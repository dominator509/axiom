use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use thiserror::Error;
use tracing::instrument;
use zeroize::Zeroize;

/// Root wrapping-key material. Debug output is always redacted and the bytes
/// are cleared when the last owned copy is dropped.
#[derive(Clone)]
pub struct SecretKey([u8; 32]);

impl SecretKey {
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl std::fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretKey([REDACTED])")
    }
}

impl Drop for SecretKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Errors that can occur during cryptographic operations.
#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Invalid nonce length: expected 24 bytes, got {0}")]
    InvalidNonceLength(usize),

    #[error("Invalid key length: expected 32 bytes, got {0}")]
    InvalidKeyLength(usize),

    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
}

/// Encrypt a plaintext into an XChaCha20-Poly1305 envelope.
/// Generates a fresh random 24-byte nonce; returns `(ciphertext, nonce)`.
/// Used by the control plane when persisting model egress credentials
/// (L2.6: proxy/WG creds are envelope-encrypted at rest).
pub fn encrypt_envelope(plaintext: &[u8], dek: &[u8]) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    encrypt_with_aad(plaintext, dek, b"")
}

/// Encrypt a new organization-scoped envelope. The authenticated metadata
/// prevents ciphertext from being moved between tenants or key versions.
pub fn encrypt_org_envelope(
    plaintext: &[u8],
    dek: &[u8],
    org_id: &str,
    dek_id: &str,
) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    encrypt_with_aad(plaintext, dek, &org_envelope_aad(org_id, dek_id))
}

fn encrypt_with_aad(
    plaintext: &[u8],
    dek: &[u8],
    aad: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    if dek.len() != 32 {
        return Err(CryptoError::InvalidKeyLength(dek.len()));
    }
    let mut nonce = vec![0u8; 24];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce);

    let cipher = XChaCha20Poly1305::new_from_slice(dek)
        .map_err(|e| CryptoError::EncryptionFailed(format!("key init: {e}")))?;
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|e| CryptoError::EncryptionFailed(format!("encrypt: {e}")))?;
    Ok((ct, nonce))
}

/// Decrypt an XChaCha20-Poly1305 encrypted envelope.
///
/// # Arguments
/// * `enc_token` - The ciphertext (includes the 16-byte Poly1305 tag appended).
/// * `enc_nonce` - The 24-byte XChaCha20 nonce.
/// * `dek`       - The 32-byte Data Encryption Key (DEK).
///
/// # Returns
/// The decrypted plaintext bytes.
#[instrument(skip_all)]
pub fn decrypt_envelope(
    enc_token: &[u8],
    enc_nonce: &[u8],
    dek: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    decrypt_with_aad(enc_token, enc_nonce, dek, b"")
}

/// Decrypt a new organization-scoped envelope, authenticating its tenant and
/// data-key identity as associated data.
#[instrument(skip_all)]
pub fn decrypt_org_envelope(
    enc_token: &[u8],
    enc_nonce: &[u8],
    dek: &[u8],
    org_id: &str,
    dek_id: &str,
) -> Result<Vec<u8>, CryptoError> {
    decrypt_with_aad(enc_token, enc_nonce, dek, &org_envelope_aad(org_id, dek_id))
}

fn decrypt_with_aad(
    enc_token: &[u8],
    enc_nonce: &[u8],
    dek: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    // Validate key length (XChaCha20 requires 256-bit / 32-byte key)
    if dek.len() != 32 {
        return Err(CryptoError::InvalidKeyLength(dek.len()));
    }

    // Validate nonce length (XChaCha20 requires 192-bit / 24-byte nonce)
    if enc_nonce.len() != 24 {
        return Err(CryptoError::InvalidNonceLength(enc_nonce.len()));
    }

    // Build the XChaCha20-Poly1305 cipher
    let cipher = XChaCha20Poly1305::new_from_slice(dek)
        .map_err(|e| CryptoError::DecryptionFailed(format!("key init: {}", e)))?;

    let nonce = XNonce::from_slice(enc_nonce);

    // Decrypt with associated data (AD) set to empty — no additional aad
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: enc_token,
                aad,
            },
        )
        .map_err(|e| CryptoError::DecryptionFailed(format!("decrypt: {}", e)))?;

    Ok(plaintext)
}

/// Wrap a random per-organization DEK with the configured root KEK.
pub fn wrap_org_dek(
    dek: &[u8],
    kek: &[u8],
    org_id: &str,
    dek_id: &str,
    kek_id: &str,
) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    encrypt_with_aad(dek, kek, &wrapped_dek_aad(org_id, dek_id, kek_id))
}

/// Unwrap a tenant DEK only for the organization, key version, and KEK id
/// recorded with the wrapped bytes.
pub fn unwrap_org_dek(
    wrapped_dek: &[u8],
    nonce: &[u8],
    kek: &[u8],
    org_id: &str,
    dek_id: &str,
    kek_id: &str,
) -> Result<Vec<u8>, CryptoError> {
    decrypt_with_aad(
        wrapped_dek,
        nonce,
        kek,
        &wrapped_dek_aad(org_id, dek_id, kek_id),
    )
}

fn org_envelope_aad(org_id: &str, dek_id: &str) -> Vec<u8> {
    format!("axiom:org-envelope:v1\0{org_id}\0{dek_id}").into_bytes()
}

fn wrapped_dek_aad(org_id: &str, dek_id: &str, kek_id: &str) -> Vec<u8> {
    format!("axiom:wrapped-org-dek:v1\0{org_id}\0{dek_id}\0{kek_id}").into_bytes()
}

/// Safely zero out sensitive memory.
/// Uses `zeroize` crate's volatile write to prevent compiler optimization.
pub fn zeroize(data: &mut [u8]) {
    data.zeroize();
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    /// Helper: generate random bytes
    fn random_bytes(len: usize) -> Vec<u8> {
        let mut buf = vec![0u8; len];
        rand::thread_rng().fill_bytes(&mut buf);
        buf
    }

    /// Helper: encrypt with XChaCha20-Poly1305 for round-trip testing.
    /// We use the same cipher crate for both encrypt and decrypt since this
    /// test validates our decrypt function against a known-good encryption.
    fn encrypt_with_xchacha20(
        plaintext: &[u8],
        key: &[u8],
        nonce: &[u8],
    ) -> Result<Vec<u8>, CryptoError> {
        let cipher = XChaCha20Poly1305::new_from_slice(key)
            .map_err(|e| CryptoError::DecryptionFailed(format!("key init: {0}", e)))?;
        let xnonce = XNonce::from_slice(nonce);
        cipher
            .encrypt(
                xnonce,
                Payload {
                    msg: plaintext,
                    aad: b"",
                },
            )
            .map_err(|e| CryptoError::DecryptionFailed(format!("encrypt: {}", e)))
    }

    #[test]
    fn test_decrypt_round_trip() {
        let key = random_bytes(32);
        let nonce = random_bytes(24);
        let plaintext = b"Hello, egress plane! This is a test message.";

        let ciphertext =
            encrypt_with_xchacha20(plaintext, &key, &nonce).expect("Encryption should succeed");

        let decrypted =
            decrypt_envelope(&ciphertext, &nonce, &key).expect("Decryption should succeed");

        assert_eq!(decrypted, plaintext, "Decrypted text must match original");
    }

    #[test]
    fn test_decrypt_wrong_key() {
        let key = random_bytes(32);
        let wrong_key = random_bytes(32);
        let nonce = random_bytes(24);
        let plaintext = b"Secret data";

        let ciphertext =
            encrypt_with_xchacha20(plaintext, &key, &nonce).expect("Encryption should succeed");

        let result = decrypt_envelope(&ciphertext, &nonce, &wrong_key);
        assert!(result.is_err(), "Decryption with wrong key should fail");
    }

    #[test]
    fn test_decrypt_wrong_nonce() {
        let key = random_bytes(32);
        let nonce = random_bytes(24);
        let wrong_nonce = random_bytes(24);
        let plaintext = b"Secret data";

        let ciphertext =
            encrypt_with_xchacha20(plaintext, &key, &nonce).expect("Encryption should succeed");

        let result = decrypt_envelope(&ciphertext, &wrong_nonce, &key);
        assert!(result.is_err(), "Decryption with wrong nonce should fail");
    }

    #[test]
    fn test_decrypt_tampered_ciphertext() {
        let key = random_bytes(32);
        let nonce = random_bytes(24);
        let plaintext = b"Secret data";

        let mut ciphertext =
            encrypt_with_xchacha20(plaintext, &key, &nonce).expect("Encryption should succeed");

        // Tamper with the ciphertext
        if let Some(b) = ciphertext.get_mut(0) {
            *b ^= 0xff;
        }

        let result = decrypt_envelope(&ciphertext, &nonce, &key);
        assert!(result.is_err(), "Decryption of tampered data should fail");
    }

    #[test]
    fn test_decrypt_invalid_key_length() {
        let short_key = random_bytes(16); // 16 bytes, not 32
        let nonce = random_bytes(24);
        let ciphertext = b"some ciphertext";

        let result = decrypt_envelope(ciphertext, &nonce, &short_key);
        assert!(result.is_err(), "Should reject 16-byte key");
        match result {
            Err(CryptoError::InvalidKeyLength(len)) => assert_eq!(len, 16),
            _ => panic!("Expected InvalidKeyLength error"),
        }
    }

    #[test]
    fn test_decrypt_invalid_nonce_length() {
        let key = random_bytes(32);
        let short_nonce = random_bytes(12); // 12 bytes, not 24
        let ciphertext = b"some ciphertext";

        let result = decrypt_envelope(ciphertext, &short_nonce, &key);
        assert!(result.is_err(), "Should reject 12-byte nonce");
        match result {
            Err(CryptoError::InvalidNonceLength(len)) => assert_eq!(len, 12),
            _ => panic!("Expected InvalidNonceLength error"),
        }
    }

    #[test]
    fn test_zeroize() {
        let mut data = vec![0xABu8; 64];
        zeroize(&mut data);
        assert!(data.iter().all(|&b| b == 0), "All bytes should be zero");
    }

    #[test]
    fn test_encrypt_decrypt_round_trip() {
        let key = random_bytes(32);
        let plaintext = b"proxy:user:pass + wg private key material";

        let (ct, nonce) = encrypt_envelope(plaintext, &key).expect("encrypt should succeed");
        assert_eq!(nonce.len(), 24, "nonce must be 24 bytes");
        assert_ne!(ct, plaintext, "ciphertext must differ from plaintext");

        let dec = decrypt_envelope(&ct, &nonce, &key).expect("decrypt should succeed");
        assert_eq!(dec, plaintext, "round trip must match");

        let (ct2, nonce2) = encrypt_envelope(plaintext, &key).expect("encrypt 2");
        assert_ne!(nonce, nonce2, "fresh nonce per encryption");
        assert_ne!(ct, ct2, "same plaintext must not produce same ciphertext");
    }

    #[test]
    fn test_encrypt_rejects_short_key() {
        let key = random_bytes(16);
        let result = encrypt_envelope(b"x", &key);
        assert!(matches!(result, Err(CryptoError::InvalidKeyLength(16))));
    }

    #[test]
    fn organization_dek_wrap_is_authenticated_to_org_and_key_ids() {
        let kek = random_bytes(32);
        let dek = random_bytes(32);
        let (wrapped, nonce) = wrap_org_dek(&dek, &kek, "org-a", "dek-a", "kek-a").unwrap();

        assert_eq!(
            unwrap_org_dek(&wrapped, &nonce, &kek, "org-a", "dek-a", "kek-a").unwrap(),
            dek
        );
        assert!(unwrap_org_dek(&wrapped, &nonce, &kek, "org-b", "dek-a", "kek-a").is_err());
        assert!(unwrap_org_dek(&wrapped, &nonce, &kek, "org-a", "dek-b", "kek-a").is_err());
        assert!(unwrap_org_dek(&wrapped, &nonce, &kek, "org-a", "dek-a", "kek-b").is_err());
    }

    #[test]
    fn organization_credential_envelope_rejects_tenant_or_key_substitution() {
        let dek = random_bytes(32);
        let plaintext = b"synthetic credential";
        let (ciphertext, nonce) = encrypt_org_envelope(plaintext, &dek, "org-a", "dek-a").unwrap();

        assert_eq!(
            decrypt_org_envelope(&ciphertext, &nonce, &dek, "org-a", "dek-a").unwrap(),
            plaintext
        );
        assert!(decrypt_org_envelope(&ciphertext, &nonce, &dek, "org-b", "dek-a").is_err());
        assert!(decrypt_org_envelope(&ciphertext, &nonce, &dek, "org-a", "dek-b").is_err());
    }

    #[test]
    fn secret_key_debug_is_redacted() {
        let key = SecretKey::new([0xabu8; 32]);
        assert_eq!(format!("{key:?}"), "SecretKey([REDACTED])");
        assert!(!format!("{key:?}").contains("ab".repeat(8).as_str()));
    }
}
