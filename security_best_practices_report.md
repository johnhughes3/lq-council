# Security Best Practices Report

## Executive Summary

I reviewed the TypeScript Cloudflare Worker, CLI, optional MCP helper, Durable Object spend ledger,
GitHub Actions workflows, and publishing path against the JavaScript/TypeScript web-server guidance
available in the `security-best-practices` skill. No critical or high-severity vulnerabilities were
found. I fixed five medium/low hardening issues during the review: provider error detail exposure,
optional MCP SSRF/resource-exhaustion controls, spend-ledger input and state-transition validation,
baseline response headers, and manual npm publish branch restrictions.

The repo already had several important controls in place: bearer auth before request body parsing,
runtime schema validation for the public LQ contract, SHA-256 token-hash storage, prompt-output
canary filtering, 100 KB body limits, monthly spend caps with refund-on-failure behavior, no
runtime filesystem reads for personas, no `eval`/dynamic function construction, no shell execution
inside the Worker request path, no committed secrets found by Gitleaks, and no
`pull_request_target` workflows.

## Critical Findings

None.

## High Findings

None.

## Medium Findings

### S1. Provider Error Details Were Returned To Callers

- **Status:** Fixed
- **Location:** [src/index.ts](src/index.ts:124), function
  `errorResponse`
- **Evidence after fix:** [src/index.ts](src/index.ts:131)
  now returns only `{ error: "provider_error" }` for `ProviderError`.
- **Impact:** Raw provider error messages can contain operational details such as model-provider
  status, account configuration hints, or upstream error text. Returning them to anyone with a
  valid bearer token is unnecessary information disclosure.
- **Fix:** Provider failures now return a generic `502` response without the provider message.
- **Verification:** [tests/worker.test.ts](tests/worker.test.ts:136)
  asserts the generic error body.

### S2. Optional Remote MCP Helper Needed Stronger SSRF And Resource Controls

- **Status:** Fixed
- **Location:** [src/tools/mcp.ts](src/tools/mcp.ts:12),
  functions `callRemoteMcpTool` and `validateRemoteMcpServer`
- **Evidence after fix:** MCP URLs must be HTTPS, cannot embed credentials, cannot target
  localhost/private/link-local/internal hosts, must use the configured transport, must be read-only,
  must use allowlisted tools, and must have bounded timeouts:
  [src/tools/mcp.ts](src/tools/mcp.ts:58). MCP responses are
  also capped at 65,536 bytes and must parse as JSON:
  [src/tools/mcp.ts](src/tools/mcp.ts:44).
- **Impact:** If MCP support is enabled in the future, weak endpoint validation could turn tool
  calls into SSRF probes or permit excessive response bodies to waste Worker memory.
- **Fix:** Added public-host validation, invalid URL handling, URL-credential rejection, private
  IPv4/IPv6 blocking, JSON-only response parsing, and a streaming response-size cap.
- **Verification:** [tests/mcp.test.ts](tests/mcp.test.ts:21)
  covers unsafe hosts, embedded credentials, non-HTTPS URLs, non-read-only tools, disallowed tools,
  invalid JSON, upstream failures, and oversized responses.
- **Residual note:** DNS rebinding cannot be fully eliminated without runtime DNS resolution. The
  code now blocks literal private IPs and internal-looking hostnames; production deployments should
  still allowlist known MCP origins.

### S3. Spend Ledger Mutations Needed Defensive Runtime Validation

- **Status:** Fixed
- **Location:** [src/cost/ledger.ts](src/cost/ledger.ts:117),
  classes `InMemoryCostLedger` and `MonthlySpendLedger`
- **Evidence after fix:** Mutating ledger methods validate agent ids, request ids, months, and USD
  amounts before state changes:
  [src/cost/ledger.ts](src/cost/ledger.ts:120),
  [src/cost/ledger.ts](src/cost/ledger.ts:239), and
  [src/cost/ledger.ts](src/cost/ledger.ts:344).
- **Impact:** The Durable Object is called internally by the Worker, not directly by the public
  internet, but it owns the monthly spend control. Malformed values such as invalid slugs, invalid
  months, `NaN`, or unbounded amounts should never be able to mutate persistent cost state.
- **Fix:** Added `LedgerInputError`, `LedgerStateError`, format/amount validators,
  `400 invalid_ledger_input` responses for invalid Durable Object calls, and `409
  invalid_ledger_state` responses when a commit arrives without a matching reservation.
- **Verification:** [tests/cost-ledger.test.ts](tests/cost-ledger.test.ts:95)
  covers invalid in-memory mutations and invalid Durable Object requests.

## Low Findings

### S4. API Responses Lacked Baseline Security Headers

- **Status:** Fixed
- **Location:** [src/index.ts](src/index.ts:21), Hono app
  middleware
- **Evidence after fix:** All responses now set `Cache-Control: no-store`, restrictive CSP,
  `Cross-Origin-Resource-Policy`, `Permissions-Policy`, `Referrer-Policy`,
  `X-Content-Type-Options`, and `X-Frame-Options`:
  [src/index.ts](src/index.ts:23).
- **Impact:** This is an API-only Worker, so browser attack surface is limited. Still, default
  no-store and anti-sniffing/framing headers reduce accidental browser exposure and caching of
  debate responses.
- **Fix:** Added a global Hono middleware that sets restrictive headers.
- **Verification:** [tests/worker.test.ts](tests/worker.test.ts:35)
  asserts representative headers on a successful LQ response.

### S5. Manual npm Publish Runs Were Not Branch-Restricted

- **Status:** Fixed
- **Location:** [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml:20)
- **Evidence after fix:** The publish job now runs for releases, or for manual runs only from
  `main`: [.github/workflows/publish-npm.yml](.github/workflows/publish-npm.yml:22).
- **Impact:** The workflow already uses an `npm` environment and npm trusted publishing, but a
  manual dispatch from an arbitrary branch is a weaker release-control posture than publishing from
  release refs or `main`.
- **Fix:** Added a job-level condition requiring release events or `refs/heads/main`.
- **Verification:** `actionlint` passes with the new workflow condition.

## Residual Risks And Operational Notes

- GitHub Actions use major-version action pins rather than full commit-SHA pins. That is common and
  maintainable, but SHA pinning is stronger supply-chain hardening if the repo wants maximum
  assurance.
- The app enforces model spend caps but does not include an app-level request-rate limiter. Cloudflare
  firewall/rate limiting can be added at the edge if the endpoint is abused with valid tokens.
- The optional MCP helper is hardened but still disabled by default. Keep it disabled unless a
  specific read-only remote MCP origin is needed.
- Provider base URLs are intentionally configurable for OpenAI-compatible providers. Treat that value
  as trusted deployment configuration, not prompt-controlled input.

## Verification Performed

- `pnpm check`
- `pnpm test`
- `pnpm test:security`
- `pnpm typecheck`
- `pnpm format`
- `go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/*.yml`
- `pnpm security:audit`
- `go run github.com/zricethezav/gitleaks/v8@latest detect --source . --no-git --redact`
- `pnpm exec wrangler check startup`
