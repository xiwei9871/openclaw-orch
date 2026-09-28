import type {
  FeishuBitableProjectionField,
  FeishuBitableProjectionRow,
  FeishuBitableProjectionView,
} from "./feishu-bitable-sync.js";

export type SchedulerCronJob = {
  id?: string | number;
  name?: string;
  status?: string;
  state?: {
    lastStatus?: string;
    consecutiveErrors?: number;
    nextRunAtMs?: number;
    lastError?: string;
  };
};

export type SchedulerProjection = {
  fields: FeishuBitableProjectionField[];
  rows: FeishuBitableProjectionRow[];
  views: FeishuBitableProjectionView[];
};

function formatShanghai(inputMs: number | undefined): string {
  if (inputMs === undefined || inputMs === null) {
    return "";
  }
  const date = new Date(Number(inputMs));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function truncate(value: string | undefined, maxLength = 200): string {
  const text = String(value ?? "");
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function parseCronJobListOutput(raw: string): SchedulerCronJob[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid cron JSON: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
  const jobs = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { jobs?: unknown }).jobs)
      ? (parsed as { jobs: unknown[] }).jobs
      : undefined;
  if (!jobs) {
    throw new Error("Cron list must be an array or contain jobs");
  }
  if (jobs.some((job) => !job || typeof job !== "object" || Array.isArray(job))) {
    throw new Error("Cron list contains an invalid job");
  }
  return jobs as SchedulerCronJob[];
}

export function buildSchedulerProjection(
  jobs: SchedulerCronJob[],
  now = Date.now(),
): SchedulerProjection {
  const nowString = formatShanghai(now);
  const rows = jobs.map<FeishuBitableProjectionRow>((job) => {
    const rowKey = String(job.id ?? "").trim();
    if (!rowKey) {
      throw new Error("Cron job id is required for a stable dashboard row key");
    }
    return {
      rowKey,
      fields: {
        Name: String(job.name ?? ""),
        更新时间: nowString,
        类型: "cron-auto",
        对象ID: rowKey,
        对象名称: String(job.name ?? ""),
        状态: String(job.state?.lastStatus ?? job.status ?? ""),
        连续错误: Number(job.state?.consecutiveErrors ?? 0),
        下次执行: formatShanghai(job.state?.nextRunAtMs),
        最近错误: truncate(job.state?.lastError),
        备注: "auto-sync",
      },
    };
  });

  return {
    fields: [
      { key: "Name", fieldType: 1 },
      { key: "更新时间", fieldType: 1 },
      { key: "类型", fieldType: 1 },
      { key: "对象ID", fieldType: 1 },
      { key: "对象名称", fieldType: 1 },
      { key: "状态", fieldType: 1 },
      { key: "连续错误", fieldType: 2 },
      { key: "下次执行", fieldType: 1 },
      { key: "最近错误", fieldType: 1 },
      { key: "备注", fieldType: 1 },
    ],
    rows,
    views: [],
  };
}
