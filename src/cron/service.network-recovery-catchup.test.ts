import { describe, expect, it } from "vitest";
import { createRunningCronServiceState, setupCronServiceSuite } from "./service.test-harness.js";
import { isNetworkRecoverableCronError, maybeRunNetworkRecoveryCatchup } from "./service/timer.js";
import type { CronJob } from "./types.js";

const { logger: noopLogger, makeStorePath } = setupCronServiceSuite({
  prefix: "openclaw-cron-network-recovery-",
  baseTimeIso: "2026-02-06T10:05:00.000Z",
});

const FOUNDER_OS_CRITICAL_JOB_ID = "c0ff4e45-9a3c-417e-a324-a95d65a16a28";

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

describe("cron network recovery catch-up", () => {
  it("classifies ENOTFOUND and normalized network errors as recoverable", () => {
    expect(
      isNetworkRecoverableCronError(
        Object.assign(new Error("dial tcp: lookup api.example.com: no such host"), {
          code: "ENOTFOUND",
        }),
      ),
    ).toBe(true);
    expect(isNetworkRecoverableCronError("network error")).toBe(true);
  });

  it("does not classify HTTP 401 or local write failures as recoverable", () => {
    expect(
      isNetworkRecoverableCronError(
        Object.assign(new Error("401 Unauthorized"), {
          status: 401,
        }),
      ),
    ).toBe(false);
    expect(
      isNetworkRecoverableCronError(
        new Error("EACCES: permission denied, open '/tmp/cron-jobs.json' for write"),
      ),
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
    });

    await maybeRunNetworkRecoveryCatchup(state, {
      stableSinceMs: now - 59_000,
      lastError: new Error("network error"),
    });

    expect(state.deps.enqueueSystemEvent).not.toHaveBeenCalled();
    expect(state.deps.requestHeartbeatNow).not.toHaveBeenCalled();
  });

  it("replays only Founder OS critical jobs after the stable recovery window", async () => {
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
    });

    await maybeRunNetworkRecoveryCatchup(state, {
      stableSinceMs: now - 60_000,
      lastError: Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), {
        code: "ENOTFOUND",
      }),
    });

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledWith(
      "replay founder critical",
      expect.objectContaining({ agentId: undefined }),
    );
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });

  it("triggers recovery catch-up only once per stable recovery window", async () => {
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
    });

    await maybeRunNetworkRecoveryCatchup(state, {
      stableSinceMs: now - 60_000,
      lastError: new Error("network error"),
    });

    now += 30_000;

    await maybeRunNetworkRecoveryCatchup(state, {
      stableSinceMs: now - 90_000,
      lastError: new Error("network error"),
    });

    expect(state.deps.enqueueSystemEvent).toHaveBeenCalledTimes(1);
    expect(state.deps.requestHeartbeatNow).toHaveBeenCalledTimes(1);
  });
});
