import { describe, expect, it } from "vitest";
import { buildSchedulerProjection, parseCronJobListOutput } from "./scheduler-projection.js";

describe("scheduler projection", () => {
  it("parses array and jobs-wrapper cron output", () => {
    expect(parseCronJobListOutput(JSON.stringify([{ id: "cron-1" }]))).toHaveLength(1);
    expect(parseCronJobListOutput(JSON.stringify({ jobs: [{ id: "cron-2" }] }))).toHaveLength(1);
  });

  it("keeps the cron job id as the stable row key and object id", () => {
    const projection = buildSchedulerProjection(
      [
        {
          id: "cron-42",
          name: "Nightly",
          state: {
            lastStatus: "ok",
            consecutiveErrors: 2,
            nextRunAtMs: Date.UTC(2026, 8, 28, 12, 0, 0),
            lastError: "",
          },
        },
      ],
      Date.UTC(2026, 8, 28, 8, 0, 0),
    );

    expect(projection.rows[0]).toMatchObject({
      rowKey: "cron-42",
      fields: {
        对象ID: "cron-42",
        对象名称: "Nightly",
        状态: "ok",
        连续错误: 2,
      },
    });
  });

  it("rejects malformed JSON, invalid shapes, and missing ids", () => {
    expect(() => parseCronJobListOutput("not-json")).toThrow(/invalid cron JSON/i);
    expect(() => parseCronJobListOutput(JSON.stringify({ data: [] }))).toThrow(
      /cron list must be an array or contain jobs/i,
    );
    expect(() => buildSchedulerProjection([{ name: "Missing ID" }], Date.UTC(2026, 8, 28))).toThrow(
      /cron job id/i,
    );
  });
});
