//! Review worker: claims queued reviews from Postgres and runs them.

use std::time::Duration;

use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tracing::{Instrument, error, info, warn};

use crate::review::{self, Outcome, ReviewError};
use crate::{AppState, db};

const POLL: Duration = Duration::from_secs(2);
const HEARTBEAT: Duration = Duration::from_secs(20);
/// A running review with no heartbeat for this long goes back to the queue.
const STALE: Duration = Duration::from_secs(120);

pub async fn run(state: AppState, shutdown: CancellationToken) {
    if let Err(err) = std::fs::create_dir_all(&state.settings.work_dir) {
        error!(error = %err, "cannot create work dir");
        return;
    }
    let worker_id = format!(
        "{}-{}",
        std::env::var("HOSTNAME").unwrap_or_else(|_| "worker".into()),
        uuid::Uuid::new_v4().simple()
    );
    info!(worker = %worker_id, slots = state.settings.worker_concurrency, "worker started");

    let mut tasks = JoinSet::new();
    for slot in 0..state.settings.worker_concurrency {
        let state = state.clone();
        let shutdown = shutdown.clone();
        let id = format!("{worker_id}-{slot}");
        tasks.spawn(async move { slot_loop(state, id, shutdown).await });
    }
    tasks.spawn(reaper(state.clone(), shutdown.clone()));
    tasks.spawn(crate::models::refresh_loop(state.clone(), shutdown.clone()));
    while tasks.join_next().await.is_some() {}
    info!("worker stopped");
}

async fn slot_loop(state: AppState, worker: String, shutdown: CancellationToken) {
    while !shutdown.is_cancelled() {
        let job =
            match db::claim_review(&state.db, &worker, state.settings.max_per_installation).await {
                Ok(Some(job)) => job,
                Ok(None) => {
                    idle(&shutdown).await;
                    continue;
                }
                Err(err) => {
                    warn!(error = %err, "claim review");
                    idle(&shutdown).await;
                    continue;
                }
            };
        let span = tracing::info_span!(
            "review",
            id = %job.id,
            repo = %job.repo_full_name,
            pr = job.pr_number,
            attempt = job.attempts
        );
        process(&state, &worker, job, &shutdown)
            .instrument(span)
            .await;
    }
}

async fn idle(shutdown: &CancellationToken) {
    tokio::select! {
        _ = tokio::time::sleep(POLL) => {}
        _ = shutdown.cancelled() => {}
    }
}

async fn process(state: &AppState, worker: &str, job: db::Job, shutdown: &CancellationToken) {
    info!("review started");

    // Cancelled on shutdown, or when the heartbeat finds the review taken
    // away from us (superseded by a new push, PR closed, or reaped).
    let cancel = shutdown.child_token();
    let heartbeat = {
        let db = state.db.clone();
        let cancel = cancel.clone();
        let worker = worker.to_owned();
        let id = job.id;
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(HEARTBEAT) => {}
                    _ = cancel.cancelled() => return,
                }
                match db::heartbeat(&db, id, &worker).await {
                    Ok(true) => {}
                    Ok(false) => {
                        cancel.cancel();
                        return;
                    }
                    Err(err) => warn!(error = %err, "heartbeat"),
                }
            }
        })
    };

    let result = review::execute(state, &job, &cancel).await;
    heartbeat.abort();

    let outcome = match result {
        Ok(Outcome::Done {
            summary,
            agent,
            model,
        }) => {
            info!("review succeeded");
            db::finish_review(
                &state.db,
                job.id,
                worker,
                &db::Finish {
                    status: "succeeded",
                    summary: Some(&summary),
                    error: None,
                    agent: Some(agent.name()),
                    model: model.as_deref(),
                },
            )
            .await
        }
        Ok(Outcome::Skipped(reason)) => {
            info!(%reason, "review skipped");
            db::finish_review(
                &state.db,
                job.id,
                worker,
                &db::Finish {
                    status: "skipped",
                    summary: Some(&reason),
                    error: None,
                    agent: None,
                    model: None,
                },
            )
            .await
        }
        Err(ReviewError::Cancelled) if shutdown.is_cancelled() => {
            info!("review released for another worker");
            db::release_review(&state.db, job.id, worker).await
        }
        Err(ReviewError::Cancelled) => {
            info!("review cancelled");
            // Status is already final when another writer cancelled it.
            db::finish_review(
                &state.db,
                job.id,
                worker,
                &db::Finish {
                    status: "cancelled",
                    summary: None,
                    error: None,
                    agent: None,
                    model: None,
                },
            )
            .await
        }
        Err(ReviewError::Permanent(message)) => {
            warn!(%message, "review failed");
            db::finish_review(
                &state.db,
                job.id,
                worker,
                &db::Finish {
                    status: "failed",
                    summary: None,
                    error: Some(&message),
                    agent: None,
                    model: None,
                },
            )
            .await
        }
        Err(ReviewError::Retry(err)) => {
            let message = format!("{err:#}");
            if job.attempts < job.max_attempts {
                let delay = backoff(job.attempts);
                warn!(error = %message, ?delay, "review failed; will retry");
                db::retry_review(&state.db, job.id, worker, &message, delay).await
            } else {
                error!(error = %message, "review failed; no attempts left");
                db::finish_review(
                    &state.db,
                    job.id,
                    worker,
                    &db::Finish {
                        status: "failed",
                        summary: None,
                        error: Some(&message),
                        agent: None,
                        model: None,
                    },
                )
                .await
            }
        }
    };
    if let Err(err) = outcome {
        error!(error = %err, "save review state");
    }
}

/// 30 s, 60 s, 120 s, … up to 10 minutes.
fn backoff(attempt: i32) -> Duration {
    let exp = attempt.clamp(1, 6) as u32 - 1;
    Duration::from_secs((30u64 << exp).min(600))
}

async fn reaper(state: AppState, shutdown: CancellationToken) {
    loop {
        match db::requeue_stale(&state.db, STALE).await {
            Ok(0) => {}
            Ok(n) => warn!(count = n, "requeued stale reviews"),
            Err(err) => warn!(error = %err, "requeue stale reviews"),
        }
        if let Err(err) = db::prune_deliveries(&state.db).await {
            warn!(error = %err, "prune webhook deliveries");
        }
        match db::prune_reviews(&state.db).await {
            Ok(0) => {}
            Ok(n) => info!(count = n, "pruned reviews"),
            Err(err) => warn!(error = %err, "prune reviews"),
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(60)) => {}
            _ = shutdown.cancelled() => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_and_caps() {
        assert_eq!(backoff(1), Duration::from_secs(30));
        assert_eq!(backoff(2), Duration::from_secs(60));
        assert_eq!(backoff(10), Duration::from_secs(600));
        assert_eq!(backoff(0), Duration::from_secs(30));
    }
}
