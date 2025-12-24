# Карта комфортности районов

Интерактивная карта для оценки качества жилых районов города на основе близости к метро, паркам и школам/детским садам.

## Описание

Проект загружает данные из OpenStreetMap, хранит их в PostGIS, вычисляет балл комфортности для каждого жилого района и визуализирует результаты на интерактивной карте.

**Алгоритм скоринга:**  
Для каждого жилого полигона вычисляется расстояние до ближайшего метро, парка и школы. Балл комфортности рассчитывается как взвешенная сумма нормированных значений:

```
score = (w_metro × metro_score + w_parks × parks_score + w_schools × schools_score) / (w_metro + w_parks + w_schools)
```

где `score_i = max(0, 1 - dist_i / d_i)`, `dist_i` — расстояние в метрах, `d_i` — максимальный допустимый радиус.

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

Загружаются таблицы: `residential_areas`, `metro_stations`, `parks`, `schools`.

### 3. Backend
```bash
PORT=5001 python backend/app.py
```
API запустится на `http://localhost:5001`.

**Эндпоинты:**
- `GET /api/residential?tolerance=20` — жилые полигоны (GeoJSON).
- `GET /api/comfort?tolerance=20&w_metro=0.5&w_parks=0.25&w_schools=0.25&d_metro=1200&d_parks=800&d_schools=800` — карта комфортности с настраиваемыми весами и радиусами.
- `GET /api/pois` — точки интереса (метро, парки, школы).

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
- **Переключатели слоёв:** комфортность, жилые зоны, метро, парки, школы.
- **Тултипы** с детализацией: баллы, расстояния до объектов.
- **Настройки упрощения геометрии** для быстрой отрисовки больших наборов данных.
- **Параметризуемый расчёт** через query-параметры API (веса критериев, радиусы поиска).
