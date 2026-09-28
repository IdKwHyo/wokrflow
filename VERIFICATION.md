# Verification — 28 September 2026

Base: synergycodes/workflowbuilder, commit `052c396cc90aeebe5b8a1055b7625ec43a88a38e`.
Modified consumer: `examples/workflow-builder-starter`.

## Passed

- `npm run build`: TypeScript checking and Vite production compilation.
- Backend `pytest -q`: 21 tests. Covers restart persistence; positions and blocked reasons; partial updates; node creation; dependency and milestone deletion cleanup; cycles, dangling references and duplicate links; invalid field types; required versions and atomic version conflicts; sample/real workflow distinctions; missing Groq keys; validated, non-persisting AI drafts; exclusion of internal tasks and private briefs from customer follow-up context.
- Chromium browser checks against the actual Vite and FastAPI processes: edit title/status/blocker; drag nodes; save, reload, and confirm coordinates persisted; add a task; draw a connection and confirm its persisted endpoints; delete the task and its connection; create a real empty customer workspace and save its first task.
- Browser failure checks: failed save displays an error and retains edits; retry succeeds; workspace navigation is locked while a save is in flight.
- Browser AI flow with explicitly mocked HTTP responses: proposal does not mutate the workflow; approval remaps task IDs and preserves proposed dependencies; missing-key UI disables generation; Escape during a busy request does not break the dialog; dialogs reopen correctly.
- Responsive checks at 1440×1000 and 390×844: no horizontal document overflow, usable editor, mobile inspector.
- Reduced-motion browser mode selects the natural document layout. Three.js renders a real WebGL canvas in normal mode.
- No uncaught browser errors in the exercised flows. Launcher passes `bash -n`.

## Not claimed

No Groq API key was provided. Live model generation and account-specific limits were not tested. AI-flow tests used fixtures, never represented as live model output.

This has not been deployed, tested with multiple authenticated users, or submitted to any employer. The starter has no authentication. The build reports large-bundle warnings from the SDK and Three.js; the editor is lazy-loaded separately from the introduction. Npm reports legacy peer warnings in the SDK's transitive UI dependencies; the tested flows work with the starter's React 19 version.
