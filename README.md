# Afterglow — the onboarding studio

An adaptation of [Synergy Codes Workflow Builder's React starter](https://github.com/synergycodes/workflowbuilder/tree/main/examples/workflow-builder-starter). A customer brief becomes an editable, persisted onboarding workflow, with optional AI planning through Groq.

## Run on your Mac

Install **Node.js 20.19+** and **Python 3.11+**. From this folder:

```bash
bash Start.command
```

Open **http://127.0.0.1:5173**. Keep the terminal open. The launcher installs dependencies, starts the FastAPI backend on port 8000 and Vite on port 5173. Press Ctrl+C to stop. You can use the fictional Northstar sample, edit tasks and save without an API key.

Windows: use the separate-terminal instructions below rather than the bash launcher.

## Connect Groq

Copy `backend/.env.example` to `backend/.env` (the launcher does this automatically). Set:

```dotenv
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
```

Restart the backend after changing this file. The API key stays on the server; it is never stored in browser localStorage or shipped in a frontend environment variable. The configured model is available on Groq's free plan at the time of this build, subject to your account's rate limits. Do not enable a paid plan unless you intend to use one.

- [Groq keys](https://console.groq.com/keys)
- [Groq model and free-plan limits](https://console.groq.com/docs/rate-limits)

**Shape with AI** proposes new tasks and questions to clarify. **Approve & add tasks** commits that draft. **Customer view → Draft a customer update** produces editable text for copying; the application never sends a message. Missing or rejected keys, rate limits, malformed drafts and network failures have explicit error states. No simulated AI response is substituted.

## What changed from the starter

- Kept `@workflowbuilder/sdk` 2.2.0 and its React Flow canvas, store, connection controls, validation and JSON Forms inspector.
- Added a custom onboarding task renderer, domain-to-SDK mapping, explicit save states, node creation/deletion, reconnection, export, and dependency-cycle checks.
- Applied the supplied Python graph adapter, schema and API approach in `backend/app/services/graph.py`, `backend/app/services/node_schema.py`, and `backend/app/api.py`.
- Added the missing Python model/store foundation as a small FastAPI + SQLite service. The original React starter has no Python models to preserve. SQLite stores workflow documents and canvas positions; no PostgreSQL or Temporal setup is needed for this example.
- Fixed position persistence, blocked-reason persistence, omitted-edge updates, new nodes, dangling references, deletion cleanup, and version conflicts. Validation completes before any database write. Saving after another tab changed the same document returns a conflict instead of overwriting it.
- Added a short cinematic introduction using Lenis, GSAP/ScrollTrigger and Three.js: pointer-reactive shader geometry, particles, forward camera travel, connected brief fragments, masked editorial typography, and restrained glass surfaces.
- Reduced-motion settings disable smooth scrolling and continuous scene animation. Mobile uses natural document flow. The editor has no scroll choreography and retains normal drag/pan/zoom and form scrolling.
- Added fictional sample data, customer workspace creation, a brief view, and a preview showing only tasks marked visible to the customer.

## Separate-terminal setup

Terminal 1:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env  # first setup only; do not overwrite an existing key
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

On Windows, activate with `.venv\Scripts\activate` instead.

Terminal 2, in this starter folder:

```bash
npm ci --workspaces=false
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`. OpenAPI docs are at `http://127.0.0.1:8000/docs`.

## Validation

```bash
npm run build
cd backend
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

The frontend production build is placed in `dist/`. `npm run preview` previews that build with the same local API proxy. Backend tests use temporary databases and mocked Groq responses, not real API credits. See `VERIFICATION.md` for the checks performed on this adaptation.

## Project map

```text
src/app.tsx                 Customer workspace and AI review flow
src/cinematic/              Three.js, Lenis, GSAP intro
src/workflow/               Synergy SDK editor and graph conversion
src/api.ts                  HTTP error handling
backend/app/models.py       Onboarding domain models
backend/app/store.py        SQLite persistence and version checks
backend/app/services/       Graph adapter, JSON Forms schema, Groq client
backend/tests/              Persistence, validation and AI error regressions
Start.command               Mac/Linux local launcher
```

## Scope

This is a **local single-user portfolio prototype**. It has no authentication, workspace authorization or tenant isolation. Keep the default localhost binding. A public deployment needs authentication, server-side access control, request quotas and durable database hosting. Customer view is an in-app preview, not an externally shared portal. The visual workflow describes onboarding dependencies; this example does not execute email, CRM or Temporal automation. Automation ideas are suggestions.

## Attribution

The base starter and SDK are by Synergy Codes, Apache-2.0; the upstream `LICENSE` is included. The original intro geometry, shaders and app styling were written for this adaptation. Design direction was informed by Auteur, Web Design Studio, Modern Design's Immersive Garden analysis, and Premium Web Design principles; no proprietary reference imagery, models or fonts were copied. Cormorant Garamond and DM Sans are bundled through Fontsource under their included open font licenses.
