import { listTaskRecords } from "../runtime-internal.js";
import { listTaskAuditFindings, summarizeTaskAuditFindings } from "../task-registry.audit.js";
import { reconcileTaskRecordForOperatorInspection } from "../task-registry.reconcile.js";
import { summarizeTaskRecords } from "../task-registry.summary.js";
import type { TaskRecord, TaskRuntime, TaskStatus } from "../task-registry.types.js";
import { sanitizeTaskStatusText } from "../task-status.js";
import type {
  TaskCatalog,
  TaskCatalogEntry,
  TaskControlPlaneModel,
  TaskErrorClass,
  TaskErrorClassification,
  TaskErrorClassificationEntry,
  TaskHealthEntry,
  TaskHealthModel,
  TaskHealthSeverity,
  TaskLedger,
  TaskLedgerDay,
  TaskLedgerEntry,
  TaskSnapshot,
  TaskSnapshotEntry,
} from "./types.js";

function createTaskStatusCountRecord(): Record<TaskStatus, number> {
  return {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    timed_out: 0,
    cancelled: 0,
    lost: 0,
  };
}

function createTaskRuntimeCountRecord(): Record<TaskRuntime, number> {
  return {
    subagent: 0,
    acp: 0,
    cli: 0,
    cron: 0,
  };
}

function createTaskErrorClassCountRecord(): Record<TaskErrorClass, number> {
  return {
    none: 0,
    auth: 0,
    timeout: 0,
    filesystem: 0,
    network: 0,
    rate_limit: 0,
    approval: 0,
    config: 0,
    delivery: 0,
    model: 0,
    unknown: 0,
  };
}

function isActiveStatus(status: TaskStatus): boolean {
  return status === "queued" || status === "running";
}

function isFailureStatus(status: TaskStatus): boolean {
  return status === "failed" || status === "timed_out" || status === "lost";
}

function resolveReferenceAt(task: TaskRecord): number {
  return task.lastEventAt ?? task.endedAt ?? task.startedAt ?? task.createdAt;
}

function resolveDurationMs(task: TaskRecord, now: number): number {
  const start = task.startedAt ?? task.createdAt;
  const end = task.endedAt ?? task.lastEventAt ?? now;
  return Math.max(0, end - start);
}

function resolveTaskTitle(task: TaskRecord): string {
  return sanitizeTaskStatusText(task.label?.trim() || task.task.trim()) || "Background task";
}

function resolveTaskSummary(task: TaskRecord): string | undefined {
  const summary = sanitizeTaskStatusText(
    task.terminalSummary ?? task.progressSummary ?? task.task,
    { errorContext: isFailureStatus(task.status) },
  );
  return summary || undefined;
}

function resolveTaskErrorText(task: TaskRecord): string | undefined {
  const text = sanitizeTaskStatusText(task.error, { errorContext: true });
  return text || undefined;
}

function toDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function sortNewestFirst<T extends { referenceAt: number; createdAt: number }>(left: T, right: T) {
  if (left.referenceAt !== right.referenceAt) {
    return right.referenceAt - left.referenceAt;
  }
  return right.createdAt - left.createdAt;
}

function loadSourceTasks(source?: readonly TaskRecord[]): TaskRecord[] {
  if (source) {
    return source.map((task) => ({ ...task }));
  }
  return listTaskRecords().map((task) => reconcileTaskRecordForOperatorInspection(task));
}

export function readTaskControlPlaneTasks(): TaskRecord[] {
  return loadSourceTasks();
}

export function buildTaskCatalog(tasks: readonly TaskRecord[], now = Date.now()): TaskCatalog {
  const byRuntime = createTaskRuntimeCountRecord();
  const byStatus = createTaskStatusCountRecord();
  const byOwnerKey: Record<string, number> = {};
  const byAgentId: Record<string, number> = {};

  const items = tasks
    .map<TaskCatalogEntry>((task) => {
      byRuntime[task.runtime] += 1;
      byStatus[task.status] += 1;
      byOwnerKey[task.ownerKey] = (byOwnerKey[task.ownerKey] ?? 0) + 1;
      if (task.agentId?.trim()) {
        byAgentId[task.agentId] = (byAgentId[task.agentId] ?? 0) + 1;
      }
      return {
        taskId: task.taskId,
        ...(task.runId ? { runId: task.runId } : {}),
        ...(task.sourceId ? { sourceId: task.sourceId } : {}),
        runtime: task.runtime,
        ownerKey: task.ownerKey,
        requesterSessionKey: task.requesterSessionKey,
        scopeKind: task.scopeKind,
        ...(task.childSessionKey ? { childSessionKey: task.childSessionKey } : {}),
        ...(task.parentFlowId ? { parentFlowId: task.parentFlowId } : {}),
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(task.agentId ? { agentId: task.agentId } : {}),
        ...(task.label ? { label: task.label } : {}),
        title: resolveTaskTitle(task),
        createdAt: task.createdAt,
      };
    })
    .toSorted((left, right) => right.createdAt - left.createdAt);

  return {
    generatedAt: now,
    total: items.length,
    items,
    byRuntime,
    byStatus,
    byOwnerKey,
    byAgentId,
  };
}

export function buildTaskSnapshot(tasks: readonly TaskRecord[], now = Date.now()): TaskSnapshot {
  const items = tasks
    .map<TaskSnapshotEntry>((task) => {
      const referenceAt = resolveReferenceAt(task);
      return {
        taskId: task.taskId,
        ...(task.runId ? { runId: task.runId } : {}),
        runtime: task.runtime,
        ownerKey: task.ownerKey,
        ...(task.agentId ? { agentId: task.agentId } : {}),
        title: resolveTaskTitle(task),
        status: task.status,
        deliveryStatus: task.deliveryStatus,
        notifyPolicy: task.notifyPolicy,
        createdAt: task.createdAt,
        ...(task.startedAt != null ? { startedAt: task.startedAt } : {}),
        ...(task.endedAt != null ? { endedAt: task.endedAt } : {}),
        ...(task.lastEventAt != null ? { lastEventAt: task.lastEventAt } : {}),
        referenceAt,
        ageMs: Math.max(0, now - referenceAt),
        durationMs: resolveDurationMs(task, now),
        active: isActiveStatus(task.status),
        terminal: !isActiveStatus(task.status),
        ...(resolveTaskSummary(task) ? { summary: resolveTaskSummary(task) } : {}),
        ...(resolveTaskErrorText(task) ? { error: resolveTaskErrorText(task) } : {}),
        ...(task.parentFlowId ? { parentFlowId: task.parentFlowId } : {}),
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
        ...(task.childSessionKey ? { childSessionKey: task.childSessionKey } : {}),
      };
    })
    .toSorted(sortNewestFirst);

  const summary = summarizeTaskRecords(tasks);
  return {
    generatedAt: now,
    total: items.length,
    active: summary.active,
    terminal: summary.terminal,
    failures: summary.failures,
    items,
  };
}

export function buildTaskLedger(tasks: readonly TaskRecord[], now = Date.now()): TaskLedger {
  const byDay = new Map<string, TaskLedgerDay>();
  const entries = tasks
    .map<TaskLedgerEntry>((task) => {
      const referenceAt = resolveReferenceAt(task);
      const dayKey = toDayKey(task.createdAt);
      const day = byDay.get(dayKey) ?? { dayKey, total: 0, failures: 0, active: 0 };
      day.total += 1;
      if (isFailureStatus(task.status)) {
        day.failures += 1;
      }
      if (isActiveStatus(task.status)) {
        day.active += 1;
      }
      byDay.set(dayKey, day);
      return {
        taskId: task.taskId,
        ...(task.runId ? { runId: task.runId } : {}),
        runtime: task.runtime,
        ownerKey: task.ownerKey,
        ...(task.agentId ? { agentId: task.agentId } : {}),
        title: resolveTaskTitle(task),
        status: task.status,
        createdAt: task.createdAt,
        ...(task.startedAt != null ? { startedAt: task.startedAt } : {}),
        ...(task.endedAt != null ? { endedAt: task.endedAt } : {}),
        ...(task.lastEventAt != null ? { lastEventAt: task.lastEventAt } : {}),
        referenceAt,
        durationMs: resolveDurationMs(task, now),
        dayKey,
        ...(task.terminalSummary ? { terminalSummary: task.terminalSummary } : {}),
        ...(task.progressSummary ? { progressSummary: task.progressSummary } : {}),
        ...(task.error ? { error: task.error } : {}),
        ...(task.parentFlowId ? { parentFlowId: task.parentFlowId } : {}),
        ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
      };
    })
    .toSorted(sortNewestFirst);

  return {
    generatedAt: now,
    total: entries.length,
    entries,
    byDay: [...byDay.values()].toSorted((left, right) => right.dayKey.localeCompare(left.dayKey)),
  };
}

function classifyTaskError(task: TaskRecord): {
  errorClass: TaskErrorClass;
  summary: string;
  confidence: "high" | "medium" | "low";
} {
  const summary =
    sanitizeTaskStatusText(task.error, { errorContext: true }) ||
    sanitizeTaskStatusText(task.terminalSummary, { errorContext: true }) ||
    sanitizeTaskStatusText(task.progressSummary, { errorContext: true }) ||
    "";

  if (!summary && task.deliveryStatus !== "failed") {
    return { errorClass: "none", summary: "", confidence: "high" };
  }

  const text = `${summary} ${task.status} ${task.deliveryStatus}`.toLowerCase();
  if (
    /401|403|unauthorized|invalid access token|token expired|auth\b|credential|login/.test(text)
  ) {
    return { errorClass: "auth", summary, confidence: "high" };
  }
  if (/timeout|timed out|deadline|etimedout/.test(text)) {
    return { errorClass: "timeout", summary, confidence: "high" };
  }
  if (
    /enoent|eacces|eperm|permission denied|no such file|mkdir|directory|filesystem|path/.test(text)
  ) {
    return { errorClass: "filesystem", summary, confidence: "high" };
  }
  if (
    /enotfound|econn|network|connection refused|connection reset|socket|dns|fetch failed/.test(text)
  ) {
    return { errorClass: "network", summary, confidence: "high" };
  }
  if (/429|rate limit|too many requests|cooldown|quota/.test(text)) {
    return { errorClass: "rate_limit", summary, confidence: "high" };
  }
  if (/approval|denied|rejected|not approved/.test(text)) {
    return { errorClass: "approval", summary, confidence: "medium" };
  }
  if (
    /invalid config|missing config|unresolved|secretref|not configured|no available auth profile/.test(
      text,
    )
  ) {
    return { errorClass: "config", summary, confidence: "medium" };
  }
  if (
    task.deliveryStatus === "failed" ||
    /delivery failed|not delivered|parent missing/.test(text)
  ) {
    return { errorClass: "delivery", summary, confidence: "medium" };
  }
  if (/all models failed|provider|fallbacksummaryerror|model/.test(text)) {
    return { errorClass: "model", summary, confidence: "medium" };
  }
  return { errorClass: "unknown", summary, confidence: summary ? "low" : "medium" };
}

export function buildErrorClassification(
  tasks: readonly TaskRecord[],
  now = Date.now(),
): TaskErrorClassification {
  const byClass = createTaskErrorClassCountRecord();
  const entries = tasks
    .map<TaskErrorClassificationEntry>((task) => {
      const classified = classifyTaskError(task);
      byClass[classified.errorClass] += 1;
      return {
        taskId: task.taskId,
        ...(task.runId ? { runId: task.runId } : {}),
        ownerKey: task.ownerKey,
        runtime: task.runtime,
        status: task.status,
        errorClass: classified.errorClass,
        summary: classified.summary,
        confidence: classified.confidence,
      };
    })
    .filter((entry) => entry.errorClass !== "none" || entry.status === "failed")
    .toSorted((left, right) => left.taskId.localeCompare(right.taskId));

  return {
    generatedAt: now,
    total: tasks.length,
    problematic: entries.length,
    byClass,
    entries,
  };
}

function deriveHealthSeverity(task: TaskRecord, reasonCount: number): TaskHealthSeverity {
  if (task.status === "failed" || task.status === "timed_out" || task.status === "lost") {
    return "critical";
  }
  if (reasonCount > 0) {
    return "critical";
  }
  if (task.status === "queued" || task.status === "running") {
    return "healthy";
  }
  return "healthy";
}

export function buildHealthModel(tasks: readonly TaskRecord[], now = Date.now()): TaskHealthModel {
  const findings = listTaskAuditFindings({ now, tasks: [...tasks] });
  const byTaskId = new Map<string, typeof findings>();
  for (const finding of findings) {
    const bucket = byTaskId.get(finding.task.taskId) ?? [];
    bucket.push(finding);
    byTaskId.set(finding.task.taskId, bucket);
  }
  const auditSummary = summarizeTaskAuditFindings(findings);
  const taskSummary = summarizeTaskRecords(tasks);
  const entries = tasks
    .map<TaskHealthEntry>((task) => {
      const taskFindings = byTaskId.get(task.taskId) ?? [];
      const reasons = taskFindings.map((finding) => finding.detail);
      if (isFailureStatus(task.status) && reasons.length === 0) {
        reasons.push(resolveTaskErrorText(task) ?? `Task ${task.status}`);
      }
      const severity = taskFindings.some((finding) => finding.severity === "error")
        ? "critical"
        : taskFindings.length > 0
          ? "warn"
          : deriveHealthSeverity(task, reasons.length);
      return {
        taskId: task.taskId,
        ...(task.runId ? { runId: task.runId } : {}),
        ownerKey: task.ownerKey,
        runtime: task.runtime,
        status: task.status,
        severity,
        ageMs: Math.max(0, now - resolveReferenceAt(task)),
        reasons,
        auditCodes: taskFindings.map((finding) => finding.code),
      };
    })
    .toSorted((left, right) => {
      const rank = (severity: TaskHealthSeverity) =>
        severity === "critical" ? 0 : severity === "warn" ? 1 : 2;
      if (rank(left.severity) !== rank(right.severity)) {
        return rank(left.severity) - rank(right.severity);
      }
      return right.ageMs - left.ageMs;
    });

  const summary = {
    total: tasks.length,
    healthy: entries.filter((entry) => entry.severity === "healthy").length,
    warn: entries.filter((entry) => entry.severity === "warn").length,
    critical: entries.filter((entry) => entry.severity === "critical").length,
    active: taskSummary.active,
    terminal: taskSummary.terminal,
    failures: taskSummary.failures,
    staleQueued: auditSummary.byCode.stale_queued,
    staleRunning: auditSummary.byCode.stale_running,
    deliveryFailed: auditSummary.byCode.delivery_failed,
    lost: auditSummary.byCode.lost,
  };

  return {
    generatedAt: now,
    overallSeverity: summary.critical > 0 ? "critical" : summary.warn > 0 ? "warn" : "healthy",
    summary,
    entries,
    findings,
  };
}

export function buildTaskControlPlane(params?: {
  now?: number;
  tasks?: readonly TaskRecord[];
}): TaskControlPlaneModel {
  const now = params?.now ?? Date.now();
  const tasks = loadSourceTasks(params?.tasks);
  return {
    generatedAt: now,
    source: {
      kind: "task_registry",
      totalTasks: tasks.length,
    },
    taskCatalog: buildTaskCatalog(tasks, now),
    taskSnapshot: buildTaskSnapshot(tasks, now),
    taskLedger: buildTaskLedger(tasks, now),
    healthModel: buildHealthModel(tasks, now),
    errorClassification: buildErrorClassification(tasks, now),
  };
}
