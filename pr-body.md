## Description

Bump all platform packages to v1.2.0 and Companion to v1.1.0. Includes Companion chat history fix (CORS bypass via Rust invoke), channelType support, and .gitignore cleanup for Rust build artifacts.

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### Version Bump (v1.2.0)
- Root `package.json`: 1.1.0 → 1.2.0
- All 10 platform packages (`agent`, `channels`, `cli`, `core`, `dashboard`, `desktop`, `plugins`, `security`, `shared`, `tools`, `workflows`): 1.1.0 → 1.2.0

### Companion v1.1.0
- `package.json`: 1.0.0 → 1.1.0
- `Cargo.toml`: 1.0.0 → 1.1.0
- `tauri.conf.json`: 1.0.0 → 1.1.0
- **Chat History Fix**: replaced frontend `fetch()` with Tauri `invoke()` to bypass CORS restrictions in webview
- **3 new Rust commands**: `list_sessions`, `get_session_history`, `delete_session` — proxy Gateway API calls through Rust backend
- Commands registered in `main.rs` invoke handler
- `channelType` support for identifying Companion messages in web chat

### Infrastructure
- `.gitignore`: added `**/src-tauri/target/` to exclude Rust build artifacts
- `Cargo.lock` and Tauri generated schemas added

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate`
3. `pnpm test` — expect all tests passing
4. Build Companion: `pnpm --filter @forgeai/companion run build`
5. Launch Companion → verify chat history loads (no more "No previous chats")
6. Send a message → click New Chat → verify previous conversation appears in history
7. Verify all `package.json` files show correct versions (1.2.0 platform, 1.1.0 companion)

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

### Version Summary

| Component | Previous | New |
|:----------|:---------|:----|
| **Platform** (all packages) | 1.1.0 | **1.2.0** |
| **Companion** | 1.0.0 | **1.1.0** |

### Files Changed

| File | Change |
|:-----|:-------|
| `package.json` (root) | version bump |
| `packages/*/package.json` (11 files) | version bump |
| `packages/companion/src-tauri/Cargo.toml` | version bump |
| `packages/companion/src-tauri/tauri.conf.json` | version bump |
| `packages/companion/src-tauri/src/commands.rs` | 3 new Rust commands |
| `packages/companion/src-tauri/src/main.rs` | register new commands |
| `packages/companion/src/App.tsx` | invoke-based sessions, loadSessions fixes |
| `.gitignore` | exclude Rust target/ |
