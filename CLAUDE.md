# amqp-ts

Fork of [abreits/amqp-ts](https://github.com/abreits/amqp-ts), published to npm as `@droidsolutions-oss/amqp-ts`.

## Things not derivable from the code

- Lockfiles are written with npm 11. `npm ci` with npm 10 rejects them, so any CI job running on a Node version that ships npm 10 (see the matrix in `.github/workflows/main.yml`) upgrades npm to 11 before installing.
- npm publishing uses OIDC trusted publishing, bound to the workflow file name `.github/workflows/main.yml`. Never rename that file. `GH_TOKEN` is still needed for GitHub releases.
- semantic-release: `master` (or `main`) cuts releases. Every push to `develop` publishes a prerelease (`X.Y.Z-develop.N`), so push there deliberately.
- The release config lives in `release.config.mjs`, not in `package.json`. It contains `stripTrailers`, which removes git trailers (e.g. `Co-Authored-By`) from changelog and release notes. Test it with `npm run test:release-config`.
- Do not upgrade to TypeScript 7 until typescript-eslint supports it.

## Build and test

- `npm run build` compiles `src/` to `lib/` (tsc); the tutorials and `test:cjs` import the built package, so build first.
- `npm test`: unit tests (`test/*.spec.ts`), they need a RabbitMQ broker. `npm run test:integration`: reconnect tests against a real broker that is restarted during the run (`test/*.spec-i.ts`). `npm run test:cjs`: smoke test that `require()` of the built package works and deep imports are refused. `npm run test:release-config`: tests `release.config.mjs`.
- The broker must allow `guest`/`guest` and have the management plugin enabled. Env vars (defaults in brackets): `AMQPTEST_CONNECTION_URL` (`amqp://localhost`), `AMQPTEST_MANAGEMENT_URL` (`http://guest:guest@localhost:15672`), `AMQPTEST_RESTART_CMD` (`podman restart rabbitmq`, the command that restarts the broker; CI uses `docker restart <service container id>`). Point them at your own broker, e.g. a throwaway container on other ports.

## ESM rules

The package is ESM-only (`"type": "module"`, `module: node20`). Use `.js` extensions in relative imports inside `src/` (they refer to the compiled files), no top-level `await` in `src/` (CommonJS consumers load the package with `require(esm)`, which rejects it), and keep `exports` root-only: new public API must be exported from `src/index.ts`, nothing may be imported through `lib/...`. Members that are `@internal` are stripped from the typings (`stripInternal`).

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint via husky. The type decides the release, so use non-releasing types (`ci:`, `chore:`, `docs:`) for changes that must not publish.
