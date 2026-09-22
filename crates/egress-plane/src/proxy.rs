//! Per-model sidecar forward proxy (L2.6 enforcement).
//!
//! The sidecar runs INSIDE the model's network namespace (`ip netns exec`),
//! listening on the netns-side veth address. API/connector clients connect to
//! the netns-side veth address and use this proxy (SOCKS5 or HTTP CONNECT).
//! Because the process lives in the namespace, its outbound routing is
//! governed by the namespace rules (fail-closed blackhole or tunnel). This
//! isolates the SIDE CAR's sockets, not the caller's process: a host-network
//! Node caller can still construct its own unbound client. Complete L2.6
//! enforcement also requires confinement of those connector/MCP callers.
//!
//! Upstream selection:
//! - proxy modes (socks5/http/https): the sidecar forwards to the model's
//!   approved external egress proxy (optionally authenticating with the
//!   envelope-decrypted proxy credentials).
//! - tunnel modes (wireguard/vpn): the sidecar connects directly; the
//!   namespace route forces every byte through the tunnel.

use base64::Engine as _;
use std::io;
use std::net::SocketAddr;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{rustls, TlsConnector};
use tracing::{debug, info, warn};

/// How the sidecar reaches the outside world.
#[derive(Clone)]
pub enum Upstream {
    /// Connect directly to the target (routed by the netns — used with
    /// WireGuard/VPN tunnels).
    Direct,
    /// Forward through an external egress proxy.
    Proxy {
        kind: ProxyKind,
        addr: String,
        /// Resolved once by the control plane and shared with the firewall.
        connect_addr: Option<SocketAddr>,
        username: Option<String>,
        password: Option<String>,
    },
}

impl std::fmt::Debug for Upstream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Direct => f.write_str("Direct"),
            Self::Proxy { kind, .. } => f
                .debug_tuple("Proxy")
                .field(kind)
                .field(&"[REDACTED]")
                .finish(),
        }
    }
}

impl Drop for Upstream {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        if let Self::Proxy {
            username, password, ..
        } = self
        {
            username.zeroize();
            password.zeroize();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyKind {
    Http,
    Https,
    Socks5,
}

#[allow(clippy::should_implement_trait)]
impl ProxyKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "http" => Some(ProxyKind::Http),
            "https" => Some(ProxyKind::Https),
            "socks5" => Some(ProxyKind::Socks5),
            _ => None,
        }
    }
}

/// Run the sidecar proxy loop until the listener errors.
pub async fn run_sidecar(listen: SocketAddr, upstream: Upstream) -> io::Result<()> {
    let listener = TcpListener::bind(listen).await?;
    info!(addr = %listen, "Sidecar proxy listening");
    loop {
        let (socket, peer) = match listener.accept().await {
            Ok(x) => x,
            Err(e) => {
                warn!(error = %e, "accept failed");
                continue;
            }
        };
        let upstream = upstream.clone();
        socket.set_nodelay(true)?;
        tokio::spawn(async move {
            if let Err(e) = handle_client(socket, upstream).await {
                debug!(peer = %peer, error = %e, "sidecar client error");
            }
        });
    }
}

async fn handle_client(mut socket: TcpStream, upstream: Upstream) -> io::Result<()> {
    // Peek the first byte: 0x05 = SOCKS5, otherwise assume HTTP.
    let mut buf = [0u8; 1];
    socket.peek(&mut buf).await?;
    if buf[0] == 0x05 {
        let target = socks5_handshake(&mut socket).await?;
        let mut target_stream = connect_target(&upstream, &target).await?;
        socket
            .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        tokio::io::copy_bidirectional(&mut socket, &mut target_stream).await?;
    } else {
        http_forward(&mut socket, &upstream).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// SOCKS5 (RFC 1928) — no-auth + username/password (RFC 1929) upstream auth
// ---------------------------------------------------------------------------

async fn socks5_handshake(socket: &mut TcpStream) -> io::Result<String> {
    // greeting: VER(0x05) NMETHODS METHODS
    let mut greeting = [0u8; 2];
    socket.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Err(io::Error::other("not socks5"));
    }
    let nmethods = greeting[1] as usize;
    let mut methods = vec![0u8; nmethods];
    socket.read_exact(&mut methods).await?;

    // Upstream credentials authenticate to the upstream only. The private
    // sidecar's callers never receive or repeat those credentials.
    if methods.contains(&0x00) {
        socket.write_all(&[0x05, 0x00]).await?; // no-auth
    } else {
        socket.write_all(&[0x05, 0xff]).await?; // no acceptable methods
        return Err(io::Error::other("no acceptable socks auth method"));
    }

    // connect request: VER CMD RSV ATYP ...
    let mut req = [0u8; 4];
    socket.read_exact(&mut req).await?;
    if req[0] != 0x05 || req[1] != 0x01 || req[2] != 0 {
        socket
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?; // command not supported
        return Err(io::Error::other("only CONNECT supported"));
    }
    let atyp = req[3];
    let target = match atyp {
        0x01 => {
            let mut ip = [0u8; 4];
            socket.read_exact(&mut ip).await?;
            let mut port = [0u8; 2];
            socket.read_exact(&mut port).await?;
            format!(
                "{}.{}.{}.{}:{}",
                ip[0],
                ip[1],
                ip[2],
                ip[3],
                u16::from_be_bytes(port)
            )
        }
        0x03 => {
            let mut len = [0u8; 1];
            socket.read_exact(&mut len).await?;
            let mut domain = vec![0u8; len[0] as usize];
            socket.read_exact(&mut domain).await?;
            let mut port = [0u8; 2];
            socket.read_exact(&mut port).await?;
            format!(
                "{}:{}",
                String::from_utf8_lossy(&domain),
                u16::from_be_bytes(port)
            )
        }
        0x04 => {
            let mut ip = [0u8; 16];
            socket.read_exact(&mut ip).await?;
            let mut port = [0u8; 2];
            socket.read_exact(&mut port).await?;
            let addr = std::net::Ipv6Addr::from(ip);
            format!("[{}]:{}", addr, u16::from_be_bytes(port))
        }
        _ => {
            return Err(io::Error::other("unsupported socks atyp"));
        }
    };

    Ok(target)
}

// ---------------------------------------------------------------------------
// HTTP forward proxy (RFC 7230 §5.3.2 absolute-form + CONNECT tunneling)
// ---------------------------------------------------------------------------

async fn http_forward(socket: &mut TcpStream, upstream: &Upstream) -> io::Result<()> {
    // Read the request head (up to 64 KiB).
    let mut buf = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    while buf.len() < 65536 {
        if socket.read(&mut byte).await? == 0 {
            break;
        }
        buf.push(byte[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let head_end = buf
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
        .ok_or_else(|| io::Error::other("request head too large/incomplete"))?;
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut lines = head.lines();
    let req_line = lines.next().unwrap_or("").to_string();
    let mut parts = req_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();

    // CONNECT: establish a raw tunnel to the target.
    if method == "CONNECT" {
        let mut target_stream = connect_target(upstream, &target).await?;
        socket
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
        tokio::io::copy_bidirectional(socket, &mut target_stream).await?;
        return Ok(());
    }

    // Absolute-form (proxy-style) request: METHOD http://host:port/path HTTP/1.1
    let url = url::Url::parse(&target).map_err(|_| io::Error::other("bad absolute-form URL"))?;
    let host = url
        .host_str()
        .ok_or_else(|| io::Error::other("absolute URL missing host"))?;
    let port = url.port_or_known_default().unwrap_or(80);
    let target_addr = format!("{host}:{port}");
    let path = if url.path().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    let query = url.query().map(|q| format!("?{q}")).unwrap_or_default();
    let origin_form = format!("{path}{query}");

    let mut target_stream = connect_target(upstream, &target_addr).await?;

    // Rebuild the request in origin-form with a Host header.
    let mut out = format!("{method} {origin_form} HTTP/1.1\r\n");
    let mut has_host = false;
    for line in head.lines().skip(1) {
        if line.to_ascii_lowercase().starts_with("host:") {
            has_host = true;
        }
        if line.to_ascii_lowercase().starts_with("proxy-connection:")
            || line
                .to_ascii_lowercase()
                .starts_with("proxy-authorization:")
        {
            continue;
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    if !has_host {
        out.push_str(&format!("Host: {host}:{port}\r\n"));
    }
    out.push_str("\r\n");
    target_stream.write_all(out.as_bytes()).await?;
    // Forward any buffered body bytes beyond the head.
    if buf.len() > head_end {
        target_stream.write_all(&buf[head_end..]).await?;
    }
    tokio::io::copy_bidirectional(socket, &mut target_stream).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Target connection (direct or through upstream proxy)
// ---------------------------------------------------------------------------

trait ProxyStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> ProxyStream for T {}

async fn connect_target(upstream: &Upstream, target: &str) -> io::Result<Box<dyn ProxyStream>> {
    match upstream {
        Upstream::Direct => {
            let tcp = TcpStream::connect(target).await?;
            tcp.set_nodelay(true)?;
            Ok(Box::new(tcp))
        }
        Upstream::Proxy {
            kind,
            addr,
            connect_addr,
            username,
            password,
        } => {
            let tcp = match connect_addr {
                Some(addr) => TcpStream::connect(addr).await?,
                None => TcpStream::connect(addr).await?,
            };
            tcp.set_nodelay(true)?;
            let mut proxy: Box<dyn ProxyStream> = if *kind == ProxyKind::Https {
                use rustls::pki_types::{pem::PemObject, CertificateDer, ServerName};
                let mut roots = rustls::RootCertStore::from_iter(
                    webpki_roots::TLS_SERVER_ROOTS.iter().cloned(),
                );
                // Operator-provided private CA trust, never an insecure TLS bypass.
                if let Ok(file) = std::env::var("EGRESS_PROXY_CA_FILE") {
                    for cert in CertificateDer::pem_file_iter(file).map_err(io::Error::other)? {
                        roots
                            .add(cert.map_err(io::Error::other)?)
                            .map_err(io::Error::other)?;
                    }
                }
                let config = rustls::ClientConfig::builder()
                    .with_root_certificates(roots)
                    .with_no_client_auth();
                let parsed =
                    url::Url::parse(&format!("https://{addr}")).map_err(io::Error::other)?;
                let host = parsed
                    .host_str()
                    .ok_or_else(|| io::Error::other("proxy hostname missing"))?;
                let name = ServerName::try_from(host.trim_matches(['[', ']']).to_owned())
                    .map_err(io::Error::other)?;
                Box::new(
                    TlsConnector::from(std::sync::Arc::new(config))
                        .connect(name, tcp)
                        .await?,
                )
            } else {
                Box::new(tcp)
            };
            match kind {
                ProxyKind::Http | ProxyKind::Https => {
                    let mut req = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
                    if let (Some(u), Some(p)) = (username, password) {
                        let cred =
                            base64::engine::general_purpose::STANDARD.encode(format!("{u}:{p}"));
                        req.push_str(&format!("Proxy-Authorization: Basic {cred}\r\n"));
                    }
                    req.push_str("\r\n");
                    proxy.write_all(req.as_bytes()).await?;
                    let mut resp = Vec::with_capacity(1024);
                    let mut byte = [0u8; 1];
                    while resp.len() < 8192 {
                        let n = proxy.read(&mut byte).await?;
                        if n == 0 {
                            break;
                        }
                        resp.push(byte[0]);
                        if resp.ends_with(b"\r\n\r\n") {
                            break;
                        }
                    }
                    let head = String::from_utf8_lossy(&resp).to_string();
                    let status = head.lines().next().unwrap_or("");
                    let fields: Vec<_> = status.split_whitespace().collect();
                    if !resp.ends_with(b"\r\n\r\n")
                        || fields.len() < 2
                        || !matches!(fields[0], "HTTP/1.0" | "HTTP/1.1")
                        || fields[1] != "200"
                    {
                        return Err(io::Error::other("upstream proxy refused CONNECT"));
                    }
                    Ok(proxy)
                }
                ProxyKind::Socks5 => {
                    // greeting
                    proxy.write_all(&[0x05, 0x02, 0x00, 0x02]).await?;
                    let mut resp = [0u8; 2];
                    proxy.read_exact(&mut resp).await?;
                    if resp[0] != 0x05 {
                        return Err(io::Error::other("invalid upstream SOCKS version"));
                    }
                    match resp[1] {
                        0x00 => {}
                        0x02 => {
                            // username/password auth
                            let u = username.clone().unwrap_or_default();
                            let p = password.clone().unwrap_or_default();
                            if u.is_empty() || u.len() > 255 || p.is_empty() || p.len() > 255 {
                                return Err(io::Error::other("invalid SOCKS credential lengths"));
                            }
                            let mut auth = vec![0x01, u.len() as u8];
                            auth.extend_from_slice(u.as_bytes());
                            auth.push(p.len() as u8);
                            auth.extend_from_slice(p.as_bytes());
                            proxy.write_all(&auth).await?;
                            let mut auth_resp = [0u8; 2];
                            proxy.read_exact(&mut auth_resp).await?;
                            if auth_resp != [0x01, 0x00] {
                                return Err(io::Error::other("upstream socks auth failed"));
                            }
                        }
                        m => {
                            return Err(io::Error::other(format!(
                                "upstream socks method {m} rejected"
                            )))
                        }
                    }
                    // connect request with domain
                    let host_port = target
                        .rsplit_once(':')
                        .ok_or_else(|| io::Error::other("bad target"))?;
                    let host = host_port.0;
                    let port: u16 = host_port
                        .1
                        .parse()
                        .map_err(|_| io::Error::other("bad target port"))?;
                    let mut req = vec![0x05, 0x01, 0x00];
                    match host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
                        Ok(std::net::IpAddr::V4(ip)) => {
                            req.push(0x01);
                            req.extend_from_slice(&ip.octets());
                        }
                        Ok(std::net::IpAddr::V6(ip)) => {
                            req.push(0x04);
                            req.extend_from_slice(&ip.octets());
                        }
                        Err(_) if !host.is_empty() && host.len() <= 255 => {
                            req.extend_from_slice(&[0x03, host.len() as u8]);
                            req.extend_from_slice(host.as_bytes());
                        }
                        _ => return Err(io::Error::other("invalid SOCKS target")),
                    }
                    req.extend_from_slice(&port.to_be_bytes());
                    proxy.write_all(&req).await?;
                    let mut conn_resp = [0u8; 4];
                    proxy.read_exact(&mut conn_resp).await?;
                    if conn_resp[0] != 0x05 || conn_resp[1] != 0x00 || conn_resp[2] != 0 {
                        return Err(io::Error::other(format!(
                            "upstream socks connect failed: {}",
                            conn_resp[1]
                        )));
                    }
                    let tail_len = match conn_resp[3] {
                        1 => 6,
                        4 => 18,
                        3 => proxy.read_u8().await? as usize + 2,
                        _ => return Err(io::Error::other("invalid SOCKS bind address")),
                    };
                    proxy.read_exact(&mut vec![0u8; tail_len]).await?;
                    Ok(proxy)
                }
            }
        }
    }
}

/// Spawn the sidecar process inside a netns. `exe` is the current binary;
/// `listen_ip` is the netns-side veth address; `sidecar_port` is the listen
/// port inside the netns. Upstream info is passed via env (never argv).
#[allow(clippy::too_many_arguments)]
pub fn spawn_sidecar_in_netns(
    ns: &str,
    exe: &std::path::Path,
    listen_ip: &str,
    sidecar_port: u16,
    upstream: &Upstream,
) -> io::Result<std::process::Child> {
    let listen = format!("{listen_ip}:{sidecar_port}");
    let mut cmd = std::process::Command::new("ip");
    cmd.args([
        "netns",
        "exec",
        ns,
        "setpriv",
        "--no-new-privs",
        "--bounding-set=-all",
        "--inh-caps=-all",
        "--ambient-caps=-all",
        exe.to_str().unwrap_or("egress-plane"),
        "--sidecar",
        "--listen",
        &listen,
    ]);
    // Do not pass the control plane's DB credentials or vault key into the
    // data-plane process. Keep only explicitly needed TLS/runtime settings.
    cmd.env_clear().env(
        "PATH",
        std::env::var("PATH").unwrap_or_else(|_| "/usr/sbin:/usr/bin:/sbin:/bin".into()),
    );
    if let Ok(ca) = std::env::var("EGRESS_PROXY_CA_FILE") {
        cmd.env("EGRESS_PROXY_CA_FILE", ca);
    }
    match upstream {
        Upstream::Direct => {
            cmd.env("SIDECAR_UPSTREAM", "direct");
        }
        Upstream::Proxy {
            kind,
            addr,
            connect_addr,
            username,
            password,
        } => {
            cmd.env(
                "SIDECAR_UPSTREAM",
                format!("proxy:{}:{}", kind_str(*kind), addr),
            );
            if let Some(addr) = connect_addr {
                cmd.env("SIDECAR_UPSTREAM_CONNECT_ADDR", addr.to_string());
            }
            if let (Some(u), Some(p)) = (username, password) {
                cmd.env("SIDECAR_UPSTREAM_USER", u);
                cmd.env("SIDECAR_UPSTREAM_PASS", p);
            }
        }
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.spawn()
}

fn kind_str(k: ProxyKind) -> &'static str {
    match k {
        ProxyKind::Http => "http",
        ProxyKind::Https => "https",
        ProxyKind::Socks5 => "socks5",
    }
}

/// Build the `Upstream` for a sidecar from the CLI/env arguments used by the
/// `--sidecar` entry point.
pub fn upstream_from_env() -> io::Result<Upstream> {
    match std::env::var("SIDECAR_UPSTREAM") {
        Ok(v) if v == "direct" => Ok(Upstream::Direct),
        Ok(v) => {
            // format: proxy:<kind>:<addr>
            let parts: Vec<&str> = v.splitn(3, ':').collect();
            if parts.len() == 3 && parts[0] == "proxy" && !parts[2].is_empty() {
                let kind = ProxyKind::from_str(parts[1])
                    .ok_or_else(|| io::Error::other("invalid proxy kind"))?;
                Ok(Upstream::Proxy {
                    kind,
                    addr: parts[2].to_string(),
                    connect_addr: std::env::var("SIDECAR_UPSTREAM_CONNECT_ADDR")
                        .ok()
                        .map(|v| v.parse().map_err(io::Error::other))
                        .transpose()?,
                    username: std::env::var("SIDECAR_UPSTREAM_USER").ok(),
                    password: std::env::var("SIDECAR_UPSTREAM_PASS").ok(),
                })
            } else {
                Err(io::Error::other("invalid sidecar upstream"))
            }
        }
        _ => Err(io::Error::other("explicit sidecar upstream required")),
    }
}

/// Parse `--listen host:port` used by the `--sidecar` entry point.
pub fn listen_from_env() -> Option<SocketAddr> {
    std::env::var("SIDECAR_LISTEN")
        .ok()
        .and_then(|v| v.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upstream_env_parsing() {
        std::env::set_var("SIDECAR_UPSTREAM", "proxy:http:proxy.example.com:3128");
        std::env::set_var("SIDECAR_UPSTREAM_USER", "u");
        std::env::set_var("SIDECAR_UPSTREAM_PASS", "p");
        let u = upstream_from_env().unwrap();
        assert!(!format!("{u:?}").contains("proxy.example.com"));
        match &u {
            Upstream::Proxy {
                kind,
                addr,
                username,
                password,
                ..
            } => {
                assert_eq!(*kind, ProxyKind::Http);
                assert_eq!(addr, "proxy.example.com:3128");
                assert_eq!(username.as_deref(), Some("u"));
                assert_eq!(password.as_deref(), Some("p"));
            }
            _ => panic!("expected proxy upstream"),
        }
        std::env::set_var("SIDECAR_UPSTREAM", "direct");
        assert!(matches!(upstream_from_env().unwrap(), Upstream::Direct));
        for invalid in [
            "",
            "proxy:typo:127.0.0.1:9",
            "oops:http:127.0.0.1:9",
            "proxy:http:",
        ] {
            std::env::set_var("SIDECAR_UPSTREAM", invalid);
            assert!(upstream_from_env().is_err());
        }
        std::env::remove_var("SIDECAR_UPSTREAM");
        assert!(upstream_from_env().is_err());
    }

    #[test]
    fn listen_env_parsing() {
        std::env::set_var("SIDECAR_LISTEN", "10.240.1.2:8080");
        assert_eq!(listen_from_env(), Some("10.240.1.2:8080".parse().unwrap()));
        std::env::set_var("SIDECAR_LISTEN", "bogus");
        assert_eq!(listen_from_env(), None);
    }
}
