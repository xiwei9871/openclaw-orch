import { afterEach, describe, expect, it } from "vitest";
import { withTempDir } from "../../test-helpers/temp-dir.js";
import { createTaskRecord, resetTaskRegistryForTests } from "../task-registry.js";
import type { TaskRecord } from "../task-registry.types.js";
import { buildTaskControlPlane } from "./model.js";
import { buildTaskControlProjectionLayer } from "./projection.js";

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

function createSampleTasks(now: number): TaskRecord[] {
  return [
    {
      taskId: "task-running",
      runtime: "acp",
      requesterSessionKey: "agent:agent_athena:main",
      ownerKey: "agent:agent_athena:main",
      scopeKind: "session",
      childSessionKey: "agent:agent_athena:acp:run",
      agentId: "agent_athena",
      runId: "run-running",
      task: "Investigate task health drift",
      status: "running",
      deliveryStatus: "pending",
      notifyPolicy: "done_only",
      createdAt: now - 8 * 60_000,
      startedAt: now - 7 * 60_000,
      lastEventAt: now - 2 * 60_000,
      progressSummary: "Collecting recent execution evidence",
    },
    {
      taskId: "task-stale-queued",
      runtime: "cron",
      requesterSessionKey: "",
      ownerKey: "system:cron:daily",
      scopeKind: "system",
      runId: "run-stale-queued",
      task: "Daily cron reconciliation",
      status: "queued",
      deliveryStatus: "not_applicable",
      notifyPolicy: "silent",
      createdAt: now - 25 * 60_000,
      lastEventAt: now - 20 * 60_000,
    },
    {
      taskId: "task-auth-failure",
      runtime: "cli",
      requesterSessionKey: "agent:agent_jarvis:main",
      ownerKey: "agent:agent_jarvis:main",
      scopeKind: "session",
      agentId: "agent_jarvis",
      runId: "run-auth-failure",
      task: "Send final report",
      status: "failed",
      deliveryStatus: "failed",
      notifyPolicy: "state_changes",
      createdAt: now - 30 * 60_000,
      startedAt: now - 29 * 60_000,
      endedAt: now - 27 * 60_000,
      lastEventAt: now - 27 * 60_000,
      error: "HTTP 401: invalid access token or token expired",
      terminalSummary: "Delivery failed after auth error",
    },
    {
      taskId: "task-filesystem-lost",
      runtime: "subagent",
      requesterSessionKey: "agent:agent_alpha:main",
      ownerKey: "agent:agent_alpha:main",
      scopeKind: "session",
      agentId: "agent_alpha",
      runId: "run-filesystem-lost",
      task: "Write board projection",
      status: "lost",
      deliveryStatus: "pending",
      notifyPolicy: "done_only",
      createdAt: now - 40 * 60_000,
      startedAt: now - 39 * 60_000,
      endedAt: now - 35 * 60_000,
      lastEventAt: now - 35 * 60_000,
      error: "Error: ENOENT: no such file or directory, mkdir '/home/node'",
    },
    {
      taskId: "task-succeeded",
      runtime: "cli",
      requesterSessionKey: "agent:agent_watson:main",
      ownerKey: "agent:agent_watson:main",
      scopeKind: "session",
      agentId: "agent_watson",
      runId: "run-succeeded",
      task: "Publish summary",
      status: "succeeded",
      deliveryStatus: "delivered",
      notifyPolicy: "done_only",
      createdAt: now - 90 * 60_000,
      startedAt: now - 88 * 60_000,
      endedAt: now - 84 * 60_000,
      lastEventAt: now - 84 * 60_000,
      cleanupAfter: now + 7 * 24 * 60 * 60_000,
      terminalSummary: "Published clean summary",
    },
  ];
}

describe("task control plane", () => {
  afterEach(() => {
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
    resetTaskRegistryForTests({ persist: false });
  });

  it("builds catalog, snapshot, ledger, health, and error classification from task records", () => {
    const now = Date.UTC(2026, 3, 10, 6, 0, 0);
    const model = buildTaskControlPlane({
      now,
      tasks: createSampleTasks(now),
    });

    expect(model.taskCatalog.total).toBe(5);
    expect(model.taskCatalog.byRuntime.cli).toBe(2);
    expect(model.taskCatalog.byStatus.failed).toBe(1);
    expect(model.taskSnapshot.active).toBe(2);
    expect(model.taskSnapshot.failures).toBe(2);
    expect(model.taskLedger.byDay[0]).toMatchObject({
      dayKey: "2026-04-10",
      total: 5,
      failures: 2,
      active: 2,
    });
    expect(model.healthModel.overallSeverity).toBe("critical");
    expect(model.healthModel.summary.staleQueued).toBe(1);
    expect(model.healthModel.summary.deliveryFailed).toBe(1);
    expect(model.errorClassification.byClass.auth).toBe(1);
    expect(model.errorClassification.byClass.filesystem).toBe(1);
  });

  it("builds Feishu projection and Jarvis summary as read models", () => {
    const now = Date.UTC(2026, 3, 10, 6, 0, 0);
    const model = buildTaskControlPlane({
      now,
      tasks: createSampleTasks(now),
    });
    const projection = buildTaskControlProjectionLayer(model, {
      now,
      timeZone: "Asia/Shanghai",
    });

    expect(projection.feishu.views.map((view) => view.name)).toEqual([
      "总览",
      "异常",
      "今日队列",
      "Agent 视图",
    ]);
    expect(projection.feishu.views[0]?.mobileCardFields.slice(0, 5)).toEqual([
      "标题",
      "健康",
      "状态",
      "错误分类",
      "负责人",
    ]);
    const failedRow = projection.feishu.rows.find((row) => row.taskId === "task-auth-failure");
    expect(failedRow?.fields["错误分类"]).toBe("认证");
    expect(projection.summary.text).toContain("Task Control 每日健康报告");
    expect(projection.summary.text).toContain("异常任务：");
    expect(projection.summary.text).toContain("错误分类：");
  });

  it("reads from the task registry runtime when no explicit task list is provided", async () => {
    await withTempDir({ prefix: "openclaw-task-control-" }, async (root) => {
      process.env.OPENCLAW_STATE_DIR = root;
      resetTaskRegistryForTests();

      createTaskRecord({
        runtime: "cli",
        ownerKey: "agent:agent_jarvis:main",
        scopeKind: "session",
        requesterSessionKey: "agent:agent_jarvis:main",
        childSessionKey: "agent:agent_jarvis:cli:run",
        runId: "run-control-plane",
        task: "Read task registry and project snapshot",
        status: "running",
        deliveryStatus: "pending",
        notifyPolicy: "done_only",
      });

      const model = buildTaskControlPlane({ now: Date.now() });
      expect(model.source).toEqual({
        kind: "task_registry",
        totalTasks: 1,
      });
      expect(model.taskSnapshot.items[0]).toEqual(
        expect.objectContaining({
          runId: "run-control-plane",
          status: "running",
          ownerKey: "agent:agent_jarvis:main",
        }),
      );
    });
  });
});
