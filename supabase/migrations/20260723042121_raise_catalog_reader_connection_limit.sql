-- A page load starts several independent read-only catalog queries. The
-- previous limit of 12 was exhausted when multiple POS clients opened at once
-- or a realtime transport became ready during the initial fetch. Twenty stays
-- below 40% of the project's 60 Postgres connections, leaving capacity for
-- Auth, Realtime, Storage, PostgREST, and administrative sessions.
alter role pos_catalog_reader_live connection limit 20;
