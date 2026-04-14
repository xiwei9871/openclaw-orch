import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { createRunningTaskRun } from "../tasks/task-executor.js";
import {
  createManagedTaskFlow,
  resetTaskFlowRegistryForTests,
} from "../tasks/task-flow-registry.js";
import {
  resetTaskRegistryDeliveryRuntimeForTests,
  resetTaskRegistryForTests,
} from "../tasks/task-registry.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { tasksAuditCommand, tasksControlCommand, tasksMaintenanceCommand } from "./tasks.js";

const sendMessageFeishuMock = vi.hoisted(() => vi.fn());

vi.mock("../../extensions/feishu/src/send.js", () => ({
  sendMessageFeishu: sendMessageFeishuMock,
}));

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  } as unknown as RuntimeEnv;
}

async function withTaskCommandStateDir(run: () => Promise<void>): Promise<void> {
  await withTempDir({ prefix: "openclaw-tasks-command-" }, async (root) => {
    process.env.OPENCLAW_STATE_DIR = root;
    resetTaskRegistryDeliveryRuntimeForTests();
    resetTaskRegistryForTests();
    resetTaskFlowRegistryForTests();
    try {
      await run();
    } finally {
      resetTaskRegistryDeliveryRuntimeForTests();
      resetTaskRegistryForTests();
      resetTaskFlowRegistryForTests();
    }
  });
}

describe("tasks commands", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
    resetTaskRegistryDeliveryRuntimeForTests();
    resetTaskRegistryForTests();
    resetTaskFlowRegistryForTests();
  });

  it("keeps tasks audit JSON stable while adding TaskFlow summary fields", async () => {
    await withTaskCommandStateDir(async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now - 40 * 60_000);
      createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        runId: "task-stale-queued",
        task: "Inspect issue backlog",
      });
      vi.setSystemTime(now);
      createManagedTaskFlow({
        ownerKey: "agent:main:main",
        controllerId: "tests/tasks-command",
        goal: "Inspect issue backlog",
        status: "waiting",
        createdAt: now - 40 * 60_000,
        updatedAt: now - 40 * 60_000,
      });

      const runtime = createRuntime();
      await tasksAuditCommand({ json: true }, runtime);

      const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
        summary: {
          total: number;
          errors: number;
          warnings: number;
          byCode: Record<string, number>;
          taskFlows: { total: number; byCode: Record<string, number> };
          combined: { total: number; errors: number; warnings: number };
        };
      };

      expect(payload.summary.byCode.stale_running).toBe(1);
      expect(payload.summary.taskFlows.byCode.stale_waiting).toBe(1);
      expect(payload.summary.taskFlows.byCode.missing_linked_tasks).toBe(1);
      expect(payload.summary.combined.total).toBe(3);
    });
  });

  it("sorts combined audit findings before applying the limit", async () => {
    await withTaskCommandStateDir(async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now - 40 * 60_000);
      createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:main:main",
        scopeKind: "session",
        runId: "task-stale-queued",
        task: "Queue audit",
      });
      vi.setSystemTime(now);
      const runningFlow = createManagedTaskFlow({
        ownerKey: "agent:main:main",
        controllerId: "tests/tasks-command",
        goal: "Running flow",
        status: "running",
        createdAt: now - 45 * 60_000,
        updatedAt: now - 45 * 60_000,
      });

      const runtime = createRuntime();
      await tasksAuditCommand({ json: true, limit: 1 }, runtime);

      const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
        findings: Array<{ kind: string; code: string; token?: string }>;
      };

      expect(payload.findings).toHaveLength(1);
      expect(payload.findings[0]).toMatchObject({
        kind: "task_flow",
        code: "stale_running",
        token: runningFlow.flowId,
      });
    });
  });

  it("keeps tasks maintenance JSON additive for TaskFlow state", async () => {
    await withTaskCommandStateDir(async () => {
      const now = Date.now();
      createManagedTaskFlow({
        ownerKey: "agent:main:main",
        controllerId: "tests/tasks-command",
        goal: "Old terminal flow",
        status: "succeeded",
        createdAt: now - 8 * 24 * 60 * 60_000,
        updatedAt: now - 8 * 24 * 60 * 60_000,
        endedAt: now - 8 * 24 * 60 * 60_000,
      });

      const runtime = createRuntime();
      await tasksMaintenanceCommand({ json: true, apply: false }, runtime);

      const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
        mode: string;
        maintenance: { taskFlows: { pruned: number } };
        auditBefore: {
          byCode: Record<string, number>;
          taskFlows: { byCode: Record<string, number> };
        };
        auditAfter: {
          byCode: Record<string, number>;
          taskFlows: { byCode: Record<string, number> };
        };
      };

      expect(payload.mode).toBe("preview");
      expect(payload.maintenance.taskFlows.pruned).toBe(1);
      expect(payload.auditBefore.byCode).toBeDefined();
      expect(payload.auditBefore.taskFlows.byCode.stale_running).toBe(0);
      expect(payload.auditAfter.byCode).toBeDefined();
      expect(payload.auditAfter.taskFlows.byCode.stale_running).toBe(0);
    });
  });

  it("emits task control plane JSON with read models and projection layer", async () => {
    await withTaskCommandStateDir(async () => {
      const now = Date.UTC(2026, 3, 10, 6, 0, 0);
      vi.useFakeTimers();
      vi.setSystemTime(now - 35 * 60_000);
      createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:agent_jarvis:main",
        scopeKind: "session",
        runId: "task-control-running",
        task: "Review control plane payload",
      });
      vi.setSystemTime(now - 20 * 60_000);
      createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:agent_alpha:main",
        scopeKind: "session",
        runId: "task-control-failure",
        task: "Write projection adapter",
      });
      vi.setSystemTime(now - 5 * 60_000);
      createManagedTaskFlow({
        ownerKey: "agent:agent_jarvis:main",
        controllerId: "tests/tasks-control",
        goal: "Track control plane",
        status: "waiting",
        createdAt: now - 30 * 60_000,
        updatedAt: now - 5 * 60_000,
      });

      const runtime = createRuntime();
      await tasksControlCommand({ json: true, timeZone: "Asia/Shanghai" }, runtime);

      const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
        taskCatalog: { total: number };
        taskSnapshot: { total: number; items: Array<{ runId?: string; status: string }> };
        taskLedger: { total: number; byDay: Array<{ dayKey: string }> };
        healthModel: { summary: { total: number } };
        errorClassification: { total: number };
        projectionLayer: {
          feishu: { views: Array<{ name: string }>; rows: Array<{ taskId: string }> };
          summary: { text: string };
        };
      };

      expect(payload.taskCatalog.total).toBeGreaterThanOrEqual(2);
      expect(payload.taskSnapshot.total).toBeGreaterThanOrEqual(2);
      expect(payload.taskSnapshot.items.some((item) => item.runId === "task-control-running")).toBe(
        true,
      );
      expect(payload.taskLedger.total).toBe(payload.taskCatalog.total);
      expect(payload.taskLedger.byDay[0]?.dayKey).toBe("2026-04-10");
      expect(payload.healthModel.summary.total).toBe(payload.taskCatalog.total);
      expect(payload.errorClassification.total).toBe(payload.taskCatalog.total);
      expect(payload.projectionLayer.feishu.views.map((view) => view.name)).toEqual([
        "总览",
        "异常",
        "今日队列",
        "Agent 视图",
      ]);
      expect(payload.projectionLayer.feishu.rows.length).toBe(payload.taskSnapshot.total);
      expect(payload.projectionLayer.summary.text).toContain("Task Control 每日健康报告");
    });
  });

  it("writes and sends the Jarvis summary without requiring a scheduler", async () => {
    await withTaskCommandStateDir(async () => {
      const now = Date.UTC(2026, 3, 10, 6, 0, 0);
      vi.useFakeTimers();
      vi.setSystemTime(now - 10 * 60_000);
      createRunningTaskRun({
        runtime: "cli",
        ownerKey: "agent:agent_jarvis:main",
        scopeKind: "session",
        runId: "task-summary-running",
        task: "Prepare daily health summary",
      });

      await withTempDir({ prefix: "openclaw-task-summary-" }, async (root) => {
        const summaryPath = path.join(root, "task_health.md");
        const runtime = createRuntime();
        sendMessageFeishuMock.mockResolvedValue({
          messageId: "om_summary",
          chatId: "oc_group_1",
        });

        await tasksControlCommand(
          {
            writeSummary: summaryPath,
            sendFeishuSummary: true,
            summaryTarget: "chat:oc_group_1",
            summaryAccount: "jarvis",
          },
          runtime,
        );

        const written = await fs.readFile(summaryPath, "utf8");
        expect(written).toContain("# Task Control 每日健康报告");
        expect(written).toContain("生成时间：");
        expect(written).toContain("总体：");
        expect(sendMessageFeishuMock).toHaveBeenCalledWith(
          expect.objectContaining({
            accountId: "jarvis",
            to: "chat:oc_group_1",
            text: expect.stringContaining("Task Control 每日健康报告"),
          }),
        );
      });
    });
  });

  it("emits inventory JSON and writes inventory files when requested", async () => {
    await withTaskCommandStateDir(async () => {
      await withTempDir({ prefix: "openclaw-task-inventory-" }, async (root) => {
        const inventoryDir = path.join(root, "inventory");
        const runtime = createRuntime();

        await tasksControlCommand(
          {
            json: true,
            inventory: true,
            writeInventory: inventoryDir,
          },
          runtime,
        );

        const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
          inventory: {
            workspaceInventory: { total: number };
            cronInventory: { total: number };
            pathInventory: { total: number };
            providerInventory: { entries: unknown[] };
          };
          inventoryFiles: {
            rootDir: string;
            files: Record<string, string>;
          };
        };

        expect(payload.inventory.workspaceInventory.total).toBeGreaterThanOrEqual(0);
        expect(payload.inventory.cronInventory.total).toBeGreaterThanOrEqual(0);
        expect(payload.inventory.pathInventory.total).toBeGreaterThanOrEqual(0);
        expect(payload.inventory.providerInventory.entries).toBeDefined();
        expect(payload.inventoryFiles.rootDir).toBe(inventoryDir);
        await expect(
          fs.readFile(payload.inventoryFiles.files.workspaces, "utf8"),
        ).resolves.toContain('"entries":');
      });
    });
  });

  it("previews cron path repair through tasks control", async () => {
    await withTaskCommandStateDir(async () => {
      const runtime = createRuntime();

      await tasksControlCommand(
        {
          json: true,
          previewCronPathRepair: true,
        },
        runtime,
      );

      const payload = JSON.parse(String(vi.mocked(runtime.log).mock.calls[0]?.[0])) as {
        cronPathRepair: {
          applied: boolean;
          changedJobs: number;
          totalJobs: number;
        };
      };

      expect(payload.cronPathRepair.applied).toBe(false);
      expect(payload.cronPathRepair.totalJobs).toBeGreaterThanOrEqual(0);
    });
  });
});
