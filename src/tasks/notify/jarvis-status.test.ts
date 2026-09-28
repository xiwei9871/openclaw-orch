import { describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "../types.js";
import {
  buildJarvisTaskStatusSummary,
  createJarvisTaskNotifier,
  formatJarvisTaskFailureAlert,
} from "./jarvis-status.js";

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = "2026-04-09T00:00:00.000Z";
  return {
    taskId: "task-1",
    parentTaskId: null,
    rootTaskId: "task-1",
    source: "system",
    sourceMessageId: null,
    sourceSessionKey: "agent:agent_jarvis:feishu:group:oc_group",
    sourceUserId: null,
    taskType: "research",
    instruction: "整理任务状态",
    ownerAgent: "agent_jarvis",
    status: "running",
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

describe("buildJarvisTaskStatusSummary", () => {
  it("groups tasks into chinese summary buckets", () => {
    const summary = buildJarvisTaskStatusSummary([
      createTask({ taskId: "task-running", status: "running" }),
      createTask({ taskId: "task-dispatched", status: "dispatched" }),
      createTask({ taskId: "task-waiting", status: "waiting" }),
      createTask({ taskId: "task-done", status: "done" }),
      createTask({ taskId: "task-failed", status: "failed" }),
    ]);

    expect(summary).toContain("进行中：2 项");
    expect(summary).toContain("等待中：1 项");
    expect(summary).toContain("已完成：1 项");
    expect(summary).toContain("失败：1 项");
  });
});

describe("formatJarvisTaskFailureAlert", () => {
  it("formats a concise chinese failure alert", () => {
    const alert = formatJarvisTaskFailureAlert(
      createTask({
        taskId: "task-failed",
        ownerAgent: "agent_watson",
        status: "failed",
        instruction: "起草迁移方案",
        lastError: "rate limit",
      }),
    );

    expect(alert).toContain("失败告警");
    expect(alert).toContain("沃森");
    expect(alert).toContain("起草迁移方案");
    expect(alert).toContain("rate limit");
  });
});

describe("createJarvisTaskNotifier", () => {
  it("suppresses unchanged summaries inside the cooldown window", async () => {
    const send = vi.fn(async () => undefined);
    const notifier = createJarvisTaskNotifier({
      send,
      now: vi
        .fn<() => number>()
        .mockReturnValueOnce(Date.parse("2026-04-09T00:00:00.000Z"))
        .mockReturnValueOnce(Date.parse("2026-04-09T00:10:00.000Z")),
    });
    const tasks = [createTask({ taskId: "task-running", status: "running" })];

    await notifier.notifySummary(tasks);
    await notifier.notifySummary(tasks);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends immediate failure alerts and suppresses duplicates inside cooldown", async () => {
    const send = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    const notifier = createJarvisTaskNotifier({
      send,
      now: vi
        .fn<() => number>()
        .mockReturnValueOnce(Date.parse("2026-04-09T00:00:00.000Z"))
        .mockReturnValueOnce(Date.parse("2026-04-09T00:05:00.000Z")),
    });
    const failedTask = createTask({
      taskId: "task-failed",
      ownerAgent: "agent_watson",
      status: "failed",
      lastError: "bitable timeout",
    });

    await notifier.notifyFailure(failedTask);
    await notifier.notifyFailure(failedTask);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toContain("失败告警");
  });
});
