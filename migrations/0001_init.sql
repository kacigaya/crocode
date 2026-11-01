-- One row per GitHub App installation. The GitHub installation ID is the key.
CREATE TABLE installations (
    id                   BIGINT PRIMARY KEY,
    account_id           BIGINT NOT NULL,
    account_login        TEXT NOT NULL,
    account_type         TEXT NOT NULL,
    repository_selection TEXT NOT NULL DEFAULT 'selected',
    suspended            BOOLEAN NOT NULL DEFAULT FALSE,
    deleted              BOOLEAN NOT NULL DEFAULT FALSE,
    enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    agent                TEXT,
    model                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery IDs of processed webhooks. GitHub can redeliver an event.
CREATE TABLE webhook_deliveries (
    id          TEXT PRIMARY KEY,
    event       TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A review is also the job record in the work queue.
CREATE TABLE reviews (
    id              UUID PRIMARY KEY,
    installation_id BIGINT NOT NULL REFERENCES installations (id) ON DELETE CASCADE,
    repo_id         BIGINT NOT NULL,
    repo_full_name  TEXT NOT NULL,
    pr_number       INTEGER NOT NULL,
    pr_title        TEXT NOT NULL DEFAULT '',
    head_sha        TEXT NOT NULL,
    base_sha        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by       TEXT,
    heartbeat_at    TIMESTAMPTZ,
    agent           TEXT,
    model           TEXT,
    summary         TEXT,
    error           TEXT,
    github_review_id BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    UNIQUE (repo_id, pr_number, head_sha)
);

CREATE INDEX reviews_queue_idx ON reviews (run_after) WHERE status = 'queued';
CREATE INDEX reviews_running_idx ON reviews (heartbeat_at) WHERE status = 'running';
CREATE INDEX reviews_installation_idx ON reviews (installation_id, created_at DESC);

CREATE TABLE findings (
    id          UUID PRIMARY KEY,
    review_id   UUID NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
    repo_id     BIGINT NOT NULL,
    pr_number   INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    path        TEXT NOT NULL,
    start_line  INTEGER,
    line        INTEGER NOT NULL,
    severity    TEXT NOT NULL,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    suggestion  TEXT,
    published   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX findings_review_idx ON findings (review_id);
CREATE INDEX findings_dedupe_idx ON findings (repo_id, pr_number, fingerprint) WHERE published;
