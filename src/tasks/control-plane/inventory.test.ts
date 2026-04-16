import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.js";
import type { CronStoreFile } from "../../cron/types.js";
import { withTempDir } from "../../test-helpers/temp-dir.js";
import { buildTaskControlInventory, writeTaskControlInventory } from "./inventory.js";

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

describe("task control inventory", () => {
  afterEach(() => {
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
  });

  it("builds workspace, cron, path, and provider inventories from config and cron data", async () => {
    await withTempDir({ prefix: "openclaw-inventory-" }, async (root) => {
      process.env.OPENCLAW_STATE_DIR = root;
      await fs.mkdir(path.join(root, "workspace-feishu"), { recursive: true });
      await fs.writeFile(path.join(root, "workspace-feishu", ".PRIMARY_WORKSPACE"), "", "utf8");
      await fs.mkdir(path.join(root, "workspace-legacy"), { recursive: true });

      const cfg = {
        agents: {
          defaults: {
            workspace: path.join(root, "workspace-feishu"),
            model: {
              primary: "openai-codex/gpt-5.4",
              fallbacks: ["deepseek/chat"],
            },
          },
          list: [
            { id: "jarvis", workspace: path.join(root, "workspace-feishu") },
            {
              id: "athena",
              workspace: path.join(root, "workspace-legacy"),
              model: { primary: "bailian/qwen3-max-2026-01-23" },
            },
          ],
        },
        models: {
          providers: {
            "openai-codex": {},
            deepseek: {},
            bailian: {},
          },
        },
        cron: {
          store: path.join(root, "cron", "jobs.json"),
        },
      } as unknown as OpenClawConfig;

      const cronStore: CronStoreFile = {
        version: 1,
        jobs: [
          {
            id: "job-1",
            name: "founder-morning",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: { kind: "cron", expr: "0 8 * * *", tz: "Asia/Shanghai" },
            sessionTarget: "isolated",
            wakeMode: "now",
            agentId: "agent_tui",
            sessionKey: "agent:agent_tui:main",
            payload: {
              kind: "agentTurn",
              message:
                "读取 /home/node/.openclaw/workspace-feishu/FOUNDER_OS.md 并写入 ~/.openclaw/shared/reports/founder_morning_brief.md",
              model: "openai-codex/gpt-5.4",
              fallbacks: ["deepseek/chat"],
            },
            delivery: { mode: "none" },
            state: {
              lastStatus: "error",
              consecutiveErrors: 2,
            },
          },
          {
            id: "job-2",
            name: "founder-evening",
            enabled: true,
            createdAtMs: 2,
            updatedAtMs: 2,
            schedule: { kind: "cron", expr: "0 21 * * *", tz: "Asia/Shanghai" },
            sessionTarget: "isolated",
            wakeMode: "now",
            payload: {
              kind: "agentTurn",
              message: "读取 ~/.openclaw/shared/reports/founder_morning_brief.md",
              model: "bailian/qwen3-max-2026-01-23",
            },
            delivery: { mode: "none" },
            state: {
              lastRunStatus: "ok",
              consecutiveErrors: 0,
            },
          },
          {
            id: "job-3",
            name: "dashboard-sync-legacy",
            enabled: false,
            createdAtMs: 3,
            updatedAtMs: 3,
            schedule: { kind: "cron", expr: "*/10 * * * *", tz: "Asia/Shanghai" },
            sessionTarget: "isolated",
            wakeMode: "now",
            payload: {
              kind: "agentTurn",
              message: "同步 bitable",
              model: "openai-codex/gpt-5.4",
            },
            delivery: { mode: "none" },
            state: {
              lastStatus: "error",
              consecutiveErrors: 95,
              lastError: "Delivering to Feishu requires target <chatId|user:openId|chat:chatId>",
            },
          },
        ],
      };

      const inventory = await buildTaskControlInventory({
        now: Date.UTC(2026, 3, 14, 0, 0, 0),
        cfg,
        cronStore,
        stateDir: root,
      });

      expect(inventory.workspaceInventory.total).toBe(3);
      expect(
        inventory.workspaceInventory.entries.find((entry) => entry.isPrimary)?.normalizedPath,
      ).toBe(path.join(root, "workspace-feishu"));
      expect(inventory.cronInventory.total).toBe(3);
      expect(inventory.cronInventory.summary).toMatchObject({
        enabledHealthy: 1,
        enabledAlerting: 1,
        enabledUnknown: 0,
        disabledHealthy: 0,
        disabledWithHistoricalErrors: 1,
      });
      expect(inventory.cronInventory.entries.find((entry) => entry.id === "job-1")).toMatchObject({
        id: "job-1",
        scheduleKind: "cron",
        model: "openai-codex/gpt-5.4",
        operationalStatus: "alerting",
        historicalErrorOnly: false,
      });
      expect(inventory.cronInventory.entries.find((entry) => entry.id === "job-2")).toMatchObject({
        id: "job-2",
        operationalStatus: "healthy",
        historicalErrorOnly: false,
      });
      expect(inventory.cronInventory.entries.find((entry) => entry.id === "job-3")).toMatchObject({
        id: "job-3",
        operationalStatus: "disabled",
        historicalErrorOnly: true,
      });
      expect(inventory.pathInventory.byCategory.legacy_home_node).toBeGreaterThan(0);
      expect(inventory.pathInventory.byCategory.report).toBeGreaterThan(0);
      expect(inventory.providerInventory.configuredProviders).toEqual([
        "bailian",
        "deepseek",
        "openai-codex",
      ]);
      expect(
        inventory.providerInventory.entries.find((entry) => entry.provider === "openai-codex"),
      ).toMatchObject({
        configured: true,
        referencedByDefault: true,
        referencedByCron: 2,
      });
    });
  });

  it("degrades provider inventory when config-lite parsing fails without blocking pure-read data", async () => {
    await withTempDir({ prefix: "openclaw-inventory-invalid-config-" }, async (root) => {
      process.env.OPENCLAW_STATE_DIR = root;
      await fs.writeFile(path.join(root, "openclaw.json"), "{ invalid json", "utf8");
      const cronStore: CronStoreFile = {
        version: 1,
        jobs: [
          {
            id: "job-1",
            name: "repair-me",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: { kind: "cron", expr: "0 8 * * *", tz: "Asia/Shanghai" },
            sessionTarget: "isolated",
            wakeMode: "now",
            payload: {
              kind: "agentTurn",
              message: "read ~/.openclaw/workspace/FOUNDER_OS.md",
              model: "openai/gpt-5",
            },
            delivery: { mode: "none" },
            state: {},
          },
        ],
      };

      const inventory = await buildTaskControlInventory({
        now: Date.UTC(2026, 3, 14, 0, 0, 0),
        cronStore,
        stateDir: root,
      });

      expect(inventory.workspaceInventory.total).toBeGreaterThanOrEqual(1);
      expect(inventory.cronInventory.total).toBe(1);
      expect(inventory.pathInventory.total).toBeGreaterThanOrEqual(1);
      expect(inventory.inventoryStatus.workspace).toBe("ok");
      expect(inventory.inventoryStatus.cron).toBe("ok");
      expect(inventory.inventoryStatus.path).toBe("ok");
      expect(inventory.inventoryStatus.provider).toBe("degraded");
      expect(inventory.providerInventory.configReadable).toBe(false);
      expect(inventory.providerInventory.providerInventoryDegraded).toBe(true);
      expect(inventory.warnings[0]).toContain("provider inventory degraded");
    });
  });

  it("writes inventory files into the requested directory", async () => {
    await withTempDir({ prefix: "openclaw-inventory-write-" }, async (root) => {
      const inventory = await buildTaskControlInventory({
        now: Date.UTC(2026, 3, 14, 0, 0, 0),
        cfg: {} as OpenClawConfig,
        cronStore: { version: 1, jobs: [] },
        stateDir: root,
      });
      const outputDir = path.join(root, "system_inventory");
      const written = await writeTaskControlInventory(inventory, outputDir);

      expect(written.rootDir).toBe(outputDir);
      await expect(fs.readFile(written.files.workspaces, "utf8")).resolves.toContain('"entries":');
      await expect(fs.readFile(written.files.cronJobs, "utf8")).resolves.toContain('"total"');
      await expect(fs.readFile(written.files.pathReferences, "utf8")).resolves.toContain(
        '"byCategory"',
      );
      await expect(fs.readFile(written.files.providerRoutes, "utf8")).resolves.toContain(
        '"configuredProviders"',
      );
    });
  });
});
