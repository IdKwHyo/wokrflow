# Afterglow API

This Python API adapts customer onboarding tasks to the Synergy / React Flow canvas and serves JSON Forms schemas. It adds the model and SQLite store that the original frontend starter did not contain. `app/services/graph.py`, `app/services/node_schema.py`, and the graph routes in `app/api.py` integrate the supplied adapter design.

## Run

Requires Python 3.11 or later. From this directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

On Windows PowerShell, activate with `.venv\Scripts\Activate.ps1` and copy the environment template with `Copy-Item .env.example .env`.

The frontend proxies `/api` to port 8000. API documentation is at <http://127.0.0.1:8000/docs>.

`backend/.env` is loaded on startup. Add a Groq API key as `GROQ_API_KEY`; the default model is `openai/gpt-oss-20b`. Requests go directly from the Python server to `https://api.groq.com/openai/v1/chat/completions`. The browser never receives the key. A Groq free-tier account can be used within its applicable limits; no paid fallback is enabled. Restart the API after changing configuration.

Without a key, workflow editing and persistence work normally. AI requests return an explicit setup error. The application does not substitute fabricated AI output.

## Persistence and sample data

SQLite stores workflow documents, task dependencies, milestone references, change logs, and canvas positions in `backend/data/workflows.sqlite3`. Set `DATABASE_PATH` for a different file. Keep that file on persistent storage when deploying.

The first launch seeds **Northstar Studio**, a fictional customer, with `is_sample_data: true`. New customer workflows are empty and have `is_sample_data: false`. Saving edits preserves that distinction. Task due dates use the kickoff date plus `day_offset + duration_days - 1` calendar days.

This is a local portfolio prototype with no authentication or tenant isolation. The startup command binds to the local machine. Add access control and per-user AI quotas before exposing write or AI endpoints publicly.

## Frontend contract

| Endpoint | Result |
| --- | --- |
| `GET /api/health` | `{status, ai_configured, model}` |
| `GET /api/workflows` | `{workflows: [{id, customer_name, brief, version, start_date, is_sample_data, task_count, completed_count, blocked_count}]}` |
| `POST /api/workflows` | Accepts `{customer_name, brief?, start_date?}`; returns a new graph document with `workflow_id` |
| `GET /api/workflows/{id}/graph` | React Flow nodes/edges, version, customer metadata, phases, role names, and lanes |
| `PUT /api/workflows/{id}/graph` | Accepts `{version, nodes?, edges?, deleted_node_ids?}`; returns the saved graph |
| `GET /api/workflows/{id}/node-schema` | `{schema, uischema}` for the JSON Forms inspector |
| `POST /api/workflows/{id}/ai-plan` | Accepts `{brief?}`; returns `{summary, missing_questions, tasks, model, requires_review: true}` |
| `POST /api/workflows/{id}/ai-followup` | Accepts `{instruction?}`; returns `{subject, body, model, requires_review: true}` |

The graph document's `roles` is an array of role-name strings. Each node has `{id, type: "onboardingTask", position: {x, y}, data}`. Task fields are stored directly in `data`; SDK-specific label and property wrappers belong in the frontend adapter.

Canvas updates require the last loaded `version` (`expected_version` is also accepted). Stale writes return HTTP 409, including concurrent writes that race in the database. Omitted `edges` preserves dependencies; an explicit empty array removes all dependencies. Node omissions do not imply deletion: use `deleted_node_ids`.

Nodes can update existing tasks or create new tasks. Deletions also remove the task's dependency links, milestone references, and saved position. All changes are validated on a copy before an atomic database write. Invalid field values, unknown roles/phases, self-links, duplicate links, dangling links, and dependency cycles return HTTP 422 without partially saving the request.

AI plans contain new task proposals with allowed phases and roles. Generation never changes a workflow. The frontend must let a person review a plan and explicitly save approved nodes and edges with the graph endpoint. Follow-ups use only customer-visible task context and exclude the internal customer brief; they are drafts, and there is no send endpoint. Task status changes are manual—the graph does not execute external actions.

Briefs are capped at 6,000 characters; model context includes at most 20 task summaries and generation is capped at 3,000 completion tokens. Missing keys return HTTP 503; rate limits return 429; invalid provider output returns 502. An account's free-tier limits can still be exhausted.

## Tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

The suite exercises database persistence across application instances, partial updates, graph validation and rollback, task creation/deletion, stale versions, missing-key behavior, reviewed AI proposals, and isolation of internal tasks from customer follow-up context. Provider calls are mocked for successful AI tests; they do not establish that a live Groq account is configured.
