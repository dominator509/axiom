//! Real sockets and a locally generated CA; no external service or live secret.
#![cfg(target_os = "linux")]
use std::{
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_rustls::{
    rustls::{
        self,
        pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer},
    },
    TlsAcceptor,
};

struct Sidecar(Child);
impl Drop for Sidecar {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn start_sidecar(upstream: &str, ca: Option<&std::path::Path>) -> (u16, Sidecar) {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_egress-plane"));
    cmd.args(["--sidecar", "--listen", &format!("127.0.0.1:{port}")])
        .env_clear()
        .env("SIDECAR_UPSTREAM", upstream)
        .stderr(Stdio::null())
        .stdout(Stdio::null());
    if let Some(ca) = ca {
        cmd.env("EGRESS_PROXY_CA_FILE", ca);
    }
    let child = Sidecar(cmd.spawn().unwrap());
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return (port, child);
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("sidecar did not listen");
}

async fn connect_header(port: u16) -> String {
    let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    client
        .write_all(b"CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n")
        .await
        .unwrap();
    let mut buf = [0u8; 1024];
    match tokio::time::timeout(Duration::from_secs(2), client.read(&mut buf)).await {
        Ok(Ok(n)) => String::from_utf8_lossy(&buf[..n]).into_owned(),
        _ => String::new(),
    }
}

#[tokio::test]
async fn http_connect_refusal_cannot_masquerade_as_success() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = upstream.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut s, _) = upstream.accept().await.unwrap();
        let mut buf = [0u8; 1024];
        let _ = s.read(&mut buf).await;
        s.write_all(b"HTTP/1.1 407 200 is not the status\r\n\r\n")
            .await
            .unwrap();
    });
    let (local, _child) = start_sidecar(&format!("proxy:http:127.0.0.1:{port}"), None).await;
    assert!(!connect_header(local).await.contains("200"));
}

#[tokio::test]
async fn socks_auth_failure_cannot_acknowledge_target_connection() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = upstream.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut s, _) = upstream.accept().await.unwrap();
        let mut greeting = [0u8; 4];
        s.read_exact(&mut greeting).await.unwrap();
        // Requires credentials that were not configured. No fallback to no-auth.
        s.write_all(&[5, 2]).await.unwrap();
    });
    let (local, _child) = start_sidecar(&format!("proxy:socks5:127.0.0.1:{port}"), None).await;
    assert!(!connect_header(local).await.contains("200"));
}

#[tokio::test]
async fn https_proxy_requires_verified_tls_without_plaintext_fallback() {
    let dir = std::env::temp_dir().join(format!("egress-ca-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _fixture = Fixture(dir.clone());
    let openssl = |args: &[&str]| {
        assert!(Command::new("openssl")
            .current_dir(&dir)
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
    };
    openssl(&[
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "ca.key",
        "-out",
        "ca.pem",
        "-days",
        "1",
        "-subj",
        "/CN=EgressTestCA",
    ]);
    openssl(&[
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        "server.key",
        "-out",
        "server.csr",
        "-subj",
        "/CN=localhost",
    ]);
    std::fs::write(dir.join("extensions"), "basicConstraints=CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n").unwrap();
    openssl(&[
        "x509",
        "-req",
        "-in",
        "server.csr",
        "-CA",
        "ca.pem",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-out",
        "server.pem",
        "-days",
        "1",
        "-extfile",
        "extensions",
    ]);
    let cert = CertificateDer::from_pem_file(dir.join("server.pem")).unwrap();
    let key = PrivateKeyDer::from_pem_file(dir.join("server.key")).unwrap();
    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(config));
    let server = TcpListener::bind("0.0.0.0:0").await.unwrap();
    let port = server.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        loop {
            let (tcp, _) = server.accept().await.unwrap();
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                if let Ok(mut tls) = acceptor.accept(tcp).await {
                    let mut head = Vec::new();
                    while head.len() < 4096 && !head.ends_with(b"\r\n\r\n") {
                        match tls.read_u8().await {
                            Ok(byte) => head.push(byte),
                            Err(_) => return,
                        }
                    }
                    if head.starts_with(b"CONNECT example.test:443 HTTP/1.1\r\n") {
                        let _ = tls
                            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                            .await;
                    }
                }
            });
        }
    });
    let url = format!("proxy:https:127.0.0.1:{port}");
    let (untrusted, _untrusted_child) = start_sidecar(&url, None).await;
    assert!(
        !connect_header(untrusted).await.contains("200"),
        "untrusted TLS accepted"
    );
    let (trusted, _trusted_child) = start_sidecar(&url, Some(&dir.join("ca.pem"))).await;
    assert!(
        connect_header(trusted).await.starts_with("HTTP/1.1 200"),
        "trusted TLS failed"
    );
    let (wrong_host, _wrong_host_child) = start_sidecar(
        &format!("proxy:https:127.0.0.2:{port}"),
        Some(&dir.join("ca.pem")),
    )
    .await;
    assert!(
        !connect_header(wrong_host).await.contains("200"),
        "TLS hostname mismatch accepted"
    );
    task.abort();
}

#[tokio::test]
async fn dead_direct_target_never_receives_a_successful_socks_ack() {
    let dead_port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (local, _child) = start_sidecar("direct", None).await;
    let mut client = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
    client.write_all(&[5, 1, 0]).await.unwrap();
    let mut greeting = [0u8; 2];
    client.read_exact(&mut greeting).await.unwrap();
    assert_eq!(greeting, [5, 0]);
    let mut request = vec![5, 1, 0, 1, 127, 0, 0, 1];
    request.extend_from_slice(&dead_port.to_be_bytes());
    client.write_all(&request).await.unwrap();
    let mut reply = [0u8; 10];
    let n = client.read(&mut reply).await.unwrap_or(0);
    assert!(
        n == 0 || reply[1] != 0,
        "sidecar announced a nonexistent connection"
    );
}
