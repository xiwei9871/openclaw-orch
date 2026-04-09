const TASK_STATUS_ZH = {
  pending: "待处理",
  dispatched: "已派发",
  running: "进行中",
  waiting: "等待中",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
} as const;

const TASK_OWNER_ZH: Record<string, string> = {
  agent_athena: "雅典娜",
  agent_jarvis: "贾维斯",
  agent_watson: "沃森",
  agent_alpha: "阿尔法",
  agent_friday: "星期五",
};

const TASK_DEPTH_ZH: Record<"root" | "child" | "grandchild", string> = {
  root: "根任务",
  child: "子任务",
  grandchild: "孙任务",
};

export function toTaskStatusZh(status: string): string {
  return TASK_STATUS_ZH[status as keyof typeof TASK_STATUS_ZH] ?? status;
}

export function toTaskOwnerZh(ownerAgent: string): string {
  return TASK_OWNER_ZH[ownerAgent] ?? ownerAgent;
}

export function toTaskDepthZh(depth: "root" | "child" | "grandchild"): string {
  return TASK_DEPTH_ZH[depth];
}
