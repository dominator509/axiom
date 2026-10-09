//! Root-owned, local-only model namespace provisioner.
//!
//! The provisioner intentionally accepts a tiny typed lifecycle protocol. It
//! never accepts a command line, path, route, interface name, provider URL or
//! raw namespace name from the caller. Namespace identity is derived from a
//! signed, bounded model lease; namespace creation starts fail-closed with
//! blackhole defaults and both IPv4/IPv6 policy DROP.

pub use egress_plane::provisioner_protocol::{
    namespace_for, now_unix, sign_lease, validate_request, Action, Lease, ProvisionError,
    ReplayRegistry, Request, Response, PROTOCOL,
};
use egress_plane::{config::EgressMode, netns};

/// Apply one signed lifecycle operation. Direct mode is intentionally rejected
/// for `create`: it has no namespace and must never consume root privileges.
pub fn apply(request: &Request, key: &[u8], now: u64) -> Result<Response, ProvisionError> {
    let mode = validate_request(request, key, now)?;
    if mode == EgressMode::Direct {
        return Err(ProvisionError::Invalid(
            "direct mode does not have a provisioned namespace".to_string(),
        ));
    }
    let namespace = namespace_for(&request.lease.model_id)?;
    match request.action {
        Action::Create => {
            create_default_deny_namespace(&namespace)?;
            Ok(Response {
                request_id: request.request_id.clone(),
                status: "created".to_string(),
                namespace,
                mode: mode.as_str().to_string(),
                default_deny: true,
            })
        }
        Action::Inspect => {
            inspect_default_deny_namespace(&namespace)?;
            Ok(Response {
                request_id: request.request_id.clone(),
                status: "ready".to_string(),
                namespace,
                mode: mode.as_str().to_string(),
                default_deny: true,
            })
        }
        Action::Release => {
            netns::delete_netns(&namespace)?;
            Ok(Response {
                request_id: request.request_id.clone(),
                status: "released".to_string(),
                namespace,
                mode: mode.as_str().to_string(),
                default_deny: true,
            })
        }
    }
}

fn create_default_deny_namespace(namespace: &str) -> Result<(), ProvisionError> {
    netns::create_netns(namespace)?;
    let setup = (|| -> Result<(), std::io::Error> {
        netns::execute_in_netns(namespace, &["ip", "link", "set", "lo", "up"])?;
        netns::set_null_default_route(namespace)?;
        // The provisioner does not accept a caller-selected gateway or port.
        // It starts from a closed firewall; a later typed attach operation may
        // add exactly the persisted model path before a runner receives a lease.
        netns::configure_default_deny_firewall(namespace)?;
        Ok(())
    })();
    if let Err(error) = setup {
        let _ = netns::delete_netns(namespace);
        return Err(error.into());
    }
    inspect_default_deny_namespace(namespace)?;
    Ok(())
}

fn inspect_default_deny_namespace(namespace: &str) -> Result<(), ProvisionError> {
    let route = netns::execute_in_netns(namespace, &["ip", "route", "show", "default"])?;
    if !route.contains("blackhole default") {
        return Err(ProvisionError::Invalid(
            "namespace has no blackhole default route".to_string(),
        ));
    }
    for tool in ["iptables", "ip6tables"] {
        let output = netns::execute_in_netns(namespace, &[tool, "-S", "OUTPUT"])?;
        if !output.contains("-P OUTPUT DROP") {
            return Err(ProvisionError::Invalid(format!(
                "{tool} output policy is not DROP"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8] = b"0123456789abcdef0123456789abcdef";

    fn request(action: Action) -> Request {
        let mut lease = Lease {
            org_id: "org_1".to_string(),
            model_id: "model_1".to_string(),
            mode: "wireguard".to_string(),
            nonce: "nonce_for_test_0001".to_string(),
            expires_unix: 1_700_000_100,
            signature: String::new(),
        };
        lease.signature = sign_lease(KEY, action, &lease).unwrap();
        Request {
            protocol: PROTOCOL.to_string(),
            request_id: "request_for_test_0001".to_string(),
            action,
            lease,
        }
    }

    #[test]
    fn valid_signed_request_has_a_deterministic_namespace() {
        let request = request(Action::Create);
        assert_eq!(
            validate_request(&request, KEY, 1_700_000_000).unwrap(),
            EgressMode::WireGuard
        );
        assert_eq!(
            namespace_for(&request.lease.model_id).unwrap(),
            "egress_model_1"
        );
    }

    #[test]
    fn lease_rejects_tampering_expiry_and_unsafe_identity() {
        let mut tampered = request(Action::Create);
        tampered.lease.model_id = "model_2".to_string();
        assert!(matches!(
            validate_request(&tampered, KEY, 1_700_000_000),
            Err(ProvisionError::Unauthorized)
        ));

        let mut expired = request(Action::Create);
        expired.lease.expires_unix = 1_699_999_999;
        assert!(matches!(
            validate_request(&expired, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));

        let mut unsafe_identity = request(Action::Create);
        unsafe_identity.lease.model_id = "model/../../host".to_string();
        assert!(matches!(
            validate_request(&unsafe_identity, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));
    }

    #[test]
    fn direct_mode_never_requests_root_namespace_lifecycle() {
        let mut direct = request(Action::Create);
        direct.lease.mode = "direct".to_string();
        direct.lease.signature = sign_lease(KEY, Action::Create, &direct.lease).unwrap();
        assert!(matches!(
            apply(&direct, KEY, 1_700_000_000),
            Err(ProvisionError::Invalid(_))
        ));
    }

    #[test]
    fn replay_registry_reserves_each_validated_nonce_once() {
        let registry = ReplayRegistry::default();
        let request = request(Action::Create);
        validate_request(&request, KEY, 1_700_000_000).unwrap();
        registry.reserve(&request.lease.nonce).unwrap();
        assert!(matches!(
            registry.reserve(&request.lease.nonce),
            Err(ProvisionError::Invalid(_))
        ));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn signed_lifecycle_creates_inspects_and_releases_a_closed_namespace() {
        assert_eq!(
            std::env::var("AXIOM_EGRESS_ISOLATED_REHEARSAL").as_deref(),
            Ok("1"),
            "this test must run only in the isolated Linux rehearsal"
        );
        let now = now_unix().unwrap();
        let model_id = format!("provisioner_{}", std::process::id());
        let build_request = |action: Action, nonce: &str| {
            let mut lease = Lease {
                org_id: "isolated_org".to_string(),
                model_id: model_id.clone(),
                mode: "wireguard".to_string(),
                nonce: nonce.to_string(),
                expires_unix: now + 60,
                signature: String::new(),
            };
            lease.signature = sign_lease(KEY, action, &lease).unwrap();
            Request {
                protocol: PROTOCOL.to_string(),
                request_id: format!("request_{nonce}"),
                action,
                lease,
            }
        };
        let create = build_request(Action::Create, "create_nonce_0001");
        let inspect = build_request(Action::Inspect, "inspect_nonce_0001");
        let release = build_request(Action::Release, "release_nonce_0001");
        let namespace = namespace_for(&model_id).unwrap();
        let _ = netns::delete_netns(&namespace);
        assert_eq!(apply(&create, KEY, now).unwrap().status, "created");
        assert_eq!(apply(&inspect, KEY, now).unwrap().status, "ready");
        assert_eq!(apply(&release, KEY, now).unwrap().status, "released");
    }
}
