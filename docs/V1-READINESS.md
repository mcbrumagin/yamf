# YAMF v1 readiness

This document triages **known gaps** before a **1.0.0** tag. The goal is **honest, small-to-medium production** use with an experienced team — not enterprise-grade “boring reliability” or full platform-as-a-product automation.

For process rules (examples, tests, dependencies), see [CONTRIBUTING.md](../CONTRIBUTING.md). For direction and shipped slices, see [ROADMAP.md](./ROADMAP.md).

---

## Must-fix or must-resolve before v1.0.0

| Item | Notes |
|------|--------|
| **Public process** | [CONTRIBUTING.md](../CONTRIBUTING.md), root [LICENSE](../LICENSE), [CHANGELOG.md](../CHANGELOG.md), GitHub CI on default branch. |
| **Runtime / metadata drift** | All `@yamf/*` packages: `engines.node: ">=22.0.0"`, `license: "MIT"`; README badges match. |
| **Publishable artifacts** | `packages/core/package.json` `files` list matches on-disk names (e.g. `README.md`). |
| **Runtime `TODO` in user-critical paths** | Any TODO that implies incomplete security, auth, deploy token handling, or registration semantics should be **fixed** or **explicitly documented** here with a safe contract. |

---

## Documented limitations (not v1 blockers)

These are **intentional** or **deferred**; they stay in [ROADMAP.md](./ROADMAP.md) for detail.

| Area | Limitation |
|------|------------|
| **Orchestration** | No built-in **canary percentage** deploy or **auto re-placement** on sustained unhealthy / flap (hooks and roadmap items exist; automation is operator-owned). |
| **Observability** | Rich deploy ring buffer / extended `yamf status` history is optional follow-up, not required for v1. |
| **Distributed cache** | Multiple `@yamf/services-cache` replicas do **not** share memory; production should use an external shared store when needed ([ROADMAP](./ROADMAP.md)). |
| **`registerCommand`** | Registry **in-process** extension only — not a remote plugin protocol and **not** mirrored on the gateway ([CONTRIBUTING.md](../CONTRIBUTING.md)). |

---

## Post-v1 backlog (from code TODOs / roadmap)

Safe to schedule **after** 1.0.0 unless product demand forces earlier work:

| Theme | Examples |
|-------|-----------|
| **Load balancing** | Extra strategies (least-connections, CPU-aware, etc.) — stubs in `packages/core/src/registry/load-balancer.js`. |
| **Rate limiting** | IPv6 / CIDR nuances — `packages/core/src/rate-limiter/`. |
| **Gateway / registry polish** | Logging, forwarding, hybrid rate-limit serialization — various `TODO` in `gateway-*`, `registry-server.js`, `yamf-headers.js`. |
| **HTTP stack** | VERIFY pipes, timeout overrides — `http-server.js`, `http-request.js`. |
| **Services** | Queue service and other “TBD” areas under `packages/services/` — see per-package README and TODOs. |
| **Horizon** | Data-backed cache, sticky sessions, cascade fan-out — [ROADMAP](./ROADMAP.md) **Deferred** section. |

When picking up a backlog item, either remove the `TODO` or link it from a roadmap slice so the tree stays honest for contributors ([CONTRIBUTING.md](../CONTRIBUTING.md)).
