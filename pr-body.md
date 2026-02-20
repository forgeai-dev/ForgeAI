## Description

Complete internationalization (i18n) system for the Dashboard, agent identity fix to prevent hallucination, TTS text sanitization, streaming TTS playback, and voice/language config persistence in Vault.

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### 1. Dashboard i18n System (9 languages)

- **New `i18n.ts`** — translation dictionaries for EN, PT-BR, ES, FR, DE, IT, JA, KO, ZH
- **New `I18nProvider.tsx`** — React Context managing language state, loads from Vault API on mount
- **Language selector** in Settings saves to Vault + localStorage, updates entire UI instantly
- **Translated pages**: Layout (sidebar + footer), Settings, Chat, Overview — all hardcoded strings replaced with `t()` calls

### 2. Agent Identity Fix (Anti-Hallucination)

- **System prompt** now explicitly states: "You are ForgeAI, NOT Claude, NOT GPT, NOT Gemini"
- **Anti-hallucination rule**: "Only describe capabilities you actually have based on the tools listed below"
- **Applies to both** full prompt and lightweight local LLM prompt

### 3. TTS Text Sanitization

- **New `sanitizeForTTS()`** method in VoiceEngine — strips markdown, emojis, tables, code blocks, HTML tags, etc.
- **Auto-applied** in `speak()` before synthesis

### 4. TTS Streaming Playback

- **Sentence-by-sentence** TTS in Chat — splits text into chunks, plays first chunk ASAP while fetching rest
- **Sequential audio queue** for natural pacing

### 5. Config Persistence in Vault

- **Voice config** (TTS/STT provider, voice, speed) saved to Vault on change, restored on gateway restart
- **Language setting** persisted via `PUT /api/settings/language` endpoint

---

## Files Changed (14 files)

| File | Change |
|:-----|:-------|
| `packages/dashboard/src/lib/i18n.ts` | **NEW** — Translation dictionaries + useI18n hook |
| `packages/dashboard/src/components/I18nProvider.tsx` | **NEW** — React i18n context provider |
| `packages/dashboard/src/App.tsx` | Wrap app with I18nProvider |
| `packages/dashboard/src/components/Layout.tsx` | Use t() for nav labels + footer |
| `packages/dashboard/src/pages/Settings.tsx` | Use t() for all section headers, labels, Claude subscription |
| `packages/dashboard/src/pages/Chat.tsx` | Use t() for sidebar, input, status messages |
| `packages/dashboard/src/pages/Overview.tsx` | Use t() for all stats, alerts, tables, sections |
| `packages/agent/src/runtime.ts` | Fix system prompt identity + anti-hallucination |
| `packages/agent/src/voice-engine.ts` | Add sanitizeForTTS(), integrate in speak() |
| `packages/core/src/gateway/chat-routes.ts` | Voice config Vault persistence + language API endpoints |
| `packages/shared/src/types/voice.ts` | VPS STT/TTS provider types |
| `packages/channels/src/telegram.ts` | Telegram voice message handling |
| `packages/agent/src/providers/ollama.ts` | Ollama provider updates |
| `.env.example` | New env vars for VPS STT/TTS |

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate`
3. Open Dashboard → Settings → change language to Português (BR)
4. Verify all pages (Overview, Chat, Settings) update instantly
5. Refresh page — language persists
6. Open Chat → ask "quem é você?" — agent should say "ForgeAI" (not Claude/GPT)
7. Test voice mode in Chat — TTS should play clean audio without markdown artifacts

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)
