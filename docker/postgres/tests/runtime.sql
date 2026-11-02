-- Run against a disposable database after crocode migrate.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE crocode_runtime;
DO $$
DECLARE
    name text;
BEGIN
    FOREACH name IN ARRAY ARRAY['installations', 'webhook_deliveries', 'reviews', 'findings', 'review_files'] LOOP
        IF NOT has_table_privilege(current_user, name, 'SELECT')
           OR NOT has_table_privilege(current_user, name, 'INSERT')
           OR NOT has_table_privilege(current_user, name, 'UPDATE')
           OR NOT has_table_privilege(current_user, name, 'DELETE') THEN
            RAISE EXCEPTION 'runtime data access missing: %', name;
        END IF;
    END LOOP;
    IF has_table_privilege(current_user, '_sqlx_migrations', 'SELECT')
       OR has_table_privilege(current_user, '_sqlx_migrations', 'INSERT')
       OR has_table_privilege(current_user, '_sqlx_migrations', 'UPDATE')
       OR has_table_privilege(current_user, '_sqlx_migrations', 'DELETE') THEN
        RAISE EXCEPTION 'runtime can access migration history';
    END IF;
    BEGIN
        CREATE TABLE public.runtime_must_not_create_tables (id integer);
        RAISE EXCEPTION 'runtime can create tables';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    BEGIN
        ALTER TABLE public.reviews ADD COLUMN runtime_must_not_alter boolean;
        RAISE EXCEPTION 'runtime can alter tables';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
INSERT INTO installations (id, account_id, account_login, account_type)
VALUES (-1, -1, 'runtime-test', 'User');
UPDATE installations SET enabled = false WHERE id = -1;
SELECT enabled FROM installations WHERE id = -1;
DELETE FROM installations WHERE id = -1;
ROLLBACK;
