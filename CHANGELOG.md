# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-10-20

### Added

- **npm package** — published as `claude-forge-cli`. Node blocks type stripping inside
  `node_modules`, so the package ships the same TypeScript source as the repository and
  registers a loader hook (`bin/loader.js`) that strips types at load time. No build step,
  no compiler, no dependencies. `tests/packaging.test.ts` verifies every module still
  loads through that loader.
- **`forge init` now scaffolds a complete project** — configs, an example workflow, an eval
  dataset, a `forge.config.json` gate, and a sample session log — so `run`, `eval`, `ci`,
  and `learn` all work immediately after init.
- **Hook runtime** (`src/core/hooks.ts`) — 14 lifecycle phases; handlers can observe
  events or veto a step.
- **Config-driven hooks** (`src/core/hookconfig.ts`) — shell commands in
  `configs/hooks/*.json`, wired to the run via `FORGE_*` environment variables.
- **Policy engine** (`src/core/policy.ts`) — enforceable guardrails with `deny` and
  `require-approval` effects, seven safe defaults, and integration with the hook
  runtime as a `tool:pre` guard.
- **Persistent memory** (`src/core/memory.ts`) — typed entries with keyword and tag
  retrieval plus usage-recency scoring.
- **Rate limiting and circuit breaking** (`src/core/ratelimit.ts`) — token bucket and
  circuit breaker with half-open probing; both accept an injectable clock.
- **Checkpoint and resume** (`src/core/checkpoint.ts`) — save a run's completed steps
  and resume without redoing them.
- **Saga compensation** (`src/orchestration/saga.ts`) — reverse-order rollback of
  completed steps when a later step fails.
- **DAG analysis and rendering** (`src/orchestration/graph.ts`) — levels, critical
  path, max parallelism, Mermaid and ASCII output.
- **A/B comparison with bootstrap significance** (`src/eval/compare.ts`).
- **Six new graders** — `contains-all`, `not-contains`, `similarity` (Levenshtein),
  `json-valid`, `json-path`, `schema`.
- **Pattern clustering** (`src/learning/cluster.ts`) — groups near-duplicate
  corrections so one skill proposal covers a family of them.
- **Six new CLI commands** — `graph`, `policy`, `memory`, `checkpoint`, `hooks`,
  `compare` — plus `--checkpoint` and `--resume` on `forge run`.
- **Expanded config library** — 18 agents, 12 skills, 13 commands, 9 rules.
- **Agent system-prompt injection** — a step that names an `agent` now runs with that
  agent's instructions.

### Fixed

- `runEval` reported `costUsd` as a hardcoded `0`; it now aggregates the cost the
  runner reports.
- The `mode` option was accepted but had no effect; `checkpoint` now reports without
  persisting and `continuous` persists and tracks regressions.
- The `test-command` grader used POSIX single-quote escaping, which breaks on
  Windows. Output and expected are now passed as `FORGE_OUTPUT` / `FORGE_EXPECTED`
  environment variables.
- `makeProvider` did not read `OPENAI_BASE_URL`, despite the documentation claiming it did.
- `forge run` named agents in workflows but never used their instructions.
- `CheckpointStore` read `stepId` from a `StepResult`, which has no such field, so no
  checkpoint was ever recorded; `remove()` also did not delete the file.
- JSON parsing failed on files with a UTF-8 BOM, which Windows tools write by default.
- Config-driven hook output was captured but never printed, so hooks ran silently.

### Changed

- The documented minimum Node version is now **24.0.0** — the version this project is
  actually verified against, rather than an untested lower bound.
- README examples are now executed as tests (`tests/readme.test.ts`).

## [0.1.0] - 2026-10-20

### Added

- Workflow engine with DAG dependencies, bounded parallelism, retries with backoff,
  timeouts, conditional skips, and branch routing.
- `ContextManager` with token and cost metering and automatic compaction.
- Provider abstraction with Anthropic, OpenAI, Ollama, and a deterministic mock.
- Eval harness with pass@k, pluggable graders, and regression detection.
- Bounded fan-out, git worktree orchestration, and cheap-model-first cascade.
- Self-improving loop: session-log parsing, pattern extraction, and versioned skill
  proposals behind a human approval gate.
- `forge` CLI: `init`, `run`, `eval`, `agent`, `skill`, `learn`, `ci`, `config`, `status`.
- Atomic JSON state store under `.forge/`.
