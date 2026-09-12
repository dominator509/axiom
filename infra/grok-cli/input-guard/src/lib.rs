//! Source-image capability for the Grok CLI integration. The model never
//! supplies an OS path. This does not enable video by itself: the upstream
//! resolver must call this boundary, and the launcher must provide the one
//! authorized descriptor. Missing integration must remain fail-closed.
#[cfg(not(target_os = "linux"))]
compile_error!("The Grok sealed-image input guard requires Linux");

use std::fs::File;
use std::io::{self, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::FileExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

pub const IMAGE_REFERENCE: &str = "axiom-input://image";
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const SEALS: i32 = libc::F_SEAL_WRITE | libc::F_SEAL_GROW | libc::F_SEAL_SHRINK | libc::F_SEAL_SEAL;
static INHERITED: OnceLock<Result<AuthorizedImage, ()>> = OnceLock::new();

/// Call at the very start of the dedicated patched CLI, before threads or
/// plugins. Both success and failure are cached, so reuse of FD 3 cannot grant
/// a new capability. A process without the explicit launcher protocol never
/// inspects or closes an ambient FD 3.
pub fn initialize_inherited_image() -> io::Result<()> {
    let image = INHERITED.get_or_init(|| {
        if std::env::var("AXIOM_GROK_INPUT_PROTOCOL").as_deref() != Ok("sealed-v1") {
            return Err(());
        }
        // SAFETY: fcntl rejects invalid descriptors; duplicate owns a new FD.
        let duplicate = unsafe { libc::fcntl(3, libc::F_DUPFD_CLOEXEC, 4) };
        if duplicate < 0 {
            return Err(());
        }
        // SAFETY: the launch protocol transfers ownership of reserved FD 3.
        unsafe {
            libc::close(3);
        }
        // SAFETY: successful F_DUPFD_CLOEXEC returns a uniquely owned FD.
        AuthorizedImage::new(unsafe { File::from_raw_fd(duplicate) }).map_err(|_| ())
    });
    image.as_ref().map(|_| ()).map_err(|_| denied())
}

/// Resolver entry point. Never lazily initializes after runtime startup.
pub fn read_inherited_image(reference: &str) -> io::Result<Vec<u8>> {
    match INHERITED.get() {
        Some(Ok(image)) => image.read_once(reference),
        _ => Err(denied()),
    }
}

fn denied() -> io::Error {
    io::Error::new(
        io::ErrorKind::PermissionDenied,
        "Unauthorized Grok image input",
    )
}

/// Called by the trusted launcher with already-authorized image bytes. The
/// descriptor defaults to close-on-exec; inheritance must be explicit and
/// limited to the patched CLI, never ambient in arbitrary subprocesses.
pub fn seal_image(bytes: &[u8]) -> io::Result<File> {
    if !(12..=MAX_IMAGE_BYTES).contains(&bytes.len()) {
        return Err(denied());
    }
    // SAFETY: the name is a NUL-terminated static string; flags are Linux ABI.
    let fd = unsafe {
        libc::memfd_create(
            c"axiom-grok-image".as_ptr(),
            libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
        )
    };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: memfd_create returned a new descriptor owned by this function.
    let mut file = unsafe { File::from_raw_fd(fd) };
    file.write_all(bytes)?;
    // SAFETY: file owns a live descriptor; F_ADD_SEALS takes an integer mask.
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, SEALS) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(file)
}

/// One capability per request, created once by trusted CLI initialization.
/// Do not reconstruct this object for each model tool call or retry.
pub struct AuthorizedImage {
    file: File,
    length: usize,
    used: AtomicBool,
    owner_pid: u32,
}

impl AuthorizedImage {
    pub fn new(file: File) -> io::Result<Self> {
        // Devices/FIFOs are rejected without reading their contents.
        if !file.metadata()?.is_file() {
            return Err(denied());
        }
        // SAFETY: live borrowed descriptor; F_GET_SEALS takes no third arg.
        let seals = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_GET_SEALS) };
        if seals < 0 || seals & SEALS != SEALS {
            return Err(denied());
        }
        // Size is sampled only AFTER proving write/grow/shrink are impossible.
        let length = file.metadata()?.len();
        if !(12..=MAX_IMAGE_BYTES as u64).contains(&length) {
            return Err(denied());
        }
        Ok(Self {
            file,
            length: length as usize,
            used: AtomicBool::new(false),
            owner_pid: std::process::id(),
        })
    }

    pub fn read_once(&self, reference: &str) -> io::Result<Vec<u8>> {
        // No normalization, URL fetch, path resolution, or file open here.
        if reference != IMAGE_REFERENCE || std::process::id() != self.owner_pid {
            return Err(denied());
        }
        if self
            .used
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(denied());
        }
        let mut bytes = vec![0; self.length];
        // Positional reads avoid a shared descriptor-offset race. Seals bind
        // these bytes to the launcher's original snapshot throughout the read.
        self.file.read_exact_at(&mut bytes, 0)?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn source() -> Vec<u8> {
        vec![0x42; 128]
    }

    #[test]
    fn authorized_bytes_are_returned_once() {
        let bytes = source();
        let image = AuthorizedImage::new(seal_image(&bytes).unwrap()).unwrap();
        assert_eq!(image.read_once(IMAGE_REFERENCE).unwrap(), bytes);
        assert_eq!(
            image.read_once(IMAGE_REFERENCE).unwrap_err().kind(),
            io::ErrorKind::PermissionDenied
        );
    }

    #[test]
    fn paths_urls_devices_and_encoded_aliases_are_rejected() {
        let image = AuthorizedImage::new(seal_image(&source()).unwrap()).unwrap();
        for reference in [
            "/credentials/auth.json",
            "/dev/zero",
            "/proc/self/fd/3",
            "https://example.com/image.png",
            "file:///input.png",
            "../input.png",
            "axiom-input://%69mage",
            "AXIOM-INPUT://image",
            "axiom-input://image\0",
            "",
        ] {
            assert!(
                image.read_once(reference).is_err(),
                "unexpected reference accepted"
            );
        }
        assert_eq!(image.read_once(IMAGE_REFERENCE).unwrap(), source());
    }

    #[test]
    fn device_descriptor_is_rejected_without_reading() {
        assert!(AuthorizedImage::new(File::open("/dev/zero").unwrap()).is_err());
    }

    #[test]
    fn unsealed_descriptor_is_rejected() {
        // SAFETY: valid static C string and Linux flags.
        let fd = unsafe {
            libc::memfd_create(
                c"unsealed-fixture".as_ptr(),
                libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
            )
        };
        assert!(fd >= 0);
        // SAFETY: this is the sole owner of the newly created descriptor.
        let mut file = unsafe { File::from_raw_fd(fd) };
        file.write_all(&source()).unwrap();
        assert!(AuthorizedImage::new(file).is_err());
    }

    #[test]
    fn each_missing_seal_is_rejected() {
        for missing in [
            libc::F_SEAL_WRITE,
            libc::F_SEAL_GROW,
            libc::F_SEAL_SHRINK,
            libc::F_SEAL_SEAL,
        ] {
            // SAFETY: valid static C string and Linux flags.
            let fd = unsafe {
                libc::memfd_create(
                    c"partial-seals".as_ptr(),
                    libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
                )
            };
            assert!(fd >= 0);
            // SAFETY: uniquely owned successful memfd result.
            let mut file = unsafe { File::from_raw_fd(fd) };
            file.write_all(&source()).unwrap();
            // SAFETY: live fd and integer seal mask.
            assert_eq!(
                unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, SEALS & !missing) },
                0
            );
            assert!(AuthorizedImage::new(file).is_err());
        }
    }

    #[test]
    fn oversized_sealed_descriptor_is_rejected() {
        // SAFETY: valid static C string and Linux flags.
        let fd = unsafe {
            libc::memfd_create(
                c"oversized".as_ptr(),
                libc::MFD_CLOEXEC | libc::MFD_ALLOW_SEALING,
            )
        };
        assert!(fd >= 0);
        // SAFETY: uniquely owned successful memfd result.
        let file = unsafe { File::from_raw_fd(fd) };
        file.set_len(MAX_IMAGE_BYTES as u64 + 1).unwrap();
        // SAFETY: live fd and integer seal mask.
        assert_eq!(
            unsafe { libc::fcntl(file.as_raw_fd(), libc::F_ADD_SEALS, SEALS) },
            0
        );
        assert!(AuthorizedImage::new(file).is_err());
    }

    #[test]
    fn kernel_rejects_mutation_through_another_descriptor() {
        let file = seal_image(&source()).unwrap();
        let other = file.try_clone().unwrap();
        let image = AuthorizedImage::new(file).unwrap();
        assert!(other.write_at(b"changed", 0).is_err());
        assert!(other.set_len(0).is_err());
        assert!(other.set_len(256).is_err());
        assert_eq!(image.read_once(IMAGE_REFERENCE).unwrap(), source());
    }

    #[test]
    fn bounded_input_is_checked_before_allocating_a_memfd() {
        assert!(seal_image(&[0; 11]).is_err());
        assert!(seal_image(&vec![0; MAX_IMAGE_BYTES + 1]).is_err());
    }

    #[test]
    fn concurrent_calls_cannot_read_the_capability_twice() {
        let image = Arc::new(AuthorizedImage::new(seal_image(&source()).unwrap()).unwrap());
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let image = Arc::clone(&image);
                std::thread::spawn(move || image.read_once(IMAGE_REFERENCE).is_ok())
            })
            .collect();
        assert_eq!(
            threads
                .into_iter()
                .filter_map(|t| t.join().ok())
                .filter(|ok| *ok)
                .count(),
            1
        );
    }
}
