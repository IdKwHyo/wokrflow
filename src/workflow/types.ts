export type TaskStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'skipped';

export type TaskData = {
  title: string;
  description: string;
  phase: string;
  owner_role: string;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  day_offset: number;
  duration_days: number;
  customer_visible: boolean;
  blocked_reason: string;
  automation_hint: string;
  due_date?: string;
  statusClass?: string;
  [key: string]: unknown;
};

export type GraphNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: TaskData;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
  data?: Record<string, unknown>;
};

export type GraphDocument = {
  workflow_id: string;
  customer_name: string;
  version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  lanes: Array<{ id?: string; name?: string; phase?: string; task_ids?: string[]; [key: string]: unknown }>;
  is_sample_data: boolean;
  brief?: string;
  start_date?: string;
  phases?: string[];
  roles?: string[];
};

export type GraphPatch = {
  version: number;
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  deleted_node_ids?: string[];
};

// Kept open because the server owns the JSON Schema and JSON Forms UI schema.
export type NodeSchemaResponse = { schema: Record<string, any>; uischema: Record<string, any> };
