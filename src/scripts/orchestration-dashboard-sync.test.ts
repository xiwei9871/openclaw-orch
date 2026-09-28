import { describe, expect, it, vi } from "vitest";
import { main } from "../../scripts/orchestration-dashboard-sync.js";

const cronOutput = JSON.stringify([{ id: "cron-42", name: "Nightly" }]);

function createDeps(overrides: Record<string, unknown> = {}) {
  return {
    readCronOutput: vi.fn(() => cronOutput),
    loadConfig: vi.fn(() => ({})),
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
});
