import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.services import ai
from app.store import VersionConflict, WorkflowStore

GRAPH = "/api/workflows/sample-northstar/graph"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    app = create_app(str(tmp_path / "test.sqlite3"))
    with TestClient(app) as test_client:
        yield test_client


def test_seed_and_schema_are_explicitly_sample_data(client):
    graph = client.get(GRAPH).json()
    assert graph["is_sample_data"] is True
    assert len(graph["nodes"]) == 7
    assert len(graph["edges"]) == 7
    schema = client.get("/api/workflows/sample-northstar/node-schema").json()
    assert schema["schema"]["properties"]["owner_role"]["enum"] == graph["roles"]
    assert schema["uischema"]["elements"][-2]["rule"]["effect"] == "SHOW"
    assert client.get("/api/health").json()["ai_configured"] is False


def test_positions_blocker_and_omitted_edges_survive_restart(client):
    graph = client.get(GRAPH).json()
    node = next(node for node in graph["nodes"] if node["id"] == "workspace-access")
    node["position"] = {"x": 187.5, "y": -44}
    node["data"]["blocked_reason"] = "Waiting for admin approval"
    response = client.put(GRAPH, json={"version": graph["version"], "nodes": [node]})
    assert response.status_code == 200
    assert response.json()["edges"] == graph["edges"]
    with TestClient(create_app(client.app.state.store.database)) as restarted:
        persisted = restarted.get(GRAPH).json()
    updated = next(node for node in persisted["nodes"] if node["id"] == "workspace-access")
    assert updated["position"] == {"x": 187.5, "y": -44.0}
    assert updated["data"]["blocked_reason"] == "Waiting for admin approval"
    assert persisted["version"] == graph["version"] + 1


def test_new_node_and_explicit_empty_edges(client):
    response = client.put(GRAPH, json={
        "version": 1, "nodes": [{"id": "new-task", "position": {"x": 12, "y": 22},
                                  "data": {"title": "Confirm renewal owner"}}], "edges": [],
    })
    assert response.status_code == 200
    assert len(response.json()["nodes"]) == 8
    assert response.json()["edges"] == []
    assert response.json()["nodes"][-1]["data"]["phase"] == "Discover"


def test_deletion_prunes_dependencies_milestones_and_positions(client):
    response = client.put(GRAPH, json={"version": 1, "deleted_node_ids": ["map-process", "first-value"]})
    assert response.status_code == 200
    graph = response.json()
    assert not any(edge["source"] == "map-process" or edge["target"] == "first-value" for edge in graph["edges"])
    stored = client.app.state.store.get_workflow("sample-northstar")
    assert stored.milestones[0].task_ids == []
    assert "first-value" not in stored.node_positions


@pytest.mark.parametrize("edges", [
    [{"id": "self", "source": "kickoff", "target": "kickoff"}],
    [{"id": "missing", "source": "missing", "target": "kickoff"}],
    [{"id": "a", "source": "kickoff", "target": "map-process"}, {"id": "b", "source": "map-process", "target": "kickoff"}],
    [{"id": "a", "source": "kickoff", "target": "map-process"}, {"id": "b", "source": "kickoff", "target": "map-process"}],
])
def test_invalid_graph_is_rejected_atomically(client, edges):
    before = client.get(GRAPH).json()
    node = before["nodes"][0].copy()
    node["data"] = {"title": "This must not save"}
    response = client.put(GRAPH, json={"version": 1, "nodes": [node], "edges": edges})
    assert response.status_code == 422
    assert client.get(GRAPH).json() == before


@pytest.mark.parametrize("data", [
    {"title": " "}, {"day_offset": -1}, {"duration_days": 0},
    {"customer_visible": "false"}, {"owner_role": "Invented owner"}, {"phase": "Unknown"},
])
def test_invalid_task_edit_does_not_write(client, data):
    response = client.put(GRAPH, json={"version": 1, "nodes": [{
        "id": "kickoff", "position": {"x": 0, "y": 0}, "data": data,
    }]})
    assert response.status_code == 422
    assert client.get(GRAPH).json()["version"] == 1


def test_stale_version_returns_conflict_and_database_compare_is_atomic(client):
    assert client.put(GRAPH, json={"version": 1}).status_code == 200
    assert client.put(GRAPH, json={"version": 1, "edges": []}).status_code == 409
    assert client.put(GRAPH, json={"edges": []}).status_code == 422
    store = WorkflowStore(client.app.state.store.database)
    old = store.get_workflow("sample-northstar")
    first = old.model_copy(deep=True)
    first.version += 1
    store.save_workflow(first, expected_version=old.version)
    with pytest.raises(VersionConflict):
        store.save_workflow(first, expected_version=old.version)


def test_create_real_workflow_has_no_sample_tasks(client):
    response = client.post("/api/workflows", json={"customer_name": "Acme", "brief": "Pilot launch", "start_date": "2026-10-01"})
    assert response.status_code == 201
    graph = response.json()
    assert graph["is_sample_data"] is False
    assert graph["nodes"] == []
    assert graph["start_date"] == "2026-10-01"
    assert len(client.get("/api/workflows").json()["workflows"]) == 2
    assert client.get("/api/workflows/missing/graph").status_code == 404


@pytest.mark.parametrize("endpoint", ["ai-plan", "ai-followup"])
def test_missing_ai_key_explains_setup_without_fake_generation(client, endpoint):
    before = client.get(GRAPH).json()
    response = client.post(f"/api/workflows/sample-northstar/{endpoint}", json={})
    assert response.status_code == 503
    assert "GROQ_API_KEY" in response.json()["detail"]
    assert client.get(GRAPH).json() == before


def test_ai_plan_is_review_only_and_rejects_invalid_proposals(client, monkeypatch):
    async def valid_completion(*args):
        return {"summary": "Confirm the long-term owner", "missing_questions": ["Who owns renewal?"],
                "tasks": [{"id": "renewal", "title": "Confirm the renewal owner", "phase": "Launch", "owner_role": "Customer Success", "depends_on": ["launch"]}]}
    monkeypatch.setattr(ai, "_json_completion", valid_completion)
    before = client.get(GRAPH).json()
    response = client.post("/api/workflows/sample-northstar/ai-plan", json={"brief": "Plan follow-through"})
    assert response.status_code == 200
    assert response.json()["requires_review"] is True
    assert response.json()["tasks"][0]["status"] == "not_started"
    assert client.get(GRAPH).json() == before

    async def invalid_completion(*args):
        return {"summary": "Invalid", "tasks": [{"id": "bad", "title": "Invalid owner", "owner_role": "CEO"}]}
    monkeypatch.setattr(ai, "_json_completion", invalid_completion)
    assert client.post("/api/workflows/sample-northstar/ai-plan", json={}).status_code == 502
    assert client.get(GRAPH).json() == before


def test_followup_is_a_draft_and_does_not_mutate_workflow(client, monkeypatch):
    async def completion(*args):
        return {"subject": "Workspace access", "body": "Could you confirm the pilot teammate list?"}
    monkeypatch.setattr(ai, "_json_completion", completion)
    before = client.get(GRAPH).json()
    response = client.post("/api/workflows/sample-northstar/ai-followup", json={})
    assert response.status_code == 200
    assert response.json()["requires_review"] is True
    assert client.get(GRAPH).json() == before


def test_customer_followup_excludes_internal_tasks_and_private_brief(client, monkeypatch):
    workflow = client.app.state.store.get_workflow("sample-northstar")
    workflow.brief = "Internal margin review: PRIVATE-BRIEF"
    workflow.task("workspace-access").customer_visible = False
    workflow.task("workspace-access").blocked_reason = "PRIVATE-BLOCKER"
    workflow.version += 1
    client.app.state.store.save_workflow(workflow, expected_version=1)
    captured = {}

    async def completion(system, content):
        captured.update(content)
        return {"subject": "Pilot progress", "body": "The handoff mapping is complete."}

    monkeypatch.setattr(ai, "_json_completion", completion)
    response = client.post("/api/workflows/sample-northstar/ai-followup", json={})
    assert response.status_code == 200
    payload = json.dumps(captured)
    assert "PRIVATE-BRIEF" not in payload
    assert "PRIVATE-BLOCKER" not in payload
    assert "workspace-access" not in payload
    assert "kickoff" in payload
