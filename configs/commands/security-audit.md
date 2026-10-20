---
description: Audit a change for security defects — injection, secrets, authz, and unsafe deserialization.
---

# /security-audit

Review the diff for security defects, ranked by exploitability.

**Check, in this order**
1. **Injection** — SQL/NoSQL built by string concatenation; shell commands
   built from input; LDAP/XPath/template injection; unsanitised HTML.
2. **Secrets** — hardcoded keys, tokens, passwords, private keys; secrets in
   logs, error messages, or committed `.env`; secrets in URLs or headers.
3. **Authentication & authorisation** — missing checks on new endpoints; IDOR
   (an id from the request used without an ownership check); role checks
   performed client-side or only in the UI.
4. **Input validation** — unvalidated input crossing a trust boundary; no
   schema validation; unbounded input accepted into memory or a query.
5. **Deserialisation** — `pickle`, `yaml.load`, `eval`/`exec`, or unsafe
   deserialisation of untrusted data.
6. **Cryptography** — MD5/SHA1 for passwords, `Math.random()` for tokens,
   hardcoded IVs, disabled TLS verification.
7. **File & path handling** — path traversal from user input; writing to a
   user-controlled path; unrestricted file uploads.
8. **Dependencies** — new or upgraded packages, and their advisories.
9. **Transport & headers** — missing CORS restriction, missing security
   headers, cookies without `Secure`/`HttpOnly`/`SameSite`.

**Report** each finding as `[SEVERITY] title`, `file:line`, the concrete attack
path, and the fix. Bands: CRITICAL (exploitable now), HIGH, MEDIUM, LOW.

**Never** report a hypothetical without naming the input an attacker controls
and the code path that reaches it. If you cannot describe the attack, it is a
style note, not a finding.
