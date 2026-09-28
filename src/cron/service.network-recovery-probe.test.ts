import { describe, expect, it, vi } from "vitest";
import { createRunningCronServiceState, setupCronServiceSuite } from "./service.test-harness.js";
import { maybeProbeNetworkRecovery, resolveNextNetworkProbeDelayMs } from "./service/timer.js";
import type { CronJob } from "./types.js";

const BASE_NOW_MS = Date.parse("2026-02-06T10:05:00.000Z");

const { logger: noopLogger, makeStorePath } = setupCronServiceSuite({
  prefix: "openclaw-cron-network-recovery-probe-",
  baseTimeIso: new Date(BASE_NOW_MS).toISOString(),
});

const FOUNDER_OS_CRITICAL_JOB_ID = "c0ff4e45-9a3c-417e-a324-a95d65a16a28";
const runProbe: (
  state: ProbeTrackedState,
  overrides: ProbeRunnerOverrides,
) => Promise<void> = maybeProbeNetworkRecovery;
const resolveProbeDelay: (previousDelayMs?: number) => number = resolveNextNetworkProbeDelayMs;

type ProbeRunnerOverrides = {
  runFeishuProbe: () => Promise<boolean>;
  runLlmProbe: () => Promise<boolean>;
};

type ProbeTrackedState = ReturnType<typeof createRunningCronServiceState> & {
  networkRecovery: ReturnType<typeof createRunningCronServiceState>["networkRecovery"] & {
    lastNetworkFailureAtMs?: number;
    nextProbeAtMs?: number;
    consecutiveProbeFailures?: number;
    lastErrorText?: string;
  };
};

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

function markFailureWindow(state: ProbeTrackedState, now: number, errorText = "network connection error") {
  Object.assign(state.networkRecovery, {
    lastNetworkFailureAtMs: now - 1_000,
    nextProbeAtMs: now,
    consecutiveProbeFailures: 0,
    lastErrorText: errorText,
  });
}

async function createProbeState(params?: { jobs?: CronJob[]; now?: number }) {
  const now = params?.now ?? BASE_NOW_MS;
  const store = await makeStorePath();
  const state = createRunningCronServiceState({
    storePath: store.storePath,
    log: noopLogger,
    nowMs: () => now,
    jobs: params?.jobs ?? [],
  }) as ProbeTrackedState;
  return { now, state };
}

describe("cron network recovery probes", () => {
  it("probes only run inside an active failure window", async () => {
    const { now, state } = await createProbeState();
    const runFeishuProbe = vi.fn().mockResolvedValue(true);
    const runLlmProbe = vi.fn().mockResolvedValue(true);
    state.networkRecovery = {};

    await runProbe(state, { runFeishuProbe, runLlmProbe });

    expect(runFeishuProbe).not.toHaveBeenCalled();
    expect(runLlmProbe).not.toHaveBeenCalled();

    markFailureWindow(state, now);

    await runProbe(state, { runFeishuProbe, runLlmProbe });

    expect(runFeishuProbe).toHaveBeenCalledTimes(1);
    expect(runLlmProbe).toHaveBeenCalledTimes(1);
  });

  it("backs off probe retries from 15 seconds to 30 seconds to 60 seconds", () => {
    expect(resolveProbeDelay(undefined)).toBe(15_000);
    expect(resolveProbeDelay(15_000)).toBe(30_000);
    expect(resolveProbeDelay(30_000)).toBe(60_000);
    expect(resolveProbeDelay(60_000)).toBe(60_000);
  });

  it("does not recover when the Feishu probe succeeds but the LLM probe fails", async () => {
    const now = BASE_NOW_MS;
    const { state } = await createProbeState({
      now,
      jobs: [
        createCriticalReplayJob({
          text: "replay founder critical after probes",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    });
    markFailureWindow(state, now);

    await runProbe(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(true),
      runLlmProbe: vi.fn().mockResolvedValue(false),
    });

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("does not recover when the LLM probe succeeds but the Feishu probe fails", async () => {
    const now = BASE_NOW_MS;
    const { state } = await createProbeState({
      now,
      jobs: [
        createCriticalReplayJob({
          text: "replay founder critical after probes",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    });
    markFailureWindow(state, now);

    await runProbe(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(false),
      runLlmProbe: vi.fn().mockResolvedValue(true),
    });

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("triggers catch-up when both probes succeed in the same failure window", async () => {
    const now = BASE_NOW_MS;
    const { state } = await createProbeState({
      now,
      jobs: [
        createCriticalReplayJob({
          text: "replay founder critical after probes",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    });
    markFailureWindow(state, now);

    await runProbe(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(true),
      runLlmProbe: vi.fn().mockResolvedValue(true),
    });

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay founder critical after probes",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });
});
