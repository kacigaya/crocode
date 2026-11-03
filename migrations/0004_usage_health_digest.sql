-- Agent run time and the token usage that the agent CLI reports. Null when
-- the review has no agent run or the CLI reports no usage.
ALTER TABLE reviews
    ADD COLUMN agent_duration_ms   BIGINT,
    ADD COLUMN input_tokens        BIGINT,
    ADD COLUMN cached_input_tokens BIGINT,
    ADD COLUMN output_tokens       BIGINT;

-- Result of the latest model list run. A failed run keeps the old models.
ALTER TABLE agent_models
    ADD COLUMN available  BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN checked_at TIMESTAMPTZ;
UPDATE agent_models SET checked_at = detected_at;
ALTER TABLE agent_models
    ALTER COLUMN checked_at SET NOT NULL,
    ALTER COLUMN checked_at SET DEFAULT now();

-- Opt-in weekly security digest. The webhook URL is a secret. It is stored
-- sealed with AES-256-GCM under a key derived from the GitHub App private
-- key, which the database never holds. The host is kept for display.
ALTER TABLE installations
    ADD COLUMN digest_webhook_sealed TEXT,
    ADD COLUMN digest_webhook_host   TEXT,
    ADD COLUMN digest_sent_at      TIMESTAMPTZ,
    ADD COLUMN digest_attempted_at TIMESTAMPTZ,
    ADD COLUMN digest_error        TEXT;
