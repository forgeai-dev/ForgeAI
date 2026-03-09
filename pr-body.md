## Description

**Security Hardening: 8 new defense layers against indirect prompt injection, data exfiltration, and machine persistence attacks.**

Closes the critical security gaps identified in the OpenClaw-style attack surface audit. Adds defense-in-depth across all tool execution paths (`shell_exec`, `file_manager`, `web_browse`, `code_runner`, agent runtime) with 170+ detection patterns, 40+ blocked exfiltration domains, and model-aware security thresholds for 28 LLM models.

## Type of Change

- [x] Bug fix (3 security bugs found and fixed during review)
- [x] New feature (8 security layers)
- [ ] Refactor (no functional changes)
- [x] Documentation (README updated: 9 → 17 security modules)
- [x] Tests (71 new security tests)
- [x] Security

## Attack Vectors Addressed

| Vector | Protection | Status |
|:-------|:-----------|:-------|
| **Indirect Prompt Injection** (hidden commands in web pages/emails) | Tool Output Sanitizer (38 patterns) + System Prompt Defense + Model Security Profiles | ✅ |
| **Sensitive File Leakage** (`.env`, SSH keys, credentials) | Sensitive File Guard (30+ patterns) + Blocked Reads (`/etc/shadow`, SAM) | ✅ |
| **Data Exfiltration** (`curl/wget/scp` with secrets) | Exfiltration Prevention (7 regex) + Network Egress Control (40+ domains) | ✅ |
| **Machine Persistence** (crontab, reverse shells, SSH key injection) | Persistence Blocker (18 regex in `shell_exec` + 10 patterns in `file_manager`) | ✅ |
| **Vulnerable LLM Models** (GPT-3.5, Ollama, Mixtral) | Model Security Profiles (28 models, 3 tiers, 43% stricter thresholds for vulnerable models) | ✅ |
| **SSRF / Cloud Metadata** (AWS/GCP/Azure `169.254.169.254`) | Network Egress Control (metadata IP + private range blocking) | ✅ |
| **Code Execution Escape** | Sandbox enabled by default (`--read-only`, `--no-new-privileges`, `--network none`) | ✅ |

## Changes Made

### New Files
- `packages/security/src/tool-output-sanitizer.ts` — S1: 38-pattern indirect prompt injection scanner for tool outputs
- `packages/security/src/network-egress.ts` — S9: Domain blocklist (40+) + SSRF prevention + shell command URL extraction
- `tests/security-hardening.test.ts` — 71 unit tests covering all 8 security layers

### Modified Files
- `packages/agent/src/runtime.ts` — Integrated S1 (tool output scanning in agentic loop), S7 (model-aware thresholds in `processMessage` AND `processMessageStream`), S8 (system prompt defense instructions). Fixed: `compactToolResult` now preserves `__sensitiveWarning` from Sensitive File Guard
- `packages/tools/src/tools/file-manager.ts` — S2 (Sensitive File Guard: 30+ patterns + blocked reads) + S4b (Persistence Guard: blocks write to `authorized_keys`, crontab, systemd, `rc.local`, `init.d`, Startup folder)
- `packages/tools/src/tools/shell-exec.ts` — S3 (Exfiltration Prevention: 7 regex) + S4 (Persistence Blocker: 18 regex) + S9 (Network Egress Control integration)
- `packages/tools/src/tools/web-browser.ts` — S9 (Network Egress Control: URL check before HTTP requests)
- `packages/tools/src/sandbox-manager.ts` — S5 (`enabled: true` by default)
- `packages/shared/src/types/security.ts` — 4 new `AuditAction` types for security event logging
- `packages/security/src/index.ts` — Exports for `ToolOutputSanitizer` and `NetworkEgressControl`

### Bugs Found & Fixed During Review
1. **`processMessageStream` missing S7** — Streaming path had no model-specific security thresholds (vulnerable models used default 0.7 instead of strict 0.4)
2. **`compactToolResult` discarding `__sensitiveWarning`** — When reading `.env` files, the Sensitive File Guard warning was stripped before reaching the LLM
3. **`file_manager` missing persistence protection** — Attacker could bypass all S4 `shell_exec` blocks by using `file_manager(write, path=~/.ssh/authorized_keys)`

### CI/CD
- `ci.yml` — Added `tests/security-hardening.test.ts` to unit test runner (10 test suites, 514+ tests)
- `security.yml` — Added exclusions for security hardening files (`network-egress.ts`, `tool-output-sanitizer.ts`, `security-hardening.test.ts`) in backdoor/domain scans to prevent false positives

### Documentation
- `README.md` — Security Modules section updated from 9 → 17. "What's New" section updated with Security Hardening details. Badge count updated

## How to Test

1. `pnpm -r run build` → all packages compile clean
2. `npx vitest run tests/security-hardening.test.ts` → 71/71 tests pass
3. `npx vitest run` → 514+/514+ tests pass (api.test.ts needs running gateway)

## Checklist

- [x] Code builds without errors (`pnpm -r run build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Backward compatible (all new features are additive, no breaking changes)
- [x] All 514+ tests pass (71 new security tests)
- [x] CI/CD workflows updated to include new test file and exclude security false positives
- [x] README updated with new security modules
