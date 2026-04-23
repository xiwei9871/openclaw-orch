import { describe, expect, it, vi } from "vitest";
import { createRunningCronServiceState, setupCronServiceSuite } from "./service.test-harness.js";
import { maybeProbeNetworkRecovery, resolveNextNetworkProbeDelayMs } from "./service/timer.js";
import type { CronJob } from "./types.js";

const { logger: noopLogger, makeStorePath } = setupCronServiceSuite({
  prefix: "openclaw-cron-network-recovery-probe-",
  baseTimeIso: "2026-02-06T10:05:00.000Z",
});

const FOUNDER_OS_CRITICAL_JOB_ID = "c0ff4e45-9a3c-417e-a324-a95d65a16a28";

function createCriticalReplayJob(params: {
  id?: string;
  text: string;
  nextRunAtMs: number;
}): CronJob {
  return {
    id: params.id ?? FOUNDER_OS_CRITICAL_JOB_ID,
    name: "founder-os critical",
    enabled: true,
    createdAtMs: params.nextRunAtMs - 60_000,
    updatedAtMs: params.nextRunAtMs - 60_000,
    schedule: { kind: "every", everyMs: 60_000, anchorMs: params.nextRunAtMs - 60_000 },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: params.text },
    state: { nextRunAtMs: params.nextRunAtMs },
  };
}

describe("cron network recovery probes", () => {
  it("probes only run inside an active failure window", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [],
    });
    const runFeishuProbe = vi.fn().mockResolvedValue(true);
    const runLlmProbe = vi.fn().mockResolvedValue(true);
    state.networkRecovery = {};

    await maybeProbeNetworkRecovery(state, { runFeishuProbe, runLlmProbe } as never);

    expect(runFeishuProbe).not.toHaveBeenCalled();
    expect(runLlmProbe).not.toHaveBeenCalled();

    Object.assign(state.networkRecovery as Record<string, unknown>, {
      lastNetworkFailureAtMs: now - 1_000,
      nextProbeAtMs: now,
      consecutiveProbeFailures: 0,
      lastErrorText: "network connection error",
    });

    await maybeProbeNetworkRecovery(state, { runFeishuProbe, runLlmProbe } as never);

    expect(runFeishuProbe).toHaveBeenCalledTimes(1);
    expect(runLlmProbe).toHaveBeenCalledTimes(1);
  });

  it("backs off probe retries from 15 seconds to 30 seconds to 60 seconds", () => {
    expect(resolveNextNetworkProbeDelayMs(undefined)).toBe(15_000);
    expect(resolveNextNetworkProbeDelayMs(15_000)).toBe(30_000);
    expect(resolveNextNetworkProbeDelayMs(30_000)).toBe(60_000);
    expect(resolveNextNetworkProbeDelayMs(60_000)).toBe(60_000);
  });

  it("does not recover when the Feishu probe succeeds but the LLM probe fails", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createCriticalReplayJob({
          text: "replay founder critical after probes",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    });
    Object.assign(state.networkRecovery as Record<string, unknown>, {
      lastNetworkFailureAtMs: now - 1_000,
      nextProbeAtMs: now,
      consecutiveProbeFailures: 0,
      lastErrorText: "network connection error",
    });

    await maybeProbeNetworkRecovery(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(true),
      runLlmProbe: vi.fn().mockResolvedValue(false),
    } as never);

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("does not recover when the LLM probe succeeds but the Feishu probe fails", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createCriticalReplayJob({
          text: "replay founder critical after probes",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    });
    Object.assign(state.networkRecovery as Record<string, unknown>, {
      lastNetworkFailureAtMs: now - 1_000,
      nextProbeAtMs: now,
      consecutiveProbeFailures: 0,
      lastErrorText: "network connection error",
    });

    await maybeProbeNetworkRecovery(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(false),
      runLlmProbe: vi.fn().mockResolvedValue(true),
    } as never);

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("triggers catch-up when both probes succeed in the same failure window", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createCriticalReplayJob({
          text: "replay founder critical after probes",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    });
    Object.assign(state.networkRecovery as Record<string, unknown>, {
      lastNetworkFailureAtMs: now - 1_000,
      nextProbeAtMs: now,
      consecutiveProbeFailures: 0,
      lastErrorText: "network connection error",
    });

    await maybeProbeNetworkRecovery(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(true),
      runLlmProbe: vi.fn().mockResolvedValue(true),
    } as never);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay founder critical after probes",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });
});
