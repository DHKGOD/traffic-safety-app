"""FastAPI 入口：uvicorn backend.app.main:app"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import db
from .routers import ai, geo, hotspots, reports, routes, system, weather


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.open()
    ai.load_models()
    yield
    db.close()


app = FastAPI(title="交通安全路口提醒 API", version="0.1.0", lifespan=lifespan,
              description="依官方歷史事故統計提醒注意，不保證路況安全")
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
                   allow_headers=["*"], allow_credentials=False)

app.include_router(system.router)
app.include_router(hotspots.router)
app.include_router(reports.router)
app.include_router(ai.router)
app.include_router(geo.router)
app.include_router(routes.router)
app.include_router(weather.router)

# 同一個伺服器也提供網頁版前端（電腦用瀏覽器開 http://<IP>:8000/）
if settings.frontend_dir.exists():
    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
