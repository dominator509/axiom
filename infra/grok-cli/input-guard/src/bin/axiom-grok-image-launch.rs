//! Runs inside bubblewrap. stdin is one exact-length authorized image, never
//! a filename, token, model-selected argument or shell command.
use axiom_grok_input_guard::{seal_image, MAX_IMAGE_BYTES};
use std::io::{self, Read};
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};

fn run() -> io::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let length: usize = args
        .next()
        .and_then(|s| s.to_str().and_then(|s| s.parse().ok()))
        .filter(|n| (12..=MAX_IMAGE_BYTES).contains(n))
        .ok_or_else(|| io::Error::other("Invalid image length"))?;
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
        return Err(io::Error::other("Invalid launch protocol"));
    }
    let mut bytes = Vec::with_capacity(length);
    io::stdin()
        .lock()
        .take(length as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() != length {
        return Err(io::Error::other("Incomplete or oversized image transfer"));
    }
    let image = seal_image(&bytes)?;
    drop(bytes);
    let fd = image.as_raw_fd();
    // FD 3 is reserved only in this dedicated, single-threaded launcher.
    // dup2(3,3) would leave CLOEXEC set; dup3(3,3) would fail entirely.
    let result = if fd == 3 {
        // SAFETY: owned live FD; only its close-on-exec flag is changed.
        unsafe { libc::fcntl(fd, libc::F_SETFD, 0) }
    } else {
        // SAFETY: live source; reserved target is intentionally replaced.
        unsafe { libc::dup3(fd, 3, 0) }
    };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    let error = Command::new("/grok")
        .args(args)
        .env("AXIOM_GROK_INPUT_PROTOCOL", "sealed-v1")
        .stdin(Stdio::null())
        .exec();
    if fd != 3 {
        // SAFETY: this launcher owns the successful dup3 result on exec failure.
        unsafe {
            libc::close(3);
        }
    }
    Err(error)
}

fn main() {
    if run().is_err() {
        // Never print argv, provider diagnostics, bytes or credential paths.
        eprintln!("Grok image launch failed");
        std::process::exit(1);
    }
}
