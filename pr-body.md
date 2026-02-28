## Description

Subdomain system for agent-created sites and apps, managed via the Dashboard. Includes domain settings API, app registry, subdomain routing middleware, dashboard UI, agent-aware URL generation, and Caddy wildcard config. Also increases Docker shm_size to 8GB for Chromium stability.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [ ] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

### 1. Domain Settings API (Vault-persisted)
- `packages/core/src/gateway/chat-routes.ts`: GET/PUT/DELETE `/api/settings/domain` — stores domain & subdomains_enabled in Vault, returns DNS instructions and active sites/apps list
- No `.env` changes needed — all config via Dashboard

### 2. App Registry
- `packages/core/src/gateway/chat-routes.ts`: In-memory `appRegistry` Map (name↔port), persisted to Vault. Endpoints: GET `/api/apps/registry`, POST `/api/apps/register`, DELETE `/api/apps/registry/:name`
- `resolvePublicUrl()` and `getSiteUrl()` helper functions for domain-aware URL generation

### 3. Subdomain Routing Middleware
- `packages/core/src/gateway/server.ts`: `registerSubdomainRouting()` — Fastify `onRequest` hook reads Host header, extracts subdomain, routes to workspace static site or proxies to registered app port

### 4. Agent Runtime (Domain-Aware)
- `packages/agent/src/runtime.ts`: Updated system prompt SERVER NETWORKING section with app registry instructions and subdomain URL patterns
- `detectEnvironment()`: Now includes Apps URL, App Registry API endpoint in system state
- Dynamic context provider: Injects domain config, subdomains status, registered apps with resolved URLs

### 5. Dashboard UI — Domain & Sites Section
- `packages/dashboard/src/pages/Settings.tsx`: New "Domain & Sites" section with domain input, save/delete, subdomains toggle, DNS instructions panel, active sites/apps list with links
- `packages/dashboard/src/lib/api.ts`: Added `getDomainSettings`, `saveDomainSettings`, `deleteDomainSettings`, `getAppRegistry`, `registerApp`, `unregisterApp` API methods

### 6. Caddyfile — Wildcard Subdomain Support
- `Caddyfile`: Added `*.{$DOMAIN}` block with on-demand TLS for auto-cert per subdomain, proxying all to Gateway

### 7. Docker shm_size
- `docker-compose.yml`: `shm_size: '8gb'` for gateway container (Chromium stability)

## How to Test

1. `pnpm -r build` — all packages compile cleanly
2. `pnpm forge start --migrate`
3. **Domain Settings**: Dashboard → Settings → Domain & Sites → set domain, toggle subdomains, verify DNS instructions appear
4. **App Registry**: Agent creates app → registers via POST `/api/apps/register` → appears in settings list
5. **Subdomain Routing**: With domain configured + subdomains enabled, access `appname.yourdomain.com` → routes to correct app
6. **Agent Awareness**: Ask agent to create a site — it should report the correct URL pattern (subdomain if configured, path-based otherwise)

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)

---

### Files Changed

| File | Changes |
|------|---------|
| `packages/core/src/gateway/chat-routes.ts` | Domain settings API, app registry, resolvePublicUrl, getSiteUrl, dynamic context with domain info |
| `packages/core/src/gateway/server.ts` | Subdomain routing middleware (registerSubdomainRouting) |
| `packages/agent/src/runtime.ts` | System prompt networking section, detectEnvironment with app registry info |
| `packages/dashboard/src/pages/Settings.tsx` | Domain & Sites UI section |
| `packages/dashboard/src/lib/api.ts` | Domain/app-registry API methods |
| `Caddyfile` | Wildcard subdomain block with on-demand TLS |
| `docker-compose.yml` | shm_size: 8gb |
