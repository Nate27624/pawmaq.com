# Security Controls

This repository uses only free/open-source security tooling.

## Tooling

- `husky` (MIT): Git hooks for pre-commit and pre-push controls.
- `secretlint` (MIT): Secret scanning with recommended ruleset.
- `@secretlint/secretlint-rule-preset-recommend` (MIT): Built-in detectors for common credential/token leaks.
- `pnpm audit` (OpenSSF/NPM advisory data): Dependency vulnerability policy gate.
- Custom scanners (`scripts/security/*.mjs`): Repository-specific checks for private key material.

## Local Controls

- `pre-commit` hook:
  - `security:keys:staged`
  - `security:secrets:staged`
- `pre-push` hook:
  - `security:keys:tracked`
  - `security:secrets:tracked`
  - `security:vulns`

## CI Controls

GitHub Actions workflow: `.github/workflows/security.yml`

- Install dependencies with locked versions.
- Run `pnpm run security:ci`.
- Run `pnpm run typecheck`.

## Commands

- Full local security gate:
  - `pnpm run security:full`
- Staged-file checks (fast path):
  - `pnpm run security:precommit`
- Dependency vulnerability gate:
  - `pnpm run security:vulns`

## False Positive Handling

For intentional non-sensitive key fixture lines in test files only, annotate with:

- `security-ignore-private-key`

Use this marker sparingly and never for real credentials.
