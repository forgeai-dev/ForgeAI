## Description

Add browser multi-profile support, file upload, and DOM snapshots to the Puppeteer browser tool. Profiles persist cookies/logins across restarts. Upload handles both `input[type=file]` and file chooser interception. Snapshots capture full page state (cookies, localStorage, sessionStorage, forms, scroll position) as JSON.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [x] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **`packages/tools/src/tools/puppeteer-browser.ts`** — 4 new actions + profile system:
  - `upload` — file upload via direct `input[type=file]` selector or automatic file chooser interception
  - `switch_profile` — switch browser to a named profile (persistent userDataDir)
  - `list_profiles` — list all saved browser profiles
  - `snapshot` — capture full page state: cookies, localStorage, sessionStorage, forms, scroll, viewport → saved as JSON
  - `ensureBrowser()` now accepts profile param, uses `userDataDir` per profile in `.forgeai/browser-profiles/`
  - `close` action now reports which profile was active
- **`README.md`** — Updated browser tool description with multi-profile, file upload, DOM snapshots

## How to Test

1. `pnpm -r build` — all packages build successfully
2. `pnpm forge start --migrate`
3. Test profiles: `browser({ action: "switch_profile", profile: "gmail" })` → `browser({ action: "navigate", url: "https://gmail.com" })` → close → reopen with same profile → session persists
4. Test upload: `browser({ action: "upload", selector: "input[type=file]", filePath: "/path/to/file.pdf" })`
5. Test snapshot: `browser({ action: "snapshot" })` → check `.forgeai/snapshots/snapshot_*.json`
6. Test list: `browser({ action: "list_profiles" })`

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)

---

### Files Changed (2 files, +196 lines)

| File | Change |
|:-----|:-------|
| `packages/tools/src/tools/puppeteer-browser.ts` | 4 new actions (upload, switch_profile, list_profiles, snapshot) + profile system (+196 lines) |
| `README.md` | Browser tool description updated |
