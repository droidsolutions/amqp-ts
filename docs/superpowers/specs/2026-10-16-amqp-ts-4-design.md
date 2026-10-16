# amqp-ts 4.0 — design

Date: 2026-10-16
Status: approved 2026-10-16

## Intent

The library has accumulated a backlog of dependency updates, among them a major bump of the
underlying `amqplib` (1.x → 2.x). That bump is technically a breaking change for this package, so
the next release is a major anyway. 4.0 uses that opportunity to bundle every other breaking change
that has been waiting:

- ship as an ES module,
- raise the supported Node.js range,
- switch internally from amqplib's callback API to its promise API,
- delegate connection recovery to amqplib's built-in recovery,
- clean up the public API where it still leaks the callback world or internals.

Doing all of this in one major means users migrate once instead of several times.

The most important property of this library for its users is **automatic reconnection with topology
rebuild**. Production brokers do go down from time to time, and consumers must come back on their own.
Anything that weakens that is a failure of 4.0, no matter how clean the rest is.

## Goals

1. CI on `master` is green again (prerequisite, shipped before any 4.0 work).
2. Changelog and GitHub release notes no longer contain git trailers (`Co-authored-by`,
   `Signed-off-by`, `Claude-Session`, …), while the commits themselves keep them.
3. 4.0 is published as ESM-only and still loadable from CommonJS on supported Node versions.
4. amqplib 2.x, promise API internally, built-in recovery for reconnects.
5. Reconnection is covered by an automated test that actually restarts the broker, running in CI.
6. README contains a 3.x → 4.0 migration section good enough that a downstream project can migrate
   from it alone.

## Non-goals

- No deprecation cycle in 3.x. Breaking changes land directly in 4.0, documented in the migration
  section. (Decided: the only known downstream user migrates in one go, and nobody is forced to take
  the major.)
- No dual CJS/ESM build.
- No TypeScript 7 (typescript-eslint does not support it yet). Use TypeScript 6.
- Do not touch the open Dependabot PRs. Dependencies are updated directly on `develop` and reach
  `master` with the final merge. The PRs can be closed afterwards.
- No new features beyond what the goals require.

## Anti-goals

- Reconnect becoming less reliable than in 3.x — e.g. consumers not resuming after a broker restart,
  or messages that 3.x would have re-sent being dropped. (The bar is parity with 3.x, not stronger
  guarantees: see "Delivery during an outage" below.)
- A module graph that uses top-level `await` anywhere (it would make `require()` from CommonJS throw
  `ERR_REQUIRE_ASYNC_MODULE`).
- Raising the Node floor beyond what is technically needed, which would force another major sooner.
  Code must not depend on Node ≥ 24 features, so that dropping Node 22 later stays a CI/engines change.

## Constraints and facts

- **Node floor: `>=22.13.0`** (decided). Chain of reasoning:
  amqplib 2.x requires ≥ 18; ESM itself needs nothing newer; `require(esm)` is unflagged from 22.12
  and emits no experimental warning from **22.13**. Node 20 is EOL (2026-04-30). Node 22 is in
  maintenance until 2027-04-30.
- **TypeScript target: `ES2024`**, derived from the Node floor. `module`: `node20` or `nodenext`
  (both model `require(esm)` correctly) — builder's choice.
- **npm 11 lockfiles.** The lockfile is written by npm 11. `npm ci` with npm 10 fails
  (`Missing: conventional-commits-filter@6.0.1 from lock file`). Node 22 ships npm 10, which is why
  CI is red today. Reproduced locally.
- **npm publishing uses OIDC trusted publishing** (configured; 3.0.4 was published that way with a
  provenance attestation). The trusted publisher is bound to the workflow file name `main.yml` — do
  not rename it. `GH_TOKEN` is still needed for GitHub releases.
- **Release branches** are already configured: `master` releases, `develop` is a prerelease channel,
  so pushes to `develop` publish `4.0.0-develop.N`.
- **amqplib 2.x changes relevant to us**
  - Only breaking change: `heartbeat: 0` now disables heartbeats instead of meaning "use the server's
    value". amqp-ts passes URL and socket options through untouched, so this only affects users who
    set it themselves. Mention it in the migration section.
  - Bundled type definitions since 1.2 → drop `@types/amqplib`.
  - Built-in recovery since 1.1: `connect(url, { recovery: RecoveryOptions })` returns a
    `RecoveringChannelModel` with exponential backoff + jitter, `maxRetries`, `initialMaxRetries`,
    `calculateDelay`, `waitForConnect`, and a `setup(model)` hook that runs after **every** successful
    (re)connect. Events: `connect`, `disconnect`, `connect-failed`, `reconnect-scheduled`,
    `reconnect-failed`, `blocked`, `unblocked`, `error`.
  - Recovery restores the **connection only**. Channels do not survive a disconnect, and amqplib knows
    nothing about exchanges, queues, bindings or consumers. Rebuilding those stays in amqp-ts.
  - Upstream changelog: <https://github.com/amqp-node/amqplib/blob/main/CHANGELOG.md>

## Decided: how it gets done

### Phase 1 — on `master`, no release

Both changes use non-releasing commit types (`ci:` / `chore:`). The builder commits locally on
`master` and does **not** push: the maintainer reviews the commits and pushes them. Phase 2 starts
after that push.

1. **CI fix** in `.github/workflows/main.yml`:
   - `lint`, `build` and `release` jobs: `actions/setup-node` with `node-version: 24`.
   - Test matrix: Node `22` and `24`. Node 26 is added once it is LTS (2026-10-28) — a later, separate
     change. The Node 22 job runs `npm i -g npm@11` before `npm ci`.
   - If nyc causes trouble on the way, replace it with c8.
2. **Move the release config** from `package.json` to `release.config.mjs` and add the trailer filter:
   wrap the angular preset's `writer.transform` (via `@semantic-release/release-notes-generator`'s
   `writerOpts`, which is merged over the preset's) so that trailer lines are stripped from each
   `note.text` before the original transform runs. Both `@semantic-release/changelog` and
   `@semantic-release/github` consume these notes, so both are cleaned. Root cause for reference:
   `conventional-commits-parser` appends every line after a `BREAKING CHANGE:` note to that note until
   another note keyword appears.

3. **Add a `CLAUDE.md`** with the facts that survive 4.0 and are not derivable from the code: lockfiles
   are written with npm 11; OIDC publishing is bound to `main.yml`; every push to `develop` publishes
   a prerelease; the trailer filter lives in `release.config.mjs`; no TypeScript 7 until
   typescript-eslint supports it; the repo is a fork of `abreits/amqp-ts`. The repo is public, so no
   internal project or infrastructure names. It is extended at the end of Phase 3 (see there).

### Phase 2 — `develop`

`develop` has no own commits and is ~2700 commits behind; fast-forward it to `master`. All 4.0 work
happens there.

### Phase 3 — 4.0 content on `develop`

**Dependencies.** Update dependencies directly. The amqplib 1 → 2 bump is its own commit, carrying a
`BREAKING CHANGE:` footer that links the upstream changelog. Drop `@types/amqplib` in the same commit.

**ESM-only package.**
- `"type": "module"`, an `exports` map with `types`, `engines.node: ">=22.13.0"`.
- `exports` exposes only `"."` (plus `"./package.json"`). Deep imports into `lib/` stop working;
  call that out in the migration section. Public types that are currently only reachable via deep
  imports (`SimpleLogger`, `InitializeResult`, `StartConsumerResult`, `DeleteResult`) are exported
  from the root. The known downstream user imports everything from the package root already.
- Relative imports with `.js` extensions as required by the chosen `module` setting.
- No top-level `await` anywhere.
- CommonJS consumers keep working through `require(esm)`; verify that with a small CJS smoke test.

**Promise API internally.** Replace every use of `amqplib/callback_api` with the promise API. The
abandoned branch `async-await_refactor` (single commit from 2020) may be used as a reference, but it
cannot be merged: every source file conflicts, and it has a real bug in the retry path (the
`setTimeout` still passes a `resolve` callback to a `tryToConnect` that no longer accepts one, so a
retry never settles). Delete the branch once 4.0 is done.

**Reconnect via amqplib recovery.**
- Remove the own retry loop (`tryToConnect`, `_retry` with its double-retry guard, fixed interval).
- The topology rebuild (today `_rebuildAll`: re-initialize exchanges, queues, consumers, bindings)
  runs from the recovery `setup` hook and creates fresh channels.
- Replace `ReconnectStrategy { retries, interval }` with amqplib's `RecoveryOptions`, excluding the
  options amqp-ts owns itself (at least `setup`). Semantics change and must be called out in the
  migration section: today `retries: 0` means "retry forever"; with amqplib that is
  `maxRetries: Infinity` (amqplib's default).
- Default behaviour stays "retry forever", both at startup and after a disconnect.
- Note from reading `lib/recovery.js`: `setup` runs before the new model is installed, and a `setup`
  that throws closes the connection and schedules another reconnect.

**Delivery during an outage — parity with 3.x.** Today `send` waits on the destination's
`initialized` promise, and a publish that throws synchronously (channel known to be closed) triggers
a rebuild and a re-send. That is the guarantee to keep. No publisher confirms, no at-least-once
semantics, `send(): void` stays. A message already written to the socket in the window before the
drop is noticed can be lost, as in 3.x. Buffered sends that can never go out (recovery gave up, or
`close()` was called) are logged at warn level and dropped.

**Channel failures without connection loss — parity with 3.x.** In 3.x any publish error triggers a
full rebuild, which incidentally revives entities whose channel was closed by the broker while the
connection stayed up (406 double ack, 404 publish to a deleted exchange, a killed consumer channel).
amqplib recovery only reacts to connection loss, so this path must be kept explicitly: when an
entity's channel closes while the connection is up, re-create that entity's channel and re-declare /
re-consume that entity only. No forced reconnect of the whole connection.

**Failure isolation in `setup`.** If re-declaring a single entity fails inside `setup` (precondition
failure, a `noCreate` queue that no longer exists, …), that entity fails on its own: log it, emit
`error_connection` with the error, reject that entity's `initialized`. `setup` itself must not throw
for it, otherwise one broken entity would put the whole connection into an endless reconnect loop
(default `maxRetries: Infinity`) and take healthy consumers down with it. `setup` only throws for
connection-level failures.

**Public API cleanup (no deprecations).**
- Remove: `Connection.tryToConnect` as public API; `Exchange.rpc` entirely (decided). It only works
  for the first call (later calls resolve with the request message, their reply only reaches the
  callback) and its reply consumer is never re-registered after a reconnect. The migration section
  shows the manual `replyTo` pattern already in the README instead. The consumer-side automatic
  reply ("Automatic ReplyTo") stays.
- `Connection.getConnection` returns the promise-API connection type.
- `ReconnectStrategy` is replaced as described above.

**Remove dead files.** Most are leftovers from the original fork's Docker/gulp dev setup:
`test-integration` script (calls `gulp`, not installed), `.eslintrc.js` (superseded by
`eslint.config.mjs`), `typings.json`, `Dockerfile`, `docker-compose.yml`, `docker-bash.cmd`,
`tools/alive.js`. The restart scripts in `tools/` are replaced by whatever the new reconnect test uses.

**Tests.**
- The reconnect integration test (`test/amqp-ts.spec-i.ts`) is not run anywhere today. Make it run in
  CI: restart the RabbitMQ service container from within the job (e.g. `docker restart`) and assert
  that a consumer receives messages again afterwards and that a full topology is rebuilt.
- Locally, the tests run against a RabbitMQ container started with podman.

**README.** Update for ESM imports and the Node floor; add a "Migrating from 3.x" section covering
every breaking change: ESM-only plus `require(esm)` from CommonJS (TypeScript CommonJS consumers
need `module: node20`/`nodenext`), Node `>=22.13.0`, `RecoveryOptions` instead of
`ReconnectStrategy` with the `retries: 0` → `maxRetries` mapping, `heartbeat: 0` semantics, removed
`Exchange.rpc` (with the `replyTo` replacement), `getConnection` type, removed public `tryToConnect`,
no deep imports. The section should be
self-contained: a downstream project should be able to migrate from it without reading this document.

**CLAUDE.md, second pass.** At the end of Phase 3, extend `CLAUDE.md` with what only settles with 4.0:
build and test commands, how the broker-restart test works locally and in CI, and the ESM rules
(no top-level `await`, `.js` import extensions, root-only exports).

### Phase 4 — release and follow-up

- Every push to `develop` publishes a prerelease. So the work is done on a local/feature branch and
  pushed to `develop` only at coherent points — never a half-done state such as amqplib 2 while still
  on the callback API.
- Prereleases from `develop` (`4.0.0-develop.N`) for trying it out; the final release is the merge of
  `develop` into `master`. That merge, closing the Dependabot PRs and deleting
  `async-await_refactor` are the maintainer's steps, not the builder's.
- Follow-up outside this repository: a downstream wrapper library (CommonJS, `module: commonjs`,
  wide `engines`) needs its own major to adopt 4.0. It uses `ReconnectStrategy` in its own config type,
  the synchronous `declareExchange`/`declareQueue`, `initialized`, `isConnected`, `getMetrics()`,
  `close()`, `bind`, `activateConsumer`, `send`, `ack`/`nack`, and does not listen to connection events.
  A ticket with the migration details is filed for it once a 4.0 prerelease exists.

## Builder's calls (made during design, not explicitly confirmed)

- Keep the existing connection event names (`open_connection`, `re_established_connection`,
  `lost_connection`, `trying_connect`, `close_connection`, `error_connection`) and feed them from
  amqplib's recovery events, keeping the meaning documented in the README.
- Mark the `_`-prefixed cross-class members (`_initialize`, `_rebuildAll`, `_increaseCounter`, …) as
  `@internal` and strip them from the published typings.
- Keep both `declareQueue`/`declareExchange` and their `…Async` variants.
- Keep the positional `Connection` constructor signature; only the type of the third argument changes.
- Test tooling: keep mocha, replace `ts-node` with `tsx`; nyc → c8 if nyc gets in the way.
- Convert the `tutorials/` scripts to ESM, importing the package root, so they still run against the
  built package.
- The trailer filter applies from now on only. Existing `CHANGELOG.md` entries and published GitHub
  releases (e.g. the `Signed-off-by` in 3.0.0) are left as they are.
- Delivery parity, channel-failure parity and `setup` failure isolation as described above.
- `exports` limited to `"."` and `"./package.json"`, with the missing public types added to the root.

## Left to the builder

- `module: node20` vs `nodenext`.
- How the `setup` hook and per-entity `initialized` promises interact in detail, and how `isConnected`
  is kept in sync with the recovery events.
- Exact mapping of amqplib recovery events to the existing event names where it is not one-to-one.
- Mechanics of the broker-restart test in CI.
- Order and granularity of the 4.0 commits, as long as the amqplib bump is its own commit and every
  breaking commit carries a `BREAKING CHANGE:` footer.
