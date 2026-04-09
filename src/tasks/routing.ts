import type { HandoffSpec, TaskType } from "./types.js";

const ROUTE_MAP = {
  research: "agent_athena",
  report: "agent_watson",
  code: "agent_alpha",
  schedule: "agent_friday",
  mixed: "agent_jarvis",
  summary: "agent_jarvis",
} satisfies Record<TaskType, string>;

export function classifyTaskTypeFromInstruction(instruction: string): TaskType {
  const text = instruction.trim().toLowerCase();
  if (
    ["研究", "调研", "收集", "资料", "research", "investigate", "survey"].some((token) =>
      text.includes(token),
    )
  ) {
    return "research";
  }
  if (
    ["报告", "方案", "整理", "文档", "report", "draft", "write-up"].some((token) =>
      text.includes(token),
    )
  ) {
    return "report";
  }
  if (
    ["代码", "脚本", "修改", "bug", "api", "code", "fix", "implement"].some((token) =>
      text.includes(token),
    )
  ) {
    return "code";
  }
  if (
    ["日程", "会议", "提醒", "schedule", "calendar", "follow up"].some((token) =>
      text.includes(token),
    )
  ) {
    return "schedule";
  }
  return "mixed";
}

export function resolveOwnerAgent(taskType: TaskType): string {
  return ROUTE_MAP[taskType];
}

export function resolveHandoffSpec(params: {
  nextAction: unknown;
  instruction?: unknown;
}): HandoffSpec | null {
  const nextAction =
    typeof params.nextAction === "string" ? params.nextAction.trim().toLowerCase() : "";
  const instruction =
    typeof params.instruction === "string" && params.instruction.trim()
      ? params.instruction.trim()
      : undefined;

  if (nextAction === "handoff_to_watson") {
    return {
      nextAction: "handoff_to_watson",
      taskType: "report",
      ownerAgent: "agent_watson",
      instruction: instruction ?? "基于上一步结果起草结构化汇总和对外文案。",
    };
  }
  if (nextAction === "handoff_to_alpha") {
    return {
      nextAction: "handoff_to_alpha",
      taskType: "code",
      ownerAgent: "agent_alpha",
      instruction: instruction ?? "基于上一步结果完成代码实现或技术改动。",
    };
  }
  if (nextAction === "handoff_to_jarvis") {
    return {
      nextAction: "handoff_to_jarvis",
      taskType: "summary",
      ownerAgent: "agent_jarvis",
      instruction: instruction ?? "请汇总整条任务链结果并形成最终答复。",
    };
  }
  return null;
}
