---
description: Review an API design or change for resource modelling, error contracts, and backward compatibility.
---

# /api-review

Review an API surface for consistency, safety, and evolvability.

**Resources**
- URLs name resources, not actions. Plural, lowercase, hyphen-separated.
- The HTTP method matches the semantics (GET safe, PUT idempotent, PATCH
  partial, POST creates, DELETE removes).
- Nesting is at most one level deep; deeper relationships become filters.

**Schema**
- Request and response shapes are explicit and typed.
- Optional fields have defined behaviour when absent; `null` versus absent is
  a deliberate, documented distinction.
- Enums, not free strings, for a closed set of states.
- Pagination on every list endpoint — cursor for large sets.

**Errors**
- One error envelope for the whole API: machine-readable `code`, human-readable
  `message`, optional field-level `details`.
- Status codes reflect the condition: 400, 401, 403, 404, 409, 422, 429.
- No stack traces, SQL, or internal identifiers in an error body.

**Compatibility**
- Classify every change: additive (safe), or breaking (removal, rename, type
  narrowing, default change, semantic change).
- Breaking changes need a new version and a sunset date for the old one.
- Deprecations are announced in headers and in the changelog.

**Operability**
- Rate limits documented and returned in headers.
- Idempotency keys on retryable POSTs.
- Trace and request ids echoed in responses.

**Report**: the endpoint, the request/response contract, the error model, the
compatibility classification, and any inconsistency with sibling endpoints.
