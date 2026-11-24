use std::fs::{DirBuilder, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub struct WgKeyFiles {
    pub directory: PathBuf,
    pub private_key: PathBuf,
    pub preshared_key: PathBuf,
}

pub fn create(
    root: &Path,
    name: &str,
    private_key: &str,
    preshared_key: &str,
) -> io::Result<WgKeyFiles> {
    let directory = root.join(name);
    let mut builder = DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&directory)?;

    fn write_new(path: &Path, value: &str) -> io::Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)?.write_all(value.as_bytes())
    }

    let private_path = directory.join("private-key");
    let preshared_path = directory.join("preshared-key");
    write_new(&private_path, private_key)?;
    write_new(&preshared_path, preshared_key)?;
    Ok(WgKeyFiles {
        directory,
        private_key: private_path,
        preshared_key: preshared_path,
    })
}
