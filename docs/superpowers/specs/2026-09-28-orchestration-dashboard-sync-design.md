# Cron-to-Feishu Dashboard Sync Design

## Context

The local `workspace-tui` script reads scheduled jobs from `openclaw cron list --all --json` and projects their status into a Feishu Bitable table. Its current copy depends on a machine-specific generated bundle path and local workspace paths. The repository already has `openclaw tasks control --sync-feishu`, but that command projects task-registry data; the local script projects scheduler jobs, so the two have different inputs and should remain separate.

## Recommended approach

Promote the scheduler projection as a repository-owned TypeScript script under `scripts/`, with a portable shell launcher and a package command. Import the existing `syncTaskControlProjectionToFeishu` implementation from the repository source and load configuration through OpenClaw's config loader. Keep the current cron fields and stable row key, while making the Feishu table target and optional account configurable through command arguments or environment variables.

The script will support a dry-run mode that lists the projected row count without writing to Feishu. Normal mode will select one configured account and perform one sync attempt; it will not silently cycle through unrelated accounts. Results go to stdout by default, with an optional caller-selected result path. The launcher derives the repository root from its own location and invokes the TypeScript entrypoint through the repository's existing `tsx` runtime.

## Alternatives considered

1. **Keep the script in `workspace-tui`.** This avoids repository changes, but leaves the only copy untracked and tied to a missing local build artifact.
2. **Replace it with `openclaw tasks control --sync-feishu`.** This reuses the CLI, but changes the projection from scheduler jobs to task-registry records.
3. **Add a portable scheduler-specific script to `openclaw-orch` (recommended).** This preserves the existing projection while using the repository's supported config and sync code.

## Scope and boundaries

- Add the scheduler projection script, portable launcher, package command, and focused usage guidance.
- Keep machine-specific paths, live workspace state, snapshots, temporary sync files, and dependencies out of the repository.
- Do not add a second Feishu API client or change the task-control-plane projection.
- Do not run a live Feishu write as part of implementation verification.

## Error handling and verification

Missing target configuration, failed `openclaw cron list` execution, invalid JSON, config-load errors, and Feishu sync failures should produce a clear error and a nonzero exit. Dry-run must not invoke the Feishu sync helper. Verify the implementation with repository type checking, a dry-run invocation, and a clean diff check; do not perform a live table update.
