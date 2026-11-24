"""Small Render-compatible server for the simulation frontend."""
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
app = FastAPI(title='Green-house', docs_url=None, redoc_url=None)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'model_available': (ROOT / 'public/model.json').exists(), 'trace_available': (ROOT / 'public/trace.json').exists(), 'weather_available': (ROOT / 'public/weather-2021-2025.json').exists(), 'release': 'multi-year-signals-2026-11-25'}


@app.get('/')
def home():
    return FileResponse(ROOT / 'public/index.html')


app.mount('/', StaticFiles(directory=ROOT / 'public'), name='static')
