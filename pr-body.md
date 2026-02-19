## Description

Add free local Whisper STT (Speech-to-Text) for Telegram/WhatsApp voice messages. No API key required — runs entirely on the user's machine using `@huggingface/transformers`. OpenAI Whisper API kept as premium alternative.

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### 1. Local Whisper STT Adapter (Free, No API Key)

- **New `LocalWhisperSTTAdapter`** using `@huggingface/transformers` (whisper-tiny model, ~75MB)
- **Auto-downloads model** on first voice message (cached locally after that)
- **Cross-platform audio decoding** via `@ffmpeg-installer/ffmpeg` (OGG/Opus → PCM Float32 16kHz)
- **No external dependencies** — ffmpeg binary bundled as npm package (Windows/Linux/macOS)

### 2. Auto-Select STT Provider

- **No `OPENAI_API_KEY`** → uses local Whisper (free, zero cost)
- **With `OPENAI_API_KEY`** → uses OpenAI Whisper API (faster, higher quality)
- **New `whisper-local` STT provider** type added to shared types
- **Configurable model** via `WHISPER_MODEL` env var (default: `onnx-community/whisper-tiny`)

### 3. Voice Message Flow Fix (Telegram & WhatsApp)

- **Removed `isEnabled()` gate** — STT now works whenever `voiceEngine` is initialized, regardless of Voice toggle
- **Clear user feedback** — if STT fails, sends actionable error message instead of `[Voice message]`
- **Separate error handling** for Telegram and WhatsApp channels

### 4. Build Configuration

- **`pnpm-workspace.yaml`** updated: `@ffmpeg-installer/ffmpeg`, `onnxruntime-node`, `sharp` moved to `onlyBuiltDependencies` so native binaries are downloaded correctly

---

## Files Changed (6 files)

| File | Change |
|:-----|:-------|
| `packages/shared/src/types/voice.ts` | Add `whisper-local` to `STTProvider` type |
| `packages/agent/src/voice-engine.ts` | New `LocalWhisperSTTAdapter`, auto-select logic, ffmpeg decoding |
| `packages/agent/package.json` | Add `@huggingface/transformers`, `@ffmpeg-installer/ffmpeg` |
| `packages/core/src/gateway/chat-routes.ts` | Fix voice message handling for Telegram/WhatsApp |
| `pnpm-workspace.yaml` | Allow native build scripts for audio packages |
| `pnpm-lock.yaml` | Updated lockfile |

## How to Test

1. `pnpm install` — downloads ffmpeg binary + transformers
2. `pnpm -r build`
3. `pnpm forge start --migrate`
4. Send a voice message to the bot on Telegram
5. Bot should transcribe the audio and respond to the content
6. Check logs for `Local Whisper: model loaded` and `Voice transcribed (Telegram)`

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [x] No secrets or API keys committed
- [x] Cross-platform support (Windows/Linux/macOS via @ffmpeg-installer)
