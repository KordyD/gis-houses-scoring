# Карта комфортности районов

Интерактивная карта для оценки качества жилых районов города на основе близости к метро, паркам, школам/детским садам и уровня шума.

## Описание

Проект загружает данные из OpenStreetMap, хранит их в PostGIS, вычисляет балл комфортности для каждого жилого района и визуализирует результаты на интерактивной карте.

**Алгоритм скоринга:**  
Для каждого жилого полигона вычисляется расстояние до ближайшего метро, парка, школы и источников шума. Балл комфортности рассчитывается как взвешенная сумма нормированных значений:

```
score = (w_metro × metro_score + w_parks × parks_score + w_schools × schools_score + w_noise × noise_score) / (w_metro + w_parks + w_schools + w_noise)

где:
  score_i = max(0, 1 - dist_i / d_i)
  dist_i — расстояние в метрах
  d_i — максимальный допустимый радиус
  
  noise_score = (highway_score + railway_score + industrial_score + airport_score) / 4
  (чем дальше от источника шума — выше балл)
```

**Источники шума:**
- Крупные дороги (highway=motorway, trunk, primary, secondary, tertiary)
- Железнодорожные пути (railway=rail)
- Промышленные зоны (landuse=industrial)
- Аэропорты (aeroway=aerodrome, runway, helipad)

## Быстрый старт

### 1. База данных
```bash
docker compose up -d db
```
PostGIS поднимется на `localhost:5432`, БД `gis`, пользователь `gis` / `gis_password`.

### 2. Загрузка данных
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python scripts/ingest_osm.py --place "Primorsky District, Saint Petersburg, Russia" --overwrite
```

Загружаются таблицы: `residential_areas`, `metro_stations`, `parks`, `schools`, `highways`, `railways`, `industrial_zones`, `airports`.

### 3. Backend
```bash
PORT=5001 python backend/app.py
```
API запустится на `http://localhost:5001`.

**Эндпоинты:**
- `GET /api/residential?tolerance=20` — жилые полигоны (GeoJSON).
- `GET /api/comfort?tolerance=20&w_metro=0.35&w_parks=0.20&w_schools=0.20&w_noise=0.25&d_metro=1200&d_parks=800&d_schools=800&d_highway=500&d_railway=800&d_industrial=1000&d_airport=5000` — карта комфортности с настраиваемыми весами и радиусами (включая шумовые источники).
- `GET /api/pois` — точки интереса (метро, парки, школы, дороги, ж/д, промзоны, аэропорты).

### 4. Frontend
```bash
cd frontend
npm install
cp .env.example .env
# Отредактируйте .env: VITE_API_BASE=http://localhost:5001
npm run dev
```
Откройте `http://localhost:5173`.

## Структура проекта

- `docker-compose.yml` — контейнер PostGIS
- `db/init/` — SQL-скрипты инициализации БД
- `scripts/ingest_osm.py` — загрузчик данных из OSM
- `backend/app.py` — Flask API для расчёта комфортности
- `frontend/` — React + Leaflet интерфейс с переключателями слоёв

## Возможности

- **Интерактивная карта** с цветовой шкалой комфортности (от красного к зелёному).
- **Переключатели слоёв:** комфортность, жилые зоны, метро, парки, школы, дороги, ж/д пути, промзоны, аэропорты.
- **Модуль оценки шума** на основе близости к крупным дорогам, железной дороге, промышленным зонам и аэропортам.
- **Тултипы** с детализацией: баллы комфортности, балл шума, расстояния до всех объектов.
- **Настройки упрощения геометрии** для быстрой отрисовки больших наборов данных.
- **Параметризуемый расчёт** через query-параметры API (веса критериев, радиусы поиска).
