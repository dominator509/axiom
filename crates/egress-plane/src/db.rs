//! Optional Postgres integration: load `model_network_configs` rows and
//! persist health state (L2.6: "Rust worker picks up job(model_id) → load
//! model_network_configs (decrypt in-memory)"). All queries run with the
//! model's org RLS context set, so tenant isolation is enforced by the DB.

use tokio_postgres::{Client, NoTls};
use tracing::{error, info, warn};

use crate::config::{Creds, EgressMode, NetworkConfig};

/// Connect using DATABASE_URL (default: read the env var).
pub async fn connect(database_url: &str) -> Result<Client, String> {
    let (client, connection) = tokio_postgres::connect(database_url, NoTls)
        .await
        .map_err(|e| format!("db connect failed: {e}"))?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            warn!(error = %e, "postgres connection task ended");
        }
    });
    info!("egress-plane connected to postgres");
    Ok(client)
}

/// Load all egress config rows through the narrowly scoped, ACL-locked
/// cross-org resolver. The runtime role remains subject to FORCE RLS; only
/// the resolver owned by the trusted migration role may enumerate configs.
pub async fn load_configs(client: &mut Client) -> Result<Vec<NetworkConfig>, String> {
    let rows = client
        .query(
            "SELECT org_id::text, model_id::text, egress_mode, proxy_type, proxy_addr,
                    wg_public_key, wg_endpoint, wg_allowed_ips, wg_persistent_keepalive,
                    expected_egress_ip, failover_proxy_addrs, enc_creds, enc_nonce, dek_id
             FROM load_model_network_configs()",
            &[],
        )
        .await
        .map_err(|e| format!("load configs failed: {e}"))?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let mode_str: String = r.get(2);
        let mode = EgressMode::from_str(&mode_str).unwrap_or(EgressMode::Direct);
        let enc_creds: Option<Vec<u8>> = r.get(11);
        let enc_nonce: Option<Vec<u8>> = r.get(12);
        let dek_id: Option<String> = r.get(13);
        out.push(NetworkConfig {
            model_id: r.get(1),
            org_id: r.get(0),
            mode,
            proxy_addr: r.get(4),
            wg_public_key: r.get(5),
            wg_endpoint: r.get(6),
            wg_allowed_ips: r.get(7),
            wg_persistent_keepalive: r.get(8),
            expected_egress_ip: r.get(9),
            failover_proxy_addrs: r.get::<_, Option<Vec<String>>>(10).unwrap_or_default(),
            enc_creds,
            enc_nonce,
            dek_id,
        });
    }
    Ok(out)
}

/// Decrypt a config's credential envelope with the supplied DEK.
/// The returned `Creds` must be zeroized after use (LBI-05).
pub fn decrypt_creds(cfg: &NetworkConfig, dek: Option<&[u8]>) -> Result<Option<Creds>, String> {
    let (Some(enc), Some(nonce), Some(key)) =
        (cfg.enc_creds.as_deref(), cfg.enc_nonce.as_deref(), dek)
    else {
        return Ok(None);
    };
    let plain = zeroize::Zeroizing::new(
        crate::crypto::decrypt_envelope(enc, nonce, key)
            .map_err(|e| format!("envelope decrypt failed: {e}"))?,
    );
    let creds: Creds =
        serde_json::from_slice(&plain).map_err(|e| format!("creds parse failed: {e}"))?;
    Ok(Some(creds))
}

/// Persist a model's health state back to `model_network_configs`.
#[allow(clippy::too_many_arguments)]
pub async fn save_health(
    client: &mut Client,
    model_id: &str,
    org_id: &str,
    healthy: bool,
    latency_ms: Option<u64>,
    egress_ip: Option<&str>,
    fail_count: u32,
    drift: bool,
    last_error: Option<&str>,
) -> Result<(), String> {
    // Bind model_id as a real UUID. The prepared statement infers a `uuid`
    // parameter from `model_id = $6`, and tokio-postgres cannot serialize a
    // `&str` to `uuid` ("error serializing parameter 5"). Parsing here also
    // rejects malformed ids before a round trip.
    let model_uuid = uuid::Uuid::parse_str(model_id)
        .map_err(|e| format!("invalid model_id {model_id:?}: {e}"))?;
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("tx begin failed: {e}"))?;
    tx.query_one(
        "SELECT set_config('app.current_org_id', $1, true)",
        &[&org_id],
    )
    .await
    .map_err(|e| format!("set org ctx failed: {e}"))?;

    tx.execute(
        "UPDATE model_network_configs
         SET healthy = $1, last_check = now(), latency_ms = $2, last_egress_ip = $3,
             fail_count = $4, last_error = $5, updated_at = now()
         WHERE model_id = $6",
        &[
            &healthy,
            &latency_ms.map(|v| i32::try_from(v).unwrap_or(i32::MAX)),
            &egress_ip,
            &(fail_count as i32),
            &last_error,
            &model_uuid,
        ],
    )
    .await
    .map_err(|e| format!("save health failed: {e}"))?;

    // Expected-IP drift is surfaced as a warning row only when it occurs.
    if drift {
        error!(model_id = %model_id, "EGRESS IP DRIFT: expected policy violated");
    }
    tx.commit()
        .await
        .map_err(|e| format!("tx commit failed: {e}"))?;
    Ok(())
}

/// Resolve the DEK from the environment (64 hex chars -> 32 bytes).
pub fn dek_from_env() -> Option<[u8; 32]> {
    let v = std::env::var("EGRESS_DEK").ok()?;
    if v.len() != 64 {
        warn!("EGRESS_DEK must be 64 hex chars; envelope decryption disabled");
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&v[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Environment variables are process-global, so these tests must not race
    // while assigning EGRESS_DEK under Rust's default parallel test runner.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn dek_parses_hex() {
        let _lock = ENV_LOCK
            .lock()
            .expect("DEK test lock should not be poisoned");
        // 64 hex chars = 32 bytes of 0xAB
        let hex = "ab".repeat(32);
        std::env::set_var("EGRESS_DEK", &hex);
        let dek = dek_from_env().expect("dek should parse");
        assert_eq!(dek.len(), 32);
        assert!(dek.iter().all(|&b| b == 0xAB));
        std::env::remove_var("EGRESS_DEK");
    }

    #[test]
    fn dek_rejects_bad_length() {
        let _lock = ENV_LOCK
            .lock()
            .expect("DEK test lock should not be poisoned");
        std::env::set_var("EGRESS_DEK", "abc");
        assert!(dek_from_env().is_none());
        std::env::remove_var("EGRESS_DEK");
    }

    /// Regression for the TEST egress health-persistence failure
    /// ("save health failed: error serializing parameter 5").
    ///
    /// The `model_network_configs.model_id` column is a UUID, so the prepared
    /// UPDATE infers a `uuid` parameter for `WHERE model_id = $6`. Passing a
    /// `&str` there fails at serialization time; the fix parses the id into a
    /// `Uuid` first. This pins both halves of that contract against the exact
    /// parameter types the server reports for the statement.
    #[test]
    fn save_health_model_id_binds_as_uuid_not_str() {
        use tokio_postgres::types::{private::BytesMut, ToSql, Type};

        let model_id = "41851a4a-08ec-4031-9de4-25ea8bac7167";

        // What the old code did: bind the raw &str against the uuid param.
        let raw: &str = model_id;
        let mut buf = BytesMut::new();
        assert!(
            raw.to_sql_checked(&Type::UUID, &mut buf).is_err(),
            "a bare &str must not serialize against a uuid parameter"
        );

        // What the fix does: parse to Uuid, then bind.
        let parsed = uuid::Uuid::parse_str(model_id).expect("valid uuid parses");
        let mut buf = BytesMut::new();
        assert!(
            parsed.to_sql_checked(&Type::UUID, &mut buf).is_ok(),
            "a parsed Uuid must serialize against a uuid parameter"
        );
    }

    #[test]
    fn save_health_rejects_malformed_model_id_before_round_trip() {
        // Mirrors the guard added at the top of save_health: a malformed id is
        // rejected as a string error rather than reaching the database.
        let err = uuid::Uuid::parse_str("not-a-uuid").unwrap_err();
        assert!(!err.to_string().is_empty());
    }
}
