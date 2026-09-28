from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .models import Workflow


class VersionConflict(Exception):
    pass


class WorkflowStore:
    def __init__(self, database: str):
        self.database = database
        Path(database).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS workflows "
                "(id TEXT PRIMARY KEY, version INTEGER NOT NULL, document TEXT NOT NULL)"
            )

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.database, timeout=10)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            with connection:
                yield connection
        finally:
            connection.close()

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT document FROM workflows WHERE id = ?", (workflow_id,)
            ).fetchone()
        return Workflow.model_validate_json(row[0]) if row else None

    def list_workflows(self) -> list[Workflow]:
        with self.connect() as connection:
            rows = connection.execute("SELECT document FROM workflows ORDER BY rowid").fetchall()
        return [Workflow.model_validate_json(row[0]) for row in rows]

    def create_workflow(self, workflow: Workflow) -> Workflow:
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO workflows (id, version, document) VALUES (?, ?, ?)",
                (workflow.id, workflow.version, workflow.model_dump_json()),
            )
        return workflow

    def save_workflow(self, workflow: Workflow, expected_version: int) -> Workflow:
        with self.connect() as connection:
            result = connection.execute(
                "UPDATE workflows SET version = ?, document = ? WHERE id = ? AND version = ?",
                (workflow.version, workflow.model_dump_json(), workflow.id, expected_version),
            )
            if result.rowcount != 1:
                raise VersionConflict("This workflow changed in another tab. Reload before saving.")
        return workflow
