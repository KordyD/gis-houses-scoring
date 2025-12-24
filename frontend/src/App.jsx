import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import * as L from "leaflet";

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:5000";
const defaultCenter = [55.751244, 37.618423];

function App() {
  const [comfort, setComfort] = useState(null);
  const [comfortStatus, setComfortStatus] = useState("loading");
  const [comfortError, setComfortError] = useState("");
  const [residential, setResidential] = useState(null);
  const [resStatus, setResStatus] = useState("loading");
  const [resError, setResError] = useState("");
  const [pois, setPois] = useState(null);
  const [poiStatus, setPoiStatus] = useState("loading");
  const [poiError, setPoiError] = useState("");
  const [tolerance, setTolerance] = useState(20);
  const [showComfort, setShowComfort] = useState(true);
  const [showResidential, setShowResidential] = useState(true);
  const [showMetro, setShowMetro] = useState(true);
  const [showParks, setShowParks] = useState(true);
  const [showSchools, setShowSchools] = useState(true);
  const mapRef = useRef(null);

  useEffect(() => {
    setComfortStatus("loading");
    setComfortError("");
    fetch(`${apiBase}/api/comfort?tolerance=${tolerance}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setComfort(data);
        setComfortStatus("ready");
      })
      .catch((err) => {
        console.error(err);
        setComfortStatus("error");
        setComfortError(err.message || "fetch failed");
      });
  }, [tolerance]);

  useEffect(() => {
    setResStatus("loading");
    setResError("");
    fetch(`${apiBase}/api/residential?tolerance=${tolerance}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setResidential(data);
        setResStatus("ready");
      })
      .catch((err) => {
        console.error(err);
        setResStatus("error");
        setResError(err.message || "fetch failed");
      });
  }, [tolerance]);

  useEffect(() => {
    setPoiStatus("loading");
    setPoiError("");
    fetch(`${apiBase}/api/pois`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setPois(data);
        setPoiStatus("ready");
      })
      .catch((err) => {
        console.error(err);
        setPoiStatus("error");
        setPoiError(err.message || "fetch failed");
      });
  }, []);

  useEffect(() => {
    if (!comfort || !comfort.features || !comfort.features.length) return;
    const layer = L.geoJSON(comfort);
    const bounds = layer.getBounds();
    if (bounds.isValid() && mapRef.current) {
      mapRef.current.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 });
    }
  }, [comfort]);

  const palette = useMemo(
    () => [
      { stop: 0.0, color: "#d73027" },
      { stop: 0.25, color: "#fc8d59" },
      { stop: 0.5, color: "#fee08b" },
      { stop: 0.75, color: "#91cf60" },
      { stop: 1.0, color: "#1a9850" },
    ],
    []
  );

  const getColor = useCallback(
    (score = 0) => {
      const s = Math.max(0, Math.min(1, score));
      for (let i = palette.length - 1; i >= 0; i -= 1) {
        if (s >= palette[i].stop) return palette[i].color;
      }
      return palette[0].color;
    },
    [palette]
  );

  const comfortStyle = useCallback(
    (feature) => {
      const score = feature?.properties?.score ?? 0;
      const color = getColor(score);
      return {
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.55,
      };
    },
    [getColor]
  );

  const onEachComfort = useCallback((feature, layer) => {
    if (!feature?.properties) return;
    const { name, score, dist_metro_m, dist_parks_m, dist_schools_m } = feature.properties;
    const lines = [
      `<strong>${name || "Жилая зона"}</strong>`,
      `Баллы: ${(score ?? 0).toFixed(3)}`,
      `Метро: ${dist_metro_m ?? "–"} м`,
      `Парки: ${dist_parks_m ?? "–"} м`,
      `Школы: ${dist_schools_m ?? "–"} м`,
    ];
    layer.bindTooltip(lines.join("<br>"));
  }, []);

  const poiMarker = useCallback((feature, latlng) => {
    const kind = feature?.properties?.kind;
    const colors = {
      metro: "#316cff",
      park: "#2ecc71",
      school: "#f39c12",
    };
    const color = colors[kind] || "#888";
    return L.circleMarker(latlng, {
      radius: 6,
      color,
      weight: 1,
      fillColor: color,
      fillOpacity: 0.9,
    }).bindTooltip(`${feature?.properties?.name || kind} (${kind})`);
  }, []);

  const filteredPois = useMemo(() => {
    if (!pois?.features) return null;
    const kindsAllowed = new Set([
      ...(showMetro ? ["metro"] : []),
      ...(showParks ? ["park"] : []),
      ...(showSchools ? ["school"] : []),
    ]);
    return {
      type: "FeatureCollection",
      features: pois.features.filter((f) => kindsAllowed.has(f?.properties?.kind)),
    };
  }, [pois, showMetro, showParks, showSchools]);

  const residentialStyle = useMemo(
    () => ({
      color: "#9fb0cc",
      weight: 1,
      fillColor: "#2a3350",
      fillOpacity: 0.15,
    }),
    []
  );

  return (
    <div className="page">
      <header className="panel">
        <div>
          <p className="eyebrow">PostGIS → Leaflet</p>
          <h1>Карта комфортности районов</h1>
          <p className="muted">
            Цвет отражает интегральный балл по близости к метро, паркам и школам. Регулируйте допуск
            упрощения геометрии (в метрах) для быстрой отрисовки.
          </p>
        </div>
        <div className="controls">
          <label>
            Допуск упрощения, м
            <input
              type="range"
              min="0"
              max="200"
              step="5"
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
            />
            <span className="value">{tolerance} м</span>
          </label>
          <div className={`pill ${comfortStatus}`}>{comfortStatus}</div>
        </div>
        <div className="toggles">
          <label><input type="checkbox" checked={showComfort} onChange={(e) => setShowComfort(e.target.checked)} /> Комфорт</label>
          <label><input type="checkbox" checked={showResidential} onChange={(e) => setShowResidential(e.target.checked)} /> Жилая маска</label>
          <label><input type="checkbox" checked={showMetro} onChange={(e) => setShowMetro(e.target.checked)} /> Метро</label>
          <label><input type="checkbox" checked={showParks} onChange={(e) => setShowParks(e.target.checked)} /> Парки</label>
          <label><input type="checkbox" checked={showSchools} onChange={(e) => setShowSchools(e.target.checked)} /> Школы/сады</label>
        </div>
      </header>

      <main className="map-wrap">
        <MapContainer
          center={defaultCenter}
          zoom={11}
          scrollWheelZoom
          style={{ height: "100%", width: "100%" }}
          ref={mapRef}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {showComfort && comfort ? (
            <GeoJSON
              key={`comfort-${comfort.features?.length || 0}`}
              data={comfort}
              style={comfortStyle}
              onEachFeature={onEachComfort}
            />
          ) : showComfort ? (
            <div className="placeholder">Загружается комфортность…</div>
          ) : null}

          {showResidential && residential && (
            <GeoJSON
              key={`res-${residential.features?.length || 0}`}
              data={residential}
              style={residentialStyle}
            />
          )}

          {filteredPois && filteredPois.features.length > 0 && (
            <GeoJSON key={`pois-${filteredPois.features.length}`} data={filteredPois} pointToLayer={poiMarker} />
          )}
        </MapContainer>
        {comfortStatus === "error" && (
          <div className="toast error">
            <strong>Ошибка комфортности</strong>
            <div>{comfortError || "Не удалось обратиться к API"}</div>
            <div className="muted">Проверьте VITE_API_BASE и порт backend</div>
          </div>
        )}
        {comfortStatus === "ready" && comfort && (!comfort.features || !comfort.features.length) && (
          <div className="toast">
            <strong>Данные не найдены</strong>
            <div>GeoJSON пуст. Проверьте, что таблица residential_areas заполнена.</div>
            <div className="muted">API: {apiBase}</div>
          </div>
        )}
        {comfortStatus === "ready" && comfort && comfort.features?.length > 0 && (
          <div className="toast">
            <strong>Полигонов: {comfort.features.length}</strong>
            <div className="muted">API: {apiBase}</div>
          </div>
        )}
        {resStatus === "error" && (
          <div className="toast error" style={{ bottom: "140px" }}>
            <strong>Ошибка жилой маски</strong>
            <div>{resError || "Не удалось загрузить residential"}</div>
          </div>
        )}
        {poiStatus === "error" && (
          <div className="toast error" style={{ bottom: "100px" }}>
            <strong>Ошибка POI</strong>
            <div>{poiError || "Не удалось загрузить метро/парки/школы"}</div>
          </div>
        )}
        <div className="legend">
          <div className="legend-title">Баллы комфортности</div>
          <div className="legend-scale">
            {palette.map((p, i) => (
              <div key={i} className="legend-item">
                <span className="swatch" style={{ background: p.color }} />
                <span>{p.stop}</span>
              </div>
            ))}
          </div>
          <div className="legend-note">0 — хуже, 1 — лучше</div>
        </div>
      </main>
    </div>
  );
}

export default App;
