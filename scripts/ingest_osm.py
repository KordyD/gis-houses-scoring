#!/usr/bin/env python3
"""Download selected OSM features for a city and load them into PostGIS."""

import argparse
import os
import sys
from typing import Dict

import geopandas as gpd
import osmnx as ox
from sqlalchemy import create_engine, text

FEATURES: Dict[str, Dict] = {
    "residential_areas": {
        "tags": {
            "landuse": ["residential"],
            "building": [
                "apartments",
                "residential",
                "house",
                "detached",
                "semidetached",
            ],
        },
    },
    "metro_stations": {
        "tags": {
            "railway": ["station", "halt", "stop", "subway_entrance"],
            "public_transport": ["station", "stop_position", "stop_area"],
            "station": ["subway", "light_rail"],
        },
    },
    "parks": {
        "tags": {
            "leisure": ["park", "garden", "recreation_ground"],
            "landuse": ["recreation_ground"],
        },
    },
    "schools": {
        "tags": {
            "amenity": ["school", "kindergarten"],
        },
    },
}


def build_db_url(args: argparse.Namespace) -> str:
    """Construct SQLAlchemy DB URL from args/environment."""
    user = args.db_user or os.getenv("POSTGRES_USER", "gis")
    password = args.db_password or os.getenv("POSTGRES_PASSWORD", "gis_password")
    host = args.db_host or os.getenv("POSTGRES_HOST", "localhost")
    port = args.db_port or os.getenv("POSTGRES_PORT", "5432")
    dbname = args.db_name or os.getenv("POSTGRES_DB", "gis")
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{dbname}"


def fetch_layer(place: str, tags: Dict) -> gpd.GeoDataFrame:
    """Query OSM via Overpass for given tags."""
    print("  ↳ querying Overpass (may take time)...")
    gdf = ox.features_from_place(place, tags)
    if gdf.empty:
        return gdf
    gdf = gdf.reset_index()
    gdf = gdf[gdf.geometry.notnull()]
    return gdf


def normalize_columns(gdf: gpd.GeoDataFrame, feature_label: str) -> gpd.GeoDataFrame:
    """Keep only lightweight columns and standardize names."""
    keep = {
        "osmid",
        "name",
        "railway",
        "public_transport",
        "amenity",
        "leisure",
        "landuse",
        "building",
        "geometry",
    }
    drop_cols = [c for c in gdf.columns if c not in keep]
    gdf = gdf.drop(columns=drop_cols)
    gdf = gdf.rename_geometry("geom")
    gdf["name"] = gdf.get("name", "").fillna("")
    gdf["source"] = feature_label
    return gdf


def postprocess_residential(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Filter to polygonal residential footprints and fix geometry validity."""
    if gdf.empty:
        return gdf
    gdf = gdf[gdf.geom_type.isin(["Polygon", "MultiPolygon"])]
    gdf["geom"] = gdf.geom.buffer(0)  # fix self-intersections
    gdf = gdf[gdf.geom.notnull()]
    gdf = gdf.explode(index_parts=False).reset_index(drop=True)
    return gdf


def load_layer(engine, schema: str, table: str, gdf: gpd.GeoDataFrame, overwrite: bool) -> None:
    """Write GeoDataFrame to PostGIS."""
    if gdf.empty:
        print(f"[skip] {table}: no features returned", file=sys.stderr)
        return
    gdf.to_postgis(
        name=table,
        con=engine,
        schema=schema,
        if_exists="replace" if overwrite else "append",
        index=False,
    )
    print(f"[ok] {table}: {len(gdf)} features loaded")


def ensure_postgis(engine) -> None:
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Load selected OSM features into PostGIS")
    parser.add_argument("--place", required=True, help="City/area name, e.g. 'Moscow, Russia'")
    parser.add_argument("--schema", default="public", help="Target schema")
    parser.add_argument("--overwrite", action="store_true", help="Replace tables instead of append")
    parser.add_argument("--db-host", dest="db_host", help="Database host")
    parser.add_argument("--db-port", dest="db_port", help="Database port")
    parser.add_argument("--db-name", dest="db_name", help="Database name")
    parser.add_argument("--db-user", dest="db_user", help="Database user")
    parser.add_argument("--db-password", dest="db_password", help="Database password")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ox.settings.log_console = True
    ox.settings.timeout = 180
    ox.settings.use_cache = True
    ox.settings.cache_folder = os.path.join(os.getcwd(), ".cache-osmnx")

    db_url = build_db_url(args)
    engine = create_engine(db_url)
    ensure_postgis(engine)

    for table, cfg in FEATURES.items():
        print(f"[fetch] {table} from '{args.place}'")
        raw = fetch_layer(args.place, cfg["tags"])
        cleaned = normalize_columns(raw, table)
        if table == "residential_areas":
            cleaned = postprocess_residential(cleaned)
        load_layer(engine, args.schema, table, cleaned, args.overwrite)

    engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
