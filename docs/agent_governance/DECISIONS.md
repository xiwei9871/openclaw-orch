# Decision register

ACTIVE entries block conflicting requests — report, never silently implement.

| ID | Decision | Status |
| --- | --- | --- |
| D01 | No secrets/credentials committed | **ACTIVE** |
| D02 | Task-orchestration safety: no process termination/prod actions without authorization | **ACTIVE** |
| D03 | Build/test/deploy statuses reported separately; unverified = NOT_VERIFIED | **ACTIVE** |
