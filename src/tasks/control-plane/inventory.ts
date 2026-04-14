import fs from "node:fs/promises";
import path from "node:path";
import { resolveDefaultAgentWorkspaceDir } from "../../agents/workspace.js";
import type { OpenClawConfig } from "../../config/types.js";
import { loadCronStore, resolveCronStorePath } from "../../cron/store.js";
import type { CronJob, CronStoreFile } from "../../cron/types.js";
import { resolveHomeRelativePath, resolveRequiredHomeDir } from "../../infra/home-dir.js";
import {
  buildTaskControlConfigLite,
  readTaskControlConfigLite,
  type TaskControlConfigLite,
} from "./config-lite.js";
import type {
  CronInventory,
  CronInventoryEntry,
  PathInventory,
  PathInventoryCategory,
  PathInventoryEntry,
  ProviderInventory,
  ProviderInventoryEntry,
  TaskControlInventory,
  TaskControlInventoryStatus,
  WorkspaceInventory,
  WorkspaceInventoryEntry,
} from "./types.js";

type BuildTaskControlInventoryOptions = {
  now?: number;
  cfg?: OpenClawConfig;
  configLite?: TaskControlConfigLite;
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

function collectConfigLitePathEntries(
  configLite: TaskControlConfigLite | undefined,
): Array<{ field: string; value: string }> {
  if (!configLite) {
    return [];
  }
  const entries: Array<{ field: string; value: string }> = [];
  if (configLite.defaultWorkspace) {
    entries.push({ field: "agents.defaults.workspace", value: configLite.defaultWorkspace });
  }
  for (const agent of configLite.agentWorkspaces) {
    if (!agent.workspace) {
      continue;
    }
    entries.push({ field: `agents.list.${agent.agentId}.workspace`, value: agent.workspace });
  }
  if (configLite.cronStorePath) {
    entries.push({ field: "cron.store", value: configLite.cronStorePath });
  }
  return entries;
}

function createEmptyWorkspaceInventory(now: number): WorkspaceInventory {
  return {
    generatedAt: now,
    total: 0,
    entries: [],
  };
}

function createEmptyCronInventory(now: number): CronInventory {
  return {
    generatedAt: now,
    total: 0,
    enabled: 0,
    disabled: 0,
    entries: [],
  };
}

function createEmptyPathInventory(now: number): PathInventory {
  return {
    generatedAt: now,
    total: 0,
    entries: [],
    byCategory: {
      legacy_home_node: 0,
      openclaw_home: 0,
      workspace: 0,
      report: 0,
      script: 0,
      other: 0,
    },
  };
}

function createEmptyProviderInventory(now: number, degraded = false): ProviderInventory {
  return {
    generatedAt: now,
    configReadable: !degraded,
    providerInventoryDegraded: degraded,
    configuredProviders: [],
    defaultFallbacks: [],
    agentModels: [],
    cronModels: [],
    entries: [],
  };
}

function resolveWorkspaceEntries(params: {
  configLite?: TaskControlConfigLite;
  cronStore: CronStoreFile;
  now: number;
  discoveredPaths: string[];
}): WorkspaceInventory {
  const { configLite, cronStore, now } = params;
  const workspaceMap = new Map<string, WorkspaceInventoryEntry>();
  const explicitDefaultWorkspace = configLite?.defaultWorkspace;
  const fallbackWorkspace = resolveDefaultAgentWorkspaceDir();

  const ensureWorkspace = (workspacePath: string): WorkspaceInventoryEntry => {
    const normalizedPath = normalizeInventoryPath(workspacePath);
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

  if (explicitDefaultWorkspace) {
    ensureWorkspace(explicitDefaultWorkspace).configuredDefault = true;
  } else if (fallbackWorkspace) {
    ensureWorkspace(fallbackWorkspace);
  }

  for (const agent of configLite?.agentWorkspaces ?? []) {
    if (!agent.workspace) {
      continue;
    }
    const entry = ensureWorkspace(agent.workspace);
    if (!entry.configuredAgents.includes(agent.agentId)) {
      entry.configuredAgents.push(agent.agentId);
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
      const entry = ensureWorkspace(ref);
      if (!entry.referencedByCronIds.includes(job.id)) {
        entry.referencedByCronIds.push(job.id);
      }
    }
  }

  return {
    generatedAt: now,
    ...(explicitDefaultWorkspace
      ? { primaryWorkspace: normalizeInventoryPath(explicitDefaultWorkspace) }
      : {}),
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
  configLite?: TaskControlConfigLite;
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

  for (const entry of collectConfigLitePathEntries(params.configLite)) {
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
  configLite?: TaskControlConfigLite;
  cronStore: CronStoreFile;
  now: number;
  degraded: boolean;
}): ProviderInventory {
  const configuredProviders = [...(params.configLite?.configuredProviders ?? [])].toSorted();
  const defaultPrimary = params.configLite?.providerRefs.defaultPrimary;
  const defaultFallbacks = [...(params.configLite?.providerRefs.defaultFallbacks ?? [])];
  const agentModels = (params.configLite?.providerRefs.agents ?? []).map((agent) => ({
    agentId: agent.agentId,
    ...(agent.primary ? { primary: agent.primary } : {}),
    fallbacks: [...agent.fallbacks],
  }));
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
    for (const ref of [agent.primary, ...agent.fallbacks]) {
      const provider = extractProviderId(ref);
      if (!provider) {
        continue;
      }
      ensureProvider(provider).referencedByAgents += 1;
    }
  }
  for (const cron of cronModels) {
    for (const ref of [cron.model, ...cron.fallbacks]) {
      const provider = extractProviderId(ref);
      if (!provider) {
        continue;
      }
      ensureProvider(provider).referencedByCron += 1;
    }
  }

  return {
    generatedAt: params.now,
    configReadable: !params.degraded,
    providerInventoryDegraded: params.degraded,
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

async function resolveConfigLiteForInventory(
  options: BuildTaskControlInventoryOptions,
): Promise<{ configLite?: TaskControlConfigLite; warning?: string }> {
  if (options.configLite) {
    return { configLite: options.configLite };
  }
  if (options.cfg) {
    return { configLite: buildTaskControlConfigLite(options.cfg) };
  }
  const configLiteResult = await readTaskControlConfigLite({ stateDir: options.stateDir });
  if (!configLiteResult.ok) {
    return { warning: configLiteResult.error };
  }
  return { configLite: configLiteResult.config };
}

export async function buildTaskControlInventory(
  options: BuildTaskControlInventoryOptions = {},
): Promise<TaskControlInventory> {
  const now = options.now ?? Date.now();
  const warnings: string[] = [];
  const inventoryStatus: Record<
    keyof TaskControlInventory["inventoryStatus"],
    TaskControlInventoryStatus
  > = {
    workspace: "ok",
    cron: "ok",
    path: "ok",
    provider: "ok",
  };

  const { configLite, warning: configWarning } = await resolveConfigLiteForInventory(options);
  if (configWarning) {
    inventoryStatus.provider = "degraded";
    warnings.push(`provider inventory degraded: ${configWarning}`);
  }

  let cronStore = options.cronStore ?? ({ version: 1, jobs: [] } as CronStoreFile);
  if (!options.cronStore) {
    try {
      cronStore = await loadCronStore(resolveCronStorePath(configLite?.cronStorePath));
    } catch (error) {
      inventoryStatus.cron = "degraded";
      warnings.push(`cron inventory degraded: failed to load cron store: ${String(error)}`);
      cronStore = { version: 1, jobs: [] };
    }
  }

  const discoveredPaths = [
    ...collectConfigLitePathEntries(configLite)
      .map((entry) => entry.value)
      .filter(isInterestingConfigPathValue)
      .map((value) => normalizeInventoryPath(value)),
    ...cronStore.jobs.flatMap((job) =>
      collectCronPathReferences(job).map((value) => normalizeInventoryPath(value)),
    ),
  ];

  let workspaceInventory = createEmptyWorkspaceInventory(now);
  try {
    const baseWorkspaceInventory = resolveWorkspaceEntries({
      configLite,
      cronStore,
      now,
      discoveredPaths,
    });
    const workspaceEntries = await Promise.all(
      baseWorkspaceInventory.entries.map(async (entry) => {
        const primaryMarker = await pathExists(
          path.join(entry.normalizedPath, ".PRIMARY_WORKSPACE"),
        );
        return {
          ...entry,
          exists: (await pathExists(entry.normalizedPath)) === true,
          primaryMarker: primaryMarker === true,
          isPrimary: primaryMarker === true || entry.configuredDefault,
        };
      }),
    );
    workspaceInventory = {
      ...baseWorkspaceInventory,
      entries: workspaceEntries,
      ...(workspaceEntries.find((entry) => entry.isPrimary)
        ? { primaryWorkspace: workspaceEntries.find((entry) => entry.isPrimary)?.normalizedPath }
        : {}),
    };
  } catch (error) {
    inventoryStatus.workspace = "degraded";
    warnings.push(`workspace inventory degraded: ${String(error)}`);
  }

  let cronInventory = createEmptyCronInventory(now);
  try {
    cronInventory = buildCronInventory(cronStore, now);
  } catch (error) {
    inventoryStatus.cron = "degraded";
    warnings.push(`cron inventory degraded: ${String(error)}`);
  }

  let pathInventory = createEmptyPathInventory(now);
  try {
    pathInventory = await buildPathInventory({ configLite, cronStore, now });
  } catch (error) {
    inventoryStatus.path = "degraded";
    warnings.push(`path inventory degraded: ${String(error)}`);
  }

  let providerInventory = createEmptyProviderInventory(
    now,
    inventoryStatus.provider === "degraded",
  );
  try {
    providerInventory = buildProviderInventory({
      configLite,
      cronStore,
      now,
      degraded: inventoryStatus.provider === "degraded",
    });
  } catch (error) {
    inventoryStatus.provider = "degraded";
    warnings.push(`provider inventory degraded: ${String(error)}`);
    providerInventory = createEmptyProviderInventory(now, true);
  }

  return {
    generatedAt: now,
    workspaceInventory,
    cronInventory,
    pathInventory,
    providerInventory,
    inventoryStatus,
    warnings,
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
