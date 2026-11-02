-- PR patches of the files that have findings, so the dashboard can show each
-- finding in its diff. Stored at review time, so they match the reviewed head.
CREATE TABLE review_files (
    review_id UUID NOT NULL REFERENCES reviews (id) ON DELETE CASCADE,
    path      TEXT NOT NULL,
    patch     TEXT NOT NULL,
    PRIMARY KEY (review_id, path)
);
