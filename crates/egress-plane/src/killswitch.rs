use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{info, warn, instrument};

/// KillSwitch provides a thread-safe atomic flag that controls whether
/// egress is allowed. When enabled, all egress allow-rules are flushed
/// and no new egress is permitted.
#[derive(Debug, Clone)]
pub struct KillSwitch {
    enabled: Arc<AtomicBool>,
}

impl KillSwitch {
    /// Create a new KillSwitch, initialised from the `KILL_SWITCH` env var.
    /// If the env var is "true" or "1", the kill-switch starts enabled.
    pub fn from_env() -> Self {
        let enabled = std::env::var("KILL_SWITCH")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);

        let ks = Self {
            enabled: Arc::new(AtomicBool::new(enabled)),
        };

        if enabled {
            warn!("KillSwitch initialised from env: ENABLED");
        } else {
            info!("KillSwitch initialised from env: disabled");
        }

        ks
    }

    /// Create a new KillSwitch with a specific initial state.
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(enabled)),
        }
    }

    /// Set the kill-switch state.
    /// When `true`, all egress is blocked.
    #[instrument]
    pub fn set_enabled(&self, enabled: bool) {
        let prev = self.enabled.swap(enabled, Ordering::SeqCst);
        if prev != enabled {
            if enabled {
                warn!("KillSwitch ENABLED — all egress blocked");
            } else {
                info!("KillSwitch DISABLED — egress allowed");
            }
        }
    }

    /// Check whether the kill-switch is currently enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// Drain all egress connections — this is a signal to flush rules.
    /// The actual flushing is done by the caller (this emits the signal).
    #[instrument]
    pub fn drain_all(&self) {
        if self.is_enabled() {
            warn!("KillSwitch drain signal fired — all egress will be disconnected");
        } else {
            info!("KillSwitch drain called but switch is disabled — no action");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kill_switch_default_disabled() {
        // Don't set KILL_SWITCH env var
        let ks = KillSwitch::new(false);
        assert!(!ks.is_enabled(), "Default state should be disabled");
    }

    #[test]
    fn test_kill_switch_set_enabled() {
        let ks = KillSwitch::new(false);
        ks.set_enabled(true);
        assert!(ks.is_enabled(), "Should be enabled after set_enabled(true)");
        ks.set_enabled(false);
        assert!(!ks.is_enabled(), "Should be disabled after set_enabled(false)");
    }

    #[test]
    fn test_kill_switch_drain() {
        let ks = KillSwitch::new(true);
        // drain_all should not panic
        ks.drain_all();
        assert!(ks.is_enabled(), "drain_all should not change the switch state");
    }

    #[test]
    fn test_kill_switch_from_env() {
        // Test with explicit env (not set, so defaults to disabled)
        let ks = KillSwitch::from_env();
        // No assertion on actual value since env may or may not be set
        // Just ensure it doesn't panic
        let _ = ks.is_enabled();
    }

    #[test]
    fn test_kill_switch_thread_safety() {
        use std::thread;
        let ks = KillSwitch::new(false);
        let ks_clone = ks.clone();

        let handle = thread::spawn(move || {
            ks_clone.set_enabled(true);
        });

        handle.join().expect("Thread should not panic");
        assert!(ks.is_enabled(), "Thread should have set the switch");
    }
}
