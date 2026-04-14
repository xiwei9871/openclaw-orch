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
      expect(inventory.cronInventory.total).toBe(1);
      expect(inventory.cronInventory.entries[0]).toMatchObject({
        id: "job-1",
        scheduleKind: "cron",
        model: "openai-codex/gpt-5.4",
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
        referencedByCron: 1,
      });
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
