//! Isolated rehearsal client used to verify the provisioner peer-UID boundary.

#[cfg(unix)]
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;

#[cfg(unix)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = std::env::var_os("AXIOM_EGRESS_SOCKET_PATH")
        .ok_or_else(|| std::io::Error::other("AXIOM_EGRESS_SOCKET_PATH is required"))?;
    let request = std::env::var("AXIOM_EGRESS_SOCKET_REQUEST").map_err(std::io::Error::other)?;
    let mut stream = UnixStream::connect(socket)?;
    stream.write_all(format!("{request}\n").as_bytes())?;
    stream.flush()?;
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line)?;
    if line.is_empty() || !line.ends_with('\n') {
        return Err("provisioner returned no complete response".into());
    }
    println!("AXIOM_SOCKET_RESPONSE={}", line.trim_end());
    Ok(())
}

#[cfg(not(unix))]
fn main() {
    panic!("the isolated socket client is only available on Unix");
}
