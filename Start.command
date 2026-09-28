#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo 'Install Python 3.11+ first: https://www.python.org/downloads/'; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js 20.19+ first: https://nodejs.org/'; exit 1; }
if [ ! -d backend/.venv ]; then python3 -m venv backend/.venv; fi
backend/.venv/bin/python -m pip install -q -r backend/requirements.txt
if [ ! -d node_modules ]; then npm ci --workspaces=false; fi
if [ ! -f backend/.env ]; then cp backend/.env.example backend/.env; fi
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 &
api_pid=$!
cleanup() { kill "$api_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf '\nAfterglow: http://127.0.0.1:5173\nKeep this window open. Press Ctrl+C to stop.\n\n'
npm run dev
