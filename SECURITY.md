# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | ✅ |
| < 0.2  | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Email the maintainer directly with:

- what the issue is, and which component is affected (`src/core/`, `src/eval/`, …)
- the steps to reproduce it
- the impact you believe it has
- any suggested fix

You will get an acknowledgement within 72 hours and a status update within 7 days.
Fixes for confirmed issues are released as a patch version and credited in
`CHANGELOG.md` unless you ask us not to.

## Scope

This project executes **shell commands** (via `test-command` graders and
config-driven hooks) and evaluates **model output**. Treat both as trusted-code
surfaces.

In scope:

- a flaw in the policy engine that lets a denied action through
- path traversal or arbitrary file write in the state store, checkpoint store, or
  memory store
- command injection in the `test-command` grader or the hook runner
- secret leakage into logs, the state store, or checkpoint files
- a remote or local code-execution path that the documented policy would have blocked

Out of scope:

- vulnerabilities in a model provider's own API
- a hook command you wrote yourself that does something dangerous — hook commands run
  with your permissions by design
- denial of service from an intentionally huge dataset or workflow

## Security-relevant defaults

forge ships with these enabled; please keep them on and do not disable them without
understanding the trade-off:

- The **policy engine** blocks recursive root deletes, `curl | sh`, access to
  credential paths, and writes containing obvious secrets. `forge policy list` shows
  the current rules.
- **Hook commands run with your permissions.** Read a hook config before you trust it.
- **State, checkpoints, and memory are plain JSON on disk** and may contain prompt
  text, model output, and (if you put them there) secrets. `.forge/` is gitignored by
  default; keep it that way.
- **The `mock` provider never makes network calls.** Real providers send your prompt
  text to the provider you configured — that is the point, but it means prompts leave
  your machine.
