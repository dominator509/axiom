use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use thiserror::Error;
use tracing::instrument;

/// Errors that can occur during cryptographic operations.
#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Invalid nonce length: expected 24 bytes, got {0}")]
    InvalidNonceLength(usize),

    #[error("Invalid key length: expected 32 bytes, got {0}")]
    InvalidKeyLength(usize),

    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
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
#[instrument]
pub fn decrypt_envelope(
    enc_token: &[u8],
    enc_nonce: &[u8],
    dek: &[u8],
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
        .decrypt(nonce, Payload {
            msg: enc_token,
            aad: b"",
        })
        .map_err(|e| CryptoError::DecryptionFailed(format!("decrypt: {}", e)))?;

    Ok(plaintext)
}

/// Safely zero out sensitive memory.
/// Uses `zeroize` crate's volatile write to prevent compiler optimization.
pub fn zeroize(data: &mut [u8]) {
    use zeroize::Zeroize;
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
            .encrypt(xnonce, Payload {
                msg: plaintext,
                aad: b"",
            })
            .map_err(|e| CryptoError::DecryptionFailed(format!("encrypt: {}", e)))
    }

    #[test]
    fn test_decrypt_round_trip() {
        let key = random_bytes(32);
        let nonce = random_bytes(24);
        let plaintext = b"Hello, egress plane! This is a test message.";

        let ciphertext = encrypt_with_xchacha20(plaintext, &key, &nonce)
            .expect("Encryption should succeed");

        let decrypted = decrypt_envelope(&ciphertext, &nonce, &key)
            .expect("Decryption should succeed");

        assert_eq!(decrypted, plaintext, "Decrypted text must match original");
    }

    #[test]
    fn test_decrypt_wrong_key() {
        let key = random_bytes(32);
        let wrong_key = random_bytes(32);
        let nonce = random_bytes(24);
        let plaintext = b"Secret data";

        let ciphertext = encrypt_with_xchacha20(plaintext, &key, &nonce)
            .expect("Encryption should succeed");

        let result = decrypt_envelope(&ciphertext, &nonce, &wrong_key);
        assert!(result.is_err(), "Decryption with wrong key should fail");
    }

    #[test]
    fn test_decrypt_wrong_nonce() {
        let key = random_bytes(32);
        let nonce = random_bytes(24);
        let wrong_nonce = random_bytes(24);
        let plaintext = b"Secret data";

        let ciphertext = encrypt_with_xchacha20(plaintext, &key, &nonce)
            .expect("Encryption should succeed");

        let result = decrypt_envelope(&ciphertext, &wrong_nonce, &key);
        assert!(result.is_err(), "Decryption with wrong nonce should fail");
    }

    #[test]
    fn test_decrypt_tampered_ciphertext() {
        let key = random_bytes(32);
        let nonce = random_bytes(24);
        let plaintext = b"Secret data";

        let mut ciphertext = encrypt_with_xchacha20(plaintext, &key, &nonce)
            .expect("Encryption should succeed");

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
}
