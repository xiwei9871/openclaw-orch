import { describe, expect, it, vi } from "vitest";
import { main, type SchedulerSyncDeps } from "../../scripts/orchestration-dashboard-sync.js";
import type { FeishuBitableClient } from "../../src/tasks/feishu-bitable-sync.js";

const cronOutput = JSON.stringify([{ id: "cron-42", name: "Nightly" }]);

function createDeps(overrides: Partial<SchedulerSyncDeps> = {}): SchedulerSyncDeps {
  return {
    readCronOutput: vi.fn(() => cronOutput),
    loadConfig: vi.fn(() => ({})),
    createClient: vi.fn(() => ({}) as FeishuBitableClient),
    syncProjection: vi.fn(async () => ({ accountId: "default" })),
    writeOutput: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };
}

describe("orchestration dashboard sync runner", () => {
  it("supports dry-run without loading config or writing to Feishu", async () => {
    const deps = createDeps();

    const exitCode = await main(["--dry-run"], deps);

    expect(exitCode).toBe(0);
    expect(deps.loadConfig).not.toHaveBeenCalled();
    expect(deps.syncProjection).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('"dryRun":true'));
  });

  it("rejects a live run without an app token and table id", async () => {
    const deps = createDeps();

    const exitCode = await main([], deps);

    expect(exitCode).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/app token.*table id/i));
    expect(deps.readCronOutput).not.toHaveBeenCalled();
  });

  it("returns nonzero when the cron command fails", async () => {
    const deps = createDeps({
      readCronOutput: vi.fn(() => {
        throw new Error("cron unavailable");
      }),
    });

    const exitCode = await main(["--app-token", "app", "--table-id", "table"], deps);

    expect(exitCode).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/cron unavailable/i));
  });

  it("returns nonzero for invalid cron JSON", async () => {
    const deps = createDeps({ readCronOutput: vi.fn(() => "not-json") });

    const exitCode = await main(["--app-token", "app", "--table-id", "table"], deps);

    expect(exitCode).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/invalid cron JSON/i));
  });

  it("returns nonzero when config loading fails", async () => {
    const deps = createDeps({
      loadConfig: vi.fn(() => {
        throw new Error("config unavailable");
      }),
    });

    const exitCode = await main(["--app-token", "app", "--table-id", "table"], deps);

    expect(exitCode).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/config unavailable/i));
    expect(deps.syncProjection).not.toHaveBeenCalled();
  });

  it("returns nonzero when Feishu sync fails", async () => {
    const deps = createDeps({
      syncProjection: vi.fn(async () => {
        throw new Error("bitable write failed");
      }),
    });

    const exitCode = await main(["--app-token", "app", "--table-id", "table"], deps);

    expect(exitCode).toBe(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/bitable write failed/i));
  });

  it("sends the scheduler projection to the generic row-key primitive", async () => {
    const deps = createDeps();

    const exitCode = await main(["--app-token", "app", "--table-id", "table"], deps);

    expect(exitCode).toBe(0);
    expect(deps.syncProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ rowKeyFieldName: "对象ID" }),
        projection: expect.objectContaining({
          rows: [expect.objectContaining({ rowKey: "cron-42" })],
        }),
      }),
    );
  });

  it("passes the secret-resolved config to the client factory", async () => {
    const resolvedCfg = { marker: "resolved" };
    const resolveSecrets = vi.fn(async () => resolvedCfg as never);
    const createClient = vi.fn(() => ({}) as FeishuBitableClient);
    const deps = createDeps({ resolveSecrets, createClient });

    const exitCode = await main(
      ["--app-token", "app", "--table-id", "table", "--account", "jarvis"],
      deps,
    );

    expect(exitCode).toBe(0);
    expect(resolveSecrets).toHaveBeenCalledWith(expect.objectContaining({ accountId: "jarvis" }));
    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({ cfg: resolvedCfg, accountId: "jarvis" }),
    );
  });

  it("resolves the selected account's file SecretRef in memory only", async () => {
    const { withTempDir } = await import("../test-helpers/temp-dir.js");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await withTempDir({ prefix: "orch-secrets-" }, async (root) => {
      const secretsFile = path.join(root, "secrets.json");
      await fs.writeFile(secretsFile, JSON.stringify({ appSecret: "resolved-app-secret" }), {
        mode: 0o600,
      });
      await fs.chmod(secretsFile, 0o600);
      const cfg = {
        channels: {
          feishu: {
            defaultAccount: "jarvis",
            accounts: {
              jarvis: {
                appId: "cli_test",
                appSecret: { source: "file", provider: "testfile", id: "/appSecret" },
              },
            },
          },
        },
        secrets: {
          providers: { testfile: { source: "file", path: secretsFile, mode: "json" } },
        },
      };
      const createClient = vi.fn((_params: { cfg: unknown; accountId?: string }) => {
        return {} as FeishuBitableClient;
      });
      const deps = createDeps({
        loadConfig: vi.fn(() => cfg as never),
        createClient,
      });

      const exitCode = await main(["--app-token", "app", "--table-id", "table"], deps);

      expect(exitCode).toBe(0);
      const seenCfg = createClient.mock.calls[0]?.[0]?.cfg as {
        channels: { feishu: { accounts: { jarvis: { appSecret: string } } } };
      };
      expect(seenCfg.channels.feishu.accounts.jarvis.appSecret).toBe("resolved-app-secret");
      const logSpy = deps.log as ReturnType<typeof vi.fn>;
      for (const call of logSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("resolved-app-secret");
      }
    });
  });

  it("fails closed when the selected account's SecretRef cannot be resolved", async () => {
    const { withTempDir } = await import("../test-helpers/temp-dir.js");
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await withTempDir({ prefix: "orch-secrets-" }, async (root) => {
      const secretsFile = path.join(root, "secrets.json");
      await fs.writeFile(secretsFile, JSON.stringify({ other: "value" }), { mode: 0o600 });
      await fs.chmod(secretsFile, 0o600);
      const cfg = {
        channels: {
          feishu: {
            accounts: {
              jarvis: {
                appId: "cli_test",
                appSecret: { source: "file", provider: "testfile", id: "/missing" },
              },
            },
          },
        },
        secrets: {
          providers: { testfile: { source: "file", path: secretsFile, mode: "json" } },
        },
      };
      const deps = createDeps({ loadConfig: vi.fn(() => cfg as never) });

      const exitCode = await main(
        ["--app-token", "app", "--table-id", "table", "--account", "jarvis"],
        deps,
      );

      expect(exitCode).toBe(1);
      expect(deps.error).toHaveBeenCalledWith(expect.stringMatching(/appSecret/));
      expect(deps.createClient).not.toHaveBeenCalled();
      expect(deps.syncProjection).not.toHaveBeenCalled();
    });
  });
});
