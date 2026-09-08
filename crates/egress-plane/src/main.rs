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

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--health") {
        run_healthcheck().await;
        return;
    }

    // Sidecar mode: this process is the per-model forward proxy executed
    // INSIDE a model's network namespace via `ip netns exec`. It never
    // starts the control-plane server.
    if args.iter().any(|a| a == "--sidecar") {
        run_sidecar(&args).await;
        return;
    }

    let config = Config::from_env();
    let production = std::env::var("NODE_ENV")
        .map(|value| value.eq_ignore_ascii_case("production"))
        .unwrap_or(false);
    if production {
        if let Err(error) = config.validate_production() {
            eprintln!("egress-plane production configuration invalid: {error}");
            std::process::exit(1);
        }
    }
    let kill_switch = KillSwitch::from_env();

    // Postgres loads model_network_configs and persists health. Development
    // keeps the existing optional behavior; production has already validated
    // the URL and must terminate if the connection cannot be established.
    let db = match &config.database_url {
        Some(url) => match egress_plane::db::connect(url).await {
            Ok(client) => Some(client),
            Err(e) => {
                if production {
                    eprintln!("egress-plane production database connection failed: {e}");
                    std::process::exit(1);
                }
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

async fn run_healthcheck() {
    let url = std::env::var("HEALTHCHECK_URL").unwrap_or_else(|_| {
        let listen = std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "127.0.0.1:3000".into());
        let port = listen.rsplit(':').next().unwrap_or("3000");
        format!("http://127.0.0.1:{port}/health")
    });
    let result = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await;
    std::process::exit(match result {
        Ok(response) if response.status().is_success() => 0,
        _ => 1,
    });
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
