from __future__ import annotations

from datetime import date
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from .models import TaskStatus, Workflow
from .services.ai import AIUnavailable, ai_configured, ai_model, generate_followup, generate_plan
from .services.graph import GraphDocument, GraphPatch, apply_graph, to_graph
from .services.node_schema import task_schema, task_uischema
from .store import VersionConflict

router = APIRouter(prefix="/api")


def _get(request: Request, workflow_id: str) -> Workflow:
    workflow = request.app.state.store.get_workflow(workflow_id)
    if workflow is None:
        raise HTTPException(404, "Workflow not found")
    return workflow


class CreateWorkflow(BaseModel):
    customer_name: str = Field(min_length=1, max_length=120)
    brief: str = Field(default="", max_length=6000)
    start_date: date = Field(default_factory=date.today)

    @field_validator("start_date")
    @classmethod
    def supported_date(cls, value: date) -> date:
        if not 1900 <= value.year <= 2100:
            raise ValueError("Start date must be between 1900 and 2100")
        return value


class PlanRequest(BaseModel):
    brief: str | None = Field(default=None, max_length=6000)


class FollowupRequest(BaseModel):
    instruction: str | None = Field(default=None, max_length=1500)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "ai_configured": ai_configured(), "model": ai_model()}


@router.get("/workflows")
def list_workflows(request: Request) -> dict:
    return {"workflows": [{
        "id": workflow.id, "customer_name": workflow.customer_name,
        "brief": workflow.brief, "version": workflow.version,
        "start_date": str(workflow.start_date), "is_sample_data": workflow.is_sample_data,
        "task_count": len(workflow.tasks),
        "completed_count": sum(task.status == TaskStatus.done for task in workflow.tasks),
        "blocked_count": sum(task.status == TaskStatus.blocked for task in workflow.tasks),
    } for workflow in request.app.state.store.list_workflows()]}


@router.post("/workflows", status_code=201, response_model=GraphDocument)
def create_workflow(request: Request, body: CreateWorkflow) -> GraphDocument:
    if not body.customer_name.strip():
        raise HTTPException(422, "A customer name is required")
    workflow = Workflow(id=str(uuid4()), customer_name=body.customer_name.strip(),
                        brief=body.brief.strip(), start_date=body.start_date)
    request.app.state.store.create_workflow(workflow)
    return to_graph(workflow)


@router.get("/workflows/{wf_id}/graph", response_model=GraphDocument)
def get_graph(request: Request, wf_id: str) -> GraphDocument:
    return to_graph(_get(request, wf_id))


@router.put("/workflows/{wf_id}/graph", response_model=GraphDocument)
def put_graph(request: Request, wf_id: str, patch: GraphPatch) -> GraphDocument:
    try:
        return to_graph(apply_graph(_get(request, wf_id), patch, request.app.state.store))
    except VersionConflict as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/workflows/{wf_id}/node-schema")
def get_node_schema(request: Request, wf_id: str) -> dict:
    workflow = _get(request, wf_id)
    return {"schema": task_schema(workflow), "uischema": task_uischema()}


@router.post("/workflows/{wf_id}/ai-plan")
async def ai_plan(request: Request, wf_id: str, body: PlanRequest) -> dict:
    try:
        return await generate_plan(_get(request, wf_id), body.brief)
    except AIUnavailable as error:
        raise HTTPException(error.status_code, str(error)) from error


@router.post("/workflows/{wf_id}/ai-followup")
async def ai_followup(request: Request, wf_id: str, body: FollowupRequest) -> dict:
    try:
        return await generate_followup(_get(request, wf_id), body.instruction)
    except AIUnavailable as error:
        raise HTTPException(error.status_code, str(error)) from error
