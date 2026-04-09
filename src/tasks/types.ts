export const TASK_TYPES = ["research", "report", "code", "schedule", "mixed", "summary"] as const;

export const TASK_STATUSES = [
  "pending",
  "dispatched",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
] as const;

export const TASK_SOURCES = ["feishu", "tui", "system"] as const;
export const TASK_SYNC_STATES = ["pending", "synced", "sync_error"] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskSource = (typeof TASK_SOURCES)[number];
export type TaskSyncState = (typeof TASK_SYNC_STATES)[number];

export type DispatchMode = "sessions_send" | "subagent" | "manual";

export type TaskRecord = {
  taskId: string;
  parentTaskId: string | null;
  rootTaskId: string;
  source: TaskSource;
  sourceMessageId: string | null;
  sourceSessionKey: string | null;
  sourceUserId: string | null;
  taskType: TaskType;
  instruction: string;
  ownerAgent: string;
  status: TaskStatus;
  priority: string;
  lastError: string | null;
  nextAction: string | null;
  syncState: TaskSyncState;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  dispatchMode: DispatchMode;
  targetSessionKey: string | null;
  targetRunId: string | null;
  resultSummary: string | null;
  resultPayloadJson: string | null;
  resultRef: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TaskTreeNode = TaskRecord & {
  children: TaskTreeNode[];
};

export type TaskTree = {
  task: TaskRecord;
  children: TaskTreeNode[];
};

export type CreateTaskInput = {
  taskId: string;
  parentTaskId?: string | null;
  rootTaskId?: string | null;
  source: TaskSource;
  sourceMessageId?: string | null;
  sourceSessionKey?: string | null;
  sourceUserId?: string | null;
  taskType: TaskType;
  instruction: string;
  ownerAgent: string;
  priority?: string;
  nextAction?: string | null;
  dispatchMode?: DispatchMode;
};

export type CompleteTaskInput = {
  taskId: string;
  status: Extract<TaskStatus, "done" | "failed" | "cancelled" | "waiting" | "running">;
  resultSummary?: string | null;
  resultPayloadJson?: string | null;
  resultRef?: string | null;
};

export type HandoffSpec = {
  nextAction: "handoff_to_watson" | "handoff_to_alpha" | "handoff_to_jarvis";
  taskType: TaskType;
  ownerAgent: string;
  instruction: string;
};
