import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import * as L from "leaflet";

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:5000";
const defaultCenter = [59.9311, 30.3609];

function App() {
  const [comfort, setComfort] = useState(null);
  const [comfortStatus, setComfortStatus] = useState("loading");
  const [comfortError, setComfortError] = useState("");
  const [pois, setPois] = useState(null);
  const [poiStatus, setPoiStatus] = useState("loading");
  const [poiError, setPoiError] = useState("");
  const [showComfort, setShowComfort] = useState(true);
  const [showMetro, setShowMetro] = useState(true);
  const [showParks, setShowParks] = useState(true);
  const [showSchools, setShowSchools] = useState(true);
  const [showHighways, setShowHighways] = useState(false);
  const [showRailways, setShowRailways] = useState(false);
  const [showIndustrial, setShowIndustrial] = useState(false);
  const [showAirports, setShowAirports] = useState(false);
  const [showBars, setShowBars] = useState(false);
  const [wMetro, setWMetro] = useState(0.35);
  const [wParks, setWParks] = useState(0.20);
  const [wSchools, setWSchools] = useState(0.20);
  const [wNoise, setWNoise] = useState(0.25);
  const [debouncedWeights, setDebouncedWeights] = useState({ wMetro: 0.35, wParks: 0.20, wSchools: 0.20, wNoise: 0.25 });
  const mapRef = useRef(null);
  const comfortReqSeq = useRef(0);
  const [comfortKey, setComfortKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedWeights({ wMetro, wParks, wSchools, wNoise });
    }, 1000);
    return () => clearTimeout(timer);
  }, [wMetro, wParks, wSchools, wNoise]);

  useEffect(() => {
    setComfortStatus("loading");
    setComfortError("");
    const controller = new AbortController();
    const currentSeq = ++comfortReqSeq.current;
    const params = new URLSearchParams({
      w_metro: debouncedWeights.wMetro,
      w_parks: debouncedWeights.wParks,
      w_schools: debouncedWeights.wSchools,
      w_noise: debouncedWeights.wNoise,
      _ts: Date.now(),
    });
    fetch(`${apiBase}/api/comfort?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        if (currentSeq === comfortReqSeq.current) {
          setComfort(data);
          setComfortStatus("ready");
          setComfortKey((k) => k + 1);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.error(err);
        setComfortStatus("error");
        setComfortError(err.message || "fetch failed");
      });
    return () => controller.abort();
  }, [debouncedWeights]);

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
    const { name, score, quietness, dist_metro_m, dist_parks_m, dist_schools_m } = feature.properties;
    const lines = [
      `<strong>${name || "Жилая зона"}</strong>`,
      `Баллы: ${(score ?? 0).toFixed(3)}`,
      `Тишина: ${(quietness ?? 0).toFixed(3)}`,
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
      highway: "#e74c3c",
      railway: "#95a5a6",
      industrial: "#8e44ad",
      airport: "#34495e",
      bar: "#9b9b57",
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
      ...(showHighways ? ["highway"] : []),
      ...(showRailways ? ["railway"] : []),
      ...(showIndustrial ? ["industrial"] : []),
      ...(showAirports ? ["airport"] : []),
      ...(showBars ? ["bar"] : []),
    ]);
    return {
      type: "FeatureCollection",
      features: pois.features.filter((f) => kindsAllowed.has(f?.properties?.kind)),
    };
  }, [pois, showMetro, showParks, showSchools, showHighways, showRailways, showIndustrial, showAirports, showBars]);

  return (
    <div className="page">
      <header className="panel">
        <div>
          <p className="eyebrow">PostGIS → Leaflet</p>
          <h1>Карта комфортности районов</h1>
          <p className="muted">
            Цвет отражает интегральный балл по близости к метро, паркам, школам и тишине.
          </p>
        </div>
        <div className="controls">
          <label>
            Метро (важность)
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={wMetro}
              onChange={(e) => setWMetro(Number(e.target.value))}
            />
            <span className="value">{wMetro.toFixed(2)}</span>
          </label>
          <label>
            Парки (важность)
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={wParks}
              onChange={(e) => setWParks(Number(e.target.value))}
            />
            <span className="value">{wParks.toFixed(2)}</span>
          </label>
          <label>
            Школы (важность)
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={wSchools}
              onChange={(e) => setWSchools(Number(e.target.value))}
            />
            <span className="value">{wSchools.toFixed(2)}</span>
          </label>
          <label>
            Тишина (важность)
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={wNoise}
              onChange={(e) => setWNoise(Number(e.target.value))}
            />
            <span className="value">{wNoise.toFixed(2)}</span>
          </label>
          <div className={`pill ${comfortStatus}`}>{comfortStatus}</div>
        </div>
        <div className="toggles">
          <label><input type="checkbox" checked={showComfort} onChange={(e) => setShowComfort(e.target.checked)} /> Комфорт</label>
          <label><input type="checkbox" checked={showMetro} onChange={(e) => setShowMetro(e.target.checked)} /> Метро</label>
          <label><input type="checkbox" checked={showParks} onChange={(e) => setShowParks(e.target.checked)} /> Парки</label>
          <label><input type="checkbox" checked={showSchools} onChange={(e) => setShowSchools(e.target.checked)} /> Школы/сады</label>
          <label><input type="checkbox" checked={showHighways} onChange={(e) => setShowHighways(e.target.checked)} /> Дороги</label>
          <label><input type="checkbox" checked={showRailways} onChange={(e) => setShowRailways(e.target.checked)} /> ЖД пути</label>
          <label><input type="checkbox" checked={showIndustrial} onChange={(e) => setShowIndustrial(e.target.checked)} /> Промзоны</label>
          <label><input type="checkbox" checked={showAirports} onChange={(e) => setShowAirports(e.target.checked)} /> Аэропорты</label>
          <label><input type="checkbox" checked={showBars} onChange={(e) => setShowBars(e.target.checked)} /> Бары/клубы</label>
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
              key={`comfort-${comfortKey}`}
              data={comfort}
              style={comfortStyle}
              onEachFeature={onEachComfort}
            />
          ) : showComfort ? (
            <div className="placeholder">Загружается комфортность…</div>
          ) : null}

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
