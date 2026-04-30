# V1 examples-as-scripts rework

Corrective addendum to [V1-HARDENING.md](./V1-HARDENING.md). Supersedes the original `.example.js` / `yamf test --as-test <glob>` direction where examples were treated as first-class test modules.

This document is **implementation-ready** for Composer to apply. Sections are scoped so each can land independently.

---

## 1. Problem & goals

The earlier convention pushed examples into a test-module shape (`export default async function run`, `export const name`, mute/solo flags). That made them weaker as *examples* (a user has to read past test scaffolding to understand the API) and weaker as *tests* (they don't catch lifecycle bugs that real scripts hit).

For v1, examples are **scripts first** and **testable second**:

- An example is runnable directly with `node path/to/example.js`.
- An example demonstrates real usage with comments and option knobs.
- An example does **not** self-terminate. A user running the file gets a working, persistent registry/service they can poke at, modify, and re-run; lifecycle is the orchestrator's job.
- An example must behave the same in playground mode (`node example.js`) and under the test orchestrator. **No `if (process.env.YAMF_AS_TEST)` branches.**
- An example passes its `--as-test` case when the child process exits cleanly after the orchestrator signals shutdown.

---

## 2. Scope

**In scope**

- Refactor `yamf test --as-test` to a child-process orchestrator.
- Add `--generate` (write the equivalent suite to disk) and `--timeout`.
- Rewrite all existing `*.example.js` files as runnable scripts (no test-module exports).
- Replace `scripts/run-example-tests.mjs` with a single `yamf test --as-test -f "*.example.js"` invocation in `test:integration`.
- Add a single-fn overload to `terminateAfter` (additive; multi-arg unchanged).

**Out of scope (this round)**

- Deprecating the multi-arg `terminateAfter` signature.
- Wiring `--as-test` into PM3 lifecycle.
- Changing `*.e2e-tests.js` discovery rules.
- Touching tests not covered by the example rewrite.

---

## 3. CLI surface

### 3.1 `yamf test` argument additions

```text
--as-test                Boolean. Switch to script-orchestrator mode.
                         Requires -f/--file. -d/--dir defaults to cwd.
--generate               Boolean. Instead of running, write a generated
                         test suite to disk and exit 0.
--generate-out <path>    Optional. Output path for --generate. Defaults to
                         .yamf/generated/<dir-slug>-<glob-slug>.test.js
                         relative to repo root.
--timeout <ms>           Per-case timeout. Applies to normal tests AND
                         --as-test cases. Default: 30000.
--settle <ms>            --as-test only. Min time to wait after the child
                         registry becomes reachable before sending SIGTERM.
                         Default: 250.
```

### 3.2 Argument interactions

- `--as-test` without `-f/--file` → exit `2` with a clear error.
- `--as-test` with no matches → exit `1` with `no files matched <pattern> under <dir>`.
- `--generate` without `--as-test` → exit `2` (generation only makes sense in as-test mode).
- `--generate-out` without `--generate` is allowed; treat as `--generate --generate-out <path>`.
- `--timeout 0` is invalid (use a reasonable positive value).
- `--include-e2e` works the same as today; not relevant to `--as-test` since `*.example.js` is not `*.e2e-tests.js`.

### 3.3 Glob semantics (unchanged)

`-f` is a basename glob. `*` is the only wildcard. Other regex metacharacters are escaped. So `*.example.js` matches `cache-basic.example.js` but not `media-streaming-example.js`.

---

## 4. Orchestrator contract (`--as-test` mode)

### 4.1 Discovery

1. Walk `-d` recursively, skipping `node_modules`, `.git`, `coverage`, `dist`, `build`, `.yamf`, `tmp`.
2. Match basename against `-f`.
3. Sort by absolute path for deterministic order.
4. If zero matches, exit `1`.

### 4.2 Per-case lifecycle

For each matched file, the orchestrator runs this sequence:

```text
1.  port    = pick free TCP port on 127.0.0.1
2.  url     = "http://127.0.0.1:<port>"
3.  env     = { ...process.env, YAMF_REGISTRY_URL: url, YAMF_AS_TEST: "1" }
4.  child   = spawn(node, [absoluteFilePath], { env, stdio: pipe })
5.  start polling:
       a) every 100ms attempt TCP connect to <port>
       b) await any of: { child.exit, port-open, timeout(--timeout) }
6.  if port-open:
       wait --settle ms, then SIGTERM child
       wait min(--timeout, 5000) ms for child.exit
       if still alive: SIGKILL, mark case failed (timed out after SIGTERM)
7.  if child.exit before port-open:
       case is decided purely by exit code (non-yamf script path)
8.  if timeout before either:
       SIGTERM, then SIGKILL after 1000ms; mark case failed (no readiness)
```

### 4.3 Exit code interpretation

| child.exit reason | exitCode | signal | Verdict | Notes |
|---|---|---|---|---|
| natural | `0` | `null` | **pass** | non-yamf scripts and self-completing scripts |
| natural | non-zero | `null` | **fail** | example threw or exited bad |
| orchestrator SIGTERM, graceful | `0` | `null` | **pass** | yamf process-lifecycle hook ran the cascade |
| orchestrator SIGTERM, default handler | any | `SIGTERM` | **pass** | Node default; we initiated termination |
| orchestrator SIGKILL escalation | any | `SIGKILL` | **fail** | child wouldn't die; report timeout |
| spawn error (e.g. file not found) | n/a | n/a | **fail** | report orchestrator error |

### 4.4 Output capture

- Forward child stdout/stderr to the orchestrator with a `[<basename>]` prefix per line.
- On failure, surface the last 50 lines of child stderr inline with the test runner failure block.

### 4.5 Why SIGTERM, not an HTTP `REGISTRY_TERMINATE`

- SIGTERM works for **any** Node process — yamf or not. A non-yamf script just exits via the default handler; a yamf script's `lifecycle.shutdown()` runs its terminate cascade. Single mechanism, both worlds.
- An HTTP `REGISTRY_TERMINATE` command would only work when the example happens to be a yamf process and would silently no-op for everything else. SIGTERM is more universal.
- If a yamf script wants explicit control (e.g. flush metrics), it can hook the existing `lifecycle.onShutdown(...)` API; no new framework surface required.

### 4.6 Why plain `child_process`, not PM3

- The orchestrator's needs are tiny: spawn, env injection, stdio piping, signals, exit code, timeout. `child_process.spawn` covers it in a small surface.
- PM3 introduces managed-process state (pid registry, log files, restart policies) that is overkill for a per-case test run and would leak residue across runs.
- A test run sharing PM3 state with a developer's PM3 state on the same machine is a confusing-failure source we don't want to introduce.

PM3 still has a place: examples and integrations that specifically demonstrate PM3 lifecycle, rolling deploys, or multi-service orchestration. Those run as their own integrations, not via `--as-test`. If shared concerns appear later, extract a small spawn-with-lifecycle primitive that both consume internally; do not refactor PM3 for this round.

---

## 5. Example authoring contract

Examples are scripts. They register/configure/demonstrate, then stop adding work to the event loop. The registry/services they started keep running until the orchestrator (or the developer) signals shutdown.

### 5.1 Minimal shape

```javascript
import { registryServer, createService, callService } from '@yamf/core'

const registryUrl = process.env.YAMF_REGISTRY_URL || 'http://127.0.0.1:20000'
process.env.YAMF_REGISTRY_URL = registryUrl

await registryServer()

await createService(function hello (payload) {
  return { message: `hello ${payload.name}` }
})

const result = await callService('hello', { name: 'yamf' })
console.log(result)

// No teardown. The registry/service stay running so a user can hit them
// from another shell (curl, callService, etc.). `yamf test --as-test`
// will signal shutdown via SIGTERM. Running this file directly is
// "playground mode."
```

### 5.2 Authoring rules

- Top-level `await`. Avoid `async function main () { ... }; await main()` unless meaningful structure benefits.
- `YAMF_REGISTRY_URL` is read from env first, with a documented default. Same for any other port/URL the example needs.
- Comments call out interesting options. Avoid restating obvious code.
- **Do not** add teardown calls (`registry.terminate()`, etc.).
- **Do not** branch on `YAMF_AS_TEST`. Behavior must be identical in playground and test modes.
- For examples that exist to demonstrate long-running behavior (subscriptions, watchers), document that explicitly in a comment; the orchestrator still terminates them cleanly via SIGTERM.

### 5.3 Migration list (existing files to rewrite)

Treat each as an independent rewrite. Keep filenames; replace contents with the script convention above; verify the example actually demonstrates the package's API surface.

| File | Rewrite focus |
|---|---|
| `packages/core/kernel-basic.example.js` | registry + createService + callService round-trip |
| `packages/client/html-smoke.example.js` | re-export sanity, no test-module shape |
| `packages/shared/case-mapper-smoke.example.js` | one or two `toCamelCase` / `toSnakeCase` demos with a comment |
| `packages/services/auth/auth-basic.example.js` | registry + createAuthService with a tiny `validateUserPassword` and a login call |
| `packages/services/cache/cache-basic.example.js` | set / get / del using the documented API shape |
| `packages/services/config/config-smoke.example.js` | createConfigService with required env, list/get demo |
| `packages/services/deploy-router/deploy-router-smoke.example.js` | attachDeployRouter export demo with a registry running |
| `packages/services/dev-hmr/dev-hmr-smoke.example.js` | factory export demo |
| `packages/services/file-server/static-smoke.example.js` | createStaticFileService with a temp dir + a single GET |
| `packages/services/file-upload/upload-smoke.example.js` | service boots with a temp dir |
| `packages/services/pm3/pm3-smoke.example.js` | createPm3Service export demo (no real spawn) |
| `packages/services/postgres/postgres-basic.example.js` | createPostgresService against `YAMF_TEST_PSQL_URL` (skip if unset is OK; print a clear note) |
| `packages/services/sqlite/sqlite-basic.example.js` | createSqliteService with an in-memory db |
| `packages/services/user/user-basic.example.js` | createUserService with a sqlite backend + a register/get flow |

If a package has no value-add example to write today, **delete** the placeholder rather than ship a noop.

---

## 6. Generated file contract (`--generate`)

### 6.1 Default output path

`.yamf/generated/<dir-slug>-<glob-slug>.test.js` relative to repo root. Slug rules:

- `<dir-slug>` is `-d` made path-safe (lowercased, `/`→`-`, repeated `-` collapsed, leading/trailing `-` trimmed). For `-d .` use `repo`.
- `<glob-slug>` is `-f` with `*` and other non-alphanumerics collapsed to `-`, trimmed.
- Example: `yamf test --as-test -d packages -f "*.example.js" --generate` → `.yamf/generated/packages-example-js.test.js`.

Add `.yamf/generated/` to root `.gitignore` if not already ignored.

### 6.2 Generated file template

```javascript
// AUTO-GENERATED by `yamf test --as-test --generate`.
// Source: -d <dir> -f <glob>
// Regenerate with the same command. Do not edit by hand.

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { connect } from 'node:net'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const TIMEOUT_MS = Number(process.env.YAMF_AS_TEST_TIMEOUT_MS || 30000)
const SETTLE_MS = Number(process.env.YAMF_AS_TEST_SETTLE_MS || 250)

async function pickPort () { /* free port helper */ }
async function probeOpen (port, signal) { /* TCP connect with abort */ }
async function runScriptAsTest (absPath) {
  // 1. pick port, set YAMF_REGISTRY_URL + YAMF_AS_TEST=1
  // 2. spawn node absPath with that env, capture stdio
  // 3. race: child.exit | probeOpen | timeout
  // 4. if open: settle, SIGTERM, await exit (5s), SIGKILL on miss
  // 5. throw if exit decision = fail; return otherwise
}

// One named export per matched file, in deterministic path order.
export async function testCacheBasicExample () {
  await runScriptAsTest(resolve(__dirname, '../../packages/services/cache/cache-basic.example.js'))
}
// ...one per matched file...
```

### 6.3 Generation parity

The orchestrator's runtime path (Section 4) and the generated `runScriptAsTest` helper share the same pseudocode. Implement **once** in `packages/cli/src/lib/as-test-runner.js` and have both `--as-test` (in-memory) and the generated file import from it. The generated file is essentially a thin wrapper that lists test functions; the heavy lifting stays in one module.

### 6.4 `--generate` exit behavior

- Compute the output path.
- Ensure parent dir exists (`mkdir -p`).
- Write the generated file (overwrite if present).
- Print `wrote <path> (<n> case(s))` to stdout.
- Exit `0`.

---

## 7. `terminateAfter` simplification

### 7.1 New overload

Add a single-fn signature to `@yamf/test`'s `terminateAfter`:

```javascript
// New
await terminateAfter(async () => {
  await registryServer()
  await createService(myService)
  // act + assert
})

// Existing — unchanged
await terminateAfter(
  () => registryServer(),
  () => createService(myService),
  async (registry, service) => { /* act + assert */ }
)
```

### 7.2 Detection

In `packages/test/src/helpers.js`, dispatch on arity and types:

- `terminateAfter(fn)` where `args.length === 1 && typeof args[0] === 'function'` → new path.
- All other shapes → existing multi-arg path, byte-for-byte unchanged.

### 7.3 New-path implementation sketch

```javascript
async function terminateAfterSingleFn (fn) {
  const url = process.env.YAMF_REGISTRY_URL
  let bodyError
  try {
    await fn()
  } catch (e) {
    bodyError = e
  } finally {
    await sendRegistryTerminateBestEffort(url)
  }
  if (bodyError) throw bodyError
}

async function sendRegistryTerminateBestEffort (url) {
  if (!url) return
  try {
    // Use the registry's existing in-process terminate path if we
    // can resolve the local server reference; otherwise fall back to
    // the network shutdown command (HEADERS.COMMAND = REGISTRY_DRAIN
    // followed by graceful exit) with a short timeout.
    await terminateLocalRegistryIfPresent()
  } catch (e) {
    if (process.env.YAMF_TEST_VERBOSE_TEARDOWN) {
      console.warn(`[terminateAfter] registry shutdown failed: ${e.message}`)
    }
  }
}
```

Implementation detail: the helper should prefer terminating the **in-process** registry server (the test process started it) by walking a small registry of "active servers" that `@yamf/core` already maintains internally, rather than going over the network. Going over the network is the fallback for cases where no in-process server is found but `YAMF_REGISTRY_URL` points somewhere reachable.

### 7.4 Hardening dependencies

- **In-process cascade is the contract, not a risk.** The single-fn helper relies on the registry's shutdown cascade closing HTTP listeners owned by services running in the same process. If gaps exist, fix them in `service-registry` / `create-service`. The helper makes any such gap visible because the test process won't exit cleanly.
- **No-registry tests stay silent by default.** If the body never starts a registry, the shutdown call no-ops.
- **Optional diagnostic warning.** When `YAMF_TEST_VERBOSE_TEARDOWN=1`, the helper logs why a shutdown attempt did not run or did not succeed.
- **Lifecycle-sensitive tests** (`registry-token-tests`, drain handshake tests, gateway shutdown tests) keep the multi-arg form.
- **One registry per process.** Concurrent `terminateAfter(fn)` invocations in the same process are unsupported.

### 7.5 Adoption

1. Land the overload (additive).
2. Add tests in `packages/test/src/tests/terminate-after-tests.js`:
   - registry running → cascade closes the in-process tree, `process.exit` not needed.
   - registry not running → silent no-op.
   - thrown body → cascade still runs, original error propagates.
   - `YAMF_TEST_VERBOSE_TEARDOWN=1` → warning emitted on failure.
   - multi-arg form unchanged (parity test against current behavior).
3. Document both shapes in `packages/test/README.md` and `docs/TESTING.md`. Recommend the single-fn shape for new tests fitting *arrange registry/services → act → assert → implicit teardown*.
4. Migrate opportunistically. No tree-wide rewrite this round.

---

## 8. Pipeline & CI changes

### 8.1 Root `package.json`

Replace the current `test:integration` shell pipeline:

```json
{
  "scripts": {
    "test": "c8 pnpm -r --filter=!@yamf/cli --filter=!yamf-example-minimal-hmr test",
    "test:integration": "c8 pnpm --filter @yamf/cli test && node packages/cli/src/cli.js test --as-test -d packages -f \"*.example.js\" && node packages/cli/src/cli.js test --as-test -d examples -f \"*.example.js\"",
    "test:e2e": "node scripts/run-e2e-tests.mjs",
    "test:all": "pnpm run test && pnpm run test:integration && pnpm run test:e2e",
    "check:metadata": "node scripts/check-yamf-metadata.mjs"
  }
}
```

### 8.2 Delete

- `scripts/run-example-tests.mjs`

### 8.3 CI workflow

`.github/workflows/ci.yml` integration job already runs `pnpm run test:integration`. No structural change needed there. Confirm the e2e job still passes `YAMF_TEST_PSQL_URL`.

### 8.4 Ignore

Add `.yamf/generated/` to root `.gitignore`.

---

## 9. CLI test plan (concrete)

Add `packages/cli/src/tests/cli-as-test-tests.js` (replaces the current contents). Each function below is one test case.

| Test | Asserts |
|---|---|
| `testAsTestRequiresFileFlag` | `yamf test --as-test` (no `-f`) exits non-zero with "requires -f". |
| `testAsTestNoMatchesFails` | `yamf test --as-test -f "*.no-such-pattern.js" -d <tmp>` exits `1` with a clear "no files matched" message. |
| `testAsTestRunsOneScriptToCleanExit` | A script that prints "ready", does no networking, and falls off the event loop → pass. |
| `testAsTestSignalsShutdownToYamfRegistry` | A script that starts `registryServer()` → orchestrator detects open port, sends SIGTERM, child exits `0` → pass. |
| `testAsTestFailsOnPreShutdownThrow` | A script that throws synchronously at top-level → fail; child stderr surfaced. |
| `testAsTestEnforcesTimeout` | A script that hangs forever without opening any port → orchestrator times out, escalates SIGKILL, marks case failed with a timeout message. |
| `testAsTestRunsCasesSequentiallyInPathOrder` | Two scripts that write to a shared file with timestamps → assert order matches sorted filenames. |
| `testAsTestUsesUniqueRegistryUrlPerCase` | Two scripts that read `YAMF_REGISTRY_URL` → assert ports differ. |
| `testAsTestExposesYamfAsTestEnv` | A script asserts `process.env.YAMF_AS_TEST === '1'`. |
| `testGenerateRequiresAsTest` | `yamf test --generate -f "*.example.js"` (no `--as-test`) exits non-zero. |
| `testGenerateWritesDeterministicFile` | Run `--generate` twice; output file is byte-identical. |
| `testGenerateOutPathRespected` | `--generate-out <tmp>/out.test.js` writes there. |
| `testTimeoutAppliesToNormalTests` | A normal test that calls `await sleep(60000)` exits with timeout when `--timeout 200`. |
| `testTimeoutAppliesToAsTestCases` | An as-test script that hangs is killed at `--timeout`. |
| `testGlobDotIsLiteral` | `*.example.js` does not match `media-streaming-example.js`. |

`packages/test/src/tests/terminate-after-tests.js` covers the new overload — see §7.5.

---

## 10. Documentation updates

- `docs/TESTING.md` — replace the existing `--as-test` section with the new contract; describe `--generate`, `--timeout`, `--settle`, and exit-code interpretation.
- `packages/cli/README.md` — update the `test` command examples to the new flags.
- `packages/test/README.md` — document the new single-fn `terminateAfter` shape and `YAMF_TEST_VERBOSE_TEARDOWN`.
- `CONTRIBUTING.md` — examples-as-scripts authoring rules; link here.
- `examples/README.md` and `packages/core/examples/README.md` — clarify the three tiers and that all are scripts (no test-module shape anywhere).
- `docs/V1-HARDENING.md` — already references this doc; no further edit needed once §11 ships.
- `CHANGELOG.md` — under Unreleased: "BREAKING (CLI): `--as-test` is now a boolean flag and requires `-f`. Examples must be runnable scripts; the previous `default export` test-module shape is no longer supported."

---

## 11. Migration steps (sequencing)

Composer should land these in order. Each step is a coherent commit/PR boundary.

1. **CLI flag refactor + orchestrator core**
   - `packages/cli/src/lib/as-test-runner.js`: orchestrator (Section 4 pseudocode), single source of truth.
   - `packages/cli/src/commands/test.js`: parse new flags, dispatch to runner.
   - Tests for §9 minus `--generate` cases.
2. **`--generate` and `--generate-out`**
   - Use the same `as-test-runner` module via a generated wrapper template.
   - Tests for `--generate*` cases in §9.
3. **`--timeout` + `--settle` for normal tests**
   - Wire into the existing `TestRunner` so it's not as-test-only.
   - Tests for `testTimeoutAppliesToNormalTests`.
4. **Pipeline swap**
   - Update root `package.json` per §8.1.
   - Delete `scripts/run-example-tests.mjs`.
   - Update `.gitignore`.
5. **Example rewrites**
   - One commit per package or grouped sensibly. Each new file follows §5.1–§5.2.
   - Verify each file runs standalone with `node <file>` and stays up until Ctrl-C.
   - Verify `pnpm run test:integration` is green.
6. **`terminateAfter(fn)` overload**
   - Implement and test per §7.
   - Documentation updates per §10.
7. **Documentation pass**
   - Per §10. Confirm cross-links resolve.
8. **CHANGELOG entry**
   - Note the CLI-breaking flag change and the example convention shift.

---

## 12. Acceptance criteria

This rework is done when **all** of the following hold on a clean checkout:

- [ ] `yamf test --as-test` without `-f` exits non-zero with a clear message.
- [ ] `yamf test --as-test -f "*.example.js"` from repo root passes for every file in `packages/**/*.example.js` and `examples/**/*.example.js`.
- [ ] Running any single example via `node <path>` keeps the registry up; the process exits cleanly on Ctrl-C / SIGTERM.
- [ ] No example contains `if (process.env.YAMF_AS_TEST)`, an explicit `terminate()` call, or test-module exports (`default async function run`, `export const name`, `mute`, `solo`).
- [ ] `--generate` produces a deterministic, runnable test file under `.yamf/generated/`. Re-running yields a byte-identical file.
- [ ] `.yamf/generated/` is gitignored.
- [ ] `--timeout` is honored by both normal `yamf test` cases and `--as-test` cases.
- [ ] `terminateAfter(async fn => …)` works: registry shut down via cascade after the body resolves or throws; no-op when no registry was started.
- [ ] `terminateAfter(...factories, fn)` is byte-for-byte unchanged.
- [ ] `pnpm test`, `pnpm run test:integration`, and (with `YAMF_TEST_PSQL_URL`) `pnpm run test:e2e` are green.
- [ ] `scripts/run-example-tests.mjs` is deleted; nothing references it.
- [ ] `docs/TESTING.md`, `packages/cli/README.md`, `packages/test/README.md`, `CONTRIBUTING.md`, both `examples/README.md` files, and `CHANGELOG.md` all reflect the new behavior.
