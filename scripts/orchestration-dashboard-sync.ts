import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFeishuBitableClient } from "../extensions/feishu/api.js";
import { loadConfig } from "../src/config/config.js";
import type { OpenClawConfig } from "../src/config/config.js";
import {
  syncBitableProjectionToFeishu,
  type FeishuBitableSyncResult,
  type FeishuBitableSyncTarget,
} from "../src/tasks/feishu-bitable-sync.js";
import {
  buildSchedulerProjection,
  parseCronJobListOutput,
} from "../src/tasks/scheduler-projection.js";

type RunnerOptions = {
  dryRun: boolean;
  appToken?: string;
  tableId?: string;
  accountId?: string;
  openclawBin: string;
  resultPath?: string;
};

export type SchedulerSyncDeps = {
  readCronOutput?: (openclawBin: string) => string;
  loadConfig?: () => OpenClawConfig;
  syncProjection?: (params: {
    projection: ReturnType<typeof buildSchedulerProjection>;
    target: FeishuBitableSyncTarget;
    client: import("../src/tasks/feishu-bitable-sync.js").FeishuBitableClient;
  }) => Promise<Pick<FeishuBitableSyncResult, "accountId">>;
  createClient?: (params: {
    cfg: OpenClawConfig;
    accountId?: string;
  }) => import("../src/tasks/feishu-bitable-sync.js").FeishuBitableClient;
  writeOutput?: (payload: string, resultPath?: string) => void;
  now?: () => number;
  log?: (message: string) => void;
  error?: (message: string) => void;
};

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseOptions(argv: string[], env: NodeJS.ProcessEnv): RunnerOptions {
  return {
    dryRun: argv.includes("--dry-run") || env.ORCH_DASHBOARD_SYNC_DRY_RUN === "1",
    appToken: readOption(argv, "--app-token") ?? env.ORCH_DASHBOARD_SYNC_APP_TOKEN,
    tableId: readOption(argv, "--table-id") ?? env.ORCH_DASHBOARD_SYNC_TABLE_ID,
    accountId: readOption(argv, "--account") ?? env.ORCH_DASHBOARD_SYNC_ACCOUNT,
    openclawBin:
      readOption(argv, "--openclaw-bin") ?? env.ORCH_DASHBOARD_SYNC_OPENCLAW_BIN ?? "openclaw",
    resultPath: readOption(argv, "--result-path") ?? env.ORCH_DASHBOARD_SYNC_RESULT_PATH,
  };
}

function defaultReadCronOutput(openclawBin: string): string {
  return execFileSync(openclawBin, ["cron", "list", "--all", "--json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function defaultWriteOutput(payload: string, resultPath?: string): void {
  if (!resultPath) {
    return;
  }
  const outputPath = path.resolve(resultPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${payload}\n`, "utf8");
}

export async function main(
  argv = process.argv.slice(2),
  deps: SchedulerSyncDeps = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const log = deps.log ?? console.log;
  const error = deps.error ?? console.error;
  try {
    const options = parseOptions(argv, env);
    const appToken = options.appToken?.trim();
    const tableId = options.tableId?.trim();
    if (!options.dryRun && (!appToken || !tableId)) {
      throw new Error("app token and table id are required for a live sync");
    }
    const raw = (deps.readCronOutput ?? defaultReadCronOutput)(options.openclawBin);
    const jobs = parseCronJobListOutput(raw);
    const projection = buildSchedulerProjection(jobs, deps.now?.() ?? Date.now());

    if (options.dryRun) {
      const output = JSON.stringify({ ok: true, dryRun: true, rowCount: projection.rows.length });
      (deps.writeOutput ?? defaultWriteOutput)(output, options.resultPath);
      log(output);
      return 0;
    }

    if (!appToken || !tableId) {
      throw new Error("app token and table id are required for a live sync");
    }
    const cfg = (deps.loadConfig ?? loadConfig)();
    const client = (deps.createClient ?? createFeishuBitableClient)({
      cfg,
      accountId: options.accountId?.trim() || undefined,
    });
    const result = await (deps.syncProjection ?? syncBitableProjectionToFeishu)({
      projection,
      target: {
        appToken,
        tableId,
        accountId: options.accountId?.trim() || undefined,
        rowKeyFieldName: "对象ID",
      },
      client,
    });
    const output = JSON.stringify({
      ok: true,
      dryRun: false,
      accountId: result.accountId,
      rowCount: projection.rows.length,
      result,
    });
    (deps.writeOutput ?? defaultWriteOutput)(output, options.resultPath);
    log(output);
    return 0;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    error(message);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
