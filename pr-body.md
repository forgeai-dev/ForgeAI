## Description

Add a dedicated Node Protocol section to the README with supported devices table, quick setup guide, architecture diagram, auto-detected capabilities, and key management info. Fix incorrect ESP32 references across the entire codebase — ESP32 is not supported by the Go binary (requires full Linux/Windows/macOS OS).

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [x] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **README.md**: New "Node Protocol (IoT/Embedded Devices)" section with:
  - Supported Devices table (14 devices with architecture and binary info)
  - Quick Setup guide for Raspberry Pi (download, run, systemd service)
  - Auto-Detected Capabilities table (shell, system, gpio, camera, docker, network)
  - Architecture diagram (Device → NodeChannel → AgentManager → LLM)
  - Key Management documentation (Dashboard, Vault, hot-reload, API endpoints)
  - Note clarifying ESP32/Arduino/STM32 are not supported (future C/Rust micro-agent)
- **README.md**: Fixed ESP32 mentions in channels table, monorepo structure, roadmap section
- **ROADMAP.md**: Replaced ESP32 with supported devices (Jetson, BeagleBone, Orange Pi) in diagrams and cost tables
- **Settings.tsx**: Fixed ESP32 mentions in Dashboard UI descriptions
- **node-protocol.ts**: Fixed ESP32 mention in shared types platform comment

## How to Test

1. `pnpm -r build` — all packages build cleanly
2. Review README Node Protocol section renders correctly on GitHub
3. Verify no remaining ESP32 references in code (`grep -r ESP32`)

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

### Files Changed (5 files)

| File | Change |
|:-----|:-------|
| `README.md` | New Node Protocol section + ESP32 fixes |
| `ROADMAP.md` | Replace ESP32 with supported devices in diagrams |
| `packages/dashboard/src/pages/Settings.tsx` | Fix device names in UI descriptions |
| `packages/shared/src/types/node-protocol.ts` | Fix platform comment |
| `pr-body.md` | PR template for this change |
