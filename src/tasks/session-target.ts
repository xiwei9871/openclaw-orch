import { buildAgentMainSessionKey, parseAgentSessionKey } from "../routing/session-key.js";

export function resolveTargetSessionKey(params: {
  ownerAgent: string;
  sourceSessionKey?: string | null;
}): string {
  const sourceSessionKey = params.sourceSessionKey?.trim();
  if (!sourceSessionKey) {
    return buildAgentMainSessionKey({ agentId: params.ownerAgent });
  }
  const parsed = parseAgentSessionKey(sourceSessionKey);
  if (!parsed) {
    return buildAgentMainSessionKey({ agentId: params.ownerAgent });
  }
  return `agent:${params.ownerAgent}:${parsed.rest}`;
}
