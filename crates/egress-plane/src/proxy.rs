//! Per-model sidecar forward proxy (L2.6 enforcement).
//!
//! The sidecar runs INSIDE the model's network namespace (`ip netns exec`),
//! listening on the netns-side veth address. API/connector clients connect to
//! the host-side veth address and use this proxy (SOCKS5 or HTTP CONNECT).
//! Because the process lives in the namespace, its outbound routing is
//! governed by the namespace rules (fail-closed blackhole or tunnel) — a
//! client can never construct an unbound connection, since every byte leaves
//! through the sidecar. This is the "namespace-scoped client factory" from
//! L2.6 §Interaction with connectors & MCP.
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
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{debug, info, warn};

/// How the sidecar reaches the outside world.
#[derive(Debug, Clone)]
pub enum Upstream {
    /// Connect directly to the target (routed by the netns — used with
    /// WireGuard/VPN tunnels).
    Direct,
    /// Forward through an external egress proxy.
    Proxy {
        kind: ProxyKind,
        addr: String,
        username: Option<String>,
        password: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyKind {
    Http,
    Socks5,
}

#[allow(clippy::should_implement_trait)]
impl ProxyKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "http" | "https" => Some(ProxyKind::Http),
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
        let target = socks5_handshake(&mut socket, &upstream).await?;
        let mut target_stream = connect_target(&upstream, &target).await?;
        tokio::io::copy_bidirectional(&mut socket, &mut target_stream).await?;
    } else {
        http_forward(&mut socket, &upstream).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// SOCKS5 (RFC 1928) — no-auth + username/password (RFC 1929) upstream auth
// ---------------------------------------------------------------------------

async fn socks5_handshake(socket: &mut TcpStream, upstream: &Upstream) -> io::Result<String> {
    // greeting: VER(0x05) NMETHODS METHODS
    let mut greeting = [0u8; 2];
    socket.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Err(io::Error::other("not socks5"));
    }
    let nmethods = greeting[1] as usize;
    let mut methods = vec![0u8; nmethods];
    socket.read_exact(&mut methods).await?;

    let user_pass_ok = matches!(
        upstream,
        Upstream::Proxy {
            username: Some(_),
            ..
        }
    );
    if methods.contains(&0x00) && !user_pass_ok {
        socket.write_all(&[0x05, 0x00]).await?; // no-auth
    } else if methods.contains(&0x02) && user_pass_ok {
        socket.write_all(&[0x05, 0x02]).await?; // username/password
    } else {
        socket.write_all(&[0x05, 0xff]).await?; // no acceptable methods
        return Err(io::Error::other("no acceptable socks auth method"));
    }

    // If the sidecar itself authenticates to the CLIENT (only when upstream
    // creds exist — used in tests), perform the RFC 1929 sub-negotiation.
    if user_pass_ok {
        let mut sub = [0u8; 2];
        socket.read_exact(&mut sub).await?;
        if sub[0] != 0x01 {
            return Err(io::Error::other("bad socks auth version"));
        }
        let ulen = sub[1] as usize;
        let mut uname = vec![0u8; ulen];
        socket.read_exact(&mut uname).await?;
        let mut plenb = [0u8; 1];
        socket.read_exact(&mut plenb).await?;
        let mut pass = vec![0u8; plenb[0] as usize];
        socket.read_exact(&mut pass).await?;
        socket.write_all(&[0x01, 0x00]).await?; // success
        let _ = (uname, pass);
    }

    // connect request: VER CMD RSV ATYP ...
    let mut req = [0u8; 4];
    socket.read_exact(&mut req).await?;
    if req[1] != 0x01 {
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

    // Reply success (IPv4-mapped 0.0.0.0:0).
    socket
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;
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
        socket
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
        let mut target_stream = connect_target(upstream, &target).await?;
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
        if line.to_ascii_lowercase().starts_with("proxy-connection:") {
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

async fn connect_target(upstream: &Upstream, target: &str) -> io::Result<TcpStream> {
    match upstream {
        Upstream::Direct => TcpStream::connect(target).await,
        Upstream::Proxy {
            kind,
            addr,
            username,
            password,
        } => {
            let mut proxy = TcpStream::connect(addr).await?;
            match kind {
                ProxyKind::Http => {
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
                    if !status.contains("200") {
                        return Err(io::Error::other(format!(
                            "upstream proxy refused: {status}"
                        )));
                    }
                    Ok(proxy)
                }
                ProxyKind::Socks5 => {
                    // greeting
                    proxy.write_all(&[0x05, 0x02, 0x00, 0x02]).await?;
                    let mut resp = [0u8; 2];
                    proxy.read_exact(&mut resp).await?;
                    match resp[1] {
                        0x00 => {}
                        0x02 => {
                            // username/password auth
                            let u = username.clone().unwrap_or_default();
                            let p = password.clone().unwrap_or_default();
                            let mut auth = vec![0x01, u.len() as u8];
                            auth.extend_from_slice(u.as_bytes());
                            auth.push(p.len() as u8);
                            auth.extend_from_slice(p.as_bytes());
                            proxy.write_all(&auth).await?;
                            let mut auth_resp = [0u8; 2];
                            proxy.read_exact(&mut auth_resp).await?;
                            if auth_resp[1] != 0x00 {
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
                    let mut req = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
                    req.extend_from_slice(host.as_bytes());
                    req.extend_from_slice(&port.to_be_bytes());
                    proxy.write_all(&req).await?;
                    let mut conn_resp = [0u8; 10];
                    proxy.read_exact(&mut conn_resp).await?;
                    if conn_resp[1] != 0x00 {
                        return Err(io::Error::other(format!(
                            "upstream socks connect failed: {}",
                            conn_resp[1]
                        )));
                    }
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
        exe.to_str().unwrap_or("egress-plane"),
        "--sidecar",
        "--listen",
        &listen,
    ]);
    match upstream {
        Upstream::Direct => {
            cmd.env("SIDECAR_UPSTREAM", "direct");
        }
        Upstream::Proxy {
            kind,
            addr,
            username,
            password,
        } => {
            cmd.env(
                "SIDECAR_UPSTREAM",
                format!("proxy:{}:{}", kind_str(*kind), addr),
            );
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
        ProxyKind::Socks5 => "socks5",
    }
}

/// Build the `Upstream` for a sidecar from the CLI/env arguments used by the
/// `--sidecar` entry point.
pub fn upstream_from_env() -> Upstream {
    match std::env::var("SIDECAR_UPSTREAM") {
        Ok(v) if v == "direct" => Upstream::Direct,
        Ok(v) => {
            // format: proxy:<kind>:<addr>
            let parts: Vec<&str> = v.splitn(3, ':').collect();
            if parts.len() == 3 {
                let kind = ProxyKind::from_str(parts[1]).unwrap_or(ProxyKind::Http);
                Upstream::Proxy {
                    kind,
                    addr: parts[2].to_string(),
                    username: std::env::var("SIDECAR_UPSTREAM_USER").ok(),
                    password: std::env::var("SIDECAR_UPSTREAM_PASS").ok(),
                }
            } else {
                Upstream::Direct
            }
        }
        _ => Upstream::Direct,
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
        let u = upstream_from_env();
        match u {
            Upstream::Proxy {
                kind,
                addr,
                username,
                password,
            } => {
                assert_eq!(kind, ProxyKind::Http);
                assert_eq!(addr, "proxy.example.com:3128");
                assert_eq!(username.as_deref(), Some("u"));
                assert_eq!(password.as_deref(), Some("p"));
            }
            _ => panic!("expected proxy upstream"),
        }
        std::env::set_var("SIDECAR_UPSTREAM", "direct");
        assert!(matches!(upstream_from_env(), Upstream::Direct));
    }

    #[test]
    fn listen_env_parsing() {
        std::env::set_var("SIDECAR_LISTEN", "10.240.1.2:8080");
        assert_eq!(listen_from_env(), Some("10.240.1.2:8080".parse().unwrap()));
        std::env::set_var("SIDECAR_LISTEN", "bogus");
        assert_eq!(listen_from_env(), None);
    }
}
