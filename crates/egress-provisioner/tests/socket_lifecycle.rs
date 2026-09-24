#![cfg(target_os = "linux")]

use egress_provisioner::{now_unix, sign_lease, Action, Lease, Request, Response, PROTOCOL};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::MetadataExt;
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

const KEY: &str = "0123456789abcdef0123456789abcdef";

fn request(action: Action, model_id: &str, nonce: &str) -> Request {
    let mut lease = Lease {
        org_id: "isolated_org".to_string(),
        model_id: model_id.to_string(),
        mode: "wireguard".to_string(),
        nonce: nonce.to_string(),
        expires_unix: now_unix().unwrap() + 60,
        signature: String::new(),
    };
    lease.signature = sign_lease(KEY.as_bytes(), action, &lease).unwrap();
    Request {
        protocol: PROTOCOL.to_string(),
        request_id: format!("socket_request_{nonce}"),
        action,
        lease,
    }
}

fn connect(socket: &Path, child: &mut Child) -> UnixStream {
    for _ in 0..100 {
        if let Ok(stream) = UnixStream::connect(socket) {
            return stream;
        }
        if let Some(status) = child.try_wait().unwrap() {
            panic!("provisioner exited before accepting the local socket: {status}");
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("provisioner did not create its local socket");
}

fn call(socket: &Path, child: &mut Child, request: &Request) -> Response {
    let mut stream = connect(socket, child);
    stream
        .write_all(format!("{}\n", serde_json::to_string(request).unwrap()).as_bytes())
        .unwrap();
    stream.flush().unwrap();
    let mut line = String::new();
    BufReader::new(stream).read_line(&mut line).unwrap();
    let response: Result<Response, String> = serde_json::from_str(&line).unwrap();
    response.unwrap_or_else(|error| panic!("provisioner rejected signed socket request: {error}"))
}

#[test]
fn signed_unix_socket_lifecycle_creates_inspects_and_releases_namespace() {
    assert_eq!(
        std::env::var("AXIOM_EGRESS_ISOLATED_REHEARSAL").as_deref(),
        Ok("1"),
        "this test must run only in the isolated Linux rehearsal"
    );
    let suffix = format!("{}_{}", std::process::id(), now_unix().unwrap());
    let socket = std::env::temp_dir().join(format!("axiom-egress-{suffix}.sock"));
    let model_id = format!("socket_model_{suffix}");
    let _ = fs::remove_file(&socket);
    let uid = fs::metadata("/proc/self").unwrap().uid().to_string();
    let mut child = Command::new(env!("CARGO_BIN_EXE_egress-provisioner"))
        .args(["--socket", socket.to_str().unwrap()])
        .env("AXIOM_EGRESS_LEASE_KEY", KEY)
        .env("AXIOM_EGRESS_CONTROL_UID", uid)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let result = (|| {
        assert_eq!(
            call(
                &socket,
                &mut child,
                &request(Action::Create, &model_id, "socket_create_0001")
            )
            .status,
            "created"
        );
        assert_eq!(
            call(
                &socket,
                &mut child,
                &request(Action::Inspect, &model_id, "socket_inspect_0001")
            )
            .status,
            "ready"
        );
        assert_eq!(
            call(
                &socket,
                &mut child,
                &request(Action::Release, &model_id, "socket_release_0001")
            )
            .status,
            "released"
        );
    })();
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(&socket);
    result
}
