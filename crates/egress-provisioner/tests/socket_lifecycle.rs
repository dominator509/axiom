#![cfg(target_os = "linux")]

use egress_plane::netns;
use egress_provisioner::{
    now_unix, sign_lease, sign_lease_with_binding, Action, BindingPolicy, Lease, Request, Response,
    PROTOCOL,
};
use std::fs;
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
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
        binding: None,
    }
}

fn wait_for_socket(socket: &Path, child: &mut Child) {
    for _ in 0..100 {
        if socket.exists() {
            fs::set_permissions(socket, fs::Permissions::from_mode(0o660)).unwrap();
            return;
        }
        if let Some(status) = child.try_wait().unwrap() {
            panic!("provisioner exited before accepting the local socket: {status}");
        }
        thread::sleep(Duration::from_millis(20));
    }
    panic!("provisioner did not create its local socket");
}

fn call(socket: &Path, child: &mut Child, request: &Request) -> Response {
    wait_for_socket(socket, child);
    let client_bin = std::env::var_os("AXIOM_EGRESS_SOCKET_CLIENT_BIN")
        .expect("isolated rehearsal must build the unprivileged socket client");
    let output = Command::new("setpriv")
        .args(["--reuid=65534", "--regid=0", "--clear-groups", "--"])
        .arg(client_bin)
        .env("AXIOM_EGRESS_SOCKET_PATH", socket)
        .env(
            "AXIOM_EGRESS_SOCKET_REQUEST",
            serde_json::to_string(request).unwrap(),
        )
        .output()
        .expect("setpriv must launch the unprivileged socket client");
    if !output.status.success() {
        panic!(
            "unprivileged socket client failed: {}; {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout
        .lines()
        .find_map(|line| line.strip_prefix("AXIOM_SOCKET_RESPONSE="))
        .expect("unprivileged socket client must return one response");
    let response: Result<Response, String> = serde_json::from_str(line).unwrap();
    response.unwrap_or_else(|error| panic!("provisioner rejected signed socket request: {error}"))
}

fn assert_root_peer_rejected(socket: &Path, child: &mut Child) {
    wait_for_socket(socket, child);
    let stream = UnixStream::connect(socket).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(
        response.is_empty(),
        "root peer received a provisioner response"
    );
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
    let state_file = std::env::temp_dir().join(format!("axiom-state-{suffix}.json"));
    let model_id = format!("socket_model_{suffix}");
    let _ = fs::remove_file(&socket);
    let mut child = Command::new(env!("CARGO_BIN_EXE_egress-provisioner"))
        .args(["--socket", socket.to_str().unwrap()])
        .env("AXIOM_EGRESS_LEASE_KEY", KEY)
        .env("AXIOM_EGRESS_CONTROL_UID", "65534")
        .env("AXIOM_EGRESS_RUNTIME_MODE", "isolated-direct")
        .env(
            "AXIOM_EGRESS_SIDECAR_BIN",
            std::env::var("AXIOM_EGRESS_SIDECAR_BIN").expect("sidecar test binary must be built"),
        )
        .env("AXIOM_EGRESS_SIDECAR_UID", "65534")
        .env("AXIOM_EGRESS_SIDECAR_GID", "65534")
        .env("AXIOM_EGRESS_STATE_FILE", &state_file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();

    let result = (|| {
        assert_root_peer_rejected(&socket, &mut child);
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

#[test]
fn signed_socket_bind_starts_non_root_sidecar_and_releases_exact_resources() {
    assert_eq!(
        std::env::var("AXIOM_EGRESS_ISOLATED_REHEARSAL").as_deref(),
        Ok("1"),
        "this test must run only in the isolated Linux rehearsal"
    );
    let suffix = format!("{}_{}", std::process::id(), now_unix().unwrap());
    let socket = std::env::temp_dir().join(format!("axiom-egress-bind-{suffix}.sock"));
    let state_file = std::env::temp_dir().join(format!("axiom-egress-state-{suffix}.json"));
    let model_id = format!("socket_bind_{suffix}");
    let _ = fs::remove_file(&socket);
    let _ = fs::remove_file(&state_file);
    let mut child = Command::new(env!("CARGO_BIN_EXE_egress-provisioner"))
        .args(["--socket", socket.to_str().unwrap()])
        .env("AXIOM_EGRESS_LEASE_KEY", KEY)
        .env("AXIOM_EGRESS_CONTROL_UID", "65534")
        .env("AXIOM_EGRESS_RUNTIME_MODE", "isolated-direct")
        .env(
            "AXIOM_EGRESS_SIDECAR_BIN",
            std::env::var("AXIOM_EGRESS_SIDECAR_BIN").expect("sidecar test binary must be built"),
        )
        .env("AXIOM_EGRESS_SIDECAR_UID", "65534")
        .env("AXIOM_EGRESS_SIDECAR_GID", "65534")
        .env("AXIOM_EGRESS_STATE_FILE", &state_file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();

    let mut lease = Lease {
        org_id: "isolated_org".to_string(),
        model_id: model_id.clone(),
        mode: "http".to_string(),
        nonce: format!("bind_nonce_{suffix}"),
        expires_unix: now_unix().unwrap() + 60,
        signature: String::new(),
    };
    let binding = BindingPolicy {
        subnet_octet: 250,
        proxy_addr: Some("192.0.2.10:3128".to_string()),
        proxy_connect_addr: Some("192.0.2.10:3128".to_string()),
        proxy_username: Some("synthetic-user".to_string()),
        proxy_password: Some("synthetic-password".to_string()),
        wg_public_key: None,
        wg_endpoint: None,
        wg_allowed_ips: None,
        wg_persistent_keepalive: None,
        wg_private_key: None,
        wg_preshared_key: None,
        iface_addr: None,
    };
    lease.signature =
        sign_lease_with_binding(KEY.as_bytes(), Action::Bind, &lease, Some(&binding)).unwrap();
    let bind = Request {
        protocol: PROTOCOL.to_string(),
        request_id: format!("socket_bind_request_{suffix}"),
        action: Action::Bind,
        lease,
        binding: Some(binding),
    };
    let mut release_lease = Lease {
        org_id: "isolated_org".to_string(),
        model_id: model_id.clone(),
        mode: "http".to_string(),
        nonce: format!("release_nonce_{suffix}"),
        expires_unix: now_unix().unwrap() + 60,
        signature: String::new(),
    };
    release_lease.signature = sign_lease(KEY.as_bytes(), Action::Release, &release_lease).unwrap();
    let release = Request {
        protocol: PROTOCOL.to_string(),
        request_id: format!("socket_release_request_{suffix}"),
        action: Action::Release,
        lease: release_lease,
        binding: None,
    };
    let address: std::net::SocketAddr = "10.240.250.2:8080".parse().unwrap();

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let response = call(&socket, &mut child, &bind);
        assert_eq!(response.status, "bound");
        let info = response
            .binding
            .expect("bind response must identify the real sidecar");
        assert_eq!(info.host_ip, "10.240.250.2");
        assert_eq!(info.ns_ip, "10.240.250.2");
        assert_eq!(
            info.upstream_connect_addr.as_deref(),
            Some("192.0.2.10:3128")
        );
        std::net::TcpStream::connect_timeout(&address, Duration::from_secs(2))
            .expect("sidecar must listen on its model namespace address");

        let uid_line = std::fs::read_dir("/proc")
            .unwrap()
            .filter_map(Result::ok)
            .filter_map(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .parse::<u32>()
                    .ok()
                    .map(|pid| (pid, entry.path()))
            })
            .find_map(|(_, path)| {
                let cmdline = fs::read(path.join("cmdline")).ok()?;
                if !cmdline
                    .windows(b"--sidecar".len())
                    .any(|part| part == b"--sidecar")
                    || !cmdline
                        .windows(address.to_string().len())
                        .any(|part| part == address.to_string().as_bytes())
                {
                    return None;
                }
                fs::read_to_string(path.join("status"))
                    .ok()?
                    .lines()
                    .find(|line| line.starts_with("Uid:"))
                    .map(str::to_string)
            })
            .expect("sidecar process identity must be observable in the isolated test container");
        assert!(
            uid_line.split_whitespace().nth(1) == Some("65534"),
            "sidecar must drop root identity"
        );

        assert!(!info.veth_host.is_empty());
    }));
    let cleanup = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        assert_eq!(call(&socket, &mut child, &release).status, "released");
        assert!(
            std::net::TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_err()
        );
    }));
    let _ = child.kill();
    let _ = child.wait();
    let namespace = format!("egress_{model_id}");
    let _ = netns::teardown_veth(&netns::veth_host_name(&namespace));
    let _ = netns::delete_netns(&namespace);
    if let Ok(manifest) = fs::read_to_string(&state_file) {
        assert!(!manifest.contains(&model_id));
        assert!(!manifest.contains("synthetic-password"));
        assert!(!manifest.contains("192.0.2.10"));
    }
    assert!(!Path::new("/run/netns").join(&namespace).exists());
    let _ = fs::remove_file(&socket);
    let _ = fs::remove_file(&state_file);
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
    if let Err(payload) = cleanup {
        std::panic::resume_unwind(payload);
    }
}
