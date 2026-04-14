import type { TaskAuditCode, TaskAuditFinding } from "../task-registry.audit.js";
import type {
  TaskDeliveryStatus,
  TaskNotifyPolicy,
  TaskRecord,
  TaskRuntime,
  TaskStatus,
} from "../task-registry.types.js";

export type TaskCatalogEntry = {
  taskId: string;
  runId?: string;
  sourceId?: string;
  runtime: TaskRuntime;
  ownerKey: string;
  requesterSessionKey: string;
  scopeKind: TaskRecord["scopeKind"];
  childSessionKey?: string;
  parentFlowId?: string;
  parentTaskId?: string;
  agentId?: string;
  label?: string;
  title: string;
  createdAt: number;
};

export type TaskCatalog = {
  generatedAt: number;
  total: number;
  items: TaskCatalogEntry[];
  byRuntime: Record<TaskRuntime, number>;
  byStatus: Record<TaskStatus, number>;
  byOwnerKey: Record<string, number>;
  byAgentId: Record<string, number>;
};

export type TaskSnapshotEntry = {
  taskId: string;
  runId?: string;
  runtime: TaskRuntime;
  ownerKey: string;
  agentId?: string;
  title: string;
  status: TaskStatus;
  deliveryStatus: TaskDeliveryStatus;
  notifyPolicy: TaskNotifyPolicy;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  lastEventAt?: number;
  referenceAt: number;
  ageMs: number;
  durationMs: number;
  active: boolean;
  terminal: boolean;
  summary?: string;
  error?: string;
  parentFlowId?: string;
  parentTaskId?: string;
  childSessionKey?: string;
};

export type TaskSnapshot = {
  generatedAt: number;
  total: number;
  active: number;
  terminal: number;
  failures: number;
  items: TaskSnapshotEntry[];
};

export type TaskLedgerEntry = {
  taskId: string;
  runId?: string;
  runtime: TaskRuntime;
  ownerKey: string;
  agentId?: string;
  title: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  lastEventAt?: number;
  referenceAt: number;
  durationMs: number;
  dayKey: string;
  terminalSummary?: string;
  progressSummary?: string;
  error?: string;
  parentFlowId?: string;
  parentTaskId?: string;
};

export type TaskLedgerDay = {
  dayKey: string;
  total: number;
  failures: number;
  active: number;
};

export type TaskLedger = {
  generatedAt: number;
  total: number;
  entries: TaskLedgerEntry[];
  byDay: TaskLedgerDay[];
};

export type TaskHealthSeverity = "healthy" | "warn" | "critical";

export type TaskHealthEntry = {
  taskId: string;
  runId?: string;
  ownerKey: string;
  runtime: TaskRuntime;
  status: TaskStatus;
  severity: TaskHealthSeverity;
  ageMs: number;
  reasons: string[];
  auditCodes: TaskAuditCode[];
};

export type TaskHealthModel = {
  generatedAt: number;
  overallSeverity: TaskHealthSeverity;
  summary: {
    total: number;
    healthy: number;
    warn: number;
    critical: number;
    active: number;
    terminal: number;
    failures: number;
    staleQueued: number;
    staleRunning: number;
    deliveryFailed: number;
    lost: number;
  };
  entries: TaskHealthEntry[];
  findings: TaskAuditFinding[];
};

export type TaskErrorClass =
  | "none"
  | "auth"
  | "timeout"
  | "filesystem"
  | "network"
  | "rate_limit"
  | "approval"
  | "config"
  | "delivery"
  | "model"
  | "unknown";

export type TaskErrorClassificationEntry = {
  taskId: string;
  runId?: string;
  ownerKey: string;
  runtime: TaskRuntime;
  status: TaskStatus;
  errorClass: TaskErrorClass;
  summary: string;
  confidence: "high" | "medium" | "low";
};

export type TaskErrorClassification = {
  generatedAt: number;
  total: number;
  problematic: number;
  byClass: Record<TaskErrorClass, number>;
  entries: TaskErrorClassificationEntry[];
};

export type TaskControlPlaneModel = {
  generatedAt: number;
  source: {
    kind: "task_registry";
    totalTasks: number;
  };
  taskCatalog: TaskCatalog;
  taskSnapshot: TaskSnapshot;
  taskLedger: TaskLedger;
  healthModel: TaskHealthModel;
  errorClassification: TaskErrorClassification;
};

export type FeishuTaskControlField = {
  key: string;
  label: string;
  hidden?: boolean;
  fieldType?: number;
  property?: Record<string, unknown>;
};

export type FeishuTaskControlRow = {
  taskId: string;
  fields: Record<string, string | number | null>;
};

export type FeishuTaskControlView = {
  name: "总览" | "异常" | "今日队列" | "Agent 视图";
  description: string;
  rowIds: string[];
  mobileCardFields: string[];
  groupBy?: string;
};

export type FeishuTaskControlProjection = {
  generatedAt: number;
  fields: FeishuTaskControlField[];
  rows: FeishuTaskControlRow[];
  views: FeishuTaskControlView[];
};

export type JarvisTaskHealthSummary = {
  generatedAt: number;
  title: string;
  text: string;
};

export type TaskControlProjectionLayer = {
  feishu: FeishuTaskControlProjection;
  summary: JarvisTaskHealthSummary;
};

export type WorkspaceInventoryEntry = {
  path: string;
  normalizedPath: string;
  exists: boolean;
  isPrimary: boolean;
  primaryMarker: boolean;
  configuredDefault: boolean;
  configuredAgents: string[];
  referencedByCronIds: string[];
};

export type WorkspaceInventory = {
  generatedAt: number;
  primaryWorkspace?: string;
  total: number;
  entries: WorkspaceInventoryEntry[];
};

export type CronInventoryEntry = {
  id: string;
  name: string;
  enabled: boolean;
  agentId?: string;
  sessionKey?: string;
  sessionTarget?: string;
  wakeMode?: string;
  scheduleKind: string;
  payloadKind?: string;
  model?: string;
  fallbacks: string[];
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastStatus?: string;
  consecutiveErrors: number;
  lastError?: string;
  pathReferences: string[];
};

export type CronInventory = {
  generatedAt: number;
  total: number;
  enabled: number;
  disabled: number;
  entries: CronInventoryEntry[];
};

export type PathInventoryCategory =
  | "legacy_home_node"
  | "openclaw_home"
  | "workspace"
  | "report"
  | "script"
  | "other";

export type PathInventoryEntry = {
  rawPath: string;
  normalizedPath: string;
  source: "config" | "cron";
  owner: string;
  field: string;
  category: PathInventoryCategory;
  exists: boolean | null;
};

export type PathInventory = {
  generatedAt: number;
  total: number;
  entries: PathInventoryEntry[];
  byCategory: Record<PathInventoryCategory, number>;
};

export type ProviderInventoryEntry = {
  provider: string;
  configured: boolean;
  referencedByDefault: boolean;
  referencedByAgents: number;
  referencedByCron: number;
};

export type ProviderInventory = {
  generatedAt: number;
  configuredProviders: string[];
  defaultPrimary?: string;
  defaultFallbacks: string[];
  agentModels: Array<{
    agentId: string;
    primary?: string;
    fallbacks: string[];
  }>;
  cronModels: Array<{
    cronId: string;
    name: string;
    model?: string;
    fallbacks: string[];
  }>;
  entries: ProviderInventoryEntry[];
};

export type TaskControlInventory = {
  generatedAt: number;
  workspaceInventory: WorkspaceInventory;
  cronInventory: CronInventory;
  pathInventory: PathInventory;
  providerInventory: ProviderInventory;
};

export type CronPathRepairEntry = {
  cronId: string;
  name: string;
  changed: boolean;
  fields: Array<{
    field: "payload.text" | "payload.message";
    before: string;
    after: string;
  }>;
};

export type CronPathRepairReport = {
  generatedAt: number;
  changedJobs: number;
  totalJobs: number;
  entries: CronPathRepairEntry[];
  applied: boolean;
  storePath: string;
};
