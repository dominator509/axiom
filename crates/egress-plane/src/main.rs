use std::sync::Arc;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use egress_plane::killswitch::KillSwitch;
use egress_plane::proxy;
use egress_plane::{build_router, AppState, Config, Registry};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    // Sidecar mode: this process is the per-model forward proxy executed
    // INSIDE a model's network namespace via `ip netns exec`. It never
    // starts the control-plane server.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--sidecar") {
        run_sidecar(&args).await;
        return;
    }

    let config = Config::from_env();
    let kill_switch = KillSwitch::from_env();

    // Optional Postgres integration (loads model_network_configs + persists
    // health). Falls back gracefully when DATABASE_URL is absent.
    let db = match &config.database_url {
        Some(url) => match egress_plane::db::connect(url).await {
            Ok(client) => Some(client),
            Err(e) => {
                warn!(error = %e, "DB integration disabled");
                None
            }
        },
        None => None,
    };

    // Sweep orphaned kernel state from unclean shutdowns BEFORE serving.
    egress_plane::netns::sweep_orphans();

    info!(
        listen_addr = %config.listen_addr,
        echo_url = %config.echo_url,
        kill_switch = %kill_switch.is_enabled(),
        db_connected = db.is_some(),
        "Starting egress-plane"
    );

    let state = Arc::new(AppState {
        config: config.clone(),
        kill_switch,
        db: std::sync::Mutex::new(db),
        registry: std::sync::Mutex::new(Registry::new()),
    });
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(&config.listen_addr)
        .await
        .expect("Failed to bind TCP listener");

    info!("Egress-plane listening on {}", config.listen_addr);
    axum::serve(listener, app)
        .await
        .expect("Server exited with error");
}

async fn run_sidecar(args: &[String]) {
    // --listen host:port
    let listen: std::net::SocketAddr = args
        .windows(2)
        .find(|w| w[0] == "--listen")
        .and_then(|w| w[1].parse().ok())
        .or_else(proxy::listen_from_env)
        .unwrap_or_else(|| "127.0.0.1:8080".parse().expect("default listen"));

    let upstream = proxy::upstream_from_env();
    info!(listen = %listen, upstream = ?upstream, "Sidecar proxy starting");
    if let Err(e) = proxy::run_sidecar(listen, upstream).await {
        warn!(error = %e, "Sidecar proxy exited with error");
    }
}
