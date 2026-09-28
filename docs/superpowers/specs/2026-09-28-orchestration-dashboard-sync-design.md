# Cron-to-Feishu Dashboard Sync Design

## Context

The local `workspace-tui` script reads scheduled jobs from `openclaw cron list --all --json` and projects their status into a Feishu Bitable table. Its current copy depends on a machine-specific generated bundle path and local workspace paths. The repository already has `openclaw tasks control --sync-feishu`, but that command projects task-registry data; the local script projects scheduler jobs, so the two have different inputs and should remain separate.

## Recommended approach

Promote the scheduler projection as a repository-owned TypeScript script under `scripts/`, with a portable shell launcher and a package command. First extract a generic `syncBitableProjectionToFeishu` persistence primitive from `src/tasks/control-plane/feishu-bitable.ts`. Its projection uses `fields`, `rows`, `views`, and `rowKey`; it has no Task identifiers or Task view names. Keep `syncTaskControlProjectionToFeishu` as a compatibility wrapper that maps each Task row's `taskId` to generic `rowKey`, retains the `Task ID` unique-field default, and translates Task view metadata into generic view settings.

Model scheduler data separately as `SchedulerProjection`. Preserve the old script's stable identity exactly: `job.id` remains the row key stored in the `对象ID` field. The scheduler script calls the generic Bitable primitive directly, loads configuration through OpenClaw's config loader, and makes the Feishu table target and optional account configurable through command arguments or environment variables.

The script will support a dry-run mode that reports the projected row count without calling Feishu write operations. Normal mode will select one configured account and perform one sync attempt; it will not silently cycle through unrelated accounts. Results go to stdout by default, with an optional caller-selected result path. The launcher derives the repository root from its own location and invokes the TypeScript entrypoint through the repository's existing `tsx` runtime.

## Alternatives considered

1. **Keep the script in `workspace-tui`.** This avoids repository changes, but leaves the only copy untracked and tied to a missing local build artifact.
2. **Replace it with `openclaw tasks control --sync-feishu`.** This reuses the CLI, but changes the projection from scheduler jobs to task-registry records.
3. **Add a portable scheduler-specific script and generic Bitable persistence primitive to `openclaw-orch` (recommended).** This preserves the existing scheduler projection while sharing only the Bitable persistence mechanics with the Task Control Plane.

## Scope and boundaries

- Add the generic Bitable sync primitive, compatibility wrapper, scheduler projection and script, portable launcher, package command, focused tests, and usage guidance.
- Keep `TaskControlProjection` and `SchedulerProjection` as separate business models. Both adapt to the generic persistence shape without introducing a unified task/scheduler model.
- Preserve `job.id` as scheduler `rowKey` and `对象ID` as its Bitable unique field, matching the prior local script.
- Keep machine-specific paths, live workspace state, snapshots, temporary sync files, and dependencies out of the repository.
- Do not add a second Feishu API client or change the task-control-plane projection.
- Do not run a live Feishu write as part of implementation verification.

## Error handling and verification

Missing target configuration, failed `openclaw cron list` execution, invalid JSON, config-load errors, and Feishu sync failures should produce a clear error and a nonzero exit. Dry-run must not invoke Feishu write operations. Focused tests must cover the scheduler parser, stable key, all listed failure cases, dry-run behavior, and compatibility of the Task wrapper with the generic primitive. Verify typechecking, focused tests, Task Control Plane regression tests, an offline scheduler dry-run, and a clean diff/status check; do not perform a live table update.
