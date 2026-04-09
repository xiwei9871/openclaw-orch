import { describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "../types.js";
import { buildFeishuBoardPayload, upsertTaskToFeishuBoard } from "./feishu-board.js";
import { toTaskOwnerZh, toTaskStatusZh } from "./labels.js";

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = "2026-04-09T00:00:00.000Z";
  return {
    taskId: "task-1",
    parentTaskId: null,
    rootTaskId: "task-1",
    source: "system",
    sourceMessageId: null,
    sourceSessionKey: null,
    sourceUserId: null,
    taskType: "research",
    instruction: "整理任务看板状态",
    ownerAgent: "agent_jarvis",
    status: "done",
    priority: "P1",
    lastError: null,
    nextAction: null,
    syncState: "pending",
    lastSyncedAt: null,
    lastSyncError: null,
    dispatchMode: "sessions_send",
    targetSessionKey: null,
    targetRunId: null,
    resultSummary: null,
    resultPayloadJson: null,
    resultRef: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("task board zh labels", () => {
  it("maps task status and owner labels to Chinese", () => {
    expect(toTaskStatusZh("running")).toBe("进行中");
    expect(toTaskStatusZh("dispatched")).toBe("已派发");
    expect(toTaskOwnerZh("agent_athena")).toBe("雅典娜");
    expect(toTaskOwnerZh("agent_friday")).toBe("星期五");
  });
});

describe("feishu board payload", () => {
  it("builds chinese-first board payload with approved display fields and raw values", () => {
    const payload = buildFeishuBoardPayload(
      createTask({
        status: "done",
        ownerAgent: "agent_jarvis",
        taskId: "task-9",
        rootTaskId: "root-1",
        parentTaskId: "root-1",
        instruction: "整理 Feishu 看板字段",
      }),
    );

    expect(payload["任务标题"]).toBe("整理 Feishu 看板字段");
    expect(payload["任务ID"]).toBe("task-9");
    expect(payload["根任务ID"]).toBe("root-1");
    expect(payload["父任务ID"]).toBe("root-1");
    expect(payload["任务层级"]).toBe("子任务");
    expect(payload["类型"]).toBe("research");
    expect(payload["来源"]).toBe("system");
    expect(payload["状态"]).toBe("已完成");
    expect(payload["负责人"]).toBe("贾维斯");
    expect(payload["优先级"]).toBe("P1");
    expect(payload["下一步"]).toBeNull();
    expect(payload["结果摘要"]).toBeNull();
    expect(payload["最近错误"]).toBeNull();
    expect(payload["创建时间"]).toBe("2026-04-09T00:00:00.000Z");
    expect(payload["更新时间"]).toBe("2026-04-09T00:00:00.000Z");
    expect(payload["完成时间"]).toBeNull();
    expect(payload["结果引用"]).toBeNull();
    expect(payload["状态原值"]).toBe("done");
    expect(payload["负责人原值"]).toBe("agent_jarvis");
  });

  it("maps root/child/grandchild depth labels as 根任务/子任务/孙任务", () => {
    const rootPayload = buildFeishuBoardPayload(
      createTask({
        taskId: "root-task",
        rootTaskId: "root-task",
        parentTaskId: null,
      }),
    );
    const childPayload = buildFeishuBoardPayload(
      createTask({
        taskId: "child-task",
        rootTaskId: "root-task",
        parentTaskId: "root-task",
      }),
    );
    const grandchildPayload = buildFeishuBoardPayload(
      createTask({
        taskId: "grandchild-task",
        rootTaskId: "root-task",
        parentTaskId: "child-task",
      }),
    );

    expect(rootPayload["任务层级"]).toBe("根任务");
    expect(childPayload["任务层级"]).toBe("子任务");
    expect(grandchildPayload["任务层级"]).toBe("孙任务");
  });
});

describe("upsertTaskToFeishuBoard", () => {
  it("updates existing record matched by task id", async () => {
    const findRecordsByField = vi.fn(async () => [{ record_id: "rec_existing" }]);
    const createRecord = vi.fn(async () => ({ record: { record_id: "rec_new" } }));
    const updateRecord = vi.fn(async () => ({ record: { record_id: "rec_existing" } }));

    const result = await upsertTaskToFeishuBoard(createTask(), {
      findRecordsByField,
      createRecord,
      updateRecord,
    });

    expect(result.action).toBe("updated");
    expect(findRecordsByField).toHaveBeenCalledWith("task_id", "task-1");
    expect(updateRecord).toHaveBeenCalledWith(
      "rec_existing",
      expect.objectContaining({
        状态: "已完成",
        负责人: "贾维斯",
        状态原值: "done",
      }),
    );
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("creates a new record when task id is not found", async () => {
    const findRecordsByField = vi.fn(async () => []);
    const createRecord = vi.fn(async () => ({ record: { record_id: "rec_new" } }));
    const updateRecord = vi.fn(async () => ({ record: { record_id: "rec_existing" } }));

    const result = await upsertTaskToFeishuBoard(createTask({ taskId: "task-2" }), {
      findRecordsByField,
      createRecord,
      updateRecord,
    });

    expect(result.action).toBe("created");
    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        任务ID: "task-2",
        状态: "已完成",
      }),
    );
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it("throws when duplicate task id matches are found", async () => {
    const findRecordsByField = vi.fn(async () => [{ record_id: "rec_a" }, { record_id: "rec_b" }]);
    const createRecord = vi.fn(async () => ({ record: { record_id: "rec_new" } }));
    const updateRecord = vi.fn(async () => ({ record: { record_id: "rec_existing" } }));

    await expect(
      upsertTaskToFeishuBoard(createTask({ taskId: "task-dup" }), {
        findRecordsByField,
        createRecord,
        updateRecord,
      }),
    ).rejects.toThrow("duplicate task_id matches");

    expect(findRecordsByField).toHaveBeenCalledWith("task_id", "task-dup");
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });
});
