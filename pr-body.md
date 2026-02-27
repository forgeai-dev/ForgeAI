## Description

Scrapling-inspired advanced web scraping features: stealth browser mode, HTML→Markdown conversion, proxy rotation, and adaptive element tracking.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [x] Security

## Changes Made

### 1. Browser Stealth Mode
- `packages/tools/src/utils/browser-stealth.ts`: Comprehensive anti-detection module with dynamic stealth profiles — user-agent rotation, viewport randomization, canvas noise injection, WebGL vendor/renderer masking, WebRTC leak prevention, CDP detection hiding, navigator property spoofing, Google search referer spoofing
- `packages/tools/src/tools/puppeteer-browser.ts`: Stealth profile generated on each browser launch, evasions applied to every new page

### 2. HTML→Markdown Conversion
- `packages/tools/src/tools/web-browser.ts`: New `extract="markdown"` mode using TurndownService — converts HTML to clean Markdown, strips noisy elements (img, iframe, svg, video, audio), collapses excessive whitespace. Reduces token usage vs raw text for AI consumption
- `packages/tools/package.json`: Added `turndown` + `@types/turndown` dependencies
- `packages/agent/src/runtime.ts`: System prompt updated to prefer `extract="markdown"` for web page reading

### 3. Proxy Rotation
- `packages/tools/src/utils/proxy-rotator.ts`: `ProxyRotator` class with cyclic/random/failover strategies, proxy URL parsing, error detection (`isProxyError()`), failure reporting, global singleton management via `configureProxies()`
- `packages/tools/src/tools/puppeteer-browser.ts`: Proxy injected into Chrome launch args + page-level auth for authenticated proxies
- `packages/tools/src/tools/web-browser.ts`: Proxy headers and rotation integrated into fetch requests with error reporting

### 4. Adaptive Element Tracking
- `packages/tools/src/utils/element-fingerprint.ts`: Element fingerprinting and similarity engine (~530 lines):
  - `ElementFingerprint` type capturing tag, attributes, text, parent chain, sibling index, depth, child count
  - 5-dimensional weighted similarity: tag (0.10), attributes/Jaccard (0.30), text/token-overlap (0.25), parent chain (0.20), position (0.15)
  - Confidence thresholds: high ≥0.75, medium ≥0.55, low ≥0.35
  - Browser-side extraction script (`EXTRACT_CANDIDATES_SCRIPT`) and Cheerio-side helpers
  - Pre-filtering by tag + 500-candidate limit for performance
- `packages/core/src/database/fingerprint-store.ts`: `FingerprintStore` class for MySQL persistence (CRUD, cleanup, match count tracking)
- `packages/core/src/database/migrations/005_element_fingerprints.ts`: New `element_fingerprints` table
- `packages/core/src/database/connection.ts`: `applyMigration005` wired into migration runner
- `packages/tools/src/tools/puppeteer-browser.ts`: `saveFingerprint()` on successful selector match, `adaptiveMatch()` fallback in `content` and `click` actions
- `packages/tools/src/tools/web-browser.ts`: Same adaptive pattern using Cheerio extraction, `adaptiveInfo` included in all extraction results

### Exports
- `packages/tools/src/index.ts`: All new utilities exported (ProxyRotator, browser-stealth, element-fingerprint)
- `packages/core/src/index.ts`: `FingerprintStore` + `StoredFingerprint` exported

## How to Test

1. **Stealth Mode**: Use `browser(action="navigate", url="https://bot.sannysoft.com")` → verify all tests pass (no headless detection)
2. **Markdown Extraction**: Use `web_browse(url="https://example.com", extract="markdown")` → verify clean Markdown output
3. **Proxy Rotation**: Configure proxies via `configureProxies()` → verify rotation in browser and fetch requests
4. **Adaptive Tracking**: Use `browser(action="content", selector=".some-class")` → change the class → re-run → verify adaptive match with `adaptiveMatch: true` in response

## Related Issue

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Database migration included
