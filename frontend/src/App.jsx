import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer } from "react-leaflet";
import * as L from "leaflet";

const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:5000";
const defaultCenter = [55.751244, 37.618423];

function App() {
  const [geojson, setGeojson] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [tolerance, setTolerance] = useState(20);
  const mapRef = useRef(null);

  useEffect(() => {
    setStatus("loading");
    setError("");
    fetch(`${apiBase}/api/residential?tolerance=${tolerance}`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setGeojson(data);
        setStatus("ready");
      })
      .catch((err) => {
        console.error(err);
        setStatus("error");
        setError(err.message || "fetch failed");
      });
  }, [tolerance]);

  useEffect(() => {
    if (!geojson || !geojson.features || !geojson.features.length) return;
    const layer = L.geoJSON(geojson);
    const bounds = layer.getBounds();
    if (bounds.isValid() && mapRef.current) {
      mapRef.current.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 });
    }
  }, [geojson]);

  const featureStyle = useMemo(
    () => ({
      color: "#12754f",
      weight: 1,
      fillColor: "#6bdba7",
      fillOpacity: 0.4,
    }),
    []
  );

  return (
    <div className="page">
      <header className="panel">
        <div>
          <p className="eyebrow">PostGIS → Leaflet</p>
          <h1>Жилые зоны города</h1>
          <p className="muted">
            Источник: таблица residential_areas. Регулируйте допуск упрощения геометрии
            (в метрах) для быстрой отрисовки.
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
          <div className={`pill ${status}`}>{status}</div>
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
          {geojson ? (
            <GeoJSON key={JSON.stringify(geojson.features?.length || 0)} data={geojson} style={featureStyle} />
          ) : (
            <div className="placeholder">Загружается GeoJSON…</div>
          )}
        </MapContainer>
        {status === "error" && (
          <div className="toast error">
            <strong>Ошибка загрузки GeoJSON</strong>
            <div>{error || "Не удалось обратиться к API"}</div>
            <div className="muted">Проверьте VITE_API_BASE и порт backend</div>
          </div>
        )}
        {status === "ready" && geojson && (!geojson.features || !geojson.features.length) && (
          <div className="toast">
            <strong>Данные не найдены</strong>
            <div>GeoJSON пуст. Проверьте, что таблица residential_areas заполнена.</div>
            <div className="muted">API: {apiBase}</div>
          </div>
        )}
        {status === "ready" && geojson && geojson.features?.length > 0 && (
          <div className="toast">
            <strong>Загружено объектов: {geojson.features.length}</strong>
            <div className="muted">API: {apiBase}</div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
