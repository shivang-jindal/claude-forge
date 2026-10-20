---
name: kubernetes-patterns
description: Kubernetes deployment patterns — probes, rollouts, resources, autoscaling, and configuration.
---

# Kubernetes Patterns

**Probes**
- `readinessProbe` — "should this pod receive traffic?" Depends only on the
  pod's own ability to serve.
- `livenessProbe` — "should the kubelet restart this?" Must NOT check
  dependencies; a slow database must not cause a restart loop.
- `startupProbe` — for slow boots. It gates the liveness probe until the app
  is up, so you never need a huge liveness threshold.

**Resources**
- Always set `requests` and `limits`.
- CPU: requests == limits for latency-sensitive, CPU-throttled services.
- Memory: limit > request (a ratio like 1.5–2×) so bursts fit before OOM.
- QoS `Guaranteed` requires requests == limits for both CPU and memory.

**Rollouts**
- `maxUnavailable: 0`, `maxSurge: 25%` for zero-downtime.
- `terminationGracePeriodSeconds` long enough to drain in-flight requests.
- `preStop` sleep so the pod leaves Service endpoints before SIGTERM arrives.
- `PodDisruptionBudget` for anything that must stay up during node drains.
- `readinessGates` for custom startup coordination.

**Scaling**
- HPA on a metric that reflects demand (CPU *and* memory for memory-bound
  services; a custom metric for queue depth).
- Always set `minReplicas` >= 2 in production so a node loss is survivable.
- `behavior`/`scaleDown` stabilisation windows to prevent flapping.

**Configuration**
- ConfigMap for non-secret config; Secrets from a secret manager (External
  Secrets, CSI driver). Never a base64 Secret committed to git.
- Mount Secrets as files, not env vars, when the app supports it — env vars
  leak into `ps` and crash dumps.
- `envFrom` with `configMapRef`/`secretRef` for whole blocks.
- `imagePullPolicy: IfNotPresent` with a pinned tag; `:latest` is banned.

**Security**
- `runAsNonRoot: true`, `runAsUser` set, `allowPrivilegeEscalation: false`.
- `readOnlyRootFilesystem: true` plus an `emptyDir` for scratch space.
- `capabilities: { drop: ["ALL"] }`.
- `seccompProfile: RuntimeDefault`.
- NetworkPolicy: default-deny ingress and egress, then allow explicitly.

**Observability**
- Structured JSON logs to stdout, with the pod name and trace id attached.
- `/metrics` exposed for Prometheus; a `ServiceMonitor` or scrape annotation.
- No log lines that include secrets or full request bodies.
