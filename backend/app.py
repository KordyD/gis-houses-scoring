import os
import re
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import bindparam, create_engine, text


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


def clamp_float(val: Optional[str], default: float, lo: float, hi: float) -> float:
    try:
        num = float(val)
    except (TypeError, ValueError):
        return default
    return max(lo, min(num, hi))


def get_engine():
    db_url = build_db_url()
    return create_engine(db_url, future=True)


@app.get("/health")
def health() -> Any:
    return {"status": "ok"}


@app.get("/api/residential")
def residential_geojson():
    schema = safe_schema(request.args.get("schema", "public"))
    tolerance = clamp_float(request.args.get("tolerance"), 20.0, 0.0, 500.0)

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


@app.get("/api/comfort")
def comfort_geojson():
    schema = safe_schema(request.args.get("schema", "public"))
    tolerance = clamp_float(request.args.get("tolerance"), 20.0, 0.0, 500.0)

    w_metro = clamp_float(request.args.get("w_metro"), 0.35, 0.0, 1.0)
    w_parks = clamp_float(request.args.get("w_parks"), 0.20, 0.0, 1.0)
    w_schools = clamp_float(request.args.get("w_schools"), 0.20, 0.0, 1.0)
    w_noise = clamp_float(request.args.get("w_noise"), 0.25, 0.0, 1.0)

    d_metro = clamp_float(request.args.get("d_metro"), 1200.0, 100.0, 3000.0)
    d_parks = clamp_float(request.args.get("d_parks"), 800.0, 100.0, 3000.0)
    d_schools = clamp_float(request.args.get("d_schools"), 800.0, 100.0, 3000.0)
    d_highway = clamp_float(request.args.get("d_highway"), 500.0, 50.0, 2000.0)
    d_railway = clamp_float(request.args.get("d_railway"), 800.0, 100.0, 2000.0)
    d_industrial = clamp_float(request.args.get("d_industrial"), 1000.0, 100.0, 3000.0)
    d_airport = clamp_float(request.args.get("d_airport"), 5000.0, 500.0, 10000.0)
    d_bars = clamp_float(request.args.get("d_bars"), 300.0, 50.0, 1000.0)

    sql = text(
        f"""
        WITH params AS (
            SELECT
                :w_metro AS w_metro,
                :w_parks AS w_parks,
                :w_schools AS w_schools,
                :w_noise AS w_noise,
                :d_metro AS d_metro,
                :d_parks AS d_parks,
                :d_schools AS d_schools,
                :d_highway AS d_highway,
                :d_railway AS d_railway,
                :d_industrial AS d_industrial,
                :d_airport AS d_airport,
                :d_bars AS d_bars
        ), res AS (
            SELECT
                row_number() OVER () AS fid,
                name,
                geom
            FROM {schema}.residential_areas
            WHERE geom IS NOT NULL
        ), scored AS (
            SELECT
                r.fid,
                r.name,
                r.geom,
                metro.dist_m AS dist_metro_m,
                parks.dist_m AS dist_parks_m,
                schools.dist_m AS dist_schools_m,
                highway.dist_m AS dist_highway_m,
                railway.dist_m AS dist_railway_m,
                industrial.dist_m AS dist_industrial_m,
                airport.dist_m AS dist_airport_m,
                bars.dist_m AS dist_bars_m,
                p.w_metro,
                p.w_parks,
                p.w_schools,
                p.w_noise,
                p.d_metro,
                p.d_parks,
                p.d_schools,
                p.d_highway,
                p.d_railway,
                p.d_industrial,
                p.d_airport,
                p.d_bars,
                GREATEST(0, 1 - COALESCE(metro.dist_m, p.d_metro) / p.d_metro) AS metro_score,
                GREATEST(0, 1 - COALESCE(parks.dist_m, p.d_parks) / p.d_parks) AS parks_score,
                GREATEST(0, 1 - COALESCE(schools.dist_m, p.d_schools) / p.d_schools) AS schools_score,
                CASE WHEN highway.dist_m IS NULL THEN 1.0 ELSE LEAST(1.0, highway.dist_m / p.d_highway) END AS highway_score,
                CASE WHEN railway.dist_m IS NULL THEN 1.0 ELSE LEAST(1.0, railway.dist_m / p.d_railway) END AS railway_score,
                CASE WHEN industrial.dist_m IS NULL THEN 1.0 ELSE LEAST(1.0, industrial.dist_m / p.d_industrial) END AS industrial_score,
                CASE WHEN airport.dist_m IS NULL THEN 1.0 ELSE LEAST(1.0, airport.dist_m / p.d_airport) END AS airport_score,
                CASE WHEN bars.dist_m IS NULL THEN 1.0 ELSE LEAST(1.0, bars.dist_m / p.d_bars) END AS bars_score
            FROM res r
            CROSS JOIN params p
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, m.geom::geography) AS dist_m
                FROM {schema}.metro_stations m
                ORDER BY r.geom <-> m.geom
                LIMIT 1
            ) AS metro ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, pk.geom::geography) AS dist_m
                FROM {schema}.parks pk
                ORDER BY r.geom <-> pk.geom
                LIMIT 1
            ) AS parks ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, s.geom::geography) AS dist_m
                FROM {schema}.schools s
                ORDER BY r.geom <-> s.geom
                LIMIT 1
            ) AS schools ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, h.geom::geography) AS dist_m
                FROM {schema}.highways h
                ORDER BY r.geom <-> h.geom
                LIMIT 1
            ) AS highway ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, rl.geom::geography) AS dist_m
                FROM {schema}.railways rl
                ORDER BY r.geom <-> rl.geom
                LIMIT 1
            ) AS railway ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, iz.geom::geography) AS dist_m
                FROM {schema}.industrial_zones iz
                ORDER BY r.geom <-> iz.geom
                LIMIT 1
            ) AS industrial ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, ap.geom::geography) AS dist_m
                FROM {schema}.airports ap
                ORDER BY r.geom <-> ap.geom
                LIMIT 1
            ) AS airport ON TRUE
            LEFT JOIN LATERAL (
                SELECT ST_Distance(r.geom::geography, b.geom::geography) AS dist_m
                FROM {schema}.bars b
                ORDER BY r.geom <-> b.geom
                LIMIT 1
            ) AS bars ON TRUE
        ), agg AS (
            SELECT
                fid,
                name,
                geom,
                dist_metro_m,
                dist_parks_m,
                dist_schools_m,
                (highway_score + railway_score + industrial_score + airport_score + bars_score) / 5.0 AS noise_score,
                CASE
                    WHEN (w_metro + w_parks + w_schools + w_noise) = 0 THEN 0
                    ELSE (
                        metro_score * w_metro +
                        parks_score * w_parks +
                        schools_score * w_schools +
                        ((highway_score + railway_score + industrial_score + airport_score + bars_score) / 5.0) * w_noise
                    ) / (w_metro + w_parks + w_schools + w_noise)
                END AS comfort_score
            FROM scored
        )
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(
                    ST_Transform(
                        ST_SimplifyPreserveTopology(ST_Transform(geom, 3857), :tol),
                        4326
                    )
                )::json,
                'properties', json_build_object(
                    'id', fid,
                    'name', name,
                    'score', round(comfort_score::numeric, 3),
                    'quietness', round(noise_score::numeric, 3),
                    'dist_metro_m', round(dist_metro_m::numeric, 1),
                    'dist_parks_m', round(dist_parks_m::numeric, 1),
                    'dist_schools_m', round(dist_schools_m::numeric, 1)
                )
            )), '[]'::json)
        ) AS fc
        FROM agg;
        """
    )

    sql = sql.bindparams(
        bindparam("tol"),
        bindparam("w_metro"),
        bindparam("w_parks"),
        bindparam("w_schools"),
        bindparam("w_noise"),
        bindparam("d_metro"),
        bindparam("d_parks"),
        bindparam("d_schools"),
        bindparam("d_highway"),
        bindparam("d_railway"),
        bindparam("d_industrial"),
        bindparam("d_airport"),
        bindparam("d_bars"),
    )

    params = {
        "tol": tolerance,
        "w_metro": w_metro,
        "w_parks": w_parks,
        "w_schools": w_schools,
        "w_noise": w_noise,
        "d_metro": d_metro,
        "d_parks": d_parks,
        "d_schools": d_schools,
        "d_highway": d_highway,
        "d_railway": d_railway,
        "d_industrial": d_industrial,
        "d_airport": d_airport,
        "d_bars": d_bars,
    }

    engine = get_engine()
    with engine.begin() as conn:
        result = conn.execute(sql, params).scalar_one()
    engine.dispose()
    return jsonify(result)


@app.get("/api/pois")
def pois_geojson():
    schema = safe_schema(request.args.get("schema", "public"))

    sql = text(
        f"""
        WITH feats AS (
            SELECT row_number() OVER () AS gid, 'metro'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.metro_stations
            UNION ALL
            SELECT row_number() OVER () AS gid, 'park'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.parks
            UNION ALL
            SELECT row_number() OVER () AS gid, 'school'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.schools
            UNION ALL
            SELECT row_number() OVER () AS gid, 'highway'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.highways
            UNION ALL
            SELECT row_number() OVER () AS gid, 'railway'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.railways
            UNION ALL
            SELECT row_number() OVER () AS gid, 'industrial'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.industrial_zones
            UNION ALL
            SELECT row_number() OVER () AS gid, 'airport'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.airports
            UNION ALL
            SELECT row_number() OVER () AS gid, 'bar'::text AS kind, COALESCE(name, '') AS name, geom
            FROM {schema}.bars
        ), prepared AS (
            SELECT
                gid,
                kind,
                name,
                CASE
                    WHEN GeometryType(geom) IN ('POLYGON', 'MULTIPOLYGON') THEN ST_PointOnSurface(geom)
                    ELSE geom
                END AS geom_point
            FROM feats
            WHERE geom IS NOT NULL
        )
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(ST_Transform(geom_point, 4326))::json,
                'properties', json_build_object(
                    'id', gid,
                    'kind', kind,
                    'name', name
                )
            )), '[]'::json)
        ) AS fc
        FROM prepared;
        """
    )

    engine = get_engine()
    with engine.begin() as conn:
        result = conn.execute(sql).scalar_one()
    engine.dispose()
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
