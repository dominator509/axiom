//! Tracing redaction check for `crypto::decrypt_envelope`.
//!
//! Lives in its own test binary on purpose. Callsite interest in `tracing` is
//! cached process-wide, so when this ran next to the other unit tests a
//! parallel test could hit the `decrypt_envelope` span first and cache it as
//! disabled, and the scoped subscriber saw nothing (flaky "tracing positive
//! control" failure). A separate binary runs in its own process, and a global
//! subscriber set before any span is hit makes the result deterministic.

use egress_plane::crypto::{decrypt_envelope, encrypt_envelope};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct Sink(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Sink {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn tracing_does_not_record_envelope_or_key_bytes() {
    let sink = Sink(Default::default());
    let writer = sink.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::FULL)
        .with_writer(move || writer.clone())
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("only test in this binary sets the global subscriber");

    let key = [42u8; 32];
    let (encrypted, nonce) = encrypt_envelope(b"test-private-envelope", &key).unwrap();
    assert!(decrypt_envelope(&encrypted, &nonce, &key).is_ok());

    let captured = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
    assert!(
        captured.contains("decrypt_envelope"),
        "tracing positive control"
    );
    for forbidden in ["dek=", "enc_token=", "enc_nonce=", "test-private-envelope"] {
        assert!(!captured.contains(forbidden), "tracing output leaked {forbidden}");
    }
}
