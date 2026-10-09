#[cfg(not(unix))]
fn main() {
    eprintln!("egress-provisioner requires a Unix host");
    std::process::exit(1);
}

#[cfg(unix)]
mod unix {
    use egress_provisioner::{
        now_unix, ProvisionError, ProvisionerRuntime, ReplayRegistry, Request, Response,
        RuntimeSettings,
    };
    use std::env;
    use std::io;
    use std::os::fd::{FromRawFd, RawFd};
    use std::os::unix::net::UnixListener as StdUnixListener;
    use std::path::Path;
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{UnixListener, UnixStream};
    use zeroize::{Zeroize, Zeroizing};

    const MAX_REQUEST_BYTES: usize = 16 * 1024;

    struct Server {
        key: Zeroizing<Vec<u8>>,
        allowed_uid: u32,
        used_nonces: ReplayRegistry,
        runtime: Arc<ProvisionerRuntime>,
    }

    #[tokio::main]
    pub async fn run() {
        let args: Vec<String> = env::args().collect();
        if args.get(1).is_some_and(|arg| arg == "--stdio") {
            stdio().await;
            return;
        }
        if args.get(1).map(String::as_str) != Some("--socket") || args.len() != 3 {
            eprintln!("usage: egress-provisioner --socket <path> | --stdio");
            std::process::exit(64);
        }
        let server = match server_from_env() {
            Ok(server) => Arc::new(server),
            Err(error) => fail(error),
        };
        let listener = match activated_listener().or_else(|_| bind_listener(&args[2])) {
            Ok(listener) => listener,
            Err(error) => fail(error),
        };
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(error) => fail(error),
            };
            let server = server.clone();
            tokio::spawn(async move {
                let _ = handle_socket(stream, server).await;
            });
        }
    }

    async fn stdio() {
        let key = match env::var("AXIOM_EGRESS_LEASE_KEY") {
            Ok(value) => Zeroizing::new(value.into_bytes()),
            Err(_) => fail(io::Error::other("AXIOM_EGRESS_LEASE_KEY is required")),
        };
        let runtime = match RuntimeSettings::from_env().and_then(ProvisionerRuntime::new) {
            Ok(runtime) => runtime,
            Err(error) => fail(error),
        };
        let mut lines = BufReader::new(tokio::io::stdin()).lines();
        let mut output = tokio::io::stdout();
        let used_nonces = ReplayRegistry::default();
        while let Ok(Some(mut line)) = lines.next_line().await {
            let response = parse_and_apply(&mut line, &key, &used_nonces, &runtime);
            line.zeroize();
            let encoded = serde_json::to_string(&response)
                .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string());
            let _ = output.write_all(format!("{encoded}\n").as_bytes()).await;
        }
    }

    fn server_from_env() -> io::Result<Server> {
        let key = env::var("AXIOM_EGRESS_LEASE_KEY")
            .map_err(|_| io::Error::other("AXIOM_EGRESS_LEASE_KEY is required"))?;
        if key.len() < 32 {
            return Err(io::Error::other(
                "AXIOM_EGRESS_LEASE_KEY must be at least 32 bytes",
            ));
        }
        let key = Zeroizing::new(key.into_bytes());
        let allowed_uid = env::var("AXIOM_EGRESS_CONTROL_UID")
            .map_err(|_| io::Error::other("AXIOM_EGRESS_CONTROL_UID is required"))?
            .parse::<u32>()
            .map_err(|_| io::Error::other("AXIOM_EGRESS_CONTROL_UID must be numeric"))?;
        if allowed_uid == 0 {
            return Err(io::Error::other(
                "AXIOM_EGRESS_CONTROL_UID must identify an unprivileged caller",
            ));
        }
        let runtime = Arc::new(ProvisionerRuntime::new(RuntimeSettings::from_env()?)?);
        let _watchdog = ProvisionerRuntime::start_sidecar_watchdog(&runtime)?;
        Ok(Server {
            key,
            allowed_uid,
            used_nonces: ReplayRegistry::default(),
            runtime,
        })
    }

    fn activated_listener() -> io::Result<UnixListener> {
        if env::var("LISTEN_FDS").ok().as_deref() != Some("1") {
            return Err(io::Error::other("no systemd socket activation fd"));
        }
        let pid = env::var("LISTEN_PID")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(|| io::Error::other("LISTEN_PID missing"))?;
        if pid != std::process::id() {
            return Err(io::Error::other("LISTEN_PID does not match provisioner"));
        }
        // systemd passes the first listening descriptor at FD 3.
        let listener = unsafe { StdUnixListener::from_raw_fd(3 as RawFd) };
        listener.set_nonblocking(true)?;
        UnixListener::from_std(listener)
    }

    fn bind_listener(path: &str) -> io::Result<UnixListener> {
        let path = Path::new(path);
        if path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "refusing to replace existing socket",
            ));
        }
        UnixListener::bind(path)
    }

    async fn handle_socket(stream: UnixStream, server: Arc<Server>) -> io::Result<()> {
        let cred = stream.peer_cred()?;
        if cred.uid() != server.allowed_uid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "unexpected provisioner peer uid",
            ));
        }
        let (read, mut write) = stream.into_split();
        let mut reader = BufReader::new(read).take((MAX_REQUEST_BYTES + 2) as u64);
        let mut bytes = Vec::with_capacity(512);
        let read = reader.read_until(b'\n', &mut bytes).await?;
        if read == 0 {
            return Ok(());
        }
        if bytes.len() > MAX_REQUEST_BYTES + 1 || bytes.last() != Some(&b'\n') {
            bytes.zeroize();
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request exceeds size limit",
            ));
        }
        bytes.pop();
        if bytes.len() > MAX_REQUEST_BYTES {
            bytes.zeroize();
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request exceeds size limit",
            ));
        }
        let mut line = match String::from_utf8(bytes) {
            Ok(line) => line,
            Err(error) => {
                let mut bytes = error.into_bytes();
                bytes.zeroize();
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "request is not valid UTF-8",
                ));
            }
        };
        let response =
            parse_and_apply(&mut line, &server.key, &server.used_nonces, &server.runtime);
        line.zeroize();
        let encoded = serde_json::to_string(&response).map_err(io::Error::other)?;
        write.write_all(format!("{encoded}\n").as_bytes()).await
    }

    fn parse_and_apply(
        line: &mut String,
        key: &[u8],
        used_nonces: &ReplayRegistry,
        runtime: &ProvisionerRuntime,
    ) -> Result<Response, String> {
        let request: Request =
            serde_json::from_str(line).map_err(|_| "invalid request".to_string())?;
        let now = now_unix().map_err(error_text)?;
        egress_provisioner::validate_request(&request, key, now).map_err(error_text)?;
        let nonce = request.lease.nonce.clone();
        used_nonces.reserve(&nonce).map_err(error_text)?;
        runtime.apply(&request, key, now).map_err(error_text)
    }

    fn error_text(error: ProvisionError) -> String {
        match error {
            ProvisionError::Unauthorized => "lease authentication failed".to_string(),
            ProvisionError::Invalid(_) | ProvisionError::Netns(_) => {
                "provisioner request rejected".to_string()
            }
        }
    }

    fn fail(error: impl std::fmt::Display) -> ! {
        eprintln!("egress-provisioner startup failed: {error}");
        std::process::exit(1)
    }
}

#[cfg(unix)]
fn main() {
    unix::run();
}
