import os
import re
from typing import Any, Dict

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text


app = Flask(__name__)
CORS(app)


def build_db_url() -> str:
    user = os.getenv("POSTGRES_USER", "gis")
    password = os.getenv("POSTGRES_PASSWORD", "gis_password")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    dbname = os.getenv("POSTGRES_DB", "gis")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"


def safe_schema(name: str) -> str:
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
        return name
    return "public"


def get_engine():
    db_url = build_db_url()
    return create_engine(db_url, future=True)


@app.get("/health")
def health() -> Any:
    return {"status": "ok"}


@app.get("/api/residential")
def residential_geojson():
    schema = safe_schema(request.args.get("schema", "public"))
    try:
        tolerance = float(request.args.get("tolerance", 20))
    except ValueError:
        tolerance = 20.0
    tolerance = max(0.0, min(tolerance, 500.0))

    sql = text(
        f"""
        WITH data AS (
            SELECT
                row_number() OVER () AS fid,
                name,
                ST_Transform(geom, 3857) AS geom_web
            FROM {schema}.residential_areas
            WHERE geom IS NOT NULL
        )
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom_web, :tol), 4326))::json,
                'properties', json_build_object(
                    'id', fid,
                    'name', name
                )
            )), '[]'::json)
        ) AS fc
        FROM data;
        """
    )

    engine = get_engine()
    with engine.begin() as conn:
        result = conn.execute(sql, {"tol": tolerance}).scalar_one()
    engine.dispose()

    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
