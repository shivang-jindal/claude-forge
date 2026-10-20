---
name: observability
description: Mandatory observability rules — structured logs, metrics, traces, and actionable errors.
---

# Observability Rules

- **Logs are structured** (JSON fields, not a formatted sentence), and carry a
  request/trace id, the service name, and the environment.
- **Log levels mean something.** `ERROR` = a human should look; `WARN` =
  degraded but handled; `INFO` = business milestone; `DEBUG` = off in prod.
- **Never log secrets, tokens, passwords, session ids, or full request
  bodies.** Redact at the logger, not at the call site.
- **Errors carry context** — what failed, for which entity, with the cause —
  and are actionable without reading the source.
- **No bare `catch {}`.** Either handle it, re-throw it, or log it with
  context. Swallowed exceptions are invisible outages.
- **Every external dependency call has a timeout and a retry policy** with a
  bounded attempt count and backoff.
- **Metrics for the things you alert on**: request rate, error rate, latency
  percentiles, saturation, and queue depth. A metric nobody alerts on is
  decoration.
- **Distributed tracing spans cross service boundaries**, and the trace id
  propagates through async work and queues.
- **Health endpoints are meaningful**: liveness says "the process is alive",
  readiness says "I can serve traffic right now".
- **Every alert is actionable and has an owner.** An alert with no runbook is
  noise that trains people to ignore alerts.
- **PII is redacted in logs and traces** to the same standard as secrets.
