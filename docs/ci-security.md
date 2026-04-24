# CI Security

This repo is intended to be public. CI is designed around that assumption.

## Public PR Safety

The normal CI workflow uses `pull_request`, not `pull_request_target`. Fork PRs do not receive
repository secrets, and the workflow does not need Cloudflare, npm, Codex, or Claude secrets.

Do not change CI to use `pull_request_target` with checkout/build/test of untrusted PR code.

## Secret-Bearing Workflows

`ci-ai.yml` is intentionally guarded:

- it only runs when repository variable `ENABLE_AI_CI` is set to `true`
- it only runs on same-repository PR branches
- it only runs when a maintainer applies `codex-review` or `claude-review`
- it skips forks even if a label is applied
- it has no Cloudflare or npm publishing secrets
- it is non-gating review automation
- it runs in the `ai-review` environment, so OAuth secrets can be environment-scoped and
  protected by required reviewers
- Claude review is limited to GitHub PR/diff/status commands; it does not run package scripts
  while the Claude OAuth token is present

This avoids exposing Codex or Claude OAuth secrets to untrusted fork code.

Recommended setup: store `CODEX_AUTH_JSON` and `CLAUDE_CODE_OAUTH_TOKEN` as `ai-review`
environment secrets, not repository-wide secrets, and add required reviewers to that environment.

## Publishing

`publish-npm.yml` uses npm trusted publishing through GitHub Actions OIDC. It does not need an
`NPM_TOKEN` secret.

## Required Gates

The main `CI` workflow has separate jobs for:

- format/lint
- typecheck
- tests and coverage, with 90% global Vitest thresholds
- coverage artifact retention and gated Codecov upload from `coverage/lcov.info`
- build and package dry run
- Cloudflare Worker startup build
- workflow lint
- dependency audit
- Gitleaks secret scan
- dependency review

The final `CI Gate` job fails if any required job fails.
