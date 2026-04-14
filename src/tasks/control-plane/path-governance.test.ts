import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CronStoreFile } from "../../cron/types.js";
import { withTempDir } from "../../test-helpers/temp-dir.js";
import {
  applyCronPathRepair,
  buildCronPathRepairReport,
  normalizeOpenClawPathReferences,
} from "./path-governance.js";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

describe("task control path governance", () => {
  afterEach(() => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = ORIGINAL_HOME;
    }
    if (ORIGINAL_STATE_DIR === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
    }
  });

  it("normalizes legacy and host-specific OpenClaw home prefixes", () => {
    process.env.HOME = "/Users/xiwei";
    process.env.OPENCLAW_STATE_DIR = "/Users/xiwei/.openclaw";

    expect(
      normalizeOpenClawPathReferences(
        "read /home/node/.openclaw/workspace-feishu/FOUNDER_OS.md then write /Users/xiwei/.openclaw/shared/reports/x.md",
      ),
    ).toBe(
      "read ~/.openclaw/workspace-feishu/FOUNDER_OS.md then write ~/.openclaw/shared/reports/x.md",
    );
  });

  it("builds a preview report for cron path repairs", async () => {
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
            message:
              "读取 /home/node/.openclaw/workspace-feishu/FOUNDER_OS.md 并写入 /Users/xiwei/.openclaw/shared/reports/out.md",
          },
          delivery: { mode: "none" },
          state: {},
        },
      ],
    };

    process.env.HOME = "/Users/xiwei";
    process.env.OPENCLAW_STATE_DIR = "/Users/xiwei/.openclaw";

    const report = await buildCronPathRepairReport({
      cfg: {} as never,
      cronStore,
      storePath: "/tmp/jobs.json",
    });

    expect(report.applied).toBe(false);
    expect(report.changedJobs).toBe(1);
    expect(report.entries[0]?.fields).toEqual([
      {
        field: "payload.message",
        before:
          "读取 /home/node/.openclaw/workspace-feishu/FOUNDER_OS.md 并写入 /Users/xiwei/.openclaw/shared/reports/out.md",
        after:
          "读取 ~/.openclaw/workspace-feishu/FOUNDER_OS.md 并写入 ~/.openclaw/shared/reports/out.md",
      },
    ]);
  });

  it("applies cron path repairs to the cron store file", async () => {
    await withTempDir({ prefix: "openclaw-cron-path-repair-" }, async (root) => {
      process.env.HOME = root;
      process.env.OPENCLAW_STATE_DIR = path.join(root, ".openclaw");
      const storePath = path.join(root, "cron", "jobs.json");
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      await fs.writeFile(
        storePath,
        JSON.stringify({
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
                message: "read /home/node/.openclaw/workspace-feishu/FOUNDER_OS.md",
              },
              delivery: { mode: "none" },
              state: {},
            },
          ],
        }),
        "utf8",
      );

      const reportWithCfg = await applyCronPathRepair({ storePath, cfg: {} as never });
      const saved = JSON.parse(await fs.readFile(storePath, "utf8")) as CronStoreFile;

      expect(reportWithCfg.applied).toBe(true);
      expect(reportWithCfg.changedJobs).toBe(1);
      expect(saved.jobs[0]?.payload).toMatchObject({
        kind: "agentTurn",
        message: "read ~/.openclaw/workspace-feishu/FOUNDER_OS.md",
      });
    });
  });
});
