import type * as FeishuApi from "../../../extensions/feishu/api.js";

type SendMessageFeishu = typeof FeishuApi.sendMessageFeishu;

export async function sendTaskControlFeishuSummary(
  params: Parameters<SendMessageFeishu>[0],
): ReturnType<SendMessageFeishu> {
  const { sendMessageFeishu } = await import("../../../extensions/feishu/api.js");
  return sendMessageFeishu(params);
}
