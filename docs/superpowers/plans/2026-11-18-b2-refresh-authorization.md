# B2 Refresh Authorization Implementation Plan

> For agentic workers: use executing-plans or subagent-driven-development task by task.

Goal: authorize read-only PAT use before live refresh without replacing final release gates.
Architecture: explicit protected commands with distinct non-productive results, then unchanged live gates.
Tech stack: Node ESM, existing private runtime/controller, GitHub workflow.
Spec: ../specs/2026-11-18-b2-refresh-authorization-design.md

Constraints: no production, network operations, credentials or protected-pin updates. Preserve WIP.

Review focus: missing/wrong authority, stale authorization, preflight-output substitution, failed/changed live inventory, early PAT exposure.

- [ ] Add failing integration tests for preflight and refresh authorization without PAT and zero inventory calls.
- [ ] Factor authority-only preflight checks and add distinct helper commands/results; leave existing full checks intact.
- [ ] Route new actions through protected runtime/controller; reject PAT during preflight and require authenticated refresh permit for live access.
- [ ] Reorder workflow around preflight, authorization, live refresh and final gate, with fail-closed outcome checks.
- [ ] Test negative paths and existing gate suites; obtain independent review. No commit or publish in this task.
