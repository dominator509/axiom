use std::sync::Arc;
use tracing::info;
use tracing_subscriber::EnvFilter;

use egress_plane::{build_router, AppState, Config};
use egress_plane::killswitch::KillSwitch;

#[tokio::main]
async fn main() {
    // Initialise tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env();
    let kill_switch = KillSwitch::from_env();

    info!(
        listen_addr = %config.listen_addr,
        proxy_type = %config.proxy_type,
        proxy_addr = %config.proxy_addr,
        kill_switch = %kill_switch.is_enabled(),
        "Starting egress-plane"
    );

    let listen_addr = config.listen_addr.clone();
    let state = Arc::new(AppState { config, kill_switch });
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(&listen_addr)
        .await
        .expect("Failed to bind TCP listener");

    info!("Egress-plane listening on {}", listen_addr);
    axum::serve(listener, app)
        .await
        .expect("Server exited with error");
}
