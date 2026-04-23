import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createRunningCronServiceState,
  setupCronServiceSuite,
  writeCronStoreSnapshot,
} from "./service.test-harness.js";
import {
  isNetworkRecoverableCronError,
  maybeProbeNetworkRecovery,
  maybeRunNetworkRecoveryCatchup,
  onTimer,
} from "./service/timer.js";
import type { CronJob } from "./types.js";

const { logger: noopLogger, makeStorePath } = setupCronServiceSuite({
  prefix: "openclaw-cron-network-recovery-",
  baseTimeIso: "2026-02-06T10:05:00.000Z",
});

const FOUNDER_OS_CRITICAL_JOB_ID = "c0ff4e45-9a3c-417e-a324-a95d65a16a28";
const FOUNDER_OS_CRITICAL_JOB_IDS = [
  "c0ff4e45-9a3c-417e-a324-a95d65a16a28",
  "049a87d5-7cc5-4b65-a07f-a4ab47995ec4",
  "07084743-7475-446e-8013-63fc2afa88bc",
  "81380d51-2a99-4f03-a8ef-e57e35faeb26",
];
const runProbeRecovery: (
  state: ProbeRecoveryTrackedState,
  overrides: ProbeRunnerOverrides,
) => Promise<void> = maybeProbeNetworkRecovery;

type RecoveryTrackedState = ReturnType<typeof createRunningCronServiceState> & {
  networkRecovery: {
    lastNetworkFailureAtMs?: number;
    lastStableSuccessAtMs?: number;
    lastRecoveryCatchupTriggeredAtMs?: number;
    lastFeishuProbeOkAtMs?: number;
    lastLlmProbeOkAtMs?: number;
    nextProbeAtMs?: number;
    lastErrorText?: string;
  };
};

type ProbeRunnerOverrides = {
  runFeishuProbe: () => Promise<boolean>;
  runLlmProbe: () => Promise<boolean>;
};

type ProbeRecoveryTrackedState = RecoveryTrackedState & {
  networkRecovery: RecoveryTrackedState["networkRecovery"] & {
    nextProbeAtMs?: number;
    consecutiveProbeFailures?: number;
  };
};

function createOverdueSystemJob(params: {
  id: string;
  name?: string;
  text: string;
  nextRunAtMs: number;
}): CronJob {
  return {
    id: params.id,
    name: params.name ?? params.id,
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

function createMissedCronSystemJob(params: {
  id: string;
  name?: string;
  text: string;
  nextRunAtMs: number;
  lastRunAtMs: number;
  expr?: string;
}): CronJob {
  return {
    id: params.id,
    name: params.name ?? params.id,
    enabled: true,
    createdAtMs: params.lastRunAtMs - 60_000,
    updatedAtMs: params.lastRunAtMs,
    schedule: { kind: "cron", expr: params.expr ?? "1,11,21,31,41,51 10 * * *", tz: "UTC" },
    sessionTarget: "main",
    wakeMode: "next-heartbeat",
    payload: { kind: "systemEvent", text: params.text },
    state: {
      nextRunAtMs: params.nextRunAtMs,
      lastRunAtMs: params.lastRunAtMs,
      lastStatus: "ok",
    },
  };
}

function markProbeFailureWindow(
  state: ProbeRecoveryTrackedState,
  now: number,
  errorText = "network connection error",
) {
  Object.assign(state.networkRecovery, {
    lastNetworkFailureAtMs: now - 1_000,
    nextProbeAtMs: now,
    consecutiveProbeFailures: 0,
    lastErrorText: errorText,
  });
}

function markProbeConfirmedRecovery(
  state: RecoveryTrackedState,
  params: {
    lastFailureAtMs: number;
    probeOkAtMs?: number;
    lastStableSuccessAtMs?: number;
    nextProbeAtMs?: number;
    lastErrorText?: string;
    lastRecoveryCatchupTriggeredAtMs?: number;
  },
) {
  const probeOkAtMs = params.probeOkAtMs ?? params.lastFailureAtMs;
  Object.assign(state.networkRecovery, {
    lastNetworkFailureAtMs: params.lastFailureAtMs,
    lastStableSuccessAtMs: params.lastStableSuccessAtMs,
    lastRecoveryCatchupTriggeredAtMs: params.lastRecoveryCatchupTriggeredAtMs,
    lastFeishuProbeOkAtMs: probeOkAtMs,
    lastLlmProbeOkAtMs: probeOkAtMs,
    nextProbeAtMs: params.nextProbeAtMs,
    lastErrorText: params.lastErrorText ?? "network error",
  });
}

describe("cron network recovery catch-up", () => {
  it("classifies ENOTFOUND and normalized network errors as recoverable", () => {
    expect(isNetworkRecoverableCronError("getaddrinfo ENOTFOUND api.example.com")).toBe(true);
    expect(isNetworkRecoverableCronError("network error")).toBe(true);
  });

  it("does not classify HTTP 401 or local write failures as recoverable", () => {
    expect(isNetworkRecoverableCronError("401 Unauthorized")).toBe(false);
    expect(
      isNetworkRecoverableCronError("EACCES: permission denied, open '/tmp/cron-jobs.json'"),
    ).toBe(false);
  });

  it("does not trigger recovery catch-up before 60 seconds of stable time", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createOverdueSystemJob({
          id: FOUNDER_OS_CRITICAL_JOB_ID,
          name: "founder-os critical",
          text: "replay founder critical",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    }) as RecoveryTrackedState;
    state.networkRecovery = {
      lastNetworkFailureAtMs: now - 59_000,
      lastStableSuccessAtMs: now - 59_000,
      lastErrorText: "network error",
    };

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("replays only Founder OS critical jobs after probe-confirmed recovery", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createOverdueSystemJob({
          id: FOUNDER_OS_CRITICAL_JOB_ID,
          name: "founder-os critical",
          text: "replay founder critical",
          nextRunAtMs: now - 5 * 60_000,
        }),
        createOverdueSystemJob({
          id: "non-founder-overdue",
          name: "non-founder overdue",
          text: "do not replay this",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: now - 60_000,
      lastErrorText: "getaddrinfo ENOTFOUND api.example.com",
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay founder critical",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("replays all Founder OS critical jobs without restart staggering after probe-confirmed recovery", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: FOUNDER_OS_CRITICAL_JOB_IDS.map((id, index) =>
        createOverdueSystemJob({
          id,
          name: `founder-os critical ${index + 1}`,
          text: `replay founder critical ${index + 1}`,
          nextRunAtMs: now - (index + 1) * 60_000,
        }),
      ),
    }) as RecoveryTrackedState;
    state.deps.maxMissedJobsPerRestart = 1;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: now - 60_000,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(4);
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(4);
    expect(
      noopLogger.info.mock.calls.some(
        ([, message]) => message === "cron: staggering missed jobs to prevent gateway overload",
      ),
    ).toBe(false);
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 4,
        jobIds: expect.arrayContaining(FOUNDER_OS_CRITICAL_JOB_IDS),
      }),
      "cron: running missed jobs after network recovery",
    );
  });

  it("replays a critical job whose latest network failure already advanced nextRunAtMs", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        {
          ...createOverdueSystemJob({
            id: FOUNDER_OS_CRITICAL_JOB_ID,
            name: "founder-os critical",
            text: "replay failed founder critical",
            nextRunAtMs: now + 6 * 60_000,
          }),
          state: {
            nextRunAtMs: now + 6 * 60_000,
            lastRunAtMs: now - 30_000,
            lastStatus: "error",
            lastError: "getaddrinfo ENOTFOUND api.example.com",
          },
        },
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: now - 60_000,
      lastErrorText: "getaddrinfo ENOTFOUND api.example.com",
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay failed founder critical",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("replays a critical network-failed job with a future nextRunAtMs only after probe-confirmed recovery", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const scheduledSlot = Date.parse("2026-02-06T10:01:00.000Z");
    const futureNextRunAtMs = Date.parse("2026-02-06T10:11:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        {
          ...createMissedCronSystemJob({
            id: FOUNDER_OS_CRITICAL_JOB_ID,
            name: "founder-os critical",
            text: "replay failed founder critical future slot",
            lastRunAtMs: scheduledSlot,
            nextRunAtMs: futureNextRunAtMs,
          }),
          state: {
            nextRunAtMs: futureNextRunAtMs,
            lastRunAtMs: scheduledSlot,
            lastStatus: "error",
            lastError: "network connection error",
          },
        },
      ],
    }) as ProbeRecoveryTrackedState;
    markProbeFailureWindow(state, now);

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();

    await runProbeRecovery(state, {
      runFeishuProbe: vi.fn().mockResolvedValue(true),
      runLlmProbe: vi.fn().mockResolvedValue(true),
    });

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay failed founder critical future slot",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("triggers recovery catch-up only once per probe-confirmed recovery window", async () => {
    let now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createOverdueSystemJob({
          id: FOUNDER_OS_CRITICAL_JOB_ID,
          name: "founder-os critical",
          text: "replay founder critical",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: now - 60_000,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    now += 30_000;

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("fires recovery after probe-confirmed success even when no later successful job is recorded", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createOverdueSystemJob({
          id: FOUNDER_OS_CRITICAL_JOB_ID,
          name: "founder-os critical",
          text: "replay founder critical without later success",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: undefined,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay founder critical without later success",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("does not replay critical jobs whose latest failure was not network-related", async () => {
    const now = Date.parse("2026-02-06T10:05:00.000Z");
    const lastFailure = now - 60_000;
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        {
          ...createOverdueSystemJob({
            id: FOUNDER_OS_CRITICAL_JOB_ID,
            name: "founder-os critical",
            text: "do not replay local failure",
            nextRunAtMs: now - 5 * 60_000,
          }),
          state: {
            nextRunAtMs: now - 5 * 60_000,
            lastRunAtMs: now - 30_000,
            lastStatus: "error",
            lastError: "EACCES: permission denied, open '/tmp/founder-os.txt'",
          },
        },
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: lastFailure,
      lastStableSuccessAtMs: lastFailure,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("runs network recovery catch-up from the timer loop after persisting normal results", async () => {
    const baseNow = Date.parse("2026-02-06T10:02:00.000Z");
    const dueJobId = "timer-due-job";
    const replayJobId = FOUNDER_OS_CRITICAL_JOB_IDS[0];
    const store = await makeStorePath();
    const jobs = [
      createOverdueSystemJob({
        id: dueJobId,
        name: "timer due job",
        text: "record timer result",
        nextRunAtMs: baseNow - 60_000,
      }),
      createMissedCronSystemJob({
        id: replayJobId,
        name: "founder-os replay candidate",
        text: "replay after timer persistence",
        nextRunAtMs: Date.parse("2026-02-06T10:11:00.000Z"),
        lastRunAtMs: Date.parse("2026-02-06T09:51:00.000Z"),
      }),
    ];
    await writeCronStoreSnapshot({ storePath: store.storePath, jobs });

    const persistedSnapshots: Array<{ lastStatus?: string; lastRunAtMs?: number }> = [];
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => baseNow,
      jobs,
    }) as RecoveryTrackedState;
    state.running = false;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: baseNow - 120_000,
      probeOkAtMs: baseNow - 60_000,
      lastStableSuccessAtMs: baseNow - 60_000,
      nextProbeAtMs: baseNow + 60_000,
    });
    state.deps.enqueueSystemEvent = vi.fn((text: string) => {
      if (text !== "replay after timer persistence") {
        return;
      }
      const persisted = JSON.parse(fs.readFileSync(store.storePath, "utf-8")) as {
        jobs: CronJob[];
      };
      const dueJob = persisted.jobs.find((job) => job.id === dueJobId);
      persistedSnapshots.push({
        lastStatus: dueJob?.state.lastStatus,
        lastRunAtMs: dueJob?.state.lastRunAtMs,
      });
    }) as typeof state.deps.enqueueSystemEvent;

    await onTimer(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenNthCalledWith(
      1,
      "record timer result",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.enqueueSystemEvent).toHaveBeenNthCalledWith(
      2,
      "replay after timer persistence",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(2);
    expect(persistedSnapshots).toEqual([{ lastStatus: "ok", lastRunAtMs: baseNow }]);
  });

  it("allows one catch-up per recovery window instead of becoming a permanent latch", async () => {
    let now = Date.parse("2026-02-06T10:05:00.000Z");
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createOverdueSystemJob({
          id: FOUNDER_OS_CRITICAL_JOB_ID,
          name: "founder-os critical",
          text: "replay founder critical",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: now - 60_000,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    now += 5 * 60_000;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 61_000,
      lastStableSuccessAtMs: now - 61_000,
      lastRecoveryCatchupTriggeredAtMs: now - 5 * 60_000,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(2);
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(2);
  });

  it("opens a new recovery window after a later network failure", async () => {
    let now = Date.parse("2026-02-06T10:05:00.000Z");
    const initialFailure = now - 60_000;
    const store = await makeStorePath();
    const state = createRunningCronServiceState({
      storePath: store.storePath,
      log: noopLogger,
      nowMs: () => now,
      jobs: [
        createOverdueSystemJob({
          id: FOUNDER_OS_CRITICAL_JOB_ID,
          name: "founder-os critical",
          text: "replay founder critical",
          nextRunAtMs: now - 5 * 60_000,
        }),
      ],
    }) as RecoveryTrackedState;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: initialFailure,
      lastStableSuccessAtMs: initialFailure,
    });

    await maybeRunNetworkRecoveryCatchup(state);

    now += 3 * 60_000;
    markProbeConfirmedRecovery(state, {
      lastFailureAtMs: now - 60_000,
      lastStableSuccessAtMs: now - 60_000,
      lastRecoveryCatchupTriggeredAtMs: initialFailure + 60_000,
      lastErrorText: "getaddrinfo ENOTFOUND api.example.com",
    });

    await maybeRunNetworkRecoveryCatchup(state);

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(2);
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(2);
  });
});
