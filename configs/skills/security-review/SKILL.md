---
name: security-review
description: A security checklist to run against any change touching input, auth, secrets, external data, or dependencies.
---

# Security Review Checklist

Run these checks before approving a change.

## Injection
- [ ] No SQL built by string concatenation / f-strings — parameterized only.
- [ ] No `subprocess(..., shell=True)` with interpolated input; arg lists only.
- [ ] No `eval` / `exec` / `os.system` on external data.
- [ ] Paths from user input are validated against a base directory (no traversal).

## Deserialization & input
- [ ] No `pickle` / `marshal` / `shelve` on untrusted bytes.
- [ ] `yaml.safe_load`, not `yaml.load`.
- [ ] Structured input validated with a schema (pydantic/zod/etc.) at the boundary.

## Secrets & crypto
- [ ] No hardcoded keys/tokens/passwords; no committed `.env`.
- [ ] `secrets`, not `random`, for tokens/passwords/salts.
- [ ] No home-rolled crypto; no static IVs / ECB.

## Auth & access
- [ ] Every privileged path checks authN/authZ.
- [ ] Token/secret comparison is constant-time where relevant.

## Dependencies & output
- [ ] Dependencies pinned; no known-vulnerable versions.
- [ ] Errors and logs don't leak secrets or internal paths.
