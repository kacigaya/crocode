//! CroCode server binary.
//!
//! `crocode api` serves webhooks and the REST API. `crocode worker` runs
//! reviews. `crocode all` runs both in one process.

use std::sync::Arc;

use anyhow::{Context, Result, bail};
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use tokio_util::sync::CancellationToken;
use tracing::info;

mod agents;
mod api;
mod db;
mod digest;
mod github;
mod models;
mod review;
mod sandbox;
mod sast;
mod settings;
mod vulnerabilities;
mod webhook;
mod worker;

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct AppState {
    pub db: db::Db,
    pub github: github::GitHub,
    pub settings: Arc<settings::Settings>,
    pub auth: Arc<api::AuthCache>,
    pub pulls: Arc<api::PullCache>,
    pub vulnerability_checks: Arc<vulnerabilities::CheckHistory>,
    pub webhook_key: Arc<digest::WebhookKey>,
}

const USAGE: &str = "usage: crocode <api|worker|all|migrate>";

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let mode = std::env::args().nth(1).unwrap_or_default();
    if mode == "migrate" {
        let url = std::env::var("MIGRATION_DATABASE_URL")
            .context("MIGRATION_DATABASE_URL is required for crocode migrate")?;
        db::migrate(&url).await.context("migrate database")?;
        return Ok(());
    }
    let (serve_api, run_worker) = match mode.as_str() {
        "api" => (true, false),
        "worker" => (false, true),
        "all" => (true, true),
        "-h" | "--help" | "help" => {
            println!("{USAGE}");
            return Ok(());
        }
        _ => bail!("{USAGE}"),
    };

    if !settings::wait_for_github_app(wait_for_signal()).await {
        return Ok(());
    }
    let settings = Arc::new(settings::Settings::from_env()?);
    info!(?settings, "starting crocode {mode}");
    let state = AppState {
        db: db::connect(&settings.database_url)
            .await
            .context("connect to database")?,
        github: github::GitHub::new(
            settings.github_app_id,
            &settings.github_private_key,
            &settings.github_api_url,
        )?,
        webhook_key: Arc::new(digest::WebhookKey::derive(&settings.github_private_key)),
        settings,
        auth: Arc::default(),
        pulls: Arc::default(),
        vulnerability_checks: Arc::default(),
    };

    let shutdown = CancellationToken::new();
    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            wait_for_signal().await;
            info!("shutdown requested");
            shutdown.cancel();
        }
    });

    let worker = run_worker.then(|| tokio::spawn(worker::run(state.clone(), shutdown.clone())));
    if serve_api {
        let listener = tokio::net::TcpListener::bind(&state.settings.bind)
            .await
            .with_context(|| format!("bind {}", state.settings.bind))?;
        info!(addr = %state.settings.bind, "api listening");
        axum::serve(listener, router(state))
            .with_graceful_shutdown(shutdown.clone().cancelled_owned())
            .await?;
    }
    if let Some(worker) = worker {
        worker.await?;
    }
    Ok(())
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route(
            "/webhooks/github",
            post(webhook::handle).layer(DefaultBodyLimit::max(webhook::MAX_BODY)),
        )
        .nest("/api/v1", api::router())
        .with_state(state)
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if std::env::var("CROCODE_LOG_FORMAT").as_deref() == Ok("json") {
        builder.json().init();
    } else {
        builder.init();
    }
}

async fn wait_for_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler");
        tokio::select! {
            _ = ctrl_c => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    let _ = ctrl_c.await;
}
