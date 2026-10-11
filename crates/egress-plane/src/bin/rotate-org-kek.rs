use std::{
    env, fs,
    path::{Path, PathBuf},
    process,
};
use zeroize::Zeroizing;

#[derive(Debug)]
struct Args {
    database_url_file: PathBuf,
    old_kek_file: PathBuf,
    old_kek_id: String,
    new_kek_file: PathBuf,
    new_kek_id: String,
    apply: bool,
    confirm_services_stopped: bool,
}

fn usage() -> &'static str {
    "Usage: rotate-org-kek --database-url-file PATH --old-kek-file PATH --old-kek-id ID --new-kek-file PATH --new-kek-id ID [--apply --confirm-services-stopped]\n\
Default mode performs a read-only preflight. --apply requires an explicit maintenance confirmation.\n\
Connection and key files must be regular owner-only files; database targets must be loopback."
}

fn parse_args(values: impl IntoIterator<Item = String>) -> Result<Option<Args>, String> {
    let mut database_url_file = None;
    let mut old_kek_file = None;
    let mut old_kek_id = None;
    let mut new_kek_file = None;
    let mut new_kek_id = None;
    let mut apply = false;
    let mut confirm_services_stopped = false;
    let mut values = values.into_iter();
    while let Some(arg) = values.next() {
        match arg.as_str() {
            "--help" | "-h" => return Ok(None),
            "--database-url-file" => database_url_file = Some(next_path(&mut values, &arg)?),
            "--old-kek-file" => old_kek_file = Some(next_path(&mut values, &arg)?),
            "--old-kek-id" => old_kek_id = Some(next_value(&mut values, &arg)?),
            "--new-kek-file" => new_kek_file = Some(next_path(&mut values, &arg)?),
            "--new-kek-id" => new_kek_id = Some(next_value(&mut values, &arg)?),
            "--apply" => apply = true,
            "--confirm-services-stopped" => confirm_services_stopped = true,
            _ => return Err("unknown or incomplete argument".into()),
        }
    }
    if apply != confirm_services_stopped {
        return Err("--apply and --confirm-services-stopped must be supplied together".into());
    }
    Ok(Some(Args {
        database_url_file: database_url_file
            .ok_or_else(|| "missing required arguments".to_string())?,
        old_kek_file: old_kek_file.ok_or_else(|| "missing required arguments".to_string())?,
        old_kek_id: old_kek_id.ok_or_else(|| "missing required arguments".to_string())?,
        new_kek_file: new_kek_file.ok_or_else(|| "missing required arguments".to_string())?,
        new_kek_id: new_kek_id.ok_or_else(|| "missing required arguments".to_string())?,
        apply,
        confirm_services_stopped,
    }))
}

fn next_value(values: &mut impl Iterator<Item = String>, name: &str) -> Result<String, String> {
    values
        .next()
        .filter(|value| !value.is_empty() && !value.starts_with("--"))
        .ok_or_else(|| format!("missing value for {name}"))
}

fn next_path(values: &mut impl Iterator<Item = String>, name: &str) -> Result<PathBuf, String> {
    next_value(values, name).map(PathBuf::from)
}

fn read_protected_file(path: &Path, max_bytes: u64) -> Result<Zeroizing<Vec<u8>>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "required protected file is unavailable")?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(
            "protected input must be a non-empty regular file within the size limit".into(),
        );
    }
    validate_file_permissions(&metadata)?;
    let bytes = fs::read(path).map_err(|_| "could not read protected input")?;
    if bytes.len() as u64 > max_bytes {
        return Err("protected input exceeds the size limit".into());
    }
    Ok(Zeroizing::new(bytes))
}

#[cfg(unix)]
fn validate_file_permissions(metadata: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o077 != 0 {
        return Err("protected inputs must not grant group or other access".into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_file_permissions(_: &fs::Metadata) -> Result<(), String> {
    Err("KEK rotation is supported only on Unix hosts with owner-only file permissions".into())
}

fn read_kek(path: &Path) -> Result<egress_plane::crypto::SecretKey, String> {
    let bytes = read_protected_file(path, 256)?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "KEK file must contain 64 hexadecimal characters")?;
    egress_plane::db::parse_root_kek(text)
        .ok_or_else(|| "KEK file must contain 64 hexadecimal characters".into())
}

fn read_database_url(path: &Path) -> Result<Zeroizing<String>, String> {
    let bytes = read_protected_file(path, 4096)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| "database URL file is not valid UTF-8")?;
    let value = text.trim();
    if value.is_empty() || value.lines().count() != 1 {
        return Err("database URL file must contain one non-empty line".into());
    }
    let config: tokio_postgres::Config = value.parse().map_err(|_| "database URL is invalid")?;
    if config.get_dbname().is_none_or(str::is_empty)
        || config.get_hosts().is_empty()
        || config.get_hosts().iter().any(|host| match host {
            tokio_postgres::config::Host::Tcp(host) => {
                host != "localhost" && host != "127.0.0.1" && host != "::1"
            }
            _ => true,
        })
    {
        return Err("database target must name a database on loopback only".into());
    }
    Ok(Zeroizing::new(value.to_string()))
}

#[tokio::main]
async fn main() {
    match run().await {
        Ok(()) => {}
        Err(error) => {
            eprintln!("rotate-org-kek failed: {error}");
            process::exit(1);
        }
    }
}

async fn run() -> Result<(), String> {
    let args = match parse_args(env::args().skip(1))? {
        Some(args) => args,
        None => {
            println!("{}", usage());
            return Ok(());
        }
    };
    if args.confirm_services_stopped && !args.apply {
        return Err("--confirm-services-stopped requires --apply".into());
    }
    let database_url = read_database_url(&args.database_url_file)?;
    let old_kek = read_kek(&args.old_kek_file)?;
    let new_kek = read_kek(&args.new_kek_file)?;
    let mut client = egress_plane::db::connect(&database_url).await?;
    let tx = client
        .transaction()
        .await
        .map_err(|_| "could not begin key-rotation transaction".to_string())?;
    if !args.apply {
        tx.batch_execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            .await
            .map_err(|_| "could not set read-only preflight isolation".to_string())?;
    }
    let summary = match egress_plane::key_rotation::rotate_org_kek(
        &tx,
        &old_kek,
        &args.old_kek_id,
        &new_kek,
        &args.new_kek_id,
        args.apply,
    )
    .await
    {
        Ok(summary) => summary,
        Err(error) => {
            let _ = tx.rollback().await;
            return Err(error);
        }
    };
    if args.apply {
        tx.commit()
            .await
            .map_err(|_| "could not commit key rotation".to_string())?;
        println!(
            "applied: organizations={} updated={} keys_rewrapped={} already_current={}",
            summary.organizations_scanned,
            summary.organizations_to_update,
            summary.keys_to_rewrap,
            summary.organizations_already_current
        );
    } else {
        tx.rollback()
            .await
            .map_err(|_| "could not close key-rotation preflight".to_string())?;
        println!(
            "preflight only: organizations={} would_update={} keys_to_rewrap={} already_current={}",
            summary.organizations_scanned,
            summary.organizations_to_update,
            summary.keys_to_rewrap,
            summary.organizations_already_current
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::validate_file_permissions;
    use super::{parse_args, usage};

    #[test]
    fn apply_requires_explicit_maintenance_confirmation() {
        let args = [
            "--database-url-file",
            "db",
            "--old-kek-file",
            "old",
            "--old-kek-id",
            "old-v1",
            "--new-kek-file",
            "new",
            "--new-kek-id",
            "new-v2",
            "--apply",
        ]
        .into_iter()
        .map(str::to_string);
        assert!(parse_args(args)
            .unwrap_err()
            .contains("must be supplied together"));
    }

    #[test]
    fn read_only_preflight_needs_no_apply_confirmation() {
        let args = [
            "--database-url-file",
            "db",
            "--old-kek-file",
            "old",
            "--old-kek-id",
            "old-v1",
            "--new-kek-file",
            "new",
            "--new-kek-id",
            "new-v2",
        ]
        .into_iter()
        .map(str::to_string);
        assert!(parse_args(args).unwrap().is_some());
    }

    #[test]
    fn help_is_available_without_database_or_key_arguments() {
        assert!(parse_args(["--help".to_string()]).unwrap().is_none());
        assert!(usage().contains("--confirm-services-stopped"));
    }

    #[cfg(unix)]
    #[test]
    fn shared_file_permissions_are_rejected() {
        use std::{fs, os::unix::fs::PermissionsExt};
        let path = std::env::temp_dir().join(format!("axiom-key-rotation-{}", std::process::id()));
        fs::write(&path, b"synthetic").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        let metadata = fs::metadata(&path).unwrap();
        let result = validate_file_permissions(&metadata);
        fs::remove_file(path).unwrap();
        assert!(result.is_err());
    }
}
