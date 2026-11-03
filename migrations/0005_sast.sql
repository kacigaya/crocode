-- Static analysis before the agent. `sast_status` is null when the scan did
-- not run: it is off, or the review stopped first. `partial` means OpenGrep
-- finished with errors, so some results can be missing.
ALTER TABLE reviews
    ADD COLUMN sast_status TEXT
        CHECK (sast_status IN ('completed', 'partial', 'failed', 'timed_out'));

-- OpenGrep results on added lines, as the agent received them.
CREATE TABLE sast_results (
    review_id UUID NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    rule_id   TEXT NOT NULL,
    path      TEXT NOT NULL,
    line      INTEGER NOT NULL,
    end_line  INTEGER NOT NULL,
    severity  TEXT NOT NULL,
    message   TEXT NOT NULL,
    PRIMARY KEY (review_id, position)
);
