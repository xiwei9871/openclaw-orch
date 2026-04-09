import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskStore } from "../store.js";
import { syncTaskToFeishuBoard } from "./sync.js";

describe("syncTaskToFeishuBoard", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-task-board-sync-"));
    dbPath = path.join(tmpDir, "orchestrator", "tasks.sqlite");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("upserts board payload and marks sync success", async () => {
    const store = new TaskStore(dbPath);
    const created = store.createTask({
      taskId: "task-success",
      source: "system",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "research",
      instruction: "同步任务到看板",
      ownerAgent: "agent_athena",
    });
    const upsertTask = vi.fn(async () => undefined);

    await syncTaskToFeishuBoard(created.taskId, {
      store,
      board: {
        upsertTask,
      },
    });

    const updated = store.getTask(created.taskId);
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: created.taskId }));
    expect(updated?.status).toBe("pending");
    expect(updated?.syncState).toBe("synced");
    expect(updated?.lastSyncError).toBeNull();
    expect(updated?.lastSyncedAt).not.toBeNull();
  });

  it("marks sync error metadata only and preserves business status", async () => {
    const store = new TaskStore(dbPath);
    const created = store.createTask({
      taskId: "task-error",
      source: "system",
      sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
      taskType: "report",
      instruction: "同步失败场景",
      ownerAgent: "agent_watson",
    });
    store.completeTask({
      taskId: created.taskId,
      status: "done",
      resultSummary: "业务执行已完成",
    });
    const upsertTask = vi.fn(async () => {
      throw new Error("bitable timeout");
    });

    await syncTaskToFeishuBoard(created.taskId, {
      store,
      board: {
        upsertTask,
      },
    });

    const updated = store.getTask(created.taskId);
    expect(updated?.status).toBe("done");
    expect(updated?.syncState).toBe("sync_error");
    expect(updated?.lastSyncError).toContain("bitable timeout");
    expect(updated?.resultSummary).toBe("业务执行已完成");
  });
});
