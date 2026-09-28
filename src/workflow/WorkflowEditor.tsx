import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  WorkflowBuilder,
  getHandleId,
  getStoreDataForIntegration,
  setStoreEdges,
  setStoreNodes,
  trackFutureChange,
  useSingleSelectedElement,
  useStore,
  useWorkflowBuilderActions,
  type IntegrationDataFormat,
  type NodeSchema,
  type OnSaveExternal,
  type PaletteItem,
  type UISchema,
  type WorkflowBuilderEdge,
  type WorkflowBuilderNode,
  type WorkflowBuilderReactFlowProps,
  type WorkflowNodeTemplateProps,
} from '@workflowbuilder/sdk';
import { Handle, Position, reconnectEdge, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { rankWith, uiTypeIs, type ControlProps } from '@jsonforms/core';
import { withJsonFormsControlProps } from '@jsonforms/react';
import '@workflowbuilder/sdk/style.css';
import './workflow.css';
import type { GraphDocument, GraphEdge, GraphNode, GraphPatch, NodeSchemaResponse, TaskData } from './types';

export type { GraphDocument, GraphEdge, GraphNode, GraphPatch, NodeSchemaResponse } from './types';

export type WorkflowEditorProps = {
  graph: GraphDocument;
  schema: NodeSchemaResponse;
  onSave: (patch: GraphPatch) => Promise<GraphDocument>;
  onGraphChange?: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const statusLabels: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', blocked: 'Blocked', done: 'Complete', skipped: 'Skipped',
};

function toSdkNodes(nodes: GraphNode[]): WorkflowBuilderNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'onboardingTask',
    position: { ...node.position },
    data: { type: 'onboardingTask', icon: 'CheckCircle', properties: { ...node.data, label: node.data.title } },
  }));
}

function toSdkEdges(edges: GraphEdge[]): WorkflowBuilderEdge[] {
  return edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    sourceHandle: getHandleId({ handleType: 'source' }),
    targetHandle: getHandleId({ handleType: 'target' }),
    data: {},
  }));
}

export function fromSdkGraph(nodes: WorkflowBuilderNode[], edges: WorkflowBuilderEdge[]) {
  return {
    nodes: nodes.map((node): GraphNode => {
      const { label, errors: _errors, customErrors: _customErrors, ...properties } = node.data.properties;
      return {
        id: node.id,
        type: 'onboardingTask',
        position: { x: node.position.x, y: node.position.y },
        data: { ...properties, title: String(properties.title ?? label ?? '') } as TaskData,
      };
    }),
    edges: edges.map((edge): GraphEdge => ({
      id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep', animated: !!edge.animated, data: {},
    })),
  };
}

function snapshot(nodes: WorkflowBuilderNode[], edges: WorkflowBuilderEdge[]) {
  const graph = fromSdkGraph(nodes, edges);
  // Read-only derived fields are not edits. They can change after a server save.
  return JSON.stringify({
    nodes: graph.nodes.map((node) => {
      const { due_date: _due, statusClass: _statusClass, ...data } = node.data;
      return { ...node, data };
    }),
    edges: graph.edges.map(({ id, source, target }) => ({ id, source, target })),
  });
}

function TaskNode({ data, selected, isValid, showHandles = true }: WorkflowNodeTemplateProps) {
  const task = data?.properties ?? {};
  const status = String(task.status ?? 'not_started');
  const due = task.due_date ? new Date(`${String(task.due_date).slice(0, 10)}T12:00:00`) : null;
  const dueLabel = due && !Number.isNaN(due.getTime())
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(due)
    : `Day ${Number(task.day_offset ?? 0) + Number(task.duration_days ?? 1)}`;

  return (
    <article className={`journey-node ${selected ? 'is-selected' : ''} status-${status}`}>
      {showHandles && <Handle id={getHandleId({ handleType: 'target' })} type="target" position={Position.Left} />}
      <div className="journey-node-top"><span>{String(task.phase ?? 'Onboarding')}</span><span className="journey-node-dot" /></div>
      <h3>{String(task.title ?? task.label ?? 'New task')}</h3>
      <p>{String(task.owner_role ?? 'Unassigned')}</p>
      <div className="journey-node-foot"><span>{statusLabels[status] ?? status}</span><time>{dueLabel}</time></div>
      {isValid === false && <span className="journey-node-invalid">Check required fields</span>}
      {showHandles && <Handle id={getHandleId({ handleType: 'source' })} type="source" position={Position.Right} />}
    </article>
  );
}

const nodeTemplates = { onboardingTask: TaskNode };

// The Python adapter serves standard JSON Forms "Control" elements. The SDK's
// built-ins use named widgets instead, so this renderer keeps the server schema
// intact while supplying standard controls (including enum and integer fields).
function SchemaControl({ data, handleChange, path, schema, uischema, label, required, errors, enabled, visible }: ControlProps) {
  const generatedId = useId();
  const fieldId = `task-field-${generatedId}`;
  if (!visible) return null;
  const disabled = !enabled || !!(schema as { readOnly?: boolean }).readOnly;
  const fieldLabel = label || schema.title || path.replaceAll('_', ' ');
  const common = {
    id: fieldId, disabled, required, 'aria-invalid': !!errors,
    'aria-describedby': errors ? `${fieldId}-error` : undefined,
  };
  const labelText = <span>{fieldLabel}{required && <span aria-hidden="true" className="journey-required"> *</span>}</span>;
  let control;
  if (schema.type === 'boolean') {
    control = <label className="journey-checkbox" htmlFor={fieldId}><input {...common} type="checkbox" checked={!!data} onChange={(event) => handleChange(path, event.target.checked)} />{labelText}</label>;
  } else if (schema.enum) {
    control = <><label htmlFor={fieldId}>{labelText}</label><select {...common} value={String(data ?? '')} onChange={(event) => handleChange(path, event.target.value)}>{schema.enum.map((value) => <option key={String(value)} value={String(value)}>{statusLabels[String(value)] ?? String(value).replaceAll('_', ' ')}</option>)}</select></>;
  } else if (uischema.options?.multi) {
    control = <><label htmlFor={fieldId}>{labelText}</label><textarea {...common} rows={3} value={String(data ?? '')} onChange={(event) => handleChange(path, event.target.value)} /></>;
  } else if (schema.type === 'integer' || schema.type === 'number') {
    control = <><label htmlFor={fieldId}>{labelText}</label><input {...common} type="number" min={schema.minimum} max={schema.maximum} step={schema.type === 'integer' ? 1 : 'any'} value={data ?? ''} onChange={(event) => handleChange(path, event.target.value === '' ? undefined : Number(event.target.value))} /></>;
  } else {
    control = <><label htmlFor={fieldId}>{labelText}</label><input {...common} type="text" value={String(data ?? '')} onChange={(event) => handleChange(path, event.target.value)} /></>;
  }
  return <div className="journey-field">{control}{errors && <span className="journey-field-error" id={`${fieldId}-error`}>{errors}</span>}</div>;
}

const jsonForm = { renderers: [{ tester: rankWith(10, uiTypeIs('Control')), renderer: withJsonFormsControlProps(SchemaControl) }] };

function createsCycle(source: string, target: string, edges: WorkflowBuilderEdge[]) {
  if (source === target) return true;
  const visited = new Set<string>();
  const pending = [target];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    edges.forEach((edge) => { if (edge.source === current) pending.push(edge.target); });
  }
  return false;
}

const isValidConnection = ({ connection }: { connection: { source: string; target: string } }) => {
  const edges = useStore.getState().edges;
  return !edges.some((edge) => edge.source === connection.source && edge.target === connection.target)
    && !createsCycle(connection.source, connection.target, edges);
};

const reactFlowProps: WorkflowBuilderReactFlowProps = {
  fitView: false,
  defaultViewport: { x: 40, y: 130, zoom: 0.85 },
  minZoom: 0.2,
  maxZoom: 1.6,
  fitViewOptions: { padding: 0.15, maxZoom: 0.95 },
  panOnDrag: true,
  panOnScroll: true,
  zoomOnScroll: false,
  zoomOnPinch: true,
  preventScrolling: true,
  snapToGrid: false,
  defaultEdgeOptions: { type: 'smoothstep' },
  onReconnect: (oldEdge, connection) => {
    const edges = useStore.getState().edges;
    const others = edges.filter((edge) => edge.id !== oldEdge.id);
    if (createsCycle(connection.source, connection.target, others)) return;
    if (others.some((edge) => edge.source === connection.source && edge.target === connection.target)) return;
    trackFutureChange('reconnect');
    setStoreEdges(reconnectEdge(oldEdge, connection, edges));
  },
};

export function WorkflowEditor({ graph, schema, onSave, onGraphChange, onDirtyChange }: WorkflowEditorProps) {
  // A parent changes the React key to load a different document. A saved version
  // alone must never reload the store and discard an edit made during a request.
  const initial = useRef({ nodes: toSdkNodes(graph.nodes), edges: toSdkEdges(graph.edges), name: graph.customer_name });
  const committed = useRef({ version: graph.version, nodeIds: graph.nodes.map((node) => node.id) });
  const savedFingerprint = useRef(snapshot(initial.current.nodes, initial.current.edges));
  const handlers = useRef({ onSave, onGraphChange, onDirtyChange });
  handlers.current = { onSave, onGraphChange, onDirtyChange };
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [error, setError] = useState('');
  const [version, setVersion] = useState(graph.version);
  const inFlight = useRef<Promise<'success'> | null>(null);

  const defaults = useMemo((): TaskData => ({
    title: 'New onboarding task', description: '',
    phase: String(schema.schema.properties?.phase?.enum?.[0] ?? graph.phases?.[0] ?? 'General'),
    owner_role: String(schema.schema.properties?.owner_role?.enum?.[0] ?? graph.roles?.[0] ?? 'Unassigned'),
    status: 'not_started', priority: 'medium', day_offset: 0, duration_days: 1,
    customer_visible: true, blocked_reason: '', automation_hint: '',
  }), [schema, graph.phases, graph.roles]);

  const nodeTypes = useMemo((): PaletteItem[] => [{
    type: 'onboardingTask', icon: 'CheckCircle', label: 'Onboarding task', description: 'One clear next step',
    defaultPropertiesData: { ...defaults, label: defaults.title },
    schema: {
      ...schema.schema,
      properties: { ...schema.schema.properties, label: { type: 'string' }, description: { type: 'string', ...schema.schema.properties?.description } },
    } as NodeSchema,
    uischema: schema.uischema as UISchema,
  }], [schema, defaults]);

  const save = useCallback<OnSaveExternal>(async (data: IntegrationDataFormat) => {
    if (inFlight.current) return inFlight.current;
    const submitted = fromSdkGraph(data.nodes, data.edges);
    const submittedFingerprint = snapshot(data.nodes, data.edges);
    const currentIds = new Set(submitted.nodes.map((node) => node.id));
    const patch: GraphPatch = {
      version: committed.current.version,
      ...submitted,
      deleted_node_ids: committed.current.nodeIds.filter((id) => !currentIds.has(id)),
    };
    setSaveState('saving');
    setError('');
    const request = (async (): Promise<'success'> => {
      try {
        const result = await handlers.current.onSave(patch);
        committed.current = { version: result.version, nodeIds: result.nodes.map((node) => node.id) };
        setVersion(result.version);
        const live = useStore.getState();
        if (snapshot(live.nodes, live.edges) === submittedFingerprint) {
          const selected = new Set(live.selectedNodesIds);
          const nodes = toSdkNodes(result.nodes).map((node) => ({ ...node, selected: selected.has(node.id) }));
          const edges = toSdkEdges(result.edges);
          savedFingerprint.current = snapshot(nodes, edges);
          setStoreNodes(nodes);
          setStoreEdges(edges);
          setSaveState('saved');
          handlers.current.onDirtyChange?.(false);
        } else {
          savedFingerprint.current = submittedFingerprint;
          setSaveState('dirty');
          handlers.current.onDirtyChange?.(true);
        }
        return 'success';
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Your changes could not be saved. Please try again.');
        setSaveState('error');
        // Throw: SDK 2.2.0 treats every resolved status string as success.
        throw cause;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, []);

  const integration = useMemo(() => ({ strategy: 'props' as const, onDataSave: save }), [save]);
  const onChange = useCallback((nodes: WorkflowBuilderNode[], edges: WorkflowBuilderEdge[]) => {
    const dirty = snapshot(nodes, edges) !== savedFingerprint.current;
    setSaveState((current) => current === 'saving' || current === 'error' ? current : dirty ? 'dirty' : 'saved');
    const converted = fromSdkGraph(nodes, edges);
    handlers.current.onGraphChange?.(converted.nodes, converted.edges);
    handlers.current.onDirtyChange?.(dirty);
  }, []);

  return (
    <section className="journey-editor" aria-label="Customer onboarding workflow editor" data-lenis-prevent>
      <WorkflowBuilder.Root
        name={initial.current.name}
        initialNodes={initial.current.nodes}
        initialEdges={initial.current.edges}
        nodeTypes={nodeTypes}
        nodeTemplates={nodeTemplates}
        jsonForm={jsonForm}
        integration={integration}
        isValidConnection={isValidConnection}
        reactFlowProps={reactFlowProps}
      >
        <EditorSurface defaults={defaults} saveState={saveState} error={error} version={version} onChange={onChange} />
      </WorkflowBuilder.Root>
    </section>
  );
}

type EditorSurfaceProps = {
  defaults: TaskData;
  saveState: 'saved' | 'dirty' | 'saving' | 'error';
  error: string;
  version: number;
  onChange: (nodes: WorkflowBuilderNode[], edges: WorkflowBuilderEdge[]) => void;
};

function EditorSurface({ defaults, saveState, error, version, onChange }: EditorSurfaceProps) {
  const actions = useWorkflowBuilderActions();
  const flow = useReactFlow<WorkflowBuilderNode, WorkflowBuilderEdge>();
  const nodesInitialized = useNodesInitialized();
  const framed = useRef(false);
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const selection = useSingleSelectedElement();
  const selectedNodes = useStore((state) => state.selectedNodesIds);
  const selectedEdges = useStore((state) => state.selectedEdgesIds);
  const [ready, setReady] = useState(false);
  const [mobileInspector, setMobileInspector] = useState(true);

  useEffect(() => {
    actions.setTheme('dark');
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [actions]);

  useEffect(() => {
    // SDK 2.2 initializes node definitions when its Palette mounts. Our layout
    // uses an Add task button, so initialize that same registry explicitly.
    useStore.getState().fetchData();
  }, [defaults]);

  useEffect(() => {
    if (!nodesInitialized || framed.current || !nodes.length) return;
    framed.current = true;
    const isSmallScreen = window.matchMedia('(max-width: 740px)').matches;
    void flow.fitView({ nodes: nodes.slice(0, isSmallScreen ? 1 : 3), padding: 0.12, minZoom: 0.78, maxZoom: 0.85, duration: 0 });
  }, [nodesInitialized, nodes, flow]);

  useEffect(() => {
    if (!ready) return;
    // The server and the form use title; the SDK uses label for selection names.
    const needsSync = nodes.some((node) => node.data.properties.label !== node.data.properties.title);
    if (needsSync) {
      setStoreNodes(nodes.map((node) => ({
        ...node, data: { ...node.data, properties: { ...node.data.properties, label: String(node.data.properties.title ?? '') } },
      })));
      return;
    }
    onChange(nodes, edges);
  }, [nodes, edges, ready, onChange]);

  useEffect(() => {
    if (selection) setMobileInspector(true);
  }, [selection?.node?.id, selection?.edge?.id]);

  const done = nodes.filter((node) => ['done', 'skipped'].includes(String(node.data.properties.status))).length;

  function addTask() {
    const container = document.querySelector('.journey-canvas')?.getBoundingClientRect();
    const position = container ? flow.screenToFlowPosition({ x: container.left + container.width / 2 - 120, y: container.top + container.height / 2 - 65 }) : { x: 0, y: 0 };
    const id = `task_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    trackFutureChange('addNode');
    setStoreNodes([
      ...useStore.getState().nodes.map((node) => ({ ...node, selected: false })),
      { id, type: 'onboardingTask', position, selected: true, data: { type: 'onboardingTask', icon: 'CheckCircle', properties: { ...defaults, label: defaults.title } } },
    ]);
    setStoreEdges(useStore.getState().edges.map((edge) => ({ ...edge, selected: false })));
    useStore.setState({ selectedNodesIds: [id], selectedEdgesIds: [] });
    setMobileInspector(true);
  }

  function deleteSelection() {
    void flow.deleteElements({ nodes: selectedNodes.map((id) => ({ id })), edges: selectedEdges.map((id) => ({ id })) });
  }

  function exportGraph() {
    const data = getStoreDataForIntegration();
    const content = fromSdkGraph(data.nodes, data.edges);
    const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'onboarding-workflow.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="journey-surface">
      <header className="journey-toolbar">
        <div className="journey-toolbar-title"><span className="journey-eyebrow">The working canvas</span><span>{done}<span className="journey-muted"> / {nodes.length} steps complete</span></span></div>
        <div className="journey-toolbar-actions">
          <button type="button" className="journey-tool" onClick={addTask} disabled={saveState === 'saving'}><span aria-hidden="true">+</span> Add task</button>
          <button type="button" className="journey-tool journey-fit" onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1, duration: 350 })}>Fit view</button>
          <button type="button" className="journey-save" onClick={() => void actions.save()} disabled={saveState === 'saving'}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Save workflow' : 'Save changes'}<span aria-hidden="true">↗</span></button>
        </div>
      </header>
      <div className="journey-workspace">
        <div className="journey-canvas" aria-label="Task dependency canvas">
          <WorkflowBuilder.Canvas />
          {!nodes.length && <div className="journey-empty-canvas"><span className="journey-eyebrow">A fresh beginning</span><p>Every journey starts<br />with a first step.</p><button className="journey-tool" type="button" onClick={addTask}>+ Add the first task</button></div>}
          <div className="journey-canvas-controls" aria-label="Canvas controls">
            <button type="button" aria-label="Zoom in" onClick={() => void flow.zoomIn({ duration: 180 })}>+</button>
            <button type="button" aria-label="Zoom out" onClick={() => void flow.zoomOut({ duration: 180 })}>−</button>
            <button type="button" aria-label="Fit all tasks in view" onClick={() => void flow.fitView({ padding: 0.15, maxZoom: 1, duration: 350 })}>⤢</button>
          </div>
          <span className="journey-canvas-hint">Drag to arrange · Connect the dots</span>
        </div>
        <aside className={`journey-inspector ${mobileInspector ? 'is-open' : ''}`} aria-label="Task properties">
          <div className="journey-inspector-top"><span className="journey-eyebrow">The details</span><button type="button" className="journey-inspector-toggle" onClick={() => setMobileInspector((value) => !value)} aria-expanded={mobileInspector}>{mobileInspector ? 'Hide' : 'Show'}</button></div>
          <div className="journey-inspector-content">
            {selection?.node ? <WorkflowBuilder.PropertiesPanel /> : selection?.edge ? <div className="journey-inspector-empty"><span className="journey-inspector-mark" aria-hidden="true">→</span><h3>A clear<br /><em>dependency.</em></h3><p>{String(nodes.find((node) => node.id === selection.edge?.source)?.data.properties.title ?? 'Previous task')} comes before {String(nodes.find((node) => node.id === selection.edge?.target)?.data.properties.title ?? 'the next task')}.</p><button type="button" className="journey-tool" onClick={deleteSelection}>Remove connection</button></div> : <div className="journey-inspector-empty"><span className="journey-inspector-mark" aria-hidden="true">↗</span><h3>Make every<br /><em>step count.</em></h3><p>Select a task to shape its owner, timing, and next action.</p><span className="journey-eyebrow">Changes stay local until you save</span></div>}
          </div>
        </aside>
      </div>
      <footer className="journey-statusbar">
        <div className={`journey-save-status is-${saveState}`} role="status"><span className="journey-status-dot" />{saveState === 'saving' ? 'Saving to the workspace…' : saveState === 'error' ? 'Save failed · your edits are still here' : saveState === 'dirty' ? 'Unsaved changes' : `All changes saved · version ${version}`}</div>
        <div><button type="button" onClick={exportGraph}>Export JSON</button>{selectedNodes.length + selectedEdges.length > 0 && <button type="button" onClick={deleteSelection} disabled={saveState === 'saving'}>Delete selection</button>}</div>
      </footer>
      {error && <p className="journey-save-error" role="alert">{error}</p>}
    </div>
  );
}
