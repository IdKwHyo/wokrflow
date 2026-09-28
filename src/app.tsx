import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import { CinematicIntro } from './cinematic/CinematicIntro';
const WorkflowEditor = lazy(() => import('./workflow/WorkflowEditor').then(module => ({ default: module.WorkflowEditor })));
import type { GraphDocument, GraphPatch, GraphNode, NodeSchemaResponse } from './workflow/types';
import { api } from './api';
import { Modal } from './Modal';
import './styles.css';

type WorkflowSummary = { id: string; customer_name: string; brief: string; version: number; is_sample_data: boolean };
type Health = { ai_configured: boolean; model: string };
type PlanTask = { id: string; title: string; description: string; phase: string; owner_role: string; priority: 'low' | 'medium' | 'high'; day_offset: number; duration_days: number; customer_visible: boolean; automation_hint: string; depends_on: string[] };
type Plan = { summary: string; missing_questions: string[]; tasks: PlanTask[]; model: string };
type Followup = { subject: string; body: string; model: string };
type Panel = 'brief' | 'progress' | 'plan' | 'followup' | 'create' | null;

const statusLabel = (status: unknown) => String(status || 'not_started').replaceAll('_', ' ');
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function App() {
  const [studio, setStudio] = useState(window.location.hash === '#studio');
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [graph, setGraph] = useState<GraphDocument | null>(null);
  const [schema, setSchema] = useState<NodeSchemaResponse | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [followup, setFollowup] = useState<Followup | null>(null);
  const [copied, setCopied] = useState(false);
  const loadId = useRef(0);

  const loadWorkflow = useCallback(async (id: string) => {
    const requestId = ++loadId.current;
    setLoading(true); setError('');
    try {
      const [next, nextSchema] = await Promise.all([
        api<GraphDocument>(`/workflows/${id}/graph`),
        api<NodeSchemaResponse>(`/workflows/${id}/node-schema`),
      ]);
      if (requestId !== loadId.current) return;
      setGraph(next); setSchema(nextSchema); setDirty(false); setRevision(v => v + 1);
    } catch (e) { if (requestId === loadId.current) setError(errorMessage(e)); }
    finally { if (requestId === loadId.current) setLoading(false); }
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, ai] = await Promise.all([
        api<{ workflows: WorkflowSummary[] }>('/workflows'),
        api<Health>('/health'),
      ]);
      setWorkflows(list.workflows); setHealth(ai);
      if (list.workflows.length) await loadWorkflow(list.workflows[0].id);
      else setLoading(false);
    } catch (e) { setError(errorMessage(e)); setLoading(false); }
  }, [loadWorkflow]);

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const openStudio = () => { setStudio(true); history.replaceState(null, '', '#studio'); window.scrollTo(0, 0); };
  const openPanel = (value: Panel) => { setPanelError(''); setCopied(false); setPlan(null); setFollowup(null); setPanel(value); };
  const closePanel = () => { if (!busy) setPanel(null); };
  const saveGraph = useCallback(async (patch: GraphPatch) => {
    if (!graph) throw new Error('No workflow is open.');
    setSaving(true);
    try {
      const updated = await api<GraphDocument>(`/workflows/${graph.workflow_id}/graph`, { method: 'PUT', body: JSON.stringify(patch) });
      setGraph(updated);
      return updated;
    } finally { setSaving(false); }
  }, [graph?.workflow_id]);

  async function generate(kind: 'ai-plan' | 'ai-followup') {
    if (!graph) return;
    setBusy(true); setPanelError('');
    try {
      if (kind === 'ai-plan') setPlan(await api<Plan>(`/workflows/${graph.workflow_id}/${kind}`, { method: 'POST', body: JSON.stringify({ brief: graph.brief }) }));
      else setFollowup(await api<Followup>(`/workflows/${graph.workflow_id}/${kind}`, { method: 'POST', body: '{}' }));
    } catch (e) { setPanelError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function acceptPlan() {
    if (!graph || !plan) return;
    setBusy(true); setPanelError('');
    try {
      const ids = new Map(plan.tasks.map(task => [task.id, crypto.randomUUID()]));
      const startX = Math.max(-360, ...graph.nodes.map(node => node.position.x)) + 360;
      const nodes: GraphNode[] = plan.tasks.map((task, index) => ({
        id: ids.get(task.id)!, type: 'onboardingTask', position: { x: startX + index * 320, y: 0 },
        data: { ...task, status: 'not_started', blocked_reason: '' },
      }));
      const knownIds = new Set(graph.nodes.map(node => node.id));
      const edges = plan.tasks.flatMap(task => task.depends_on.filter(id => ids.has(id) || knownIds.has(id)).map(dependency => ({
        id: crypto.randomUUID(), source: ids.get(dependency) ?? dependency, target: ids.get(task.id)!, type: 'smoothstep', animated: false, data: {},
      })));
      await saveGraph({ version: graph.version, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges], deleted_node_ids: [] });
      setRevision(v => v + 1); setPanel(null);
    } catch (e) { setPanelError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  async function createWorkflow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setPanelError('');
    try {
      const result = await api<{ id?: string; workflow_id?: string }>('/workflows', {
        method: 'POST', body: JSON.stringify({ customer_name: data.get('customer_name'), brief: data.get('brief'), start_date: data.get('start_date') }),
      });
      const list = await api<{ workflows: WorkflowSummary[] }>('/workflows');
      setWorkflows(list.workflows);
      const id = result.id ?? result.workflow_id;
      if (!id) throw new Error('The new workflow did not return an identifier.');
      await loadWorkflow(id); setPanel(null);
    } catch (e) { setPanelError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  if (!studio) return <CinematicIntro onOpenStudio={openStudio} />;
  const finished = graph?.nodes.filter(node => ['done', 'skipped'].includes(String(node.data.status))).length ?? 0;
  const count = graph?.nodes.length ?? 0;
  const blocked = graph?.nodes.filter(node => node.data.status === 'blocked').length ?? 0;
  const progress = count ? Math.round(finished / count * 100) : 0;
  const locked = dirty || busy || saving || loading;
  const visibleTasks = graph?.nodes.filter(node => node.data.customer_visible) ?? [];

  return <main className="ag-studio">
    <header className="ag-nav">
      <button className="ag-wordmark" disabled={locked} onClick={() => { setStudio(false); history.replaceState(null, '', location.pathname); }}>afterglow<span>STUDIO</span></button>
      <span className="ag-nav-description">THE ONBOARDING STUDIO</span>
      <div className="ag-nav-end"><span className={`ag-connection ${health?.ai_configured ? 'ag-connected' : ''}`}><i />{health?.ai_configured ? 'Groq connected' : 'AI not connected'}</span><a href="https://github.com/synergycodes/workflowbuilder" target="_blank" rel="noreferrer" className="ag-built-with">Built on Synergy ↗</a></div>
    </header>

    <section className="ag-workspace-head">
      <div className="ag-customer">
        <label className="ag-eyebrow" htmlFor="customer-select">CUSTOMER WORKSPACE {graph?.is_sample_data && <span className="ag-sample">/ SAMPLE DATA</span>}</label>
        <div className="ag-customer-line"><select id="customer-select" aria-label="Customer workspace" value={graph?.workflow_id ?? ''} disabled={locked} onChange={e => void loadWorkflow(e.target.value)}>{workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.customer_name}</option>)}</select><button className="ag-new" disabled={locked} onClick={() => openPanel('create')} aria-label="Create customer workspace">+</button></div>
      </div>
      <div className="ag-progress-summary"><div><span>{progress}% complete</span><span>{finished}/{count} tasks · {blocked} blocked</span></div><progress value={progress} max={100} aria-label="Onboarding completion" /></div>
      <div className="ag-workspace-actions">
        <button className="ag-text-button" disabled={!graph || locked} onClick={() => openPanel('brief')}>The brief</button>
        <button className="ag-text-button" disabled={!graph || locked} onClick={() => openPanel('progress')}>Customer view ↗</button>
        <button className="ag-button ag-primary" disabled={!graph || locked} onClick={() => openPanel('plan')}><span aria-hidden="true">✦</span> Shape with AI</button>
      </div>
    </section>

    {dirty && <p className="ag-save-hint" role="status">Save your canvas changes to update the customer view or switch workspaces.</p>}
    {error ? <section className="ag-state"><p className="ag-eyebrow">WORKSPACE UNAVAILABLE</p><h1>Let’s reconnect.</h1><p>{error}</p><p>Make sure the Afterglow backend is running.</p><button className="ag-button ag-primary" onClick={() => void initialize()}>Try again</button></section>
      : loading ? <section className="ag-state" aria-live="polite"><span className="ag-loader" /><p>Opening your workspace…</p></section>
      : graph && schema ? <div className="ag-editor-wrap"><Suspense fallback={<section className="ag-state" aria-live="polite">Opening the canvas…</section>}><WorkflowEditor key={`${graph.workflow_id}-${revision}`} graph={graph} schema={schema} onSave={saveGraph} onDirtyChange={setDirty} /></Suspense></div>
      : <section className="ag-state"><h1>A thoughtful beginning.</h1><p>Create a customer workspace to start shaping their onboarding.</p><button className="ag-button ag-primary" onClick={() => openPanel('create')}>New workspace</button></section>}

    {panel && <Modal title={{ brief: 'Every good start has a story.', progress: 'Your next chapter.', plan: 'From brief to possibility.', followup: 'Keep the conversation moving.', create: 'Make room for a new beginning.' }[panel]} onClose={closePanel}>
      {panelError && <p className="ag-error" role="alert">{panelError}</p>}
      {panel === 'create' && <form className="ag-form" onSubmit={e => void createWorkflow(e)}>
        <label>Customer name<input name="customer_name" required maxLength={120} placeholder="e.g. Juniper Studio" autoComplete="organization" /></label>
        <label>Kickoff date<input name="start_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>The onboarding brief<textarea name="brief" required minLength={10} maxLength={6000} rows={5} placeholder="What does this customer want to achieve? Include their team, timeline, tools, and anything still unknown." /></label>
        <button className="ag-button ag-primary" disabled={busy} type="submit">{busy ? 'Creating…' : 'Create workspace ↗'}</button>
      </form>}
      {panel === 'brief' && graph && <><p className="ag-body-copy">{graph.brief || 'No customer brief has been added.'}</p><dl className="ag-details"><div><dt>Customer</dt><dd>{graph.customer_name}</dd></div><div><dt>Kickoff</dt><dd>{graph.start_date}</dd></div><div><dt>Workflow</dt><dd>Version {graph.version}</dd></div></dl><p className="ag-subtle">{graph.is_sample_data ? 'This is a fictional customer scenario for exploring the studio.' : 'Use this brief to guide your workflow and AI suggestions.'}</p><button className="ag-button ag-primary" onClick={() => openPanel('plan')}>Shape an onboarding plan ↗</button></>}
      {panel === 'progress' && graph && <>
        <p className="ag-body-copy">{graph.customer_name} · A preview of the tasks marked visible to your customer.</p>
        <ol className="ag-customer-timeline">{visibleTasks.map(node => <li key={node.id} className={`ag-task-${node.data.status}`}><span className="ag-timeline-dot" /><div><span className="ag-eyebrow">{String(node.data.phase)} · {statusLabel(node.data.status)}</span><h3>{String(node.data.title)}</h3><p>{String(node.data.description || '')}</p><small>{String(node.data.owner_role)} · Due {String(node.data.due_date || 'to be set')}</small>{node.data.status === 'blocked' && <p className="ag-blocked">{String(node.data.blocked_reason || 'Waiting on the next step.')}</p>}</div></li>)}</ol>
        {!visibleTasks.length && <p className="ag-subtle">No tasks are visible to the customer yet. Select a task and turn on “Customer sees this”.</p>}
        <button className="ag-button ag-primary" onClick={() => openPanel('followup')}>Draft a customer update ↗</button>
      </>}
      {panel === 'plan' && <>
        <p className="ag-body-copy">Turn the customer brief into suggested tasks, owners, and dependencies. Review the plan before adding it to your canvas.</p>
        {!health?.ai_configured && <p className="ag-notice">AI is not connected yet. Add your Groq API key to the backend configuration to generate a plan. You can already build and save workflows manually.</p>}
        {!plan && <button className="ag-button ag-primary" disabled={busy || !health?.ai_configured} onClick={() => void generate('ai-plan')}>{busy ? 'Shaping your plan…' : 'Generate a plan ✦'}</button>}
        {plan && <div className="ag-plan"><p>{plan.summary}</p>{plan.missing_questions.length > 0 && <div className="ag-questions"><h3>Clarify with your customer</h3><ul>{plan.missing_questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
          <ol className="ag-plan-tasks">{plan.tasks.map(task => <li key={task.id}><span className="ag-eyebrow">{task.phase} / {task.owner_role}</span><h3>{task.title}</h3><p>{task.description}</p><small>Day {task.day_offset} · {task.duration_days} day{task.duration_days !== 1 ? 's' : ''} · {task.priority} priority</small></li>)}</ol>
          <p className="ag-subtle">Generated with {plan.model} via Groq. Review ownership and dates. Adds {plan.tasks.length} tasks to the existing workflow.</p>
          <div className="ag-button-row"><button className="ag-button ag-primary" disabled={busy || !plan.tasks.length} onClick={() => void acceptPlan()}>{busy ? 'Adding…' : 'Approve & add tasks'}</button><button className="ag-text-button" disabled={busy} onClick={() => setPlan(null)}>Discard draft</button></div>
        </div>}
      </>}
      {panel === 'followup' && <>
        <p className="ag-body-copy">Draft a clear update from the saved workflow. Review and copy it when you’re ready.</p>
        {!health?.ai_configured && <p className="ag-notice">Connect a Groq API key in the backend configuration to draft an update.</p>}
        {!followup && <button className="ag-button ag-primary" disabled={busy || !health?.ai_configured} onClick={() => void generate('ai-followup')}>{busy ? 'Writing a draft…' : 'Draft update ✦'}</button>}
        {followup && <><div className="ag-form"><label>Subject<input value={followup.subject} onChange={e => setFollowup({ ...followup, subject: e.target.value })} /></label><label>Message<textarea rows={12} value={followup.body} onChange={e => setFollowup({ ...followup, body: e.target.value })} /></label></div><p className="ag-subtle">Draft only. No message has been sent.</p><button className="ag-button ag-primary" onClick={() => { void navigator.clipboard.writeText(`${followup.subject}\n\n${followup.body}`).then(() => setCopied(true)).catch(() => setPanelError('Could not copy. Select the text above and copy it manually.')); }}>{copied ? 'Copied ✓' : 'Copy draft'}</button></>}
      </>}
    </Modal>}
  </main>;
}
