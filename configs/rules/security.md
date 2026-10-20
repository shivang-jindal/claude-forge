---
name: security
description: Mandatory security checks for every change.
---

# Security Rules

- No hardcoded secrets. Read from env / secret manager; never commit `.env`.
- Parameterize all SQL — no f-string or concatenation-built queries.
- `subprocess` with arg lists and `shell=False`; never interpolate a command string.
- `yaml.safe_load`, not `yaml.load`. No `pickle`/`marshal`/`eval`/`exec` on external input.
- `secrets` (not `random`) for tokens, passwords, salts, reset URLs.
- Validate structured input at the boundary with a schema.
- Don't log secrets, tokens, or full internal paths.
