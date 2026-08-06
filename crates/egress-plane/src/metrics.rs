//! Prometheus metrics for the egress plane (L2.6 §Health monitoring feeds
//! Prometheus; the Network & Security tab reads the same state).

use std::collections::HashMap;

use crate::health::HealthState;

/// Render the metrics registry in Prometheus text exposition format.
pub struct Metrics {
    pub models_bound: usize,
    pub kill_switch: bool,
    pub binds_total: u64,
    pub unbinds_total: u64,
    pub health: HashMap<String, (String, HealthState)>, // model_id -> (mode, state)
}

impl Metrics {
    pub fn render(&self) -> String {
        let mut out = String::new();
        out.push_str("# HELP egress_models_bound Number of models with a bound egress.\n");
        out.push_str("# TYPE egress_models_bound gauge\n");
        out.push_str(&format!("egress_models_bound {}\n", self.models_bound));

        out.push_str("# HELP egress_kill_switch_enabled Whether the global egress kill switch is engaged.\n");
        out.push_str("# TYPE egress_kill_switch_enabled gauge\n");
        out.push_str(&format!("egress_kill_switch_enabled {}\n", self.kill_switch as u8));

        out.push_str("# HELP egress_binds_total Total egress bind operations.\n");
        out.push_str("# TYPE egress_binds_total counter\n");
        out.push_str(&format!("egress_binds_total {}\n", self.binds_total));

        out.push_str("# HELP egress_unbinds_total Total egress unbind operations.\n");
        out.push_str("# TYPE egress_unbinds_total counter\n");
        out.push_str(&format!("egress_unbinds_total {}\n", self.unbinds_total));

        out.push_str("# HELP egress_health 1 if the model's egress path is healthy.\n");
        out.push_str("# TYPE egress_health gauge\n");
        for (model, (mode, h)) in &self.health {
            let m = escape(model);
            out.push_str(&format!("egress_health{{model=\"{m}\",mode=\"{mode}\"}} {}\n", h.healthy as u8));
        }

        out.push_str("# HELP egress_latency_ms Last echo-IP probe latency.\n");
        out.push_str("# TYPE egress_latency_ms gauge\n");
        for (model, (_mode, h)) in &self.health {
            let m = escape(model);
            if let Some(ms) = h.latency_ms {
                out.push_str(&format!("egress_latency_ms{{model=\"{m}\"}} {ms}\n"));
            }
        }

        out.push_str("# HELP egress_ip_drift 1 if the echo IP differs from the expected-IP policy.\n");
        out.push_str("# TYPE egress_ip_drift gauge\n");
        for (model, (_mode, h)) in &self.health {
            let m = escape(model);
            out.push_str(&format!("egress_ip_drift{{model=\"{m}\"}} {}\n", h.drift as u8));
        }

        out.push_str("# HELP egress_fail_count Consecutive health-check failures for the model's egress.\n");
        out.push_str("# TYPE egress_fail_count gauge\n");
        for (model, (_mode, h)) in &self.health {
            let m = escape(model);
            out.push_str(&format!("egress_fail_count{{model=\"{m}\"}} {}\n", h.fail_count));
        }

        out
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_all_families() {
        let mut health = HashMap::new();
        let h = HealthState {
            healthy: true,
            latency_ms: Some(25),
            egress_ip: Some("1.2.3.4".into()),
            drift: false,
            ..HealthState::default()
        };
        health.insert("m1".into(), ("wireguard".into(), h));

        let m = Metrics {
            models_bound: 1,
            kill_switch: false,
            binds_total: 3,
            unbinds_total: 1,
            health,
        };
        let out = m.render();
        assert!(out.contains("egress_models_bound 1"));
        assert!(out.contains("egress_kill_switch_enabled 0"));
        assert!(out.contains("egress_health{model=\"m1\",mode=\"wireguard\"} 1"));
        assert!(out.contains("egress_latency_ms{model=\"m1\"} 25"));
        assert!(out.contains("egress_ip_drift{model=\"m1\"} 0"));
        assert!(out.contains("egress_fail_count{model=\"m1\"} 0"));
    }
}
