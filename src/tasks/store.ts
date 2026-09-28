import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveStateDir } from "../config/paths.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import type {
  CompleteTaskInput,
  CreateTaskInput,
  TaskRecord,
  TaskTree,
  TaskTreeNode,
} from "./types.js";

type TaskRow = {
  task_id: string;
  parent_task_id: string | null;
  root_task_id: string;
  source: string;
  source_message_id: string | null;
  source_session_key: string | null;
  source_user_id: string | null;
  task_type: string;
  instruction: string;
  owner_agent: string;
  status: string;
  priority: string;
  last_error: string | null;
  next_action: string | null;
  sync_state: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
  dispatch_mode: string;
  target_session_key: string | null;
  target_run_id: string | null;
  result_summary: string | null;
  result_payload_json: string | null;
  result_ref: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type TaskTableInfoRow = {
  name: string;
};

function resolveTasksDbPath(): string {
  return path.join(resolveStateDir(process.env), "orchestrator", "tasks.sqlite");
}

function ensureTasksSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      root_task_id TEXT NOT NULL,
      source TEXT NOT NULL,
      source_message_id TEXT,
      source_session_key TEXT,
      source_user_id TEXT,
      task_type TEXT NOT NULL,
      instruction TEXT NOT NULL,
      owner_agent TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'P1',
      last_error TEXT,
      next_action TEXT,
      sync_state TEXT NOT NULL DEFAULT 'pending',
      last_synced_at TEXT,
      last_sync_error TEXT,
      dispatch_mode TEXT NOT NULL,
      target_session_key TEXT,
      target_run_id TEXT,
      result_summary TEXT,
      result_payload_json TEXT,
      result_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_root_task_id ON tasks(root_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_owner_agent ON tasks(owner_agent);

    CREATE TABLE IF NOT EXISTS task_events (
      event_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);

    CREATE TABLE IF NOT EXISTS task_handoffs (
      handoff_id TEXT PRIMARY KEY,
      from_task_id TEXT NOT NULL,
      to_task_id TEXT NOT NULL,
      handoff_kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_handoffs_from_task_id ON task_handoffs(from_task_id);
  `);
  const taskColumns = db.prepare(`PRAGMA table_info(tasks)`).all() as TaskTableInfoRow[];
  const hasTaskColumn = (name: string) => taskColumns.some((column) => column.name === name);
  if (!hasTaskColumn("priority")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'P1'`);
  }
  if (!hasTaskColumn("last_error")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN last_error TEXT`);
  }
  if (!hasTaskColumn("next_action")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN next_action TEXT`);
  }
  if (!hasTaskColumn("sync_state")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'pending'`);
  }
  if (!hasTaskColumn("last_synced_at")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN last_synced_at TEXT`);
  }
  if (!hasTaskColumn("last_sync_error")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN last_sync_error TEXT`);
  }
}

function mapTaskRow(row: TaskRow | undefined): TaskRecord | null {
  if (!row) {
    return null;
  }
  return {
    taskId: row.task_id,
    parentTaskId: row.parent_task_id,
    rootTaskId: row.root_task_id,
    source: row.source as TaskRecord["source"],
    sourceMessageId: row.source_message_id,
    sourceSessionKey: row.source_session_key,
    sourceUserId: row.source_user_id,
    taskType: row.task_type as TaskRecord["taskType"],
    instruction: row.instruction,
    ownerAgent: row.owner_agent,
    status: row.status as TaskRecord["status"],
    priority: row.priority,
    lastError: row.last_error,
    nextAction: row.next_action,
    syncState: row.sync_state as TaskRecord["syncState"],
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    dispatchMode: row.dispatch_mode as TaskRecord["dispatchMode"],
    targetSessionKey: row.target_session_key,
    targetRunId: row.target_run_id,
    resultSummary: row.result_summary,
    resultPayloadJson: row.result_payload_json,
    resultRef: row.result_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class TaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = resolveTasksDbPath()) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { DatabaseSync } = requireNodeSqlite();
    this.db = new DatabaseSync(dbPath);
    ensureTasksSchema(this.db);
  }

  createTask(input: CreateTaskInput): TaskRecord {
    const now = new Date().toISOString();
    const rootTaskId = input.rootTaskId?.trim() || input.taskId;
    const priority = input.priority?.trim() || "P1";
    this.db
      .prepare(
        `INSERT INTO tasks (
          task_id, parent_task_id, root_task_id, source, source_message_id, source_session_key,
          source_user_id, task_type, instruction, owner_agent, status, priority, last_error,
          next_action, sync_state, last_synced_at, last_sync_error, dispatch_mode,
          target_session_key, target_run_id, result_summary, result_payload_json, result_ref,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending', NULL, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
      )
      .run(
        input.taskId,
        input.parentTaskId ?? null,
        rootTaskId,
        input.source,
        input.sourceMessageId ?? null,
        input.sourceSessionKey ?? null,
        input.sourceUserId ?? null,
        input.taskType,
        input.instruction,
        input.ownerAgent,
        "pending",
        priority,
        input.nextAction ?? null,
        input.dispatchMode ?? "sessions_send",
        now,
        now,
      );
    this.appendEvent({
      taskId: input.taskId,
      eventType: "created",
      actor: "system",
      payload: {
        ownerAgent: input.ownerAgent,
        taskType: input.taskType,
      },
    });
    return this.getTask(input.taskId) as TaskRecord;
  }

  markTaskStatus(params: {
    taskId: string;
    status: TaskRecord["status"];
    lastError?: string | null;
    nextAction?: string | null;
  }): TaskRecord | null {
    const now = new Date().toISOString();
    const updates = ["status = ?"];
    const values: Array<string | null> = [params.status];
    if (params.lastError !== undefined) {
      updates.push("last_error = ?");
      values.push(params.lastError);
    }
    if (params.nextAction !== undefined) {
      updates.push("next_action = ?");
      values.push(params.nextAction);
    }
    updates.push("updated_at = ?");
    values.push(now);
    const updateResult = this.db
      .prepare(
        `UPDATE tasks
         SET ${updates.join(", ")}
         WHERE task_id = ?`,
      )
      .run(...values, params.taskId);
    if (Number(updateResult.changes) === 0) {
      return null;
    }
    const payload: {
      status: TaskRecord["status"];
      lastError?: string | null;
      nextAction?: string | null;
    } = {
      status: params.status,
    };
    if (params.lastError !== undefined) {
      payload.lastError = params.lastError;
    }
    if (params.nextAction !== undefined) {
      payload.nextAction = params.nextAction;
    }
    this.appendEvent({
      taskId: params.taskId,
      eventType: "status_changed",
      actor: "system",
      payload,
    });
    return this.getTask(params.taskId);
  }

  appendEvent(params: { taskId: string; eventType: string; actor: string; payload?: unknown }) {
    this.db
      .prepare(
        `INSERT INTO task_events (event_id, task_id, event_type, actor, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        params.taskId,
        params.eventType,
        params.actor,
        params.payload === undefined ? null : JSON.stringify(params.payload),
        new Date().toISOString(),
      );
  }

  appendHandoff(params: { fromTaskId: string; toTaskId: string; handoffKind: string }) {
    this.db
      .prepare(
        `INSERT INTO task_handoffs (handoff_id, from_task_id, to_task_id, handoff_kind, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        params.fromTaskId,
        params.toTaskId,
        params.handoffKind,
        new Date().toISOString(),
      );
  }

  markDispatched(params: {
    taskId: string;
    targetSessionKey: string;
    targetRunId?: string | null;
  }): TaskRecord | null {
    const now = new Date().toISOString();
    const updateResult = this.db
      .prepare(
        `UPDATE tasks
         SET status = ?, target_session_key = ?, target_run_id = ?, updated_at = ?, started_at = COALESCE(started_at, ?)
         WHERE task_id = ?`,
      )
      .run(
        "dispatched",
        params.targetSessionKey,
        params.targetRunId ?? null,
        now,
        now,
        params.taskId,
      );
    if (Number(updateResult.changes) === 0) {
      return null;
    }
    this.appendEvent({
      taskId: params.taskId,
      eventType: "dispatched",
      actor: "system",
      payload: {
        targetSessionKey: params.targetSessionKey,
        targetRunId: params.targetRunId ?? null,
      },
    });
    return this.getTask(params.taskId);
  }

  completeTask(input: CompleteTaskInput): TaskRecord | null {
    const now = new Date().toISOString();
    const updateResult = this.db
      .prepare(
        `UPDATE tasks
         SET status = ?, result_summary = ?, result_payload_json = ?, result_ref = ?, updated_at = ?, finished_at = ?
         WHERE task_id = ?`,
      )
      .run(
        input.status,
        input.resultSummary ?? null,
        input.resultPayloadJson ?? null,
        input.resultRef ?? null,
        now,
        now,
        input.taskId,
      );
    if (Number(updateResult.changes) === 0) {
      return null;
    }
    this.appendEvent({
      taskId: input.taskId,
      eventType: "completed",
      actor: "system",
      payload: {
        status: input.status,
      },
    });
    return this.getTask(input.taskId);
  }

  markTaskSyncSuccess(taskId: string): TaskRecord | null {
    const now = new Date().toISOString();
    const updateResult = this.db
      .prepare(
        `UPDATE tasks
         SET sync_state = ?, last_synced_at = ?, last_sync_error = NULL, updated_at = ?
         WHERE task_id = ?`,
      )
      .run("synced", now, now, taskId);
    if (Number(updateResult.changes) === 0) {
      return null;
    }
    this.appendEvent({
      taskId,
      eventType: "sync_succeeded",
      actor: "system",
    });
    return this.getTask(taskId);
  }

  markTaskSyncError(taskId: string, errorMessage: string): TaskRecord | null {
    const updateResult = this.db
      .prepare(
        `UPDATE tasks
         SET sync_state = ?, last_sync_error = ?, updated_at = ?
         WHERE task_id = ?`,
      )
      .run("sync_error", errorMessage, new Date().toISOString(), taskId);
    if (Number(updateResult.changes) === 0) {
      return null;
    }
    this.appendEvent({
      taskId,
      eventType: "sync_error",
      actor: "system",
      payload: {
        error: errorMessage,
      },
    });
    return this.getTask(taskId);
  }

  getTask(taskId: string): TaskRecord | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE task_id = ?`).get(taskId) as
      | TaskRow
      | undefined;
    return mapTaskRow(row);
  }

  listTasks(params?: { updatedAfter?: string; syncState?: TaskRecord["syncState"] }): TaskRecord[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (params?.updatedAfter) {
      clauses.push("updated_at >= ?");
      values.push(params.updatedAfter);
    }
    if (params?.syncState) {
      clauses.push("sync_state = ?");
      values.push(params.syncState);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY updated_at ASC, created_at ASC`)
      .all(...values) as TaskRow[];
    return rows.map((row) => mapTaskRow(row)).filter(Boolean) as TaskRecord[];
  }

  getTaskTree(taskId: string): TaskTree | null {
    const task = this.getTask(taskId);
    if (!task) {
      return null;
    }
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE root_task_id = ? ORDER BY created_at ASC`)
      .all(task.rootTaskId) as TaskRow[];
    const allTasks = rows.map((row) => mapTaskRow(row)).filter(Boolean) as TaskRecord[];
    const rootTask = allTasks.find((entry) => entry.taskId === task.rootTaskId) ?? task;
    const childrenByParent = new Map<string, TaskRecord[]>();
    for (const entry of allTasks) {
      if (!entry.parentTaskId) {
        continue;
      }
      const bucket = childrenByParent.get(entry.parentTaskId) ?? [];
      bucket.push(entry);
      childrenByParent.set(entry.parentTaskId, bucket);
    }
    const buildNode = (entry: TaskRecord): TaskTreeNode => ({
      ...entry,
      children: (childrenByParent.get(entry.taskId) ?? []).map((child) => buildNode(child)),
    });
    return {
      task: rootTask,
      children: (childrenByParent.get(rootTask.taskId) ?? []).map((child) => buildNode(child)),
    };
  }
}
