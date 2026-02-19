## Description

Cross-platform desktop automation (macOS/Linux/Windows), file manager full system access, CLI ASCII banner, and dashboard chat UI redesign.

## Type of Change

- [ ] 🐛 Bug fix
- [x] ✨ New feature
- [x] ♻️ Refactor (no functional changes)
- [x] 📝 Documentation
- [ ] 🧪 Tests
- [ ] 🔒 Security

## Changes Made

### 1. Desktop Automation — Full macOS Support

- **AppleScript** for window management: list_windows, focus_window, send_keys, type_text
- **screencapture** for screenshots (native, no dependencies)
- **Vision framework** for OCR via Swift (native macOS 10.15+, fallback to tesseract)
- **pbcopy/pbpaste** for clipboard access
- **open -a** for launching applications
- **cliclick/Quartz** for mouse click automation
- **UI Automation** for reading window text elements

### 2. Desktop Automation — Linux Improvements

- **Wayland support**: ydotool, wlrctl, grim, wtype as alternatives to X11 tools
- **OCR via tesseract**: `sudo apt install tesseract-ocr`
- **Dependency detection**: clear error messages when tools are missing with install commands
- **read_window_text**: improved with xdotool + xprop
- **New `system_info` action**: detects OS, arch, root status, and available capabilities per platform

### 3. File Manager — Full System Access

- **Removed sandbox restriction**: absolute paths (`/etc/nginx/...`, `C:\Users\...`) now access anywhere
- **6 new actions**: `mkdir`, `copy`, `move`, `search`, `permissions` (chmod), `disk_info`
- **Max file size**: 5MB → 50MB
- **Permissions display**: shows Unix permissions and owner (uid/gid) on Linux
- **Silent operations**: Windows file ops run without opening visible windows

### 4. CLI — ASCII Art Banner

- ForgeAI ASCII art logo in orange displayed on every command
- Platform info line: "10 LLM Providers · 13 Tools · 7 Channels · Security-First"
- Improved `forge start` output with colored status and security module checkmarks
- Banner shows on `forge` (no args), `forge start`, `forge doctor`, `forge status`

### 5. Dashboard — Chat UI Redesign

- **Grouped cards**: tool_call + tool_result merged into unified collapsible cards
- **Color-coded borders**: green (success), red (error), gray (running)
- **Clickable URLs**: web_browse results show truncated clickable links
- **Extracted titles**: result preview without expanding
- **Collapsible results**: collapsed by default, click to expand
- **Live progress**: updated to match card-based style during agent execution

### 6. README — URL Updates

- All `git clone` URLs updated from `diegofelipeee/ForgeAI` to `forgeai-dev/ForgeAI`

---

## Files Changed (6 files)

| File | Change |
|:-----|:-------|
| `packages/tools/src/tools/desktop-automation.ts` | macOS AppleScript support, Linux Wayland/OCR, system_info action |
| `packages/tools/src/tools/file-manager.ts` | Full system access, 6 new actions, removed sandbox |
| `packages/cli/src/index.ts` | ASCII art banner, preAction hook |
| `packages/cli/src/commands/start.ts` | Colored startup output |
| `packages/dashboard/src/pages/Chat.tsx` | Card-based tool execution display |
| `README.md` | Updated git clone URLs to forgeai-dev org |

## How to Test

1. `pnpm -r build`
2. `pnpm forge start --migrate` — verify ASCII banner appears
3. Open dashboard → Chat → send a message that triggers tool execution → verify card UI
4. Test `desktop action=system_info` to verify OS capability detection
5. Test `file_manager action=list path=/` (Linux) or `path=C:\` (Windows) for full system access

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [x] No secrets or API keys committed
- [x] Documentation updated (README URLs)
