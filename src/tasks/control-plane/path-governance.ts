import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import type { OpenClawConfig } from "../../config/types.js";
import { loadCronStore, resolveCronStorePath, saveCronStore } from "../../cron/store.js";
import type { CronJob, CronStoreFile } from "../../cron/types.js";
import { resolveRequiredHomeDir } from "../../infra/home-dir.js";
import {
  buildTaskControlConfigLite,
  readTaskControlConfigLite,
  type TaskControlConfigLite,
} from "./config-lite.js";
import type { CronPathRepairEntry, CronPathRepairReport } from "./types.js";

type CronPathRepairOptions = {
  now?: number;
  cfg?: OpenClawConfig;
  configLite?: TaskControlConfigLite;
  cronStore?: CronStoreFile;
  storePath?: string;
  stateDir?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalOpenClawPathPrefixes(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = resolveRequiredHomeDir(env);
  const stateDir = resolveStateDir(env);
  return [...new Set(["/home/node/.openclaw", path.join(home, ".openclaw"), stateDir])].map(
    (entry) => entry.replace(/[\\/]+$/, ""),
  );
}

export function normalizeOpenClawPathReferences(
  input: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let next = input;
  for (const prefix of canonicalOpenClawPathPrefixes(env)) {
    const normalizedPrefix = prefix.replaceAll("\\", "/");
    const regex = new RegExp(`${escapeRegExp(normalizedPrefix)}(?=($|[\\/]))`, "g");
    next = next.replace(regex, "~/.openclaw");
  }
  return next;
}

function repairCronJob(job: CronJob): CronPathRepairEntry {
  const fields: CronPathRepairEntry["fields"] = [];

  if (job.payload.kind === "systemEvent" && typeof job.payload.text === "string") {
    const after = normalizeOpenClawPathReferences(job.payload.text);
    if (after !== job.payload.text) {
      fields.push({
        field: "payload.text",
        before: job.payload.text,
        after,
      });
      job.payload.text = after;
    }
  }

  if (job.payload.kind === "agentTurn" && typeof job.payload.message === "string") {
    const after = normalizeOpenClawPathReferences(job.payload.message);
    if (after !== job.payload.message) {
      fields.push({
        field: "payload.message",
        before: job.payload.message,
        after,
      });
      job.payload.message = after;
    }
  }

  return {
    cronId: job.id,
    name: job.name,
    changed: fields.length > 0,
    fields,
  };
}

async function resolveCronRepairSource(options: CronPathRepairOptions): Promise<{
  storePath: string;
  sourceStore: CronStoreFile;
}> {
  let configLite = options.configLite;
  if (!configLite && options.cfg) {
    configLite = buildTaskControlConfigLite(options.cfg);
  }
  if (!configLite && !options.storePath) {
    const liteResult = await readTaskControlConfigLite({ stateDir: options.stateDir });
    if (liteResult.ok) {
      configLite = liteResult.config;
    }
  }

  const storePath = options.storePath ?? resolveCronStorePath(configLite?.cronStorePath);
  const sourceStore = options.cronStore ?? (await loadCronStore(storePath));
  return { storePath, sourceStore };
}

export async function buildCronPathRepairReport(
  options: CronPathRepairOptions = {},
): Promise<CronPathRepairReport> {
  const now = options.now ?? Date.now();
  const { storePath, sourceStore } = await resolveCronRepairSource(options);
  const workingStore: CronStoreFile = {
    version: sourceStore.version,
    jobs: structuredClone(sourceStore.jobs),
  };
  const entries = workingStore.jobs.map((job) => repairCronJob(job));
  return {
    generatedAt: now,
    changedJobs: entries.filter((entry) => entry.changed).length,
    totalJobs: entries.length,
    entries,
    applied: false,
    storePath,
  };
}

export async function applyCronPathRepair(
  options: CronPathRepairOptions = {},
): Promise<CronPathRepairReport> {
  const now = options.now ?? Date.now();
  const { storePath, sourceStore } = await resolveCronRepairSource(options);
  const workingStore: CronStoreFile = {
    version: sourceStore.version,
    jobs: structuredClone(sourceStore.jobs),
  };
  const entries = workingStore.jobs.map((job) => repairCronJob(job));
  const changedJobs = entries.filter((entry) => entry.changed).length;
  if (changedJobs > 0) {
    await saveCronStore(storePath, workingStore);
  }
  return {
    generatedAt: now,
    changedJobs,
    totalJobs: entries.length,
    entries,
    applied: true,
    storePath,
  };
}
