import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { resolveFeishuRuntimeAccount } from "./src/accounts.js";
import { createFeishuClient } from "./src/client.js";

export type FeishuBitableClient = Pick<Lark.Client, "bitable">;

export function createFeishuBitableClient(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): FeishuBitableClient {
  const account = resolveFeishuRuntimeAccount({
    cfg: params.cfg,
    accountId: params.accountId?.trim() || undefined,
  });
  return createFeishuClient(account);
}

export { feishuPlugin } from "./src/channel.js";
export { registerFeishuDocTools } from "./src/docx.js";
export { registerFeishuChatTools } from "./src/chat.js";
export { registerFeishuWikiTools } from "./src/wiki.js";
export { registerFeishuDriveTools } from "./src/drive.js";
export { registerFeishuPermTools } from "./src/perm.js";
export { registerFeishuBitableTools } from "./src/bitable.js";
export { sendMessageFeishu } from "./src/send.js";
export {
  handleFeishuSubagentDeliveryTarget,
  handleFeishuSubagentEnded,
  handleFeishuSubagentSpawning,
} from "./src/subagent-hooks.js";
export * from "./src/conversation-id.js";
export * from "./src/setup-core.js";
export * from "./src/setup-surface.js";
export * from "./src/thread-bindings.js";
export { __testing as feishuThreadBindingTesting } from "./src/thread-bindings.js";

export const feishuSessionBindingAdapterChannels = ["feishu"] as const;
