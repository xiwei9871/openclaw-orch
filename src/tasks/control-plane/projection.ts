import type { TaskHealthSeverity } from "./types.js";
import type {
  FeishuTaskControlField,
  FeishuTaskControlProjection,
  FeishuTaskControlRow,
  FeishuTaskControlView,
  JarvisTaskHealthSummary,
  TaskControlPlaneModel,
  TaskControlProjectionLayer,
  TaskErrorClass,
} from "./types.js";

const TASK_STATUS_ZH: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  succeeded: "已完成",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
  lost: "丢失",
};

const TASK_HEALTH_ZH: Record<TaskHealthSeverity, string> = {
  healthy: "健康",
  warn: "关注",
  critical: "异常",
};

const TASK_ERROR_CLASS_ZH: Record<TaskErrorClass, string> = {
  none: "无",
  auth: "认证",
  timeout: "超时",
  filesystem: "文件系统",
  network: "网络",
  rate_limit: "限流",
  approval: "审批",
  config: "配置",
  delivery: "投递",
  model: "模型",
  unknown: "未知",
};

function formatTime(timestamp: number | undefined): string | null {
  return typeof timestamp === "number" ? new Date(timestamp).toISOString() : null;
}

function formatDuration(durationMs: number): string {
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 1) {
    return `${Math.floor(durationMs / 1000)}s`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 1) {
    return `${minutes}m`;
  }
  return `${hours}h${minutes % 60}m`;
}

function toTodayKey(now: number, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(now));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function rankHealth(severity: TaskHealthSeverity): number {
  return severity === "critical" ? 0 : severity === "warn" ? 1 : 2;
}

function sortRowIds(
  model: TaskControlPlaneModel,
  taskIds: string[],
  healthByTaskId: Map<string, TaskHealthSeverity>,
) {
  const snapshotByTaskId = new Map(
    model.taskSnapshot.items.map((item) => [item.taskId, item] as const),
  );
  return [...taskIds].toSorted((left, right) => {
    const leftHealth = rankHealth(healthByTaskId.get(left) ?? "healthy");
    const rightHealth = rankHealth(healthByTaskId.get(right) ?? "healthy");
    if (leftHealth !== rightHealth) {
      return leftHealth - rightHealth;
    }
    const leftSnapshot = snapshotByTaskId.get(left);
    const rightSnapshot = snapshotByTaskId.get(right);
    if (!leftSnapshot || !rightSnapshot) {
      return left.localeCompare(right);
    }
    if (leftSnapshot.active !== rightSnapshot.active) {
      return leftSnapshot.active ? -1 : 1;
    }
    return rightSnapshot.referenceAt - leftSnapshot.referenceAt;
  });
}

export function buildFeishuTaskControlProjection(
  model: TaskControlPlaneModel,
  opts?: {
    now?: number;
    timeZone?: string;
  },
): FeishuTaskControlProjection {
  const now = opts?.now ?? model.generatedAt;
  const timeZone = opts?.timeZone ?? "Asia/Shanghai";
  const todayKey = toTodayKey(now, timeZone);
  const healthByTaskId = new Map(
    model.healthModel.entries.map((entry) => [entry.taskId, entry.severity] as const),
  );
  const errorByTaskId = new Map(
    model.errorClassification.entries.map((entry) => [entry.taskId, entry] as const),
  );

  const fields: FeishuTaskControlField[] = [
    { key: "标题", label: "标题" },
    { key: "健康", label: "健康" },
    { key: "状态", label: "状态" },
    { key: "错误分类", label: "错误分类" },
    { key: "负责人", label: "负责人" },
    { key: "运行类型", label: "运行类型" },
    { key: "最近摘要", label: "最近摘要" },
    { key: "最近错误", label: "最近错误" },
    { key: "创建时间", label: "创建时间" },
    { key: "最近事件时间", label: "最近事件时间" },
    { key: "持续时间", label: "持续时间" },
    { key: "Task ID", label: "Task ID", hidden: true },
    { key: "Run ID", label: "Run ID", hidden: true },
    { key: "状态原值", label: "状态原值", hidden: true },
    { key: "负责人原值", label: "负责人原值", hidden: true },
    { key: "Flow ID", label: "Flow ID", hidden: true },
    { key: "Parent Task ID", label: "Parent Task ID", hidden: true },
    {
      key: "异常视图",
      label: "异常视图",
      hidden: true,
      fieldType: 3,
      property: { options: [{ name: "异常", color: 0 }] },
    },
    {
      key: "今日队列视图",
      label: "今日队列视图",
      hidden: true,
      fieldType: 3,
      property: { options: [{ name: "今日队列", color: 5 }] },
    },
  ];
  const mobileCardFields = fields.filter((field) => !field.hidden).map((field) => field.key);

  const rows = model.taskSnapshot.items.map<FeishuTaskControlRow>((task) => {
    const health = healthByTaskId.get(task.taskId) ?? "healthy";
    const error = errorByTaskId.get(task.taskId);
    return {
      taskId: task.taskId,
      fields: {
        标题: task.title,
        健康: TASK_HEALTH_ZH[health],
        状态: TASK_STATUS_ZH[task.status] ?? task.status,
        错误分类: TASK_ERROR_CLASS_ZH[error?.errorClass ?? "none"],
        负责人: task.ownerKey,
        运行类型: task.runtime,
        最近摘要: task.summary ?? "",
        最近错误: task.error ?? error?.summary ?? "",
        创建时间: formatTime(task.createdAt),
        最近事件时间: formatTime(task.referenceAt),
        持续时间: formatDuration(task.durationMs),
        "Task ID": task.taskId,
        "Run ID": task.runId ?? null,
        状态原值: task.status,
        负责人原值: task.ownerKey,
        "Flow ID": task.parentFlowId ?? null,
        "Parent Task ID": task.parentTaskId ?? null,
        异常视图: health !== "healthy" || (error && error.errorClass !== "none") ? "异常" : "",
        今日队列视图:
          task.active && toTodayKey(task.createdAt, timeZone) === todayKey ? "今日队列" : "",
      },
    };
  });

  const overviewIds = sortRowIds(
    model,
    rows.map((row) => row.taskId),
    healthByTaskId,
  );
  const exceptionIds = sortRowIds(
    model,
    rows
      .map((row) => row.taskId)
      .filter((taskId) => {
        const health = healthByTaskId.get(taskId) ?? "healthy";
        const error = errorByTaskId.get(taskId);
        return health !== "healthy" || (error && error.errorClass !== "none");
      }),
    healthByTaskId,
  );
  const todayQueueIds = sortRowIds(
    model,
    model.taskLedger.entries
      .filter(
        (entry) =>
          entry.dayKey === todayKey && (entry.status === "queued" || entry.status === "running"),
      )
      .map((entry) => entry.taskId),
    healthByTaskId,
  );
  const agentViewIds = [...rows]
    .toSorted((left, right) => {
      const leftOwner = String(left.fields["负责人"]);
      const rightOwner = String(right.fields["负责人"]);
      if (leftOwner !== rightOwner) {
        return leftOwner.localeCompare(rightOwner);
      }
      return sortRowIds(model, [left.taskId, right.taskId], healthByTaskId)[0] === left.taskId
        ? -1
        : 1;
    })
    .map((row) => row.taskId);

  const views: FeishuTaskControlView[] = [
    {
      name: "总览",
      description: "所有任务的统一投影视图，按健康度和最近活跃度排序。",
      rowIds: overviewIds,
      mobileCardFields,
    },
    {
      name: "异常",
      description: "聚焦失败、卡住、投递失败和其他需要处理的任务。",
      rowIds: exceptionIds,
      mobileCardFields,
    },
    {
      name: "今日队列",
      description: "今天产生且仍在排队或执行中的任务。",
      rowIds: todayQueueIds,
      mobileCardFields,
    },
    {
      name: "Agent 视图",
      description: "按负责人分组查看任务健康和负载。",
      rowIds: agentViewIds,
      mobileCardFields,
      groupBy: "负责人",
    },
  ];

  return {
    generatedAt: now,
    fields,
    rows,
    views,
  };
}

export function buildJarvisTaskHealthSummary(
  model: TaskControlPlaneModel,
  opts?: {
    maxItems?: number;
  },
): JarvisTaskHealthSummary {
  const maxItems = opts?.maxItems ?? 5;
  const critical = model.healthModel.entries.filter((entry) => entry.severity === "critical");
  const topErrors = model.errorClassification.entries
    .filter((entry) => entry.errorClass !== "none")
    .slice(0, maxItems);
  const activeToday = model.taskSnapshot.items.filter((item) => item.active).slice(0, maxItems);

  const lines = [
    "Task Control 每日健康报告",
    `总体：${model.taskSnapshot.total} 项，活跃 ${model.taskSnapshot.active}，终态 ${model.taskSnapshot.terminal}，失败 ${model.taskSnapshot.failures}`,
    `健康：异常 ${model.healthModel.summary.critical}，关注 ${model.healthModel.summary.warn}，健康 ${model.healthModel.summary.healthy}`,
    `审计：排队滞留 ${model.healthModel.summary.staleQueued}，运行滞留 ${model.healthModel.summary.staleRunning}，投递失败 ${model.healthModel.summary.deliveryFailed}`,
  ];

  if (critical.length > 0) {
    lines.push("异常任务：");
    for (const entry of critical.slice(0, maxItems)) {
      lines.push(`- ${entry.ownerKey} / ${entry.taskId}: ${entry.reasons[0] ?? entry.status}`);
    }
  }

  if (topErrors.length > 0) {
    lines.push("错误分类：");
    for (const entry of topErrors) {
      lines.push(
        `- ${TASK_ERROR_CLASS_ZH[entry.errorClass]} / ${entry.taskId}: ${entry.summary || entry.status}`,
      );
    }
  }

  if (activeToday.length > 0) {
    lines.push("当前队列：");
    for (const task of activeToday) {
      lines.push(
        `- ${task.ownerKey}: ${task.title} (${TASK_STATUS_ZH[task.status] ?? task.status})`,
      );
    }
  }

  return {
    generatedAt: model.generatedAt,
    title: "Task Control 每日健康报告",
    text: lines.join("\n"),
  };
}

export function renderJarvisTaskHealthSummaryMarkdown(summary: JarvisTaskHealthSummary): string {
  return [
    `# ${summary.title}`,
    "",
    `生成时间：${new Date(summary.generatedAt).toISOString()}`,
    "",
    summary.text,
    "",
  ].join("\n");
}

export function buildTaskControlProjectionLayer(
  model: TaskControlPlaneModel,
  opts?: {
    now?: number;
    timeZone?: string;
    maxSummaryItems?: number;
  },
): TaskControlProjectionLayer {
  return {
    feishu: buildFeishuTaskControlProjection(model, {
      now: opts?.now ?? model.generatedAt,
      timeZone: opts?.timeZone,
    }),
    summary: buildJarvisTaskHealthSummary(model, {
      maxItems: opts?.maxSummaryItems,
    }),
  };
}
