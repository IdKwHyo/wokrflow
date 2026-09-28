from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from pydantic import AliasChoices, BaseModel, Field, ValidationError

from ..models import ChangeLogEntry, Task, TaskStatus, Workflow, XY
from ..store import VersionConflict, WorkflowStore

COLUMN_WIDTH = 350
ROW_HEIGHT = 230


class GraphNode(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    type: str = "onboardingTask"
    position: XY
    data: dict[str, Any]


class GraphEdge(BaseModel):
    id: str = Field(min_length=1, max_length=220)
    source: str
    target: str
    type: str = "smoothstep"
    animated: bool = False
    data: dict[str, Any] = Field(default_factory=dict)


class GraphDocument(BaseModel):
    workflow_id: str
    customer_name: str
    brief: str
    start_date: str
    version: int
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    lanes: list[dict] = Field(default_factory=list)
    phases: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    is_sample_data: bool = False


class GraphPatch(BaseModel):
    version: int = Field(ge=1, validation_alias=AliasChoices("version", "expected_version"))
    nodes: list[GraphNode] | None = Field(default=None, max_length=500)
    edges: list[GraphEdge] | None = Field(default=None, max_length=3000)
    deleted_node_ids: list[str] = Field(default_factory=list, max_length=500)


def validate_workflow(workflow: Workflow) -> dict[str, int]:
    by_id = {task.id: task for task in workflow.tasks}
    if len(by_id) != len(workflow.tasks):
        raise ValueError("Task IDs must be unique")
    if len(workflow.tasks) > 500:
        raise ValueError("A workflow can contain at most 500 tasks")
    owners = {role.name for role in workflow.roles}
    children: dict[str, list[str]] = defaultdict(list)
    indegree: dict[str, int] = {}
    for task in workflow.tasks:
        if task.phase not in workflow.phases:
            raise ValueError(f"Unknown phase: {task.phase}")
        if task.owner_role not in owners:
            raise ValueError(f"Unknown owner role: {task.owner_role}")
        if len(task.depends_on) != len(set(task.depends_on)):
            raise ValueError("Duplicate dependencies are not allowed")
        for dependency in task.depends_on:
            if dependency not in by_id:
                raise ValueError("An edge references a task that does not exist")
            if dependency == task.id:
                raise ValueError("A task cannot depend on itself")
            children[dependency].append(task.id)
        indegree[task.id] = len(task.depends_on)
    queue = deque(task_id for task_id, degree in indegree.items() if degree == 0)
    layers = {task_id: 0 for task_id in queue}
    visited = 0
    while queue:
        task_id = queue.popleft()
        visited += 1
        for child in children[task_id]:
            layers[child] = max(layers.get(child, 0), layers[task_id] + 1)
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    if visited != len(workflow.tasks):
        raise ValueError("This connection creates a dependency cycle")
    return layers


def to_graph(workflow: Workflow) -> GraphDocument:
    layers = validate_workflow(workflow)
    row_by_layer: dict[int, int] = defaultdict(int)
    statuses = {
        TaskStatus.done: "success", TaskStatus.blocked: "error",
        TaskStatus.in_progress: "active", TaskStatus.skipped: "muted",
        TaskStatus.not_started: "idle",
    }
    nodes = []
    for task in workflow.tasks:
        layer = layers[task.id]
        position = workflow.node_positions.get(task.id) or XY(
            x=layer * COLUMN_WIDTH, y=row_by_layer[layer] * ROW_HEIGHT
        )
        row_by_layer[layer] += 1
        data = task.model_dump(mode="json", exclude={"id", "depends_on"})
        data.update(statusClass=statuses[task.status], due_date=str(task.due_date(workflow.start_date)))
        nodes.append(GraphNode(id=task.id, position=position, data=data))
    return GraphDocument(
        workflow_id=workflow.id, customer_name=workflow.customer_name,
        brief=workflow.brief, start_date=str(workflow.start_date), version=workflow.version,
        is_sample_data=workflow.is_sample_data, nodes=nodes,
        edges=[GraphEdge(
            id=f"e_{dependency}_{task.id}", source=dependency, target=task.id,
            animated=task.status == TaskStatus.in_progress,
            data={"blocking": workflow.task(dependency).status not in (TaskStatus.done, TaskStatus.skipped)},
        ) for task in workflow.tasks for dependency in task.depends_on],
        lanes=[{"id": phase, "title": phase, "task_ids": [task.id for task in workflow.tasks if task.phase == phase]} for phase in workflow.phases],
        phases=workflow.phases, roles=[role.name for role in workflow.roles],
    )


def apply_graph(workflow: Workflow, patch: GraphPatch, store: WorkflowStore) -> Workflow:
    if workflow.version != patch.version:
        raise VersionConflict("This workflow changed in another tab. Reload before saving.")
    updated = workflow.model_copy(deep=True)
    deleted = set(patch.deleted_node_ids)
    if not deleted.issubset({task.id for task in workflow.tasks}):
        raise ValueError("Cannot delete a task that does not exist")
    if len(deleted) != len(patch.deleted_node_ids):
        raise ValueError("Deleted task IDs must be unique")
    updated.tasks = [task for task in updated.tasks if task.id not in deleted]
    for task in updated.tasks:
        task.depends_on = [dependency for dependency in task.depends_on if dependency not in deleted]
    for milestone in updated.milestones:
        milestone.task_ids = [task_id for task_id in milestone.task_ids if task_id not in deleted]
    updated.node_positions = {task_id: position for task_id, position in updated.node_positions.items() if task_id not in deleted}
    by_id = {task.id: task for task in updated.tasks}
    seen: set[str] = set()
    editable = set(Task.model_fields) - {"id", "depends_on"}
    for node in patch.nodes or []:
        if node.type != "onboardingTask":
            raise ValueError("Only onboardingTask nodes are supported")
        if node.id in seen or node.id in deleted:
            raise ValueError("A node cannot be duplicated or updated and deleted together")
        seen.add(node.id)
        previous = by_id.get(node.id)
        data = previous.model_dump() if previous else {
            "id": node.id, "phase": updated.phases[0], "owner_role": updated.roles[0].name
        }
        data.update({key: value for key, value in node.data.items() if key in editable})
        try:
            task = Task.model_validate(data)
        except ValidationError as error:
            message = "; ".join(f"{'.'.join(map(str, item['loc']))}: {item['msg']}" for item in error.errors())
            raise ValueError(f"Invalid task {node.id}: {message}") from error
        if previous:
            updated.tasks[updated.tasks.index(previous)] = task
        else:
            updated.tasks.append(task)
        by_id[node.id] = task
        updated.node_positions[node.id] = node.position
    if patch.edges is not None:
        incoming: dict[str, list[str]] = defaultdict(list)
        edge_ids: set[str] = set()
        for edge in patch.edges:
            if edge.id in edge_ids:
                raise ValueError("Edge IDs must be unique")
            edge_ids.add(edge.id)
            if edge.source not in by_id or edge.target not in by_id:
                raise ValueError("An edge references a task that does not exist")
            incoming[edge.target].append(edge.source)
        for task in updated.tasks:
            task.depends_on = incoming[task.id]
    validate_workflow(updated)
    updated.version += 1
    updated.change_log.append(ChangeLogEntry(
        change="Workflow edited on canvas",
        detail=f"{len(patch.nodes or [])} node(s) updated; {len(deleted)} deleted",
    ))
    return store.save_workflow(updated, expected_version=patch.version)
