## Description

Major feature release: Dual environment routing, streaming heartbeat (no more timeouts), static site hosting, and native domain/HTTPS support.

## Type of Change

- [x] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [x] Documentation
- [ ] Tests
- [x] Security

## Changes Made

### Dual Environment Routing
- `packages/tools/src/tools/shell-exec.ts`: Added `target` parameter (`server`/`companion`)
- `packages/tools/src/tools/file-manager.ts`: Added `target` parameter (`server`/`companion`)
- `packages/core/src/gateway/companion-bridge.ts`: `CompanionToolExecutor.execute()` only delegates to Companion when `target="companion"` or tool is `desktop`
- `packages/agent/src/runtime.ts`: System prompt includes dual environment instructions with routing rules and keyword detection

### Streaming Heartbeat (Timeout Fix)
- `packages/core/src/gateway/chat-routes.ts`: `/api/chat` sends periodic heartbeat spaces every 10s during long agent processing, then final JSON
- `packages/companion/src-tauri/src/commands.rs`: `chat_send` sends `stream: true`, uses `connect_timeout` only (no total timeout), reads full body, trims heartbeats, parses JSON

### Static Site Hosting
- `packages/core/src/gateway/chat-routes.ts`: New `/sites/*` route serves static files from `.forgeai/workspace/` with directory index support
- `packages/core/src/gateway/server.ts`: `/sites/` exempt from rate limiting and authentication
- `packages/agent/src/runtime.ts`: System prompt includes SERVER NETWORKING rules instructing agent to use `/sites/` URLs

### Native Domain / HTTPS
- `Caddyfile`: Caddy reverse proxy config with security headers (HSTS, X-Frame-Options, etc.), WebSocket support
- `docker-compose.yml`: Added Caddy service with Docker Compose profile `domain`
- `scripts/setup-domain.sh`: Interactive setup script (DNS validation, port check, .env config, deploy)
- `.env.example`: Documented `DOMAIN` env var

### Companion Improvements
- `packages/companion/src-tauri/src/local_actions.rs`: Added `cwd` support, PowerShell instead of cmd
- `packages/companion/src-tauri/src/commands.rs`: `cwd` field in `ActionRequest`
- `packages/companion/src-tauri/src/connection.rs`: `cwd` field propagation

### Documentation
- `README.md`: Full documentation of all new features (dual routing, streaming, site hosting, domain/HTTPS, updated roadmap)

## How to Test

1. **Dual Routing**: Connect Companion → ask "crie uma pasta no meu windows" (target=companion) vs "crie um site no linux" (target=server)
2. **Streaming**: Ask a complex multi-step task → should complete without timeout errors
3. **Static Sites**: Ask agent to create a website → accessible at `http://<server>:18800/sites/<project>/`
4. **Domain**: Run `bash scripts/setup-domain.sh` with a valid domain → HTTPS auto-configured

## Related Issue

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Companion builds without errors (`npx tauri build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated
