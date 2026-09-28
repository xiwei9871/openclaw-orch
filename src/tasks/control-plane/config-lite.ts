import fs from "node:fs/promises";
import { parseConfigJson5, resolveConfigPath, resolveStateDir } from "../../config/config.js";

export type TaskControlConfigLite = {
  defaultWorkspace?: string;
  agentWorkspaces: Array<{ agentId: string; workspace?: string }>;
  cronStorePath?: string;
  configuredProviders: string[];
  feishuDefaultAccount?: string;
  feishuTaskBoard?: {
    enabled?: boolean;
    accountId?: string;
    appToken?: string;
    tableId?: string;
    summarySessionKey?: string;
    summaryChatId?: string;
  };
  providerRefs: {
    defaultPrimary?: string;
    defaultFallbacks: string[];
    agents: Array<{ agentId: string; primary?: string; fallbacks: string[] }>;
  };
};

export type ReadTaskControlConfigLiteResult = {
  ok: boolean;
  config?: TaskControlConfigLite;
  error?: string;
  path: string;
};

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => normalizeOptional(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readModelRouting(model: unknown): { primary?: string; fallbacks: string[] } {
  if (typeof model === "string") {
    return { primary: normalizeOptional(model), fallbacks: [] };
  }
  const record = asRecord(model);
  if (!record) {
    return { fallbacks: [] };
  }
  return {
    ...(normalizeOptional(record.primary) ? { primary: normalizeOptional(record.primary) } : {}),
    fallbacks: readStringArray(record.fallbacks),
  };
}

function describeLiteReadError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message);
  }
  return String(error);
}

export function buildTaskControlConfigLite(raw: unknown): TaskControlConfigLite {
  const root = asRecord(raw) ?? {};
  const agents = asRecord(root.agents);
  const agentDefaults = asRecord(agents?.defaults);
  const agentList = asArray(agents?.list)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const cron = asRecord(root.cron);
  const models = asRecord(root.models);
  const providers = asRecord(models?.providers);
  const channels = asRecord(root.channels);
  const feishu = asRecord(channels?.feishu);
  const taskBoard = asRecord(feishu?.taskBoard);
  const defaultRouting = readModelRouting(agentDefaults?.model);

  return {
    ...(normalizeOptional(agentDefaults?.workspace)
      ? { defaultWorkspace: normalizeOptional(agentDefaults?.workspace) }
      : {}),
    agentWorkspaces: agentList.map((entry) => ({
      agentId: normalizeOptional(entry.id) ?? "default",
      ...(normalizeOptional(entry.workspace)
        ? { workspace: normalizeOptional(entry.workspace) }
        : {}),
    })),
    ...(normalizeOptional(cron?.store) ? { cronStorePath: normalizeOptional(cron?.store) } : {}),
    configuredProviders: Object.keys(providers ?? {}).toSorted(),
    ...(normalizeOptional(feishu?.defaultAccount)
      ? { feishuDefaultAccount: normalizeOptional(feishu?.defaultAccount) }
      : {}),
    ...(taskBoard
      ? {
          feishuTaskBoard: {
            ...(typeof taskBoard.enabled === "boolean" ? { enabled: taskBoard.enabled } : {}),
            ...(normalizeOptional(taskBoard.accountId)
              ? { accountId: normalizeOptional(taskBoard.accountId) }
              : {}),
            ...(normalizeOptional(taskBoard.appToken)
              ? { appToken: normalizeOptional(taskBoard.appToken) }
              : {}),
            ...(normalizeOptional(taskBoard.tableId)
              ? { tableId: normalizeOptional(taskBoard.tableId) }
              : {}),
            ...(normalizeOptional(taskBoard.summarySessionKey)
              ? { summarySessionKey: normalizeOptional(taskBoard.summarySessionKey) }
              : {}),
            ...(normalizeOptional(taskBoard.summaryChatId)
              ? { summaryChatId: normalizeOptional(taskBoard.summaryChatId) }
              : {}),
          },
        }
      : {}),
    providerRefs: {
      ...(defaultRouting.primary ? { defaultPrimary: defaultRouting.primary } : {}),
      defaultFallbacks: defaultRouting.fallbacks,
      agents: agentList.map((entry) => {
        const routing = readModelRouting(entry.model);
        return {
          agentId: normalizeOptional(entry.id) ?? "default",
          ...(routing.primary ? { primary: routing.primary } : {}),
          fallbacks: routing.fallbacks,
        };
      }),
    },
  };
}

export async function readTaskControlConfigLite(
  options: {
    env?: NodeJS.ProcessEnv;
    stateDir?: string;
  } = {},
): Promise<ReadTaskControlConfigLiteResult> {
  const env = options.env ?? process.env;
  const stateDir = options.stateDir ?? resolveStateDir(env);
  const configPath = resolveConfigPath(env, stateDir);
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = parseConfigJson5(raw);
    if (!parsed.ok) {
      return {
        ok: false,
        error: `config-lite parse failed at ${configPath}: ${describeLiteReadError(parsed.error)}`,
        path: configPath,
      };
    }
    return {
      ok: true,
      config: buildTaskControlConfigLite(parsed.parsed),
      path: configPath,
    };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") {
      return {
        ok: true,
        config: buildTaskControlConfigLite({}),
        path: configPath,
      };
    }
    return {
      ok: false,
      error: `config-lite read failed at ${configPath}: ${String(error)}`,
      path: configPath,
    };
  }
}
