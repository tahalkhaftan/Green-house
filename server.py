"""Small Render-compatible server for the simulation frontend."""
import json
from functools import lru_cache
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
app = FastAPI(title='Green-house', docs_url=None, redoc_url=None)


def validate_weather(path: Path) -> bool:
    """Reject truncated or malformed weather data before a deployment is healthy."""
    try:
        with path.open(encoding='utf-8') as handle:
            data = json.load(handle)
        rows = data.get('rows')
        return (data.get('start_year') == 2020 and data.get('end_year') == 2025
                and isinstance(rows, list) and len(rows) == 52608
                and all(isinstance(row, list) and len(row) >= 5 for row in rows))
    except (OSError, ValueError, TypeError, AttributeError):
        return False


@lru_cache(maxsize=1)
def weather_ready() -> bool:
    return validate_weather(ROOT / 'public/weather-2020-2025.json')


@app.get('/api/health')
def health():
    weather_available = weather_ready()
    status = {'status': 'ok' if weather_available else 'error',
              'model_available': (ROOT / 'public/model.json').exists(),
              'trace_available': (ROOT / 'public/trace.json').exists(),
              'weather_available': weather_available,
              'release': 'greenhouse-blue-sky-2026-11-25'}
    return JSONResponse(status, status_code=200 if weather_available else 503)


@app.get('/')
def home():
    return FileResponse(ROOT / 'public/index.html')


app.mount('/', StaticFiles(directory=ROOT / 'public'), name='static')
