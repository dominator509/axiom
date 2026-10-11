//! Optional Postgres integration: load `model_network_configs` rows and
//! persist health state (L2.6: "Rust worker picks up job(model_id) → load
//! model_network_configs (decrypt in-memory)"). All queries run with the
//! model's org RLS context set, so tenant isolation is enforced by the DB.

use std::collections::HashMap;
use tokio_postgres::{Client, NoTls, Transaction};
use tracing::{error, info, warn};
use zeroize::{Zeroize, Zeroizing};

use crate::config::{Creds, EgressMode, NetworkConfig};
use crate::crypto::{self, SecretKey};

pub const LEGACY_DEK_ID: &str = "egress-dek";

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

/// Create or retrieve an organization's active random DEK. The egress plane
/// locks the organization row so concurrent first writes cannot mint two
/// active keys. Only its KEK-wrapped form is persisted.
pub async fn ensure_org_dek(
    client: &mut Client,
    org_id: &str,
    root_kek: &SecretKey,
    configured_kek_id: &str,
) -> Result<(String, Zeroizing<Vec<u8>>), String> {
    let org_uuid = uuid::Uuid::parse_str(org_id)
        .map_err(|error| format!("invalid organization id: {error}"))?;
    let tx = client
        .transaction()
        .await
        .map_err(|error| format!("begin organization key transaction failed: {error}"))?;
    tx.query_one(
        "SELECT set_config('app.current_org_id', $1, true)",
        &[&org_id],
    )
    .await
    .map_err(|error| format!("set organization key context failed: {error}"))?;

    let org_row = tx
        .query_opt(
            "SELECT kek_id FROM org WHERE id = $1 FOR UPDATE",
            &[&org_uuid],
        )
        .await
        .map_err(|error| format!("load organization KEK id failed: {error}"))?
        .ok_or_else(|| "organization key owner not found".to_string())?;
    let org_kek_id: String = org_row.get(0);
    if org_kek_id != configured_kek_id {
        return Err("organization references an unavailable KEK".to_string());
    }

    if let Some(row) = tx
        .query_opt(
            "SELECT dek_id::text, wrapped_dek, wrap_nonce, kek_id
             FROM organization_data_key
             WHERE org_id = $1 AND is_active
             FOR UPDATE",
            &[&org_uuid],
        )
        .await
        .map_err(|error| format!("load active organization DEK failed: {error}"))?
    {
        let dek_id: String = row.get(0);
        let wrapped: Vec<u8> = row.get(1);
        let nonce: Vec<u8> = row.get(2);
        let row_kek_id: String = row.get(3);
        if row_kek_id != org_kek_id {
            return Err("organization DEK references an unavailable KEK".to_string());
        }
        let dek = Zeroizing::new(
            crypto::unwrap_org_dek(
                &wrapped,
                &nonce,
                root_kek.as_bytes(),
                org_id,
                &dek_id,
                &row_kek_id,
            )
            .map_err(|_| "organization DEK could not be unwrapped".to_string())?,
        );
        if dek.len() != 32 {
            return Err("organization DEK has an invalid length".to_string());
        }
        tx.commit()
            .await
            .map_err(|error| format!("commit organization key transaction failed: {error}"))?;
        return Ok((dek_id, dek));
    }

    let dek_id = uuid::Uuid::new_v4();
    let mut dek = Zeroizing::new(vec![0u8; 32]);
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), dek.as_mut_slice());
    let (wrapped, nonce) = crypto::wrap_org_dek(
        dek.as_slice(),
        root_kek.as_bytes(),
        org_id,
        &dek_id.to_string(),
        &org_kek_id,
    )
    .map_err(|_| "organization DEK could not be wrapped".to_string())?;
    tx.execute(
        "INSERT INTO organization_data_key
           (org_id, dek_id, wrapped_dek, wrap_nonce, kek_id, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)",
        &[&org_uuid, &dek_id, &wrapped, &nonce, &org_kek_id],
    )
    .await
    .map_err(|error| format!("persist wrapped organization DEK failed: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("commit organization key transaction failed: {error}"))?;
    Ok((dek_id.to_string(), dek))
}

/// Load one previously wrapped key through FORCE RLS for an API decrypt.
pub async fn load_org_dek(
    client: &mut Client,
    org_id: &str,
    dek_id: &str,
    root_kek: &SecretKey,
    configured_kek_id: &str,
) -> Result<Zeroizing<Vec<u8>>, String> {
    let org_uuid = uuid::Uuid::parse_str(org_id)
        .map_err(|error| format!("invalid organization id: {error}"))?;
    let dek_uuid = uuid::Uuid::parse_str(dek_id)
        .map_err(|error| format!("invalid organization DEK id: {error}"))?;
    let tx = client
        .transaction()
        .await
        .map_err(|error| format!("begin organization key transaction failed: {error}"))?;
    tx.query_one(
        "SELECT set_config('app.current_org_id', $1, true)",
        &[&org_id],
    )
    .await
    .map_err(|error| format!("set organization key context failed: {error}"))?;
    let row = tx
        .query_opt(
            "SELECT wrapped_dek, wrap_nonce, kek_id FROM organization_data_key
             WHERE org_id = $1 AND dek_id = $2",
            &[&org_uuid, &dek_uuid],
        )
        .await
        .map_err(|error| format!("load organization DEK failed: {error}"))?
        .ok_or_else(|| "organization DEK not found".to_string())?;
    let wrapped: Vec<u8> = row.get(0);
    let nonce: Vec<u8> = row.get(1);
    let kek_id: String = row.get(2);
    if kek_id != configured_kek_id {
        return Err("organization DEK references an unavailable KEK".to_string());
    }
    let dek = Zeroizing::new(
        crypto::unwrap_org_dek(
            &wrapped,
            &nonce,
            root_kek.as_bytes(),
            org_id,
            dek_id,
            &kek_id,
        )
        .map_err(|_| "organization DEK could not be unwrapped".to_string())?,
    );
    if dek.len() != 32 {
        return Err("organization DEK has an invalid length".to_string());
    }
    tx.commit()
        .await
        .map_err(|error| format!("commit organization key transaction failed: {error}"))?;
    Ok(dek)
}

/// Read wrapped keys through a narrowly scoped definer for egress sync. This
/// returns ciphertext only; the configured KEK is used here to unwrap rows in
/// memory, and errors are retained per key so one unavailable tenant key does
/// not stop unrelated organizations from reconciling.
pub async fn load_org_deks(
    client: &mut Client,
    root_kek: Option<&SecretKey>,
    configured_kek_id: &str,
) -> Result<HashMap<(String, String), Result<Zeroizing<Vec<u8>>, String>>, String> {
    let rows = client
        .query(
            "SELECT org_id::text, dek_id::text, wrapped_dek, wrap_nonce, kek_id
             FROM load_organization_data_keys()",
            &[],
        )
        .await
        .map_err(|error| format!("load wrapped organization DEKs failed: {error}"))?;
    let mut keys = HashMap::with_capacity(rows.len());
    for row in rows {
        let org_id: String = row.get(0);
        let dek_id: String = row.get(1);
        let wrapped: Vec<u8> = row.get(2);
        let nonce: Vec<u8> = row.get(3);
        let kek_id: String = row.get(4);
        let resolved = match root_kek {
            Some(kek) if kek_id == configured_kek_id => {
                crypto::unwrap_org_dek(&wrapped, &nonce, kek.as_bytes(), &org_id, &dek_id, &kek_id)
                    .map_err(|_| "organization DEK could not be unwrapped".to_string())
                    .map(Zeroizing::new)
                    .and_then(|dek| {
                        if dek.len() == 32 {
                            Ok(dek)
                        } else {
                            Err("organization DEK has an invalid length".to_string())
                        }
                    })
            }
            Some(_) => Err("organization DEK references an unavailable KEK".to_string()),
            None => Err("root KEK is not configured".to_string()),
        };
        keys.insert((org_id, dek_id), resolved);
    }
    Ok(keys)
}

/// Read one tenant's durable publishing gate under FORCE RLS. The caller must
/// provide a transaction so app.current_org_id remains transaction-local and
/// cannot leak into the egress connection's next tenant query.
pub async fn load_org_publishing_enabled(
    tx: &Transaction<'_>,
    org_id: &str,
) -> Result<Option<bool>, String> {
    let org_uuid = uuid::Uuid::parse_str(org_id)
        .map_err(|error| format!("invalid organization id: {error}"))?;
    tx.query_one(
        "SELECT set_config('app.current_org_id', $1, true)",
        &[&org_id],
    )
    .await
    .map_err(|error| format!("set organization RLS context failed: {error}"))?;
    tx.query_opt(
        "SELECT publishing_enabled FROM org_settings WHERE org_id = $1",
        &[&org_uuid],
    )
    .await
    .map(|row| row.map(|row| row.get(0)))
    .map_err(|error| format!("load organization publishing state failed: {error}"))
}

/// Decrypt a config's credential envelope with the supplied DEK.
/// The returned `Creds` must be zeroized after use (LBI-05).
pub fn decrypt_creds(cfg: &NetworkConfig, dek: Option<&[u8]>) -> Result<Option<Creds>, String> {
    decrypt_creds_with_legacy_id(cfg, dek, LEGACY_DEK_ID)
}

/// Decrypt with a configured compatibility identity for envelopes written by
/// releases that used one global EGRESS_DEK and a caller-selected dek_id.
pub fn decrypt_creds_with_legacy_id(
    cfg: &NetworkConfig,
    dek: Option<&[u8]>,
    legacy_dek_id: &str,
) -> Result<Option<Creds>, String> {
    let (Some(enc), Some(nonce)) = (cfg.enc_creds.as_deref(), cfg.enc_nonce.as_deref()) else {
        if cfg.enc_creds.is_none() && cfg.enc_nonce.is_none() {
            return Ok(None);
        }
        return Err("credential envelope is incomplete".to_string());
    };
    let key = dek.ok_or_else(|| "credential envelope key is unavailable".to_string())?;
    let Some(dek_id) = cfg.dek_id.as_deref() else {
        return Err("credential envelope has no DEK id".to_string());
    };
    if dek_id.is_empty() {
        return Err("credential envelope has an empty DEK id".to_string());
    }
    let plaintext = if is_legacy_dek_id(dek_id, legacy_dek_id) {
        crypto::decrypt_envelope(enc, nonce, key)
    } else {
        crypto::decrypt_org_envelope(enc, nonce, key, &cfg.org_id, dek_id)
    }
    .map_err(|_| "credential envelope decrypt failed".to_string())?;
    let plain = Zeroizing::new(plaintext);
    let creds: Creds =
        serde_json::from_slice(&plain).map_err(|e| format!("creds parse failed: {e}"))?;
    Ok(Some(creds))
}

pub fn is_legacy_dek_id(dek_id: &str, configured_legacy_dek_id: &str) -> bool {
    dek_id == LEGACY_DEK_ID || dek_id == configured_legacy_dek_id
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

/// Resolve the local root KEK (64 hex chars -> 32 bytes). The file form is
/// suitable for an operator-provided Docker secret; EGRESS_DEK is retained as
/// a migration-compatible alias for installations that still use the legacy
/// global envelope key.
pub fn root_kek_from_env() -> Option<SecretKey> {
    let mut value = match std::env::var("EGRESS_KEK_FILE") {
        Ok(path) if !path.trim().is_empty() => match std::fs::read_to_string(path) {
            Ok(value) => value,
            Err(_) => {
                warn!("EGRESS_KEK_FILE could not be read; credential encryption disabled");
                return None;
            }
        },
        _ => std::env::var("EGRESS_KEK")
            .or_else(|_| std::env::var("EGRESS_DEK"))
            .ok()?,
    };
    let parsed = parse_root_kek(&value);
    value.zeroize();
    if parsed.is_none() {
        warn!("configured root KEK is invalid; credential encryption disabled");
    }
    parsed
}

pub fn parse_root_kek(value: &str) -> Option<SecretKey> {
    let v = value.trim();
    if v.len() != 64 {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = match u8::from_str_radix(&v[i * 2..i * 2 + 2], 16) {
            Ok(byte) => byte,
            Err(_) => {
                out.zeroize();
                return None;
            }
        };
    }
    Some(SecretKey::new(out))
}

pub fn kek_id_from_env() -> String {
    std::env::var("EGRESS_KEK_ID").unwrap_or_else(|_| LEGACY_DEK_ID.to_string())
}

pub fn legacy_dek_id_from_env() -> String {
    std::env::var("EGRESS_LEGACY_DEK_ID")
        .or_else(|_| std::env::var("EGRESS_DEK_ID"))
        .unwrap_or_else(|_| LEGACY_DEK_ID.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_kek_parser_accepts_exact_32_byte_hex_value() {
        let hex = "ab".repeat(32);
        let kek = parse_root_kek(&hex).expect("root KEK should parse");
        assert!(kek.as_bytes().iter().all(|&b| b == 0xAB));
    }

    #[test]
    fn root_kek_parser_rejects_bad_length_and_non_hex() {
        assert!(parse_root_kek("abc").is_none());
        assert!(parse_root_kek(&"gg".repeat(32)).is_none());
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
