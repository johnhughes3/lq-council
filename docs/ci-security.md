# CI Security

This repo is intended to be public. CI is designed around that assumption.

## Public PR Safety

The normal CI workflow uses `pull_request`, not `pull_request_target`. Fork PRs do not receive
repository secrets, and the workflow does not need Cloudflare, npm, Codex, or Claude secrets.

Do not change CI to use `pull_request_target` with checkout/build/test of untrusted PR code.

## AI Code Review

AI code review no longer runs in CI. The `ci-ai.yml` workflow that invoked Codex and Claude on
labelled pull requests has been retired; those reviews are reached through other channels instead.

No workflow in this repo carries Codex or Claude credentials, so there is no `CODEX_AUTH_JSON`,
`CLAUDE_CODE_OAUTH_TOKEN`, `ENABLE_AI_CI`, or `ai-review` environment to configure. Do not
reintroduce AI review as a CI workflow without revisiting the fork-safety analysis above.

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
