import fs from "node:fs/promises";
import path from "node:path";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import type { OpenClawConfig } from "../../config/types.js";
import { loadCronStore, resolveCronStorePath } from "../../cron/store.js";
import type { CronJob, CronStoreFile } from "../../cron/types.js";
import { resolveHomeRelativePath, resolveRequiredHomeDir } from "../../infra/home-dir.js";
import type {
  CronInventory,
  CronInventoryEntry,
  PathInventory,
  PathInventoryCategory,
  PathInventoryEntry,
  ProviderInventory,
  ProviderInventoryEntry,
  TaskControlInventory,
  WorkspaceInventory,
  WorkspaceInventoryEntry,
} from "./types.js";

type BuildTaskControlInventoryOptions = {
  now?: number;
  cfg?: OpenClawConfig;
  cronStore?: CronStoreFile;
  stateDir?: string;
};

type WriteTaskControlInventoryResult = {
  rootDir: string;
  files: {
    workspaces: string;
    cronJobs: string;
    pathReferences: string;
    providerRoutes: string;
  };
};

const PATH_REFERENCE_REGEX =
  /(?:\/home\/node[^\s`"',)]+|~\/\.openclaw[^\s`"',)]*|\/Users\/[^\s`"',)]*(?:\.openclaw|workspace)[^\s`"',)]*)/g;

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function extractProviderId(modelRef: string | undefined): string | undefined {
  const normalized = normalizeOptional(modelRef);
  if (!normalized) {
    return undefined;
  }
  const slashIndex = normalized.indexOf("/");
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized;
}

function resolveModelRouting(
  model:
    | string
    | {
        primary?: string;
        fallbacks?: string[];
      }
    | undefined,
): { primary?: string; fallbacks: string[] } {
  if (typeof model === "string") {
    return { primary: normalizeOptional(model), fallbacks: [] };
  }
  return {
    ...(normalizeOptional(model?.primary) ? { primary: normalizeOptional(model?.primary) } : {}),
    fallbacks: [...(model?.fallbacks ?? [])],
  };
}

function extractPathReferencesFromText(text: string): string[] {
  return [...new Set(text.match(PATH_REFERENCE_REGEX) ?? [])];
}

function classifyPath(rawPath: string): PathInventoryCategory {
  if (rawPath.includes("/home/node")) {
    return "legacy_home_node";
  }
  if (rawPath.includes("/reports/")) {
    return "report";
  }
  if (rawPath.includes("/scripts/") || rawPath.endsWith(".sh") || rawPath.endsWith(".ts")) {
    return "script";
  }
  if (rawPath.includes("workspace")) {
    return "workspace";
  }
  if (rawPath.includes(".openclaw")) {
    return "openclaw_home";
  }
  return "other";
}

async function pathExists(pathname: string): Promise<boolean | null> {
  if (!pathname.startsWith("/")) {
    return null;
  }
  try {
    await fs.stat(pathname);
    return true;
  } catch {
    return false;
  }
}

function normalizeInventoryPath(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const expanded = input.startsWith("~")
    ? resolveHomeRelativePath(input, { env })
    : input.startsWith("/")
      ? path.resolve(input)
      : path.resolve(input);
  return expanded;
}

function collectConfigStringEntries(
  value: unknown,
  currentPath = "",
): Array<{ field: string; value: string }> {
  if (typeof value === "string") {
    return [{ field: currentPath || "root", value }];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectConfigStringEntries(entry, currentPath ? `${currentPath}.${index}` : String(index)),
    );
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
    collectConfigStringEntries(entry, currentPath ? `${currentPath}.${key}` : key),
  );
}

function isInterestingConfigPathValue(value: string): boolean {
  if (/^https?:\/\//i.test(value)) {
    return false;
  }
  return (
    value.includes(".openclaw") ||
    value.includes("/home/node") ||
    value.includes("workspace") ||
    value.startsWith("~/") ||
    value.startsWith("/")
  );
}

function collectCronPathReferences(job: CronJob): string[] {
  const payload = job.payload;
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if ("text" in payload && typeof payload.text === "string") {
    return extractPathReferencesFromText(payload.text);
  }
  if ("message" in payload && typeof payload.message === "string") {
    return extractPathReferencesFromText(payload.message);
  }
  return [];
}

function resolveWorkspaceEntries(params: {
  cfg: OpenClawConfig;
  cronStore: CronStoreFile;
  now: number;
  discoveredPaths: string[];
}): WorkspaceInventory {
  const { cfg, cronStore, now } = params;
  const workspaceMap = new Map<string, WorkspaceInventoryEntry>();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const defaultWorkspace = resolveAgentWorkspaceDir(cfg, defaultAgentId);

  const ensureWorkspace = (workspacePath: string): WorkspaceInventoryEntry => {
    const normalizedPath = path.resolve(workspacePath);
    const existing = workspaceMap.get(normalizedPath) ?? {
      path: workspacePath,
      normalizedPath,
      exists: false,
      isPrimary: false,
      primaryMarker: false,
      configuredDefault: false,
      configuredAgents: [],
      referencedByCronIds: [],
    };
    workspaceMap.set(normalizedPath, existing);
    return existing;
  };

  if (defaultWorkspace) {
    const entry = ensureWorkspace(defaultWorkspace);
    entry.configuredDefault = true;
  }

  for (const agentId of listAgentIds(cfg)) {
    const workspacePath = resolveAgentWorkspaceDir(cfg, agentId);
    if (!workspacePath) {
      continue;
    }
    const entry = ensureWorkspace(workspacePath);
    if (!entry.configuredAgents.includes(agentId)) {
      entry.configuredAgents.push(agentId);
    }
  }

  for (const discovered of params.discoveredPaths.filter((pathname) =>
    pathname.includes("workspace"),
  )) {
    ensureWorkspace(discovered);
  }

  for (const job of cronStore.jobs) {
    for (const ref of collectCronPathReferences(job)) {
      if (!ref.includes("workspace")) {
        continue;
      }
      const entry = ensureWorkspace(normalizeInventoryPath(ref));
      if (!entry.referencedByCronIds.includes(job.id)) {
        entry.referencedByCronIds.push(job.id);
      }
    }
  }

  return {
    generatedAt: now,
    ...(defaultWorkspace ? { primaryWorkspace: path.resolve(defaultWorkspace) } : {}),
    total: workspaceMap.size,
    entries: [...workspaceMap.values()]
      .map((entry) => ({
        ...entry,
        configuredAgents: [...entry.configuredAgents].toSorted(),
        referencedByCronIds: [...entry.referencedByCronIds].toSorted(),
      }))
      .toSorted((left, right) => left.normalizedPath.localeCompare(right.normalizedPath)),
  };
}

function buildCronInventory(cronStore: CronStoreFile, now: number): CronInventory {
  const entries: CronInventoryEntry[] = cronStore.jobs.map((job) => {
    const payload = job.payload;
    const payloadKind = payload?.kind;
    const model = payloadKind === "agentTurn" ? payload.model : undefined;
    const fallbacks = payloadKind === "agentTurn" ? [...(payload.fallbacks ?? [])] : [];
    return {
      id: job.id,
      name: job.name,
      enabled: job.enabled,
      ...(job.agentId ? { agentId: job.agentId } : {}),
      ...(job.sessionKey ? { sessionKey: job.sessionKey } : {}),
      ...(job.sessionTarget ? { sessionTarget: job.sessionTarget } : {}),
      ...(job.wakeMode ? { wakeMode: job.wakeMode } : {}),
      scheduleKind: job.schedule.kind,
      ...(payloadKind ? { payloadKind } : {}),
      ...(model ? { model } : {}),
      fallbacks,
      ...(typeof job.state.nextRunAtMs === "number" ? { nextRunAtMs: job.state.nextRunAtMs } : {}),
      ...(typeof job.state.lastRunAtMs === "number" ? { lastRunAtMs: job.state.lastRunAtMs } : {}),
      ...(job.state.lastStatus ? { lastStatus: job.state.lastStatus } : {}),
      consecutiveErrors: job.state.consecutiveErrors ?? 0,
      ...(job.state.lastError ? { lastError: job.state.lastError } : {}),
      pathReferences: collectCronPathReferences(job),
    };
  });

  return {
    generatedAt: now,
    total: entries.length,
    enabled: entries.filter((entry) => entry.enabled).length,
    disabled: entries.filter((entry) => !entry.enabled).length,
    entries: entries.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

async function buildPathInventory(params: {
  cfg: OpenClawConfig;
  cronStore: CronStoreFile;
  now: number;
}): Promise<PathInventory> {
  const entries = new Map<string, PathInventoryEntry>();
  const homeDir = resolveRequiredHomeDir();

  const addEntry = async (
    source: "config" | "cron",
    owner: string,
    field: string,
    rawPath: string,
  ) => {
    const normalizedPath = normalizeInventoryPath(rawPath, process.env);
    const key = [source, owner, field, normalizedPath].join("\u0000");
    if (entries.has(key)) {
      return;
    }
    entries.set(key, {
      rawPath,
      normalizedPath,
      source,
      owner,
      field,
      category: classifyPath(rawPath),
      exists:
        normalizedPath.startsWith(homeDir) || normalizedPath.startsWith("/home/node")
          ? await pathExists(normalizedPath)
          : null,
    });
  };

  for (const entry of collectConfigStringEntries(params.cfg)) {
    if (!isInterestingConfigPathValue(entry.value)) {
      continue;
    }
    await addEntry("config", "config", entry.field, entry.value);
  }

  for (const job of params.cronStore.jobs) {
    for (const ref of collectCronPathReferences(job)) {
      await addEntry("cron", job.id, "payload", ref);
    }
  }

  const byCategory: Record<PathInventoryCategory, number> = {
    legacy_home_node: 0,
    openclaw_home: 0,
    workspace: 0,
    report: 0,
    script: 0,
    other: 0,
  };

  for (const entry of entries.values()) {
    byCategory[entry.category] += 1;
  }

  return {
    generatedAt: params.now,
    total: entries.size,
    entries: [...entries.values()].toSorted((left, right) =>
      left.normalizedPath.localeCompare(right.normalizedPath),
    ),
    byCategory,
  };
}

function buildProviderInventory(params: {
  cfg: OpenClawConfig;
  cronStore: CronStoreFile;
  now: number;
}): ProviderInventory {
  const configuredProviders = Object.keys(params.cfg.models?.providers ?? {}).toSorted();
  const defaultModelRouting = resolveModelRouting(params.cfg.agents?.defaults?.model);
  const defaultPrimary = defaultModelRouting.primary;
  const defaultFallbacks = defaultModelRouting.fallbacks;
  const agentModels = listAgentIds(params.cfg).map((agentId) => {
    const agent = (params.cfg.agents?.list ?? []).find((entry) => entry?.id === agentId);
    const routing = resolveModelRouting(agent?.model);
    return {
      agentId,
      ...(routing.primary ? { primary: routing.primary } : {}),
      fallbacks: routing.fallbacks,
    };
  });
  const cronModels = params.cronStore.jobs
    .filter((job) => job.payload.kind === "agentTurn")
    .map((job) => {
      const payload = job.payload;
      if (payload.kind !== "agentTurn") {
        return {
          cronId: job.id,
          name: job.name,
          fallbacks: [] as string[],
        };
      }
      return {
        cronId: job.id,
        name: job.name,
        ...(normalizeOptional(payload.model) ? { model: normalizeOptional(payload.model) } : {}),
        fallbacks: [...(payload.fallbacks ?? [])],
      };
    });

  const providerCounts = new Map<string, ProviderInventoryEntry>();
  const ensureProvider = (provider: string): ProviderInventoryEntry => {
    const existing = providerCounts.get(provider) ?? {
      provider,
      configured: configuredProviders.includes(provider),
      referencedByDefault: provider === extractProviderId(defaultPrimary),
      referencedByAgents: 0,
      referencedByCron: 0,
    };
    providerCounts.set(provider, existing);
    return existing;
  };

  for (const provider of configuredProviders) {
    ensureProvider(provider);
  }
  for (const fallback of defaultFallbacks) {
    const provider = extractProviderId(fallback);
    if (!provider) {
      continue;
    }
    ensureProvider(provider).referencedByDefault = true;
  }
  for (const agent of agentModels) {
    const refs = [agent.primary, ...agent.fallbacks];
    for (const ref of refs) {
      const provider = extractProviderId(ref);
      if (!provider) {
        continue;
      }
      ensureProvider(provider).referencedByAgents += 1;
    }
  }
  for (const cron of cronModels) {
    const refs = [cron.model, ...cron.fallbacks];
    for (const ref of refs) {
      const provider = extractProviderId(ref);
      if (!provider) {
        continue;
      }
      ensureProvider(provider).referencedByCron += 1;
    }
  }

  return {
    generatedAt: params.now,
    configuredProviders,
    ...(defaultPrimary ? { defaultPrimary } : {}),
    defaultFallbacks,
    agentModels,
    cronModels,
    entries: [...providerCounts.values()].toSorted((left, right) =>
      left.provider.localeCompare(right.provider),
    ),
  };
}

export async function buildTaskControlInventory(
  options: BuildTaskControlInventoryOptions = {},
): Promise<TaskControlInventory> {
  const now = options.now ?? Date.now();
  const cfg = options.cfg ?? loadConfig();
  const cronStore =
    options.cronStore ??
    (await loadCronStore(
      resolveCronStorePath((cfg.cron as { store?: string } | undefined)?.store),
    ));

  const discoveredPaths = [
    ...collectConfigStringEntries(cfg)
      .map((entry) => entry.value)
      .filter(isInterestingConfigPathValue)
      .map((value) => normalizeInventoryPath(value)),
    ...cronStore.jobs.flatMap((job) =>
      collectCronPathReferences(job).map((value) => normalizeInventoryPath(value)),
    ),
  ];

  const workspaceInventory = resolveWorkspaceEntries({
    cfg,
    cronStore,
    now,
    discoveredPaths,
  });
  const pathInventory = await buildPathInventory({ cfg, cronStore, now });
  const cronInventory = buildCronInventory(cronStore, now);
  const providerInventory = buildProviderInventory({ cfg, cronStore, now });

  const workspaceEntries = await Promise.all(
    workspaceInventory.entries.map(async (entry) => {
      const primaryMarker = await pathExists(path.join(entry.normalizedPath, ".PRIMARY_WORKSPACE"));
      return {
        ...entry,
        exists: (await pathExists(entry.normalizedPath)) === true,
        primaryMarker: primaryMarker === true,
        isPrimary: primaryMarker === true || entry.configuredDefault,
      };
    }),
  );

  return {
    generatedAt: now,
    workspaceInventory: {
      ...workspaceInventory,
      entries: workspaceEntries,
      ...(workspaceEntries.find((entry) => entry.isPrimary)
        ? { primaryWorkspace: workspaceEntries.find((entry) => entry.isPrimary)?.normalizedPath }
        : {}),
    },
    cronInventory,
    pathInventory,
    providerInventory,
  };
}

export async function writeTaskControlInventory(
  inventory: TaskControlInventory,
  outputDir: string,
): Promise<WriteTaskControlInventoryResult> {
  const rootDir = path.resolve(outputDir);
  await fs.mkdir(rootDir, { recursive: true });
  const files = {
    workspaces: path.join(rootDir, "workspaces.json"),
    cronJobs: path.join(rootDir, "cron_jobs.json"),
    pathReferences: path.join(rootDir, "path_references.json"),
    providerRoutes: path.join(rootDir, "provider_routes.json"),
  };
  await fs.writeFile(
    files.workspaces,
    JSON.stringify(inventory.workspaceInventory, null, 2),
    "utf8",
  );
  await fs.writeFile(files.cronJobs, JSON.stringify(inventory.cronInventory, null, 2), "utf8");
  await fs.writeFile(
    files.pathReferences,
    JSON.stringify(inventory.pathInventory, null, 2),
    "utf8",
  );
  await fs.writeFile(
    files.providerRoutes,
    JSON.stringify(inventory.providerInventory, null, 2),
    "utf8",
  );
  return { rootDir, files };
}
