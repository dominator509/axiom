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

/// Load all egress config rows (optionally filtered by org). RLS is satisfied
/// by setting `app.current_org_id` per org before reading its rows.
pub async fn load_configs(client: &mut Client) -> Result<Vec<NetworkConfig>, String> {
    // Discover org ids from the rows themselves via a superuser-safe query:
    // we set the org GUC per distinct org and read that org's rows.
    let org_rows = client
        .query(
            "SELECT DISTINCT org_id FROM model_network_configs ORDER BY org_id",
            &[],
        )
        .await
        .map_err(|e| format!("distinct org query failed: {e}"))?;

    let mut out = Vec::new();
    for row in org_rows {
        let org_id: String = row.get(0);
        // Set RLS context for this org inside a transaction.
        let tx = client
            .transaction()
            .await
            .map_err(|e| format!("tx begin failed: {e}"))?;
        tx.batch_execute(&format!(
            "SELECT set_config('app.current_org_id', '{org_id}', true)"
        ))
        .await
        .map_err(|e| format!("set org ctx failed: {e}"))?;

        let rows = tx
            .query(
                "SELECT org_id, model_id, egress_mode, proxy_type, proxy_addr,
                        wg_public_key, wg_endpoint, wg_allowed_ips, wg_persistent_keepalive,
                        expected_egress_ip, failover_proxy_addrs, enc_creds, enc_nonce, dek_id
                 FROM model_network_configs
                 WHERE org_id = $1::uuid
                 ORDER BY model_id",
                &[&org_id],
            )
            .await
            .map_err(|e| format!("load configs failed: {e}"))?;

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
        tx.commit()
            .await
            .map_err(|e| format!("tx commit failed: {e}"))?;
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
    let plain = crate::crypto::decrypt_envelope(enc, nonce, key)
        .map_err(|e| format!("envelope decrypt failed: {e}"))?;
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
    let tx = client
        .transaction()
        .await
        .map_err(|e| format!("tx begin failed: {e}"))?;
    tx.batch_execute(&format!(
        "SELECT set_config('app.current_org_id', '{org_id}', true)"
    ))
    .await
    .map_err(|e| format!("set org ctx failed: {e}"))?;

    tx.execute(
        "UPDATE model_network_configs
         SET healthy = $1, last_check = now(), latency_ms = $2, last_egress_ip = $3,
             fail_count = $4, last_error = $5, updated_at = now()
         WHERE model_id = $6::uuid",
        &[
            &healthy,
            &latency_ms.map(|v| v as i32),
            &egress_ip,
            &(fail_count as i32),
            &last_error,
            &model_id,
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
        let _lock = ENV_LOCK.lock().expect("DEK test lock should not be poisoned");
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
        let _lock = ENV_LOCK.lock().expect("DEK test lock should not be poisoned");
        std::env::set_var("EGRESS_DEK", "abc");
        assert!(dek_from_env().is_none());
        std::env::remove_var("EGRESS_DEK");
    }
}
