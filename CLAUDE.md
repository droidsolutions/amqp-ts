# amqp-ts

Fork of [abreits/amqp-ts](https://github.com/abreits/amqp-ts), published to npm as `@droidsolutions-oss/amqp-ts`.

## Things not derivable from the code

- Lockfiles are written with npm 11. `npm ci` with npm 10 rejects them, so the Node 22 test job upgrades npm to 11 before installing.
- npm publishing uses OIDC trusted publishing, bound to the workflow file name `.github/workflows/main.yml`. Never rename that file. `GH_TOKEN` is still needed for GitHub releases.
- semantic-release: `master` cuts releases. Every push to `develop` publishes a prerelease (`X.Y.Z-develop.N`), so push there deliberately.
- The release config lives in `release.config.mjs`, not in `package.json`. It contains `stripTrailers`, which removes git trailers (e.g. `Co-Authored-By`) from changelog and release notes. Test it with `npm run test:release-config`.
- Do not upgrade to TypeScript 7 until typescript-eslint supports it.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint via husky. The type decides the release, so use non-releasing types (`ci:`, `chore:`, `docs:`) for changes that must not publish.
