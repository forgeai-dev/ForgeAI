## Description

Built-in Cloudflare bypass mechanism for the agent's web browsing tools. Detects CF challenges in HTTP-only requests (web_browse/Cheerio), automatically falls back to Puppeteer to solve the challenge, caches the `cf_clearance` cookie, and reuses it for subsequent requests. No external services or Docker containers needed.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### 1. CF Bypass Utility (`cf-bypass.ts`)
- `packages/tools/src/utils/cf-bypass.ts`: Core utility with:
  - `isCloudflareChallenge()` — detects CF challenges via HTML patterns + response headers
  - `CFCookieCache` — in-memory cache (domain → cf_clearance cookie, 25min TTL, max 200 entries)
  - `solveCFChallenge()` — launches stealth Puppeteer, navigates to CF-protected URL, polls for cf_clearance cookie (up to 30s), caches result
  - `buildCFHeaders()` — builds fetch headers with cached CF cookies for a domain
  - `extractDomain()` — URL → hostname helper

### 2. web-browser.ts (Cheerio) Integration
- Before fetch: injects cached CF cookies (cookie + matching User-Agent) if available
- After fetch: detects CF challenge on 403/503 responses using `isCloudflareChallenge()`
- On CF detection: launches Puppeteer via `solveCFWithPuppeteer()`, retries the fetch with solved cookies
- Response processing refactored into `processResponse()` method (supports `cfBypassed` flag)
- Loop-prevention via `cfBypassAttempted` Set (per-domain, 60s cooldown)

### 3. puppeteer-browser.ts Integration
- After every `navigateAction`, calls `handleCFChallenge()` to check if page is a CF challenge
- If challenge detected: polls for cf_clearance cookie (up to 30s), caches it via `getCFCookieCache()`
- Cached cookies are automatically available for subsequent `web_browse` (Cheerio) requests
- Returns `cfBypassed: true` and `cfDomain` in navigation result when bypass occurs

### 4. Package Exports
- `packages/tools/src/index.ts`: Exports all CF bypass functions and types

## How to Test

1. `pnpm -r build` — all packages compile cleanly
2. **web_browse (Cheerio)**: Request a CF-protected site → should detect challenge, fall back to Puppeteer, solve it, and return content with `cfBypassed: true`
3. **browser (Puppeteer)**: Navigate to a CF-protected site → should auto-wait for challenge resolution and cache the cookie
4. **Cookie reuse**: After Puppeteer solves once, subsequent `web_browse` requests to the same domain should use cached cookies (no Puppeteer needed)
5. **Cache expiry**: After 25 minutes, cached cookies expire and next request triggers a fresh solve

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)

---

### Files Changed

| File | Changes |
|------|---------|
| `packages/tools/src/utils/cf-bypass.ts` | **NEW** — CF detection, cookie cache, Puppeteer solver |
| `packages/tools/src/tools/web-browser.ts` | CF detection + auto-fallback to Puppeteer, processResponse refactor |
| `packages/tools/src/tools/puppeteer-browser.ts` | handleCFChallenge after navigation, cookie caching |
| `packages/tools/src/index.ts` | Export CF bypass utilities and types |
