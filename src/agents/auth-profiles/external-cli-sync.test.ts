import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORE_VERSION, CODEX_CLI_PROFILE_ID } from "./constants.js";
import type { AuthProfileStore, OAuthCredential } from "./types.js";

const mocks = vi.hoisted(() => ({
  readCodexCliCredentialsCached: vi.fn<() => OAuthCredential | null>(),
  readMiniMaxCliCredentialsCached: vi.fn<() => OAuthCredential | null>(),
  readQwenCliCredentialsCached: vi.fn<() => OAuthCredential | null>(),
}));

vi.mock("../cli-credentials.js", () => ({
  readCodexCliCredentialsCached: mocks.readCodexCliCredentialsCached,
  readMiniMaxCliCredentialsCached: mocks.readMiniMaxCliCredentialsCached,
  readQwenCliCredentialsCached: mocks.readQwenCliCredentialsCached,
}));

const { syncExternalCliCredentials } = await import("./external-cli-sync.js");

function createStore(profiles: AuthProfileStore["profiles"] = {}): AuthProfileStore {
  return {
    version: AUTH_STORE_VERSION,
    profiles: { ...profiles },
  };
}

describe("syncExternalCliCredentials codex", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T04:30:00Z"));
    mocks.readCodexCliCredentialsCached.mockReset();
    mocks.readMiniMaxCliCredentialsCached.mockReset();
    mocks.readQwenCliCredentialsCached.mockReset();
    mocks.readMiniMaxCliCredentialsCached.mockReturnValue(null);
    mocks.readQwenCliCredentialsCached.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("syncs Codex CLI credentials into the auth store", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "openai-codex",
      access: "codex-access",
      refresh: "codex-refresh",
      expires: Date.now() + 60_000,
      accountId: "acc-codex",
    });

    const store = createStore();

    const mutated = syncExternalCliCredentials(store);

    expect(mutated).toBe(true);
    expect(store.profiles[CODEX_CLI_PROFILE_ID]).toMatchObject({
      type: "oauth",
      provider: "openai-codex",
      access: "codex-access",
      refresh: "codex-refresh",
      accountId: "acc-codex",
    });
  });

  it("refreshes a stale Codex CLI profile from the Codex auth source", () => {
    mocks.readCodexCliCredentialsCached.mockReturnValue({
      type: "oauth",
      provider: "openai-codex",
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: Date.now() + 120_000,
      accountId: "acc-fresh",
    });

    const store = createStore({
      [CODEX_CLI_PROFILE_ID]: {
        type: "oauth",
        provider: "openai-codex",
        access: "stale-access",
        refresh: "stale-refresh",
        expires: Date.now() - 1,
        accountId: "acc-stale",
      },
    });

    const mutated = syncExternalCliCredentials(store);

    expect(mutated).toBe(true);
    expect(store.profiles[CODEX_CLI_PROFILE_ID]).toMatchObject({
      access: "fresh-access",
      refresh: "fresh-refresh",
      accountId: "acc-fresh",
    });
  });
});
