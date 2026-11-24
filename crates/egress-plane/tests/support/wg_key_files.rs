use std::fs::{DirBuilder, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub struct WgKeyFiles {
    pub directory: PathBuf,
    pub private_key: PathBuf,
    pub preshared_key: PathBuf,
    created_files: Vec<PathBuf>,
}

impl WgKeyFiles {
    /// Failure evidence only: never include file contents or generated keys.
    pub fn diagnostics(&self) -> String {
        let mut evidence = Vec::new();
        #[cfg(target_os = "linux")]
        if let Ok(status) = std::fs::read_to_string("/proc/self/status") {
            evidence.extend(status.lines().filter(|line| {
                line.starts_with("Uid:") || line.starts_with("Gid:") || line.starts_with("Cap")
            }).map(str::to_owned));
        }
        for path in [&self.directory, &self.private_key, &self.preshared_key] {
            match std::fs::symlink_metadata(path) {
                Ok(metadata) => {
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::MetadataExt;
                        evidence.push(format!("{}: uid={} gid={} mode={:o}",
                            path.display(), metadata.uid(), metadata.gid(), metadata.mode() & 0o777));
                    }
                    #[cfg(not(unix))]
                    evidence.push(format!("{}: readonly={}", path.display(), metadata.permissions().readonly()));
                }
                Err(error) => evidence.push(format!("{}: metadata error {error}", path.display())),
            }
        }
        evidence.join("; ")
    }
}

impl Drop for WgKeyFiles {
    fn drop(&mut self) {
        // Only unlink files successfully created by this guard. Never recurse:
        // an unexpected entry must survive rather than broadening cleanup.
        for path in &self.created_files {
            let _ = std::fs::remove_file(path);
        }
        let _ = std::fs::remove_dir(&self.directory);
    }
}

pub fn create(
    root: &Path,
    name: &str,
    private_key: &str,
    preshared_key: &str,
) -> io::Result<WgKeyFiles> {
    create_with_hook(root, name, private_key, preshared_key, |_| Ok(()))
}

fn create_with_hook(
    root: &Path,
    name: &str,
    private_key: &str,
    preshared_key: &str,
    after_private: impl FnOnce(&Path) -> io::Result<()>,
) -> io::Result<WgKeyFiles> {
    if Path::new(name).components().count() != 1
        || !matches!(Path::new(name).components().next(), Some(std::path::Component::Normal(_)))
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "key directory name must be one normal component"));
    }
    let directory = root.join(name);
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&directory)?;

    fn write_new(guard: &mut WgKeyFiles, path: PathBuf, value: &str) -> io::Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path)?;
        // Register ownership before writing so errors and unwinding clean up
        // even a partially written file.
        guard.created_files.push(path);
        file.write_all(value.as_bytes())
    }

    let private_path = directory.join("private-key");
    let preshared_path = directory.join("preshared-key");
    let mut guard = WgKeyFiles {
        directory,
        private_key: private_path,
        preshared_key: preshared_path,
        created_files: Vec::with_capacity(2),
    };
    write_new(&mut guard, root.join(name).join("private-key"), private_key)?;
    after_private(&guard.directory)?;
    write_new(&mut guard, root.join(name).join("preshared-key"), preshared_key)?;
    Ok(guard)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "axiom-wg-guard-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }
    #[test]
    fn private_modes_contents_and_normal_drop() {
        let f = Fixture::new();
        let keys = create(&f.0, "keys", "synthetic-private", "synthetic-psk").unwrap();
        assert_eq!(fs::read_to_string(&keys.private_key).unwrap(), "synthetic-private");
        assert_eq!(fs::read_to_string(&keys.preshared_key).unwrap(), "synthetic-psk");
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            for (path, mode) in [(&keys.directory, 0o700), (&keys.private_key, 0o600), (&keys.preshared_key, 0o600)] {
                assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, mode);
            }
        }
        drop(keys);
        assert!(!f.0.join("keys").exists());
    }
    #[test]
    fn diagnostics_never_include_key_contents() {
        let f = Fixture::new();
        let keys = create(&f.0, "keys", "PRIVATE-CONTENT-MUST-NOT-APPEAR", "PSK-CONTENT-MUST-NOT-APPEAR").unwrap();
        let evidence = keys.diagnostics();
        assert!(!evidence.contains("PRIVATE-CONTENT-MUST-NOT-APPEAR"));
        assert!(!evidence.contains("PSK-CONTENT-MUST-NOT-APPEAR"));
        #[cfg(unix)]
        assert!(evidence.contains("mode=600") && evidence.contains("mode=700"));
    }
    #[test]
    fn panic_unwinds_and_removes_keys() {
        let f = Fixture::new();
        assert!(std::panic::catch_unwind(|| {
            let _keys = create(&f.0, "keys", "synthetic", "synthetic").unwrap();
            panic!("synthetic assertion failure");
        }).is_err());
        assert!(!f.0.join("keys").exists());
    }
    #[test]
    fn error_after_first_write_removes_partial_files() {
        let f = Fixture::new();
        assert!(create_with_hook(&f.0, "keys", "synthetic", "synthetic", |_| {
            Err(io::Error::other("synthetic creation failure"))
        }).is_err());
        assert!(!f.0.join("keys").exists());
    }
    #[test]
    fn panic_during_creation_removes_partial_files() {
        let f = Fixture::new();
        assert!(std::panic::catch_unwind(|| {
            let _ = create_with_hook(&f.0, "keys", "synthetic", "synthetic", |_| {
                panic!("synthetic creation panic")
            });
        }).is_err());
        assert!(!f.0.join("keys").exists());
    }
    #[test]
    fn failed_second_create_preserves_unowned_entry() {
        let f = Fixture::new();
        assert!(create_with_hook(&f.0, "keys", "synthetic", "synthetic", |dir| {
            fs::write(dir.join("preshared-key"), "unowned-entry")
        }).is_err());
        assert!(!f.0.join("keys/private-key").exists());
        assert_eq!(fs::read_to_string(f.0.join("keys/preshared-key")).unwrap(), "unowned-entry");
    }
    #[test]
    fn existing_directory_is_never_adopted() {
        let f = Fixture::new();
        let keys = create(&f.0, "keys", "original", "original").unwrap();
        assert!(create(&f.0, "keys", "replacement", "replacement").is_err());
        assert_eq!(fs::read_to_string(&keys.private_key).unwrap(), "original");
    }
    #[cfg(unix)]
    #[test]
    fn existing_symlink_is_never_followed() {
        let f = Fixture::new();
        fs::create_dir(f.0.join("target")).unwrap();
        std::os::unix::fs::symlink(f.0.join("target"), f.0.join("keys")).unwrap();
        assert!(create(&f.0, "keys", "synthetic", "synthetic").is_err());
        assert!(fs::symlink_metadata(f.0.join("keys")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_dir(f.0.join("target")).unwrap().count(), 0);
    }
    #[test]
    fn drop_does_not_recurse_into_unexpected_entries() {
        let f = Fixture::new();
        let keys = create(&f.0, "keys", "synthetic", "synthetic").unwrap();
        fs::write(keys.directory.join("unexpected"), "preserved").unwrap();
        drop(keys);
        assert!(!f.0.join("keys/private-key").exists());
        assert!(!f.0.join("keys/preshared-key").exists());
        assert_eq!(fs::read_to_string(f.0.join("keys/unexpected")).unwrap(), "preserved");
    }
    #[test]
    fn directory_name_cannot_escape_owned_root() {
        let f = Fixture::new();
        for name in ["", ".", "..", "/tmp/escape", "../escape", "nested/keys"] {
            assert!(create(&f.0, name, "synthetic", "synthetic").is_err(), "{name}");
        }
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 0);
    }
}
