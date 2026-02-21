# 🔥 ForgeAI — Development Roadmap

> Full development history and future plans.
> Last updated: 2026-02-16

---

## Status Atual — 22 Fases Completas

### Fase 1 ✅ — Core + Security + CLI + MySQL
- `@forgeai/shared` — Types, utils, constants
- `@forgeai/security` — Vault (AES-256-GCM), RBAC, Rate Limiter, Audit Logger, Prompt Guard, JWT Auth, 2FA, Input Sanitizer
- `@forgeai/core` — Gateway (Fastify+WS), Session Manager, DB (Knex+MySQL), Audit Store
- `@forgeai/cli` — start, doctor, status

### Fase 2 ✅ — Agent Runtime + Channels + API
- `@forgeai/agent` — Agent Runtime, Multi-LLM Router, Anthropic/OpenAI providers, streaming (SSE)
- `@forgeai/channels` — Telegram (grammY), Discord (discord.js), WebChat

### Fase 3 ✅ — Dashboard Web
- `@forgeai/dashboard` — React 19 + Vite 6 + TailwindCSS 3 + Lucide icons
- Páginas: Overview, Chat, Audit Log, Settings

### Fase 4 ✅ — Tools + Knowledge Base
- `@forgeai/tools` — Tool Registry + 5 built-in tools
  - WebBrowser (fetch + Cheerio), FileManager (sandboxed), CronScheduler, CodeRunner (node:vm), KnowledgeBase (TF-IDF)

### Fase 5 ✅ — Plugins + Workflows
- `@forgeai/plugins` — Plugin Manager, lifecycle hooks, file storage, 2 built-in plugins (AutoResponder, ContentFilter)
- `@forgeai/workflows` — Workflow Engine (tool/condition/delay/transform/parallel steps)

### Fase 6 ✅ — Canais Prioritários + Browser Real
- WhatsApp channel (Baileys) — QR pairing, allowlist, reconnect
- Slack channel (Bolt SDK) — Socket Mode, allowlist users+channels, app_mention
- Puppeteer Browser tool — navigate, screenshot, click, type, evaluate, pdf, close
- Chat Commands plugin — /status /new /help /tools /plugins /model /workflows
- **5 channels**, **6 tools**, **3 plugins**

### Fase 7 ✅ — Agent Avançado
- UsageTracker — per-model pricing (Anthropic+OpenAI), cost calc, summary, records
- Smart Session Pruning — token-based context compression + summary
- Thinking Levels — off/low/medium/high para models compatíveis
- Session Management — listSessions(), getSessionInfo(), sessionMeta
- DB Migration 002 — usage_log table, messages model/provider columns
- API endpoints: /api/sessions, /api/usage, /api/agent/config, /api/agent/thinking

### Fase 8 ✅ — Docker + Deploy + Dashboard Upgrade
- Dockerfile multi-stage (build + production + Chromium)
- docker-compose.yml (gateway + mysql, health checks, volumes)
- Dashboard: página Tools interativa (expand, params, execute)
- Dashboard: página Usage/Analytics (cards, by provider/model, records table)
- Health monitoring avançado — /api/health/detailed (memory, uptime, node, checks)
- .dockerignore
- **6 páginas no dashboard**: Overview, Chat, Tools, Usage, Audit, Settings
- **23+ API endpoints**

---

## Features que Faltam no ForgeAI

### 🔴 Channels em Falta (3 restantes)
| Channel | Lib/Protocolo | Complexidade | Notas |
|---------|--------------|-------------|-------|
| Signal | signal-cli (Java subprocess) | Alta | Requer JVM + signal-cli instalado |
| iMessage | BlueBubbles API | Média | Só funciona com macOS + iPhone |
| Matrix | matrix-js-sdk | Média | Protocolo aberto, self-hosted |

> ✅ **Já implementados:** Telegram, Discord, WhatsApp, Slack, WebChat, Microsoft Teams, Google Chat (7 channels)

### � Agent Avançado (tudo implementado!)
> ✅ Todos os itens desta seção já foram implementados:
> - Agent-to-Agent sessions → **Fase 15** (sessions_list, sessions_history, sessions_send)
> - MCP (Model Context Protocol) → **Fase 13** (MCPClient, tool servers HTTP/SSE/stdio)
> - Memory de longo prazo → **Fase 13+16** (MemoryManager TF-IDF + Cross-Session Memory)
> - RAG → **Fase 14** (RAGEngine, chunked embeddings, cosine similarity)
> - Function calling nativo → **Fase 15** (Agentic Loop, 25 iterations, tool_calls/tool results)
> - Auto-planning → **Fase 14** (AutoPlanner, dependency graph, parallel execution)
> - Model Failover → **Fase 19** (Circuit breaker, fallback chain, FailoverEvent)
> - Workspace Prompts → **Fase 19** (AGENTS.md, SOUL.md, IDENTITY.md, USER.md)

### 🔴 Infraestrutura (2 restantes)
| Feature | Descrição | Complexidade |
|---------|-----------|-------------|
| ~~Observability (OpenTelemetry)~~ | ~~Traces + metrics + spans~~ | ✅ Fase 22 |
| Log aggregation | Structured logging para ELK/Loki/CloudWatch | Média |
| Database migrations automáticas | Knex migrate:latest no startup | Baixa |

> ✅ **Já implementados:** Tailscale remote access (Fase 12), E2E Tests 38 Vitest (Fase 12-14), CI/CD GitHub Actions (Fase 13), OpenTelemetry (Fase 22)

### 🔴 Apps Nativas (2 restantes)
| Feature | Descrição | Complexidade |
|---------|-----------|-------------|
| Electron app | Desktop wrapper do Dashboard (Windows/Mac/Linux) | Média |
| React Native / Expo | App mobile com chat + notificações push | Alta |
| ~~Voice Wake Word~~ | ~~Porcupine/Picovoice para ativação por voz "Hey Forge"~~ | ✅ Done |

> ✅ **Já implementados:** PWA (Fase 12) — manifest.json + service worker

### 🔴 Integrações Externas (1 restante)
| Feature | Descrição | Complexidade |
|---------|-----------|-------------|
| ~~Calendar (Google/Outlook)~~ | ~~Criar/ler eventos, lembretes~~ | ✅ Fase 22 |
| ~~Notion / Obsidian~~ | ~~Sync de notas e documentos~~ | ✅ Fase 22 |
| Spotify / Home Assistant | Controle de dispositivos e mídia por chat | Baixa |

> ✅ **Já implementados:** GitHub integration (Fase 14), RSS/Atom feeds (Fase 14), Gmail (Fase 20), Calendar (Fase 22), Notion (Fase 22)

### 🔴 Segurança & Compliance (0 restantes) ✅ COMPLETO
| Feature | Descrição | Complexidade |
|---------|-----------|-------------|
| ~~Data encryption at rest~~ | ~~Criptografia do DB inteiro~~ | 📌 Nice-to-have futuro (Vault já cobre secrets) |
| ~~Session recording & replay~~ | ~~Gravar e reproduzir sessões para debug/audit~~ | ✅ Done |

> ✅ **Já implementados:** OAuth2/SSO Google/GitHub/Microsoft (Fase 13), GDPR export/delete (Fase 14), IP allowlist/blocklist (Fase 12), API Key Management 12 scopes (Fase 14)

### Resumo: O que Falta
```
Channels:        3 restantes (Signal, iMessage, Matrix)
Agent Avançado:  0 restantes ✅ COMPLETO
Infraestrutura:  2 restantes (Log aggregation, DB migrations auto)
Apps Nativas:    3 restantes (Electron, React Native, Voice Wake)
Integrações:     1 restante (Spotify/HA)
Segurança:       0 restantes ✅ COMPLETO (DB encryption → nice-to-have)
────────────────────────────────────────
Total:          12 features restantes (de 37 originais — 68% concluído!)
```

### Priorização Sugerida — Próximas Fases

**Fase 20:** ✅ Onboarding Wizard CLI + Google Chat channel + Gmail integration
**Fase 21:** ✅ Dashboard UI Gaps (MCP, Memory, API Keys, Webhooks)
**Fase 22:** ✅ Calendar + Notion + OpenTelemetry
**Fase 23:** ForgeAI Node Protocol (veja seção abaixo)
**Fase 24+:** Apps nativas (Electron, React Native), channels restantes

---

## 🚀 Roadmap Futuro — ForgeAI Node (Dispositivos Embarcados + Rede IoT)

### Conceito: Rede de Satélites ForgeAI

A ideia é criar um **micro-agente leve** (binary Go/Rust ~5-10MB) que se comunica com o Gateway principal via WebSocket. O Node **não roda IA** — só coleta dados locais e executa instruções recebidas do Gateway.

```
┌─────────────────┐     ┌──────────────────┐
│  ForgeAI Node   │────▸│  ForgeAI Gateway  │
│  (embarcado)    │◂────│  (seu PC/server)  │
│  Go/Rust ~5MB   │ WS  │  Node.js completo │
└─────────────────┘     └──────────────────┘
   Raspberry Pi            Seu computador
   Jetson · NanoKVM        com toda a IA
   BeagleBone
```

### Arquitetura

```
╔══════════════════════════════════════════╗
║           ForgeAI Ecosystem              ║
╠══════════════════════════════════════════╣
║                                          ║
║  ┌─────────┐  ┌─────────┐  ┌─────────┐  ║
║  │ Node A  │  │ Node B  │  │ Node C  │  ║
║  │ Sensor  │  │ Camera  │  │ Switch  │  ║
║  │ RPi 4   │  │ RPi Zero│  │ Jetson  │  ║
║  └────┬────┘  └────┬────┘  └────┬────┘  ║
║       │            │            │        ║
║       └────────────┼────────────┘        ║
║                    │ WebSocket            ║
║            ┌───────┴───────┐             ║
║            │ ForgeAI       │             ║
║            │ Gateway       │             ║
║            │ (seu PC)      │             ║
║            └───────┬───────┘             ║
║                    │                     ║
║     ┌──────────────┼──────────────┐      ║
║     │              │              │      ║
║  Telegram    Dashboard     WhatsApp      ║
║                                          ║
╚══════════════════════════════════════════╝
```

### Como funciona

**ForgeAI Node** (binary leve em Go/Rust, ~5-10MB RAM):
- Conecta via WebSocket ao Gateway principal
- Coleta dados locais (sensores, câmera, GPIO, temperatura)
- Executa comandos locais (ligar/desligar coisas, ler sensores)
- **NÃO roda IA** — só envia dados e recebe instruções

**ForgeAI Gateway** (o que já temos, Node.js):
- Recebe dados dos Nodes
- Processa com IA (LLM, tools, RAG, etc.)
- Envia instruções de volta pros Nodes

**Comunicação Node-to-Node via Gateway:**
- Node A (sensor de temperatura) → Gateway → Node B (ar condicionado)
- O agente no Gateway decide: "temperatura alta → ligar ar"

### Por que vale a pena

**Prós:**
- Abre mercado de **IoT + IA** (home automation, monitoramento)
- Unique approach — AI-powered Node-to-Node coordination via central Gateway
- Custo baixo (Raspberry Pi Zero = $15, Orange Pi = $20)
- Já temos a infra pronta (WebSocket, multi-agent, sessions_send)

**Contras:**
- Precisa escrever código em **Go ou Rust** (fora do nosso stack TypeScript)
- Hardware testing é complexo
- Não é o core do produto agora

### Fases de implementação

| Fase | O que | Prioridade |
|------|-------|------------|
| **20** | ForgeAI Node Protocol spec (WebSocket messages, auth, discovery) | Média |
| **21** | ForgeAI Node binary em Go (single binary, cross-compile ARM/RISC-V/x86) | Baixa |
| **22** | Node-to-Node communication via Gateway (sensor → IA → atuador) | Baixa |
| **23** | Dashboard: Node management page (status, logs, comandos) | Baixa |
| **24** | Node SDK para sensores populares (DHT22, PIR, câmera, relay) | Baixa |

### Design Advantages

| Aspect | ForgeAI Node Approach |
|--------|----------------------|
| **Architecture** | AI runs on Gateway, Node is lightweight (~5MB) |
| **Intelligence** | Unlimited — uses the full Gateway (LLM, RAG, tools) |
| **Multi-device** | Coordinated network with central AI |
| **Node-to-Node** | Via Gateway with AI deciding actions |
| **Cost** | Raspberry Pi Zero ($15), Orange Pi ($20) |

---

## Roadmap — Fases Completas

### Fase 22 ✅ — Calendar + Notion + OpenTelemetry
- **Google Calendar Integration** — REST API completa:
  - `CalendarIntegration` em `packages/tools/src/integrations/calendar-integration.ts`
  - 11 API endpoints: configure, status, calendars, events (list/get/create/update/delete), quickadd, today, upcoming, freebusy
  - OAuth2 access token, suporte allDay events, attendees, recurrence
- **Calendar Dashboard Page** (`/calendar`) — Página #16:
  - 3 tabs: Eventos (lista + detalhe + quick add), Criar (form completo), Config (OAuth token)
  - Range ajustável (±7 dias), busca natural "Reunião amanhã 14h"
  - Detalhe com local, descrição, participantes (status cores), link Google Calendar
- **Notion Integration** — Notion API v1 completa:
  - `NotionIntegration` em `packages/tools/src/integrations/notion-integration.ts`
  - 8 API endpoints: configure, status, search, pages (get/content/create/append), databases (get/query)
  - Sem página dedicada (config via API, checklist diz: painel pequeno)
- **OpenTelemetry Manager** — Observabilidade leve sem SDK pesado:
  - `OTelManager` em `packages/core/src/telemetry/otel-manager.ts`
  - Traces (startSpan/endSpan), Metrics (counter/gauge/histogram)
  - Pre-built instrumentation: trackRequest, trackChatMessage, trackToolExecution, trackLLMCall
  - OTLP/HTTP export (batch flush), in-memory fallback
  - 4 API endpoints: status, configure, spans, metrics
  - Card no Overview: spans/metrics/counters com indicator ativo/desativado
- **16 páginas Dashboard**, **135+ API endpoints**

### Fase 21 ✅ — Dashboard UI Gaps (MCP, Memory, API Keys, Webhooks)
- **MCP Servers panel** — Tab na página Tools:
  - Listar servers, adicionar (nome/URL/transport), conectar, reconectar, remover
  - Listar tools e resources dos servers conectados
  - Indicador visual de conexão (verde/cinza)
- **Memory Viewer page** (`/memory`) — Página #12:
  - Stats (total entradas, tokens, importância média)
  - Busca semântica na memória do agente
  - Deletar entradas individuais
  - Botão consolidar (merge duplicatas)
- **API Keys page** (`/api-keys`) — Página #13:
  - Criar keys com nome, scopes (12 disponíveis), expiração
  - Banner com key para copiar (mostrada uma única vez)
  - Listar keys com prefix, scopes, usos, datas
  - Revogar e deletar keys
- **Webhooks page** (`/webhooks`) — Página #14:
  - 3 tabs: Outbound (criar, listar, eventos), Inbound (criar, listar, path), Events (log com status/duration)
  - Criar outbound com nome/URL/eventos, inbound com nome/path/handler
- **15 páginas Dashboard**, **120+ API endpoints**

### Fase 20 ✅ — Onboarding Wizard + Google Chat + Gmail + Dashboard UI
- **Onboarding Wizard CLI** (`forge onboard`) — Setup interativo em 5 passos:
  - Segurança (auto-gera JWT_SECRET + VAULT_MASTER_PASSWORD)
  - LLM Provider (8 providers com URL de API key + validação)
  - Channels (Telegram, Discord, WhatsApp, Slack, Teams — tokens salvos no .env)
  - Personalidade do agente (nome, idioma, persona → IDENTITY.md / SOUL.md)
  - Verificação MySQL + sumário final com próximos passos
  - Provider key salva em `.forgeai/onboard-provider.json` → auto-carregada no primeiro `forge start` → Vault → deleta arquivo
- **Google Chat Channel** — 7º channel, webhook-based:
  - `GoogleChatChannel` em `packages/channels/src/googlechat.ts`
  - Webhook POST /api/googlechat/webhook (sync reply <30s, async via REST API)
  - Service account JWT auth (RS256) para mensagens async
  - ChannelWithPermissions (allowedUsers, allowedSpaces, adminUsers)
  - Message chunking 4096 chars, pending reply system
- **Gmail Integration** — Email completo via Gmail REST API:
  - `GmailIntegration` em `packages/tools/src/integrations/gmail-integration.ts`
  - 10 API endpoints: configure, status, messages, message/:id, send, search, labels, unread, threads/:id, messages/:id/read
  - MIME builder, body parsing (text/plain + parts), attachments metadata
  - Polling mode para novos emails (configurable interval)
- **Dashboard — Gmail Page** — Página #11:
  - 3 tabs: Inbox (busca, lista, detalhe, mark read), Compose (to/subject/body/send), Config (OAuth token)
  - Menu lateral: Mail icon → "Gmail"
- **Dashboard — Autopilot no Overview** — Card com status, tarefas, intervalo, último check
- **Dashboard — AUTOPILOT.md no Workspace** — 5º arquivo editável, auto-reload do engine ao salvar
- **7 channels**, **11 tools**, **11 páginas Dashboard**, **120+ API endpoints**

### Fase 19 ✅ — DM Pairing + Model Failover + Workspace Prompts + Dashboard Workspace
- **DM Pairing System** — Códigos de convite FORGE-XXXX-XXXX para onboarding de usuários:
  - `PairingManager` em `packages/core/src/pairing/pairing-manager.ts`
  - Comando `/pair` nos chats (Telegram/WhatsApp) para resgatar códigos
  - Auto-add user nas permissões do canal + persist no Vault
  - Dashboard: `PairingPanel` na página Channels (gerar, listar, copiar, revogar)
  - API: POST /api/pairing/generate, GET /api/pairing/codes, DELETE /api/pairing/codes/:code, GET /api/pairing/stats
- **Model Failover (LLMRouter rewrite)** — Fallback automático quando provider falha:
  - `buildFallbackChain()` — provider específico primeiro, depois toda a cadeia de fallback
  - `chatStream()` agora com fallback chain completa (antes: zero fallback)
  - **Circuit Breaker** por provider — 5 falhas em 5min → skip 2min cooldown, half-open recovery
  - `FailoverEvent` + `consumeLastFailover()` para tracking/notificação
  - `getCircuitStatus()` para API/dashboard
- **Workspace Prompts** — Personalização do agente via arquivos Markdown:
  - `AGENTS.md` (comportamento), `SOUL.md` (personalidade), `IDENTITY.md` (identidade), `USER.md` (preferências)
  - Templates auto-criados em `.forgeai/workspace/` no primeiro boot
  - Injetados no system prompt quando customizados (ignora templates padrão)
  - Cap de 4000 chars por arquivo
  - API: GET /api/workspace/prompts, GET/PUT /api/workspace/prompts/:filename
- **Dashboard Workspace Page** — Página #10 no Dashboard:
  - Editor de texto para cada arquivo com syntax mono
  - Sidebar com 4 arquivos + indicador verde "Ativo no prompt"
  - Preview, desfazer, salvar, warning >4000 chars
  - Menu lateral: Brain icon → "Workspace"
- **Telegram** — Emoji 👀 reaction ao receber mensagens, /pair no setMyCommands
- **6 channels**, **11 tools**, **10 páginas Dashboard**, **100+ API endpoints**

### Fase 18 ✅ — Autopilot + Chat Commands Lúdicos
- **Autopilot Engine** (AUTOPILOT.md) — Scheduled tasks defined in Markdown with smart scheduling:
  - 5 horários inteligentes: @startup, @hourly, @morning, @afternoon, @evening
  - Categorias com `## Headers`
  - Entrega resultados no Telegram pro admin
  - Comando `/autopilot` com visual completo
  - API REST: GET /api/autopilot/status, POST /api/autopilot/reload
  - Template auto-gerado com exemplos em PT-BR
- **Chat Commands Lúdicos** — 11 comandos universais reescritos:
  - PT-BR nativo com emojis e formatação visual (╔══╗)
  - Indicador ▸ na opção selecionada
  - Labels descritivos: "Desligado/Leve/Medio/Profundo"
  - Dicas contextuais e exemplos em cada comando
  - Novos: /autopilot adicionado ao /help e setMyCommands do Telegram
- **97+ API endpoints total**

### Fase 17 ✅ — Chat Commands Universais + Typing Indicators
- **ChatCommandHandler** — Comandos centralizados: /status, /new, /reset, /compact, /think, /verbose, /usage, /restart, /activation, /help
- **SessionSettings** — Configurações por-sessão: verbose, usageMode, activation, thinkingLevel
- **Typing Indicators** — sendTyping() no Telegram (sendChatAction) e WhatsApp (sendPresenceUpdate)
- **Usage Footer** — formatUsageFooter() mostra tokens/custo/tempo em cada resposta (via /usage)
- **Integração em todos os canais** — Telegram, WhatsApp, WebChat interceptam comandos antes do AgentManager
- **95+ API endpoints total**

### Fase 16 ✅ — Cross-Session Memory + WebSocket Streaming + Microsoft Teams
- **Cross-Session Memory** — MemoryManager integrado ao AgentRuntime: auto-armazena resumos de cada interação, busca memórias relevantes de sessões anteriores via TF-IDF cosine similarity, injeta no system prompt como contexto. Topic summaries a cada 10 mensagens.
- **WebSocket Real-Time Streaming** — WSBroadcaster gerencia clientes WS com session subscriptions. AgentProgressEvent + onProgress/offProgress listeners no AgentRuntime. Dashboard conecta via WS e recebe `agent.progress`, `agent.step`, `agent.done` em tempo real. Fallback para polling HTTP se WS indisponível.
- **Microsoft Teams Channel** — TeamsChannel usando Bot Framework SDK v4 (botbuilder). Suporta DMs e group chats, auto-remove @mention do texto, typing indicator, allowlist de usuários/channels, message chunking (4000 chars). Webhook em `/api/teams/messages`.
- **AgentManager.setMemoryManager()** — Propaga MemoryManager para todos os agentes (existentes e novos)
- **6 channels**: WhatsApp, Telegram, Discord, Slack, WebChat, Microsoft Teams
- API endpoints: /api/teams/messages (webhook Bot Framework)
- **95+ API endpoints total**

### Fase 15 ✅ — Agentic Loop + Multi-Agent + Multimodal
- **Agentic Tool-Calling Loop** — LLM chama tools, recebe resultados, itera até completar (max 10 iterações)
- **ShellExecTool** — Execução de comandos shell com segurança (blocked patterns, timeout, cross-platform)
- **Admin Permissions** — PowerShell/Bash com acesso admin, absolute paths, hard-blocked dangerous patterns
- **Chat History Persistence** — JSON-based storage em `.forgeai/chat-sessions/`, sobrevive restart
- **Execution Steps UI** — StepRenderer no chat com tool_call (azul) e tool_result (verde/vermelho) expansíveis
- **Multi-Agent System (AgentManager)** — Múltiplos AgentRuntime isolados, routing por bindings, per-agent tools allow/deny
- **Session Tools** — `sessions_list`, `sessions_history`, `sessions_send` para comunicação agent-to-agent
- **Agent-to-Agent Messaging** — Delegação de tasks entre agentes com allow list configurável
- **Multimodal Image Support** — Upload de imagens base64, rendering no chat, envio para LLM (OpenAI content array)
- **Dashboard SPA Serving** — Gateway serve o build do dashboard com SPA fallback (setNotFoundHandler)
- **Dashboard Agents Page** — CRUD de agentes com UI completa (criar, editar, remover, listar)
- **Agent Selector no Chat** — Pill buttons para escolher qual agente responde, link para /agents
- API endpoints: /api/agents (CRUD), /api/agents/bindings, /api/agents/send, /api/chat/upload, /api/files/*, /api/chat/progress/:id
- **11 tools**: web_browse, file_manager, cron_scheduler, code_run, knowledge_base, browser, shell_exec, desktop, sessions_list, sessions_history, sessions_send
- **8 páginas no Dashboard**: Overview, Chat, Tools, Usage, Plugins, Channels, Agents, Audit, Settings
- **90+ API endpoints total**

### Fase 9 ✅ — Docker Sandbox + Backup + Rate Limiting Avançado
- SandboxManager — Docker container isolation (read-only, no-network, memory/cpu limits)
- Backup & Restore API — Vault export/import (encrypted payloads), system backup info
- AdvancedRateLimiter — 12 regras default (global, per-channel, per-tool), burst handling
- API endpoints: /api/sandbox/status, /api/sandbox/execute, /api/rate-limits, /api/backup/*
- AuditAction types: backup.vault.export/import/restore, rate_limit.config
- **30+ API endpoints total**

### Fase 10 ✅ — Voice + Webhooks
- VoiceEngine — TTS (OpenAI, ElevenLabs) + STT (Whisper) abstraction layer
- Voice types: TTSProvider, STTProvider, TTSRequest/Response, STTRequest/Response, VoiceConfig
- WebhookManager — Outbound (HMAC-SHA256 signatures) + Inbound (signature verify, handlers)
- Webhook event log with delivery tracking (pending/delivered/failed)
- API endpoints: /api/voice/config, /api/voice/voices, /api/webhooks/*, /api/webhooks/receive/:path

### Fase 11 ✅ — Plugin Marketplace + Dashboard
- PluginSDK — Store registry, manifest validation, template generator, categories
- Plugin Store page no Dashboard — Filter by category, enable/disable, permissions viewer
- **7 páginas no Dashboard**: Overview, Chat, Tools, Usage, Plugins, Audit, Settings
- API endpoints: /api/plugins/store, /api/plugins/store/:id/enable|disable, /api/plugins/store/categories, /api/plugins/store/template
- **43+ API endpoints total**

### Fase 12 ✅ — PWA + Remote Access + E2E Tests + IP Filter
- PWA Support — manifest.json, service worker (cache-first + network-first), Apple meta tags
- IPFilter — Allowlist/blocklist mode, CIDR support, wildcard patterns, private range detection
- TailscaleHelper — Remote access via Tailscale Serve/Funnel, status check, auto-detect
- Vitest E2E — 20 API tests covering all endpoints (health, plugins, voice, webhooks, IP filter, tailscale)
- API endpoints: /api/ip-filter, /api/ip-filter/allowlist, /api/ip-filter/blocklist, /api/remote/status, /api/remote/serve, /api/remote/stop
- **50+ API endpoints total**

### Fase 13 ✅ — MCP + Long-term Memory + OAuth2 + CI/CD
- MCPClient — Connect to external MCP tool servers (HTTP/SSE/stdio), discover tools/resources/prompts, call tools
- MemoryManager — Long-term vector memory with TF-IDF embeddings, cosine similarity search, auto-consolidation, importance scoring
- OAuth2Manager — SSO with Google, GitHub, Microsoft (authorization code flow, token exchange, user info normalization)
- GitHub Actions CI/CD — Build, API test, type check jobs with MySQL service, pnpm cache
- Vitest E2E — 27 tests covering all endpoints including MCP, Memory, OAuth2
- API endpoints: /api/mcp/servers, /api/mcp/tools, /api/mcp/resources, /api/memory/stats, /api/memory/store, /api/memory/search, /api/oauth/providers, /api/oauth/authorize/:provider, /api/oauth/callback
- **60+ API endpoints total**

### Fase 14 ✅ — RAG + Auto-Planning + API Keys + GDPR + Integrações
- RAGEngine — Document ingestion, TF-IDF chunked embeddings, cosine similarity search, context builder for LLM prompts
- AutoPlanner — Task decomposition, dependency graph, parallel execution, retry logic, step status tracking
- APIKeyManager — Create/revoke/delete keys, SHA-256 hashed storage, scoped permissions (12 scopes), expiration
- GDPRManager — User data export (sessions, messages, audit, prefs), right-to-delete, export history tracking
- GitHubIntegration — Issues, PRs, code search, repo info, create issues (token-based auth)
- RSSFeedManager — Add/fetch/parse RSS+Atom feeds, CDATA support, auto-interval
- Vitest E2E — 38 tests covering all endpoints
- API endpoints: /api/rag/*, /api/planner/*, /api/keys/*, /api/gdpr/*, /api/integrations/github/*, /api/integrations/rss/*
- **80+ API endpoints total**

---

## Current Architecture (10 packages)

```
forgeai/
├── packages/
│   ├── shared/          # Types, utils, constants
│   ├── security/        # Vault, RBAC, Rate Limiter, Audit, Prompt Guard, JWT, 2FA, Sanitizer
│   ├── core/            # Gateway (Fastify+WS), Session Manager, DB, Telemetry, Autopilot, Pairing
│   ├── agent/           # AgentRuntime, AgentManager, LLMRouter (8 providers, failover, circuit breaker)
│   ├── channels/        # 7 channels: WhatsApp, Telegram, Discord, Slack, Teams, Google Chat, WebChat
│   ├── tools/           # Tool Registry + 11 tools + Integrations (GitHub, Gmail, Calendar, Notion, RSS)
│   ├── plugins/         # Plugin Manager + PluginSDK + 3 built-in plugins
│   ├── workflows/       # Workflow Engine + step runner
│   ├── cli/             # CLI: start, doctor, status, onboard
│   └── dashboard/       # React 19 + Vite 6 + TailwindCSS + Lucide (16 pages)
├── .forgeai/            # Runtime data (vault, workspace, sessions, AUTOPILOT.md)
├── docker-compose.yml   # One-command Docker deploy
├── Dockerfile           # Multi-stage production build
├── ROADMAP.md
└── README.md
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Node.js ≥ 22 |
| Gateway | Fastify 5 + WebSocket |
| Database | MySQL 8 (Knex.js, 10 tables) |
| Encryption | AES-256-GCM, PBKDF2, bcrypt, HMAC-SHA256 |
| Auth | JWT (access + refresh) + TOTP (2FA) + OAuth2 (Google/GitHub/Microsoft) |
| Dashboard | React 19, Vite 6, TailwindCSS, Lucide Icons, Recharts |
| Channels | grammY, discord.js, Baileys, @slack/bolt, botbuilder, Google Chat API |
| LLM Providers | Anthropic, OpenAI, Google, Moonshot, DeepSeek, Groq, OpenRouter, Ollama |
| Tools | Puppeteer, Cheerio, node-cron, node:vm |
| Observability | OpenTelemetry (OTLP/HTTP) |
| Build | tsup, pnpm workspaces |
| CI/CD | GitHub Actions (build + test + type check) |
| Tests | Vitest (38 E2E tests) |
| Deploy | Docker multi-stage, docker-compose |

---

**Stats: 7 channels, 11 tools, 8 LLM providers, 16 dashboard pages, 140+ API endpoints, 7 security modules, 5 integrations, 38 E2E tests.**
