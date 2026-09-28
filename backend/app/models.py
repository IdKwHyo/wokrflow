from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TaskStatus(str, Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    blocked = "blocked"
    done = "done"
    skipped = "skipped"


class Priority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class XY(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    x: float
    y: float


class Task(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    phase: str = "Discover"
    owner_role: str = "Customer Success"
    status: TaskStatus = TaskStatus.not_started
    priority: Priority = Priority.medium
    day_offset: int = Field(default=0, ge=0, le=3650, strict=True)
    duration_days: int = Field(default=1, ge=1, le=3650, strict=True)
    customer_visible: bool = Field(default=True, strict=True)
    automation_hint: str = Field(default="", max_length=2000)
    blocked_reason: str = Field(default="", max_length=2000)
    depends_on: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("A task needs a title")
        return value

    def due_date(self, start_date: date) -> date:
        return start_date + timedelta(days=self.day_offset + self.duration_days - 1)


class Role(BaseModel):
    name: str


class Milestone(BaseModel):
    id: str
    title: str
    task_ids: list[str] = Field(default_factory=list)


class ChangeLogEntry(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    change: str
    detail: str
    source: str = "user"


class Workflow(BaseModel):
    id: str
    customer_name: str
    brief: str = ""
    version: int = 1
    start_date: date = Field(default_factory=date.today)
    phases: list[str] = Field(default_factory=lambda: ["Discover", "Configure", "Launch"])
    roles: list[Role] = Field(default_factory=lambda: [
        Role(name="Customer Success"), Role(name="Customer"), Role(name="Solutions Engineer")
    ])
    tasks: list[Task] = Field(default_factory=list)
    milestones: list[Milestone] = Field(default_factory=list)
    change_log: list[ChangeLogEntry] = Field(default_factory=list)
    node_positions: dict[str, XY] = Field(default_factory=dict)
    is_sample_data: bool = False

    def task(self, task_id: str) -> Task | None:
        return next((task for task in self.tasks if task.id == task_id), None)
