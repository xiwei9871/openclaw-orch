import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createFeishuBitableClient } from "../extensions/feishu/api.js";
import { readBestEffortConfig } from "../src/config/config.js";
import type { OpenClawConfig } from "../src/config/config.js";
import { resolveConfiguredSecretInputString } from "../src/gateway/resolve-configured-secret-input-string.js";
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
  loadConfig?: () => OpenClawConfig | Promise<OpenClawConfig>;
  resolveSecrets?: (params: {
    cfg: OpenClawConfig;
    accountId?: string;
    env: NodeJS.ProcessEnv;
  }) => Promise<OpenClawConfig>;
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

async function defaultLoadConfig(): Promise<OpenClawConfig> {
  // The live openclaw.json is written by the running gateway and may carry
  // keys newer than this repo's schema (strict loadConfig() would throw
  // INVALID_CONFIG). The scheduler sync only needs channels.feishu plus the
  // secrets provider definitions, so a best-effort read is sufficient.
  return await readBestEffortConfig();
}

type FeishuChannelConfig = {
  defaultAccount?: string;
  appId?: unknown;
  appSecret?: unknown;
  accounts?: Record<string, { appId?: unknown; appSecret?: unknown } | undefined>;
};

function selectFeishuAccountId(feishu: FeishuChannelConfig, requested?: string): string {
  if (requested?.trim()) {
    return requested.trim();
  }
  const preferred = feishu.defaultAccount?.trim();
  if (preferred) {
    return preferred;
  }
  const ids = Object.keys(feishu.accounts ?? {});
  return (ids.includes("default") ? "default" : ids[0]) ?? "default";
}

export async function resolveSchedulerConfigSecrets(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  env: NodeJS.ProcessEnv;
}): Promise<OpenClawConfig> {
  // Resolve the selected Feishu account's SecretRef credentials in memory.
  // Secrets never touch disk, logs, or the result payload.
  const resolved = structuredClone(params.cfg);
  const feishu = (resolved.channels as { feishu?: FeishuChannelConfig } | undefined)?.feishu;
  if (!feishu) {
    return resolved;
  }
  const accountId = selectFeishuAccountId(feishu, params.accountId);
  const scopes: Array<[{ appId?: unknown; appSecret?: unknown }, string]> = [
    [feishu, "channels.feishu"],
  ];
  const account = feishu.accounts?.[accountId];
  if (account) {
    scopes.push([account, `channels.feishu.accounts.${accountId}`]);
  }
  for (const [scope, base] of scopes) {
    for (const key of ["appId", "appSecret"] as const) {
      const current = scope[key];
      if (current === undefined) {
        continue;
      }
      const path = `${base}.${key}`;
      const { value, unresolvedRefReason } = await resolveConfiguredSecretInputString({
        config: params.cfg,
        env: params.env,
        value: current,
        path,
      });
      if (unresolvedRefReason || value === undefined) {
        throw new Error(unresolvedRefReason ?? `${path} SecretRef resolved to no value.`);
      }
      scope[key] = value;
    }
  }
  return resolved;
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
    const cfg = await (deps.loadConfig ?? defaultLoadConfig)();
    const resolvedCfg = await (deps.resolveSecrets ?? resolveSchedulerConfigSecrets)({
      cfg,
      accountId: options.accountId?.trim() || undefined,
      env,
    });
    const client = (deps.createClient ?? createFeishuBitableClient)({
      cfg: resolvedCfg,
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
