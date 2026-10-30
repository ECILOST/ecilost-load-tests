-- Solo en el primer arranque del volumen. Las bases *_load las crea scripts/migrate-load.mjs.
-- pg_stat_statements en la base postgres ve las consultas de todas las bases del servidor.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
