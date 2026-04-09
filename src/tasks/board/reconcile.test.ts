import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "../store.js";
import { reconcileTaskBoard } from "./reconcile.js";

describe("reconcileTaskBoard", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-task-board-reconcile-"));
    dbPath = path.join(tmpDir, "orchestrator", "tasks.sqlite");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("incremental reconcile upserts recently changed and unsynced tasks", async () => {
    const store = new TaskStore(dbPath);
    const recentTask = store.createTask({
      taskId: "task-recent",
      source: "system",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "最近更新任务",
      ownerAgent: "agent_athena",
    });
    const staleUnsyncedTask = store.createTask({
      taskId: "task-unsynced",
      source: "system",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "report",
      instruction: "同步失败任务",
      ownerAgent: "agent_watson",
    });
    store.markTaskSyncError(staleUnsyncedTask.taskId, "bitable timeout");
    store.markTaskSyncSuccess(recentTask.taskId);

    const upsertTask = vi.fn(async () => undefined);
    const result = await reconcileTaskBoard({
      store,
      board: {
        upsertTask,
        listRecords: async () => [],
        updateRecord: async () => ({ record: { record_id: "unused" } }),
      },
      mode: "incremental",
      now: Date.parse("2026-04-09T06:00:00.000Z"),
    });

    expect(result.scanned).toBe(2);
    expect(result.upserted).toBe(2);
    expect(result.orphaned).toBe(0);
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-recent" }));
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-unsynced" }));
  });

  it("full reconcile flags orphan board rows", async () => {
    const store = new TaskStore(dbPath);
    store.createTask({
      taskId: "task-1",
      source: "system",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "正常任务",
      ownerAgent: "agent_athena",
    });
    const updateRecord = vi.fn(async () => ({ record: { record_id: "rec-orphan" } }));

    const result = await reconcileTaskBoard({
      store,
      board: {
        upsertTask: async () => undefined,
        listRecords: async () => [
          { record_id: "rec-task-1", fields: { task_id: "task-1" } },
          { record_id: "rec-orphan", fields: { task_id: "missing-task" } },
        ],
        updateRecord,
      },
      mode: "full",
      now: Date.parse("2026-04-09T06:00:00.000Z"),
    });

    expect(result.orphaned).toBe(1);
    expect(updateRecord).toHaveBeenCalledWith(
      "rec-orphan",
      expect.objectContaining({
        最近错误: "孤立记录",
      }),
    );
  });
});
