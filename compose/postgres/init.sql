-- Solo en el primer arranque del volumen: una base por servicio (las migraciones las aplica
-- cada servicio al arrancar) y pg_stat_statements, que desde la base postgres ve las consultas
-- de todas las bases del servidor.
CREATE DATABASE ecilost_auth_load;
CREATE DATABASE ecilost_catalog_load;
CREATE DATABASE ecilost_wallet_load;
CREATE DATABASE ecilost_auction_load;
CREATE DATABASE ecilost_engagement_load;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
