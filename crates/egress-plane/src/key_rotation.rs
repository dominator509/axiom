//! Operator-only rewrapping of organization DEKs when the root KEK changes.
//!
//! This module never re-encrypts tenant data: it unwraps each existing DEK
//! with the old KEK and wraps the same DEK with the new KEK. Callers must use
//! a BYPASSRLS/owner database role and must roll back their transaction when
//! an error is returned. The CLI provides those boundaries.

use ring::digest::{digest, SHA256};
use serde_json::{json, Value};
use tokio_postgres::Transaction;
use zeroize::Zeroizing;

use crate::{
    crypto::{self, SecretKey},
    db::ORG_DEK_ROTATION_LOCK,
};

const ROTATION_ACTOR: &str = "operator:key-rotation";
const ROTATION_ACTION: &str = "security.org-kek.rotate";
const ROTATION_TARGET: &str = "organization-data-keys";

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RotationSummary {
    pub organizations_scanned: usize,
    pub organizations_to_update: usize,
    pub keys_to_rewrap: usize,
    pub organizations_already_current: usize,
    pub organizations_with_other_kek: usize,
}

/// Verify or apply a root KEK rotation within the caller's transaction.
///
/// apply=false performs a read-only cryptographic preflight. apply=true
/// acquires the shared key-lifecycle advisory lock and table locks, updates
/// all organization key wrappers and KEK identifiers, and appends a chained
/// audit record per changed organization. This function deliberately does
/// not commit; callers own commit/rollback.
pub async fn rotate_org_kek(
    tx: &Transaction<'_>,
    old_kek: &SecretKey,
    old_kek_id: &str,
    new_kek: &SecretKey,
    new_kek_id: &str,
    apply: bool,
) -> Result<RotationSummary, String> {
    validate_kek_id(old_kek_id)?;
    validate_kek_id(new_kek_id)?;
    if old_kek_id == new_kek_id {
        return Err("old and new KEK identifiers must differ".to_string());
    }

    tx.batch_execute("SAVEPOINT org_kek_rotation")
        .await
        .map_err(|_| "could not start key-rotation savepoint".to_string())?;
    let result = rotate_org_kek_inner(tx, old_kek, old_kek_id, new_kek, new_kek_id, apply).await;
    match result {
        Ok(summary) => {
            tx.batch_execute("RELEASE SAVEPOINT org_kek_rotation")
                .await
                .map_err(|_| "could not release key-rotation savepoint".to_string())?;
            Ok(summary)
        }
        Err(error) => {
            let _ = tx
                .batch_execute("ROLLBACK TO SAVEPOINT org_kek_rotation")
                .await;
            let _ = tx.batch_execute("RELEASE SAVEPOINT org_kek_rotation").await;
            Err(error)
        }
    }
}

fn validate_kek_id(id: &str) -> Result<(), String> {
    let chars = id.chars().count();
    if chars == 0 || chars > 128 || id.trim() != id {
        return Err("KEK identifiers must contain 1 to 128 non-whitespace characters".into());
    }
    Ok(())
}

async fn rotate_org_kek_inner(
    tx: &Transaction<'_>,
    old_kek: &SecretKey,
    old_kek_id: &str,
    new_kek: &SecretKey,
    new_kek_id: &str,
    apply: bool,
) -> Result<RotationSummary, String> {
    let privileged: bool = tx
        .query_one(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user",
            &[],
        )
        .await
        .map_err(|_| "could not verify key-rotation database role".to_string())?
        .get(0);
    if !privileged {
        return Err("key rotation requires a database role with BYPASSRLS".into());
    }

    if apply {
        tx.query_one(
            "SELECT pg_advisory_xact_lock($1, $2)",
            &[&ORG_DEK_ROTATION_LOCK.0, &ORG_DEK_ROTATION_LOCK.1],
        )
        .await
        .map_err(|_| "could not acquire organization key-lifecycle lock".to_string())?;
        tx.batch_execute(
            "LOCK TABLE public.org, public.organization_data_key IN SHARE ROW EXCLUSIVE MODE",
        )
        .await
        .map_err(|_| "could not lock organization key tables".to_string())?;
    }

    let org_sql = if apply {
        "SELECT id, kek_id FROM public.org ORDER BY id FOR UPDATE"
    } else {
        "SELECT id, kek_id FROM public.org ORDER BY id"
    };
    let organizations = tx
        .query(org_sql, &[])
        .await
        .map_err(|_| "could not enumerate organization key metadata".to_string())?;
    let mut summary = RotationSummary {
        organizations_scanned: organizations.len(),
        ..RotationSummary::default()
    };

    for organization in organizations {
        let org_id: uuid::Uuid = organization.get(0);
        let org_id_text = org_id.to_string();
        let org_kek_id: String = organization.get(1);
        let rotating = org_kek_id == old_kek_id;
        let already_current = org_kek_id == new_kek_id;
        if !rotating && !already_current {
            summary.organizations_with_other_kek += 1;
        }

        let key_sql = if apply {
            "SELECT dek_id, wrapped_dek, wrap_nonce, kek_id
             FROM public.organization_data_key
             WHERE org_id = $1 ORDER BY dek_id FOR UPDATE"
        } else {
            "SELECT dek_id, wrapped_dek, wrap_nonce, kek_id
             FROM public.organization_data_key
             WHERE org_id = $1 ORDER BY dek_id"
        };
        let keys = tx
            .query(key_sql, &[&org_id])
            .await
            .map_err(|_| "could not load wrapped organization keys".to_string())?;
        let key_count = keys.len();

        if rotating {
            summary.organizations_to_update += 1;
            summary.keys_to_rewrap += key_count;
        } else if already_current {
            summary.organizations_already_current += 1;
        }

        for key in keys {
            let dek_id: uuid::Uuid = key.get(0);
            let wrapped: Vec<u8> = key.get(1);
            let nonce: Vec<u8> = key.get(2);
            let row_kek_id: String = key.get(3);
            if row_kek_id != org_kek_id {
                return Err(
                    "an organization data key references a different KEK identifier".into(),
                );
            }
            if !rotating && !already_current {
                continue;
            }

            let (unwrap_key, wrap_key, target_kek_id) = if rotating {
                (old_kek, new_kek, new_kek_id)
            } else {
                (new_kek, new_kek, new_kek_id)
            };
            let dek = Zeroizing::new(
                crypto::unwrap_org_dek(
                    &wrapped,
                    &nonce,
                    unwrap_key.as_bytes(),
                    &org_id_text,
                    &dek_id.to_string(),
                    &org_kek_id,
                )
                .map_err(|_| "an organization data key could not be verified".to_string())?,
            );
            if dek.len() != 32 {
                return Err("an organization data key has an invalid length".into());
            }

            if rotating && apply {
                let (new_wrapped, new_nonce) = crypto::wrap_org_dek(
                    dek.as_slice(),
                    wrap_key.as_bytes(),
                    &org_id_text,
                    &dek_id.to_string(),
                    target_kek_id,
                )
                .map_err(|_| "an organization data key could not be rewrapped".to_string())?;
                let updated = tx
                    .execute(
                        "UPDATE public.organization_data_key
                         SET wrapped_dek = $1, wrap_nonce = $2, kek_id = $3, updated_at = now()
                         WHERE org_id = $4 AND dek_id = $5 AND kek_id = $6",
                        &[
                            &new_wrapped,
                            &new_nonce,
                            &new_kek_id,
                            &org_id,
                            &dek_id,
                            &old_kek_id,
                        ],
                    )
                    .await
                    .map_err(|_| {
                        "could not persist a rewrapped organization data key".to_string()
                    })?;
                if updated != 1 {
                    return Err("an organization data key changed during rotation".into());
                }
            }
        }

        if rotating && apply {
            let updated = tx
                .execute(
                    "UPDATE public.org SET kek_id = $1, updated_at = now()
                     WHERE id = $2 AND kek_id = $3",
                    &[&new_kek_id, &org_id, &old_kek_id],
                )
                .await
                .map_err(|_| "could not update organization KEK metadata".to_string())?;
            if updated != 1 {
                return Err("organization KEK metadata changed during rotation".into());
            }
            append_rotation_audit(tx, org_id, old_kek_id, new_kek_id, key_count).await?;
        }
    }

    Ok(summary)
}

async fn append_rotation_audit(
    tx: &Transaction<'_>,
    org_id: uuid::Uuid,
    old_kek_id: &str,
    new_kek_id: &str,
    wrapped_keys: usize,
) -> Result<(), String> {
    let org_id_text = org_id.to_string();
    tx.query_one(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        &[&org_id_text],
    )
    .await
    .map_err(|_| "could not lock the organization audit chain".to_string())?;
    let previous = tx
        .query_opt(
            "SELECT row_hash,
               to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')
             FROM public.audit_log
             WHERE org_id = $1 ORDER BY ts DESC, id DESC LIMIT 1 FOR UPDATE",
            &[&org_id],
        )
        .await
        .map_err(|_| "could not read the organization audit head".to_string())?;
    let previous_hash = previous
        .as_ref()
        .map(|row| row.get::<_, Vec<u8>>(0))
        .unwrap_or_else(|| vec![0; 32]);
    if previous_hash.len() != 32 {
        return Err("organization audit head has an invalid hash length".into());
    }
    let previous_ts: Option<String> = previous.as_ref().map(|row| row.get::<_, String>(1));
    let timestamp: String = tx
        .query_one(
            "SELECT to_char(
               GREATEST(clock_timestamp(),
                 COALESCE($1::text::timestamptz + INTERVAL '1 millisecond', clock_timestamp())),
               'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",
            &[&previous_ts],
        )
        .await
        .map_err(|_| "could not timestamp organization key audit".to_string())?
        .get(0);
    let detail = json!({
        "new_kek_id": new_kek_id,
        "old_kek_id": old_kek_id,
        "wrapped_deks": wrapped_keys,
    });
    let payload = json!({
        "org_id": org_id_text,
        "actor_ref": ROTATION_ACTOR,
        "action": ROTATION_ACTION,
        "target": ROTATION_TARGET,
        "detail": detail,
        "ts": timestamp,
        "prev_hash": hex(&previous_hash),
    });
    let canonical = format!("axiom-audit-v2\0{}", canonical_json(&payload));
    let row_hash = digest(&SHA256, canonical.as_bytes()).as_ref().to_vec();
    let detail_json = serde_json::to_string(&detail)
        .map_err(|_| "could not serialize organization key audit detail".to_string())?;
    tx.execute(
        "INSERT INTO public.audit_log
           (org_id, actor_ref, action, target, detail, ts, prev_hash, row_hash)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::text::timestamptz, $7, $8)",
        &[
            &org_id,
            &ROTATION_ACTOR,
            &ROTATION_ACTION,
            &ROTATION_TARGET,
            &detail_json,
            &timestamp,
            &previous_hash,
            &row_hash,
        ],
    )
    .await
    .map_err(|error| format!("could not append organization key audit: {error}"))?;
    Ok(())
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into()),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys: Vec<_> = values.keys().collect();
            keys.sort_unstable();
            let fields = keys
                .into_iter()
                .map(|key| {
                    let encoded_key =
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string());
                    format!("{encoded_key}:{}", canonical_json(&values[key]))
                })
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{fields}}}")
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{canonical_json, hex, validate_kek_id};
    use serde_json::json;

    #[test]
    fn key_ids_are_bounded_and_unpadded() {
        assert!(validate_kek_id("key-v2").is_ok());
        assert!(validate_kek_id("").is_err());
        assert!(validate_kek_id(" padded").is_err());
        assert!(validate_kek_id(&"x".repeat(129)).is_err());
    }

    #[test]
    fn audit_payload_json_uses_recursive_sorted_keys() {
        let payload = json!({"z": {"b": 2, "a": 1}, "a": 0});
        assert_eq!(canonical_json(&payload), r#"{"a":0,"z":{"a":1,"b":2}}"#);
    }

    #[test]
    fn hash_bytes_encode_as_lowercase_hex() {
        assert_eq!(hex(&[0x00, 0x0f, 0xa5, 0xff]), "000fa5ff");
    }
}
