-- Base database initialization for PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_raster;

-- Optionally create a dedicated ingestion role for application use
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gis_ingest') THEN
    CREATE ROLE gis_ingest LOGIN PASSWORD 'gis_ingest_password';
  END IF;
END$$;

GRANT CONNECT ON DATABASE gis TO gis_ingest;
GRANT USAGE ON SCHEMA public TO gis_ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gis_ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gis_ingest;
