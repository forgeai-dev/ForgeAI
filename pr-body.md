## Description

Implement Voice Wake Word detection with Porcupine/Picovoice. Say "Hey Forge" to activate the agent hands-free. Includes server-side WakeWordManager with Porcupine engine + energy-based fallback, 6 REST API endpoints, Dashboard UI with AccessKey input / start-stop / sensitivity slider / stats, and full STT→Agent→TTS pipeline wired via WebSocket events.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [x] Documentation
- [x] Tests
- [ ] Security

## Changes Made

- **`packages/agent/src/wake-word.ts`** — WakeWordManager with PorcupineDetector + CustomEnergyDetector fallback
- **`packages/agent/src/porcupine.d.ts`** — Type declarations for optional `@picovoice/porcupine-node` dependency
- **`packages/shared/src/types/voice.ts`** — WakeWordConfig, WakeWordEvent, WakeWordStatus, WakeWordEngine types
- **`packages/agent/src/index.ts`** — Export WakeWordManager + createWakeWordManager
- **`packages/core/src/gateway/chat-routes.ts`** — 6 API endpoints: status, config GET/PUT, start, stop, process frame. WakeWordManager initialization + Vault persistence. Event wiring to WSBroadcaster + STT→Agent→TTS pipeline. PICOVOICE_ACCESS_KEY in SERVICE_KEYS_META
- **`packages/dashboard/src/pages/Settings.tsx`** — Wake Word Detection section: Picovoice AccessKey input, Start/Stop Listening button, sensitivity slider, detection stats (count, uptime, last detection), info panel
- **`.env.example`** — PICOVOICE_ACCESS_KEY, WAKE_WORD_KEYWORD, WAKE_WORD_SENSITIVITY
- **`tests/api.test.ts`** — 4 wake word API tests + put() helper
- **`README.md`** — Voice wake word marked as ✅ Done in roadmap
- **`ROADMAP.md`** — Voice Wake Word marked as ✅ Done, section count updated

## How to Test

1. `pnpm -r build` — all packages build successfully
2. `pnpm forge start --migrate`
3. `pnpm test` — 61+ tests passing (4 new wake word tests)
4. Dashboard → Settings → Wake Word Detection → enter Picovoice AccessKey → Start Listening
5. `GET /api/wakeword/status` returns detection status
6. `PUT /api/wakeword/config` with `{"sensitivity": 0.7}` updates sensitivity

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

### Files Changed (10 files, +963 lines)

| File | Change |
|:-----|:-------|
| `packages/agent/src/wake-word.ts` | **NEW** — WakeWordManager + PorcupineDetector + EnergyDetector (~486 lines) |
| `packages/agent/src/porcupine.d.ts` | **NEW** — Type declarations for @picovoice/porcupine-node |
| `packages/shared/src/types/voice.ts` | Wake word types: WakeWordConfig, WakeWordEvent, WakeWordStatus |
| `packages/agent/src/index.ts` | Export WakeWordManager + createWakeWordManager |
| `packages/core/src/gateway/chat-routes.ts` | 6 endpoints + init + Vault + event wiring (+163 lines) |
| `packages/dashboard/src/pages/Settings.tsx` | Wake Word UI section (+192 lines) |
| `.env.example` | PICOVOICE_ACCESS_KEY + wake word config |
| `tests/api.test.ts` | 4 wake word tests + put() helper |
| `README.md` | Roadmap: wake word ✅ Done |
| `ROADMAP.md` | Wake Word ✅ Done, section count updated |
