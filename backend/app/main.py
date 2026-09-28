from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router
from .seed import sample_workflow
from .store import WorkflowStore

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def create_app(database: str | None = None, seed: bool = True) -> FastAPI:
    app = FastAPI(title="Afterglow Onboarding API", version="0.1.0")
    app.state.store = WorkflowStore(database or os.getenv("DATABASE_PATH", str(BACKEND_DIR / "data" / "workflows.sqlite3")))
    if seed and app.state.store.get_workflow("sample-northstar") is None:
        app.state.store.create_workflow(sample_workflow())
    origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in origins],
                       allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type"])
    app.include_router(router)
    return app


app = create_app()
