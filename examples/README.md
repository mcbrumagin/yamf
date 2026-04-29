# YAMF examples (monorepo)

**Prerequisites:** Node.js **>= 22** and **pnpm** (see root [CONTRIBUTING.md](../CONTRIBUTING.md)).

| Directory | Purpose |
|-----------|---------|
| [`minimal-hmr/`](./minimal-hmr/) | Smallest `yamf.config.js` + `yamf build` / `yamf deploy --local` + Vite HMR. |

**Other tiers in this repo**

- **Per-package `*.example.js`** — next to each `@yamf/*` package (e.g. `packages/services/cache/cache-basic.example.js`), run with `yamf test --as-test '*.example.js' -d <dir>`; aggregated by root `pnpm run test:integration`.
- **Deeper integrations** — `packages/core/examples/` (Docker, k8s, polyglot). See [packages/core/examples/README.md](../packages/core/examples/README.md).

Deeper and language-specific samples remain under `packages/core/examples/`. A **full product-style** deployment is maintained as **Soundclone** (`soundclone-deployment/` in the parent repo), not a second “mega” example here.
