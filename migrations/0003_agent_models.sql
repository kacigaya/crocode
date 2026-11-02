-- Models that each agent CLI reports. The worker refreshes this table. The
-- dashboard shows the models as suggestions; settings accept any valid name.
CREATE TABLE agent_models (
    agent       TEXT PRIMARY KEY,
    models      JSONB NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
