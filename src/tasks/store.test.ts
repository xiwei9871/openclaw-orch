import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { TaskStore } from "./store.js";

describe("TaskStore", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-task-store-"));
    dbPath = path.join(tmpDir, "orchestrator", "tasks.sqlite");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("bootstraps the sqlite schema under the provided db path", () => {
    const store = new TaskStore(dbPath);

    const task = store.createTask({
      taskId: "root-task",
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "调研编排层方案",
      ownerAgent: "agent_athena",
    });

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(task.rootTaskId).toBe("root-task");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("P1");
    expect(task.lastError).toBeNull();
    expect(task.nextAction).toBeNull();
    expect(task.syncState).toBe("pending");
    expect(task.lastSyncedAt).toBeNull();
    expect(task.lastSyncError).toBeNull();
  });

  it("tracks sync success and sync error without changing business status", () => {
    const store = new TaskStore(dbPath);
    const task = store.createTask({
      taskId: "root-task",
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "调研编排层方案",
      ownerAgent: "agent_athena",
    });

    const running = store.markTaskStatus({ taskId: task.taskId, status: "running" });
    expect(running?.status).toBe("running");
    expect(running?.syncState).toBe("pending");

    const synced = store.markTaskSyncSuccess(task.taskId);
    expect(synced?.status).toBe("running");
    expect(synced?.syncState).toBe("synced");
    expect(synced?.lastSyncedAt).not.toBeNull();
    expect(synced?.lastSyncError).toBeNull();

    const syncErrored = store.markTaskSyncError(task.taskId, "bitable timeout");
    expect(syncErrored?.status).toBe("running");
    expect(syncErrored?.syncState).toBe("sync_error");
    expect(syncErrored?.lastSyncError).toContain("bitable timeout");
  });

  it("preserves error and next-action metadata for status-only updates", () => {
    const store = new TaskStore(dbPath);
    const task = store.createTask({
      taskId: "root-task",
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "调研编排层方案",
      ownerAgent: "agent_athena",
    });

    const withMetadata = store.markTaskStatus({
      taskId: task.taskId,
      status: "running",
      lastError: "rate limit",
      nextAction: "retry_after_backoff",
    });
    expect(withMetadata?.lastError).toBe("rate limit");
    expect(withMetadata?.nextAction).toBe("retry_after_backoff");

    const statusOnly = store.markTaskStatus({
      taskId: task.taskId,
      status: "waiting",
    });
    expect(statusOnly?.lastError).toBe("rate limit");
    expect(statusOnly?.nextAction).toBe("retry_after_backoff");

    const cleared = store.markTaskStatus({
      taskId: task.taskId,
      status: "done",
      lastError: null,
      nextAction: null,
    });
    expect(cleared?.lastError).toBeNull();
    expect(cleared?.nextAction).toBeNull();
  });

  it("migrates legacy task rows and backfills sync/metadata defaults", () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { DatabaseSync } = requireNodeSqlite();
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE tasks (
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
      CREATE TABLE task_events (
        event_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE task_handoffs (
        handoff_id TEXT PRIMARY KEY,
        from_task_id TEXT NOT NULL,
        to_task_id TEXT NOT NULL,
        handoff_kind TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    legacyDb
      .prepare(
        `INSERT INTO tasks (
          task_id, parent_task_id, root_task_id, source, source_message_id, source_session_key,
          source_user_id, task_type, instruction, owner_agent, status, dispatch_mode,
          target_session_key, target_run_id, result_summary, result_payload_json, result_ref,
          created_at, updated_at, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "legacy-task",
        null,
        "legacy-task",
        "feishu",
        null,
        "agent:agent_jarvis:feishu:group:oc_group",
        null,
        "research",
        "legacy instruction",
        "agent_athena",
        "pending",
        "sessions_send",
        null,
        null,
        null,
        null,
        null,
        now,
        now,
        null,
        null,
      );
    legacyDb.close();

    const store = new TaskStore(dbPath);
    const migrated = store.getTask("legacy-task");

    expect(migrated).not.toBeNull();
    expect(migrated?.priority).toBe("P1");
    expect(migrated?.lastError).toBeNull();
    expect(migrated?.nextAction).toBeNull();
    expect(migrated?.syncState).toBe("pending");
    expect(migrated?.lastSyncedAt).toBeNull();
    expect(migrated?.lastSyncError).toBeNull();
  });

  it("appends a task event for status mutations", () => {
    const store = new TaskStore(dbPath);
    const task = store.createTask({
      taskId: "root-task",
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "调研编排层方案",
      ownerAgent: "agent_athena",
    });

    store.markTaskStatus({
      taskId: task.taskId,
      status: "running",
      lastError: "rate limit",
      nextAction: "retry_after_backoff",
    });

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath);
    const statusEvent = db
      .prepare(
        `SELECT event_type, actor, payload_json
         FROM task_events
         WHERE task_id = ? AND event_type = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(task.taskId, "status_changed") as
      | { event_type: string; actor: string; payload_json: string | null }
      | undefined;
    db.close();

    expect(statusEvent).toBeDefined();
    expect(statusEvent?.actor).toBe("system");
    expect(JSON.parse(statusEvent?.payload_json ?? "{}")).toEqual({
      status: "running",
      lastError: "rate limit",
      nextAction: "retry_after_backoff",
    });
  });

  it("does not append status_changed event for missing tasks", () => {
    const store = new TaskStore(dbPath);

    const updated = store.markTaskStatus({
      taskId: "missing-task",
      status: "running",
      lastError: "rate limit",
      nextAction: "retry_after_backoff",
    });

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath);
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM task_events
         WHERE task_id = ? AND event_type = ?`,
      )
      .get("missing-task", "status_changed") as { count: number | bigint };
    db.close();

    expect(updated).toBeNull();
    expect(Number(countRow.count)).toBe(0);
  });

  it("does not append dispatched event for missing tasks", () => {
    const store = new TaskStore(dbPath);

    const updated = store.markDispatched({
      taskId: "missing-task",
      targetSessionKey: "agent:agent_athena:tui:dm:u123",
      targetRunId: "run-1",
    });

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath);
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM task_events
         WHERE task_id = ? AND event_type = ?`,
      )
      .get("missing-task", "dispatched") as { count: number | bigint };
    db.close();

    expect(updated).toBeNull();
    expect(Number(countRow.count)).toBe(0);
  });

  it("does not append completed event for missing tasks", () => {
    const store = new TaskStore(dbPath);

    const updated = store.completeTask({
      taskId: "missing-task",
      status: "done",
      resultSummary: "done",
    });

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(dbPath);
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM task_events
         WHERE task_id = ? AND event_type = ?`,
      )
      .get("missing-task", "completed") as { count: number | bigint };
    db.close();

    expect(updated).toBeNull();
    expect(Number(countRow.count)).toBe(0);
  });

  it("returns a nested task tree for multi-step handoffs", () => {
    const store = new TaskStore(dbPath);
    const root = store.createTask({
      taskId: "root-task",
      source: "feishu",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "调研编排层方案",
      ownerAgent: "agent_athena",
    });
    const child = store.createTask({
      taskId: "child-task",
      parentTaskId: root.taskId,
      rootTaskId: root.rootTaskId,
      source: "feishu",
      sourceSessionKey: root.sourceSessionKey,
      taskType: "report",
      instruction: "根据调研起草方案",
      ownerAgent: "agent_watson",
    });
    const grandchild = store.createTask({
      taskId: "grandchild-task",
      parentTaskId: child.taskId,
      rootTaskId: root.rootTaskId,
      source: "feishu",
      sourceSessionKey: root.sourceSessionKey,
      taskType: "summary",
      instruction: "最终汇总答复",
      ownerAgent: "agent_jarvis",
    });

    const tree = store.getTaskTree(root.taskId);

    expect(tree?.task.taskId).toBe(root.taskId);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]).toEqual(
      expect.objectContaining({
        taskId: child.taskId,
        children: [
          expect.objectContaining({
            taskId: grandchild.taskId,
            children: [],
          }),
        ],
      }),
    );
  });
});
