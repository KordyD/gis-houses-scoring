# GIS Project: OSM → PostGIS loader

Этот репозиторий содержит базовую инфраструктуру для загрузки открытых данных OpenStreetMap в PostGIS.

## Что есть
- `docker-compose.yml` — поднимает контейнер PostGIS с инициализацией из `db/init`.
- `scripts/ingest_osm.py` — скачивает выбранные объекты OSM для заданного города и пишет в PostGIS.
- `backend/` — Flask API, отдаёт GeoJSON жилых зон из PostGIS.
- `frontend/` — React + Leaflet-клиент для просмотра жилых зон на карте.
- `requirements.txt` — зависимости для скрипта загрузки.

## Запуск базы
1. Установите Docker и Docker Compose.
2. Поднимите базу: `docker compose up -d db`.
3. После старта в контейнере будет создана БД `gis`, расширения PostGIS и роль `gis_ingest` (пароль `gis_ingest_password`).

## Загрузка данных OSM в PostGIS
1. Создайте и активируйте Python venv, установите зависимости: `pip install -r requirements.txt`.
2. Запустите скрипт, указав город:
   ```bash
   python scripts/ingest_osm.py --place "Moscow, Russia" --overwrite
   ```

### Параметры скрипта
- `--place` — обязательное название города/области (например, `"Saint Petersburg, Russia"`).
- `--schema` — схема в БД (по умолчанию `public`).
- `--overwrite` — заменить таблицы вместо добавления в конец.
- Подключение к БД берётся из переменных окружения `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`; при их отсутствии используются значения по умолчанию (`localhost:5432`, `gis`, `gis`, `gis_password`).

### Что скачивается
Скрипт создаёт таблицы:
- `residential_areas` — полигоны жилой застройки (`landuse=residential`, жилые `building=*`), основная маска для расчётов.
- `metro_stations` — метро/железнодорожные станции.
- `parks` — парки, сады, рекреационные зоны.
- `schools` — школы и детские сады.

## Backend: Flask API
1. Экспортируйте подключения к БД (по умолчанию используются те же, что и для загрузчика):
   ```bash
   export POSTGRES_HOST=localhost
   export POSTGRES_PORT=5432
   export POSTGRES_DB=gis
   export POSTGRES_USER=gis
   export POSTGRES_PASSWORD=gis_password
   ```
2. Установите зависимости (используются из корневого `requirements.txt`).
3. Запустите сервер: `python backend/app.py`. Эндпоинт `GET /api/residential?tolerance=20` вернёт FeatureCollection из таблицы `residential_areas` (допуск упрощения в метрах).

## Frontend: React + Leaflet
1. Перейдите в `frontend/`, установите зависимости: `npm install`.
2. Скопируйте пример `.env`: `cp frontend/.env.example frontend/.env` и при необходимости смените порт (например, `http://localhost:5001`).
3. Запустите dev-сервер: `npm run dev` (по умолчанию на `http://localhost:5173`).
4. Откройте в браузере; карта загрузит GeoJSON жилых зон из backend и нарисует их на фоне OSM тайлов. Слайдер регулирует упрощение геометрии.

## Полезно знать
- При повторном запуске с `--overwrite` таблицы пересоздаются, что удобно для обновления данных.
- Для отладки можно включить кэширование и логирование osmnx, см. документацию библиотеки.
