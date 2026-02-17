# 🔥 ForgeAI

**Security-first personal AI assistant. Run it on your machine. Own your data.**

> Multi-channel, multi-agent, agentic loop, 16-page dashboard, 140+ API endpoints, 7 security modules, 7 messaging channels — all self-hosted.

ForgeAI is a fully self-hosted AI assistant platform designed from the ground up with **security as its foundation**. Connect it to your favorite messaging apps, let it use tools autonomously, and manage everything through a modern web dashboard — all while keeping your data encrypted and under your control.

---

## Why ForgeAI?

- **Self-hosted** — Runs entirely on your machine. No cloud dependency. No data leaves your network.
- **Security-first** — 7 security modules active by default: encrypted vault, RBAC, rate limiting, prompt injection guard, input sanitizer, 2FA, and immutable audit log.
- **Multi-channel** — Chat with your AI from WhatsApp, Telegram, Discord, Slack, Microsoft Teams, Google Chat, or the built-in WebChat.
- **Agentic** — The agent can use tools autonomously (up to 25 iterations), browse the web, execute code, manage files, and plan multi-step tasks.
- **Transparent** — Full dashboard with real-time monitoring: see what the agent is doing, what tools it's using, how much it costs, and every security event.

---

## Features

### Messaging Channels (7)

| Channel | Library | Features |
|---------|---------|----------|
| **WhatsApp** | Baileys | QR pairing, allowlist, message chunking |
| **Telegram** | grammY | Bot commands, group support, DM pairing |
| **Discord** | discord.js | Slash commands, multi-server, thread support |
| **Slack** | Bolt SDK | Socket Mode, app_mention, channel routing |
| **Microsoft Teams** | Bot Framework | Webhook-based, conversation references |
| **Google Chat** | Chat API | Webhook + async REST, service account JWT |
| **WebChat** | Built-in | Browser-based chat, served from the Gateway |

### Security Modules (7)

| Module | What it does |
|--------|-------------|
| **Credential Vault** | AES-256-GCM encrypted storage with PBKDF2 key derivation. API keys, tokens, and secrets never stored in plain text. |
| **RBAC** | Role-based access control (admin/user/guest) per resource and per tool. |
| **Rate Limiter** | 12 configurable rules — per-user, per-channel, per-tool, per-IP. Sliding window with burst support. |
| **Prompt Injection Guard** | Detects 6 attack patterns: direct injection, role hijacking, encoding attacks, delimiter abuse, context manipulation, and multi-language injection. |
| **Input Sanitizer** | Blocks XSS, SQL injection, and command injection attempts before they reach the agent. |
| **2FA (TOTP)** | Time-based one-time passwords for admin operations. |
| **Audit Log** | Immutable event log with 4 risk levels (low/medium/high/critical). Queryable via API and Dashboard. |

### LLM Providers (8)

| Provider | Models |
|----------|--------|
| **Anthropic** | Claude Opus, Sonnet, Haiku |
| **OpenAI** | GPT-4o, GPT-4, GPT-3.5-turbo |
| **Google** | Gemini Pro, Gemini Flash |
| **Moonshot** | Kimi K2.5 |
| **DeepSeek** | DeepSeek V3, DeepSeek Chat |
| **Groq** | Llama, Mixtral (ultra-fast) |
| **OpenRouter** | 100+ models via single API |
| **Ollama** | Any local model (Llama, Mistral, etc.) |

All providers support **automatic failover** with circuit breaker (per-provider health tracking, exponential backoff, fallback chain).

### Built-in Tools (11)

| Tool | Description |
|------|-------------|
| `web_browse` | Fetch and parse web pages (Cheerio). Blocks private IPs. |
| `browser` | Full Puppeteer control: navigate, screenshot, click, type, evaluate JS, export PDF. |
| `file_manager` | Sandboxed file operations. Path traversal protection. Blocks dangerous extensions. |
| `shell_exec` | Execute shell commands with timeout and output capture. |
| `code_run` | Run JavaScript in an isolated `node:vm` sandbox. No fs/net/process access. |
| `cron_scheduler` | Schedule recurring tasks with cron expressions. Pause/resume/cancel. |
| `knowledge_base` | Document store with TF-IDF search. Full CRUD operations. |
| `sessions_list` | List active agent sessions and metadata. |
| `sessions_history` | Fetch transcript logs for any session. |
| `sessions_send` | Send messages between agent sessions (Agent-to-Agent). |
| `discord_actions` | Native Discord actions (roles, pins, reactions) from within the agent. |

### Dashboard (16 pages)

| Page | What you can do |
|------|----------------|
| **Overview** | System health, uptime, security module status (clickable), active agent info (model, thinking, temperature, tools), security alerts, OpenTelemetry stats |
| **Chat** | Interactive chat with session history, execution step viewer (tool calls + results), persistent across restarts |
| **Tools** | Built-in tools explorer + MCP Servers management (add, connect, list tools/resources) |
| **Usage** | Token costs per model/provider, usage history chart, cost breakdown |
| **Plugins** | Plugin store with categories, enable/disable, template generator (Plugin SDK) |
| **Channels** | Channel status, configure tokens, DM Pairing panel (generate FORGE-XXXX codes) |
| **Agents** | Multi-agent management, create/configure/delete agents |
| **Workspace** | Edit prompt files (AGENTS.md, SOUL.md, IDENTITY.md, USER.md, AUTOPILOT.md) |
| **Gmail** | Inbox viewer, compose emails, search, mark read/unread |
| **Calendar** | Google Calendar events, create/edit/delete, quick add, free/busy check |
| **Memory** | Cross-session memory viewer, semantic search, consolidate duplicates |
| **API Keys** | Create keys with 12 granular scopes, expiration, revoke/delete |
| **Webhooks** | Outbound + inbound webhooks, event log with status/duration |
| **Audit Log** | Security event viewer with risk level filtering |
| **Settings** | Provider API key management (validated + encrypted), system config |

### Integrations

| Integration | Features |
|-------------|----------|
| **GitHub** | Issues, PRs, code search, repository info |
| **Gmail** | Read, send, reply, search, labels, threads, unread count |
| **Google Calendar** | List/create/update/delete events, quick add, free/busy, multiple calendars |
| **Notion** | Search, pages (read/create/append), databases (get/query) |
| **RSS/Atom** | Subscribe to feeds, fetch items, auto-update |

### Advanced Features

- **Agentic Loop** — The agent iterates up to 25 times per request, calling tools and processing results autonomously.
- **Cross-Session Memory** — TF-IDF-based memory that persists across sessions and auto-injects relevant context.
- **RAG Engine** — Ingest documents, chunk them, generate embeddings, and search semantically.
- **AutoPlanner** — Break complex goals into dependency graphs and execute steps in parallel.
- **Workflow Engine** — Multi-step automation with conditions, delays, transforms, and parallel branches.
- **MCP Client** — Connect to external Model Context Protocol servers (HTTP, SSE, stdio transports).
- **Autopilot** — Define scheduled tasks in `AUTOPILOT.md` with tags like `@startup`, `@hourly`, `@morning`.
- **Backup & Restore** — Export/import encrypted vault data via API.
- **GDPR Compliance** — Export all user data or delete everything (right to be forgotten).
- **OpenTelemetry** — Traces, metrics, and OTLP/HTTP export for observability.
- **DM Pairing** — Onboard users with invite codes (`FORGE-XXXX-XXXX`) from any messaging channel.
- **Thinking Levels** — Control agent reasoning depth: off, low, medium, high.
- **IP Allowlist/Blocklist** — Restrict Gateway access by IP address.
- **OAuth2/SSO** — Google, GitHub, and Microsoft authentication providers.

---

## Installation

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 22 | Required |
| **pnpm** | ≥ 9 | Package manager |
| **MySQL** | 8.x | Database (or MariaDB 10.6+) |
| **Docker** | Optional | For code sandbox and containerized deployment |

### Quick Start (all platforms)

```bash
# Clone the repository
git clone https://github.com/user/forgeai.git
cd forgeai

# Install dependencies
pnpm install

# Run the interactive setup wizard
pnpm forge onboard
```

The onboard wizard will guide you through:
1. **Security** — auto-generates `JWT_SECRET` and `VAULT_MASTER_PASSWORD`
2. **LLM Provider** — configure your API key (Anthropic, OpenAI, Google, etc.)
3. **Channels** — optionally set up Telegram, Discord, WhatsApp, Slack, or Teams
4. **Personality** — name your agent, set language and persona
5. **Database** — verify MySQL connection

### Linux (Ubuntu/Debian)

```bash
# 1. Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# 3. Install MySQL 8
sudo apt-get install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql

# 4. Create database
sudo mysql -e "CREATE DATABASE forgeai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 5. (Optional) Install Docker for code sandbox
sudo apt-get install -y docker.io
sudo systemctl start docker
sudo usermod -aG docker $USER

# 6. (Optional) Install Chromium for Puppeteer browser tool
sudo apt-get install -y chromium-browser
export PUPPETEER_EXECUTABLE_PATH=$(which chromium-browser)

# 7. Clone and install
git clone https://github.com/user/forgeai.git
cd forgeai
pnpm install

# 8. Configure
cp .env.example .env
nano .env  # Set MYSQL_PASSWORD and other settings

# 9. Build and start
pnpm -r build
pnpm forge onboard    # Interactive setup
pnpm forge start      # Start the Gateway

# Gateway runs at http://127.0.0.1:18800
# Dashboard at http://127.0.0.1:18800 (served by Gateway)
```

### macOS

```bash
# 1. Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install Node.js 22
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# 3. Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# 4. Install MySQL 8
brew install mysql
brew services start mysql

# 5. Create database
mysql -u root -e "CREATE DATABASE forgeai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 6. (Optional) Install Docker Desktop for code sandbox
brew install --cask docker

# 7. Clone and install
git clone https://github.com/user/forgeai.git
cd forgeai
pnpm install

# 8. Configure
cp .env.example .env
nano .env  # Set your preferences

# 9. Build and start
pnpm -r build
pnpm forge onboard
pnpm forge start
```

### Windows

```powershell
# 1. Install Node.js 22 from https://nodejs.org
# 2. Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# 3. Install MySQL 8 (via installer or XAMPP)
# Create database:
mysql -u root -p -e "CREATE DATABASE forgeai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. Clone and install
git clone https://github.com/user/forgeai.git
cd forgeai
pnpm install

# 5. Configure
copy .env.example .env
# Edit .env with your settings

# 6. Build and start
pnpm -r build
pnpm forge onboard
pnpm forge start
```

### Docker (one command)

```bash
# Clone the repo
git clone https://github.com/user/forgeai.git
cd forgeai

# Configure
cp .env.example .env
# Edit .env with your API keys and secrets

# Start everything (Gateway + MySQL)
docker compose up -d

# Gateway: http://localhost:18800
```

The Docker setup includes:
- **MySQL 8** with persistent volume and health checks
- **ForgeAI Gateway** with Chromium pre-installed for Puppeteer
- Multi-stage build for minimal image size
- Automatic health monitoring

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     MESSAGING CHANNELS                        │
│  WhatsApp · Telegram · Discord · Slack · Teams · Google Chat  │
│                      · WebChat ·                              │
└─────────────────────────┬────────────────────────────────────┘
                          │
                 ┌────────▼────────┐
                 │  Security Layer  │  Prompt Guard · Input Sanitizer
                 │  7 modules       │  Rate Limiter · JWT · 2FA · RBAC
                 └────────┬────────┘
                          │
              ┌───────────▼───────────┐
              │    GATEWAY (Fastify)   │  140+ REST endpoints
              │    Sessions · Plugins  │  WebSocket support
              │    Workflows · Cron    │  Serves Dashboard
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
  ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐
  │   Agent    │    │   Tools   │    │ Integrations│
  │  Runtime   │    │ Registry  │    │            │
  │ Multi-LLM  │    │ 11 tools  │    │ GitHub     │
  │ Failover   │    │ + MCP     │    │ Gmail      │
  │ Agentic    │    │ + Sandbox │    │ Calendar   │
  │ Loop (25x) │    │           │    │ Notion     │
  └─────┬──────┘    └─────┬─────┘    │ RSS        │
        │                 │          └────────────┘
        └────────┬────────┘
                 │
      ┌──────────▼──────────┐
      │    Persistence       │  MySQL (10 tables, Knex.js)
      │    Credential Vault  │  AES-256-GCM encrypted
      │    Audit Log         │  Immutable, queryable
      │    Memory Store      │  TF-IDF cross-session
      │    RAG Engine        │  Chunked embeddings
      └─────────────────────┘
```

---

## Security Model

Every request passes through 7 security modules before reaching the agent:

| Layer | Module | Description |
|-------|--------|-------------|
| **Encryption** | Credential Vault | AES-256-GCM + PBKDF2. All API keys and tokens encrypted at rest in `.forgeai/vault.json`. |
| **Access** | RBAC | Role-based permissions (admin/user/guest) per resource and per tool. |
| **Access** | JWT Auth | Token-based authentication with refresh rotation and revocation. |
| **Access** | 2FA (TOTP) | Time-based one-time passwords for sensitive operations. |
| **Input** | Prompt Injection Guard | 6 detection patterns against injection, hijacking, and encoding attacks. |
| **Input** | Input Sanitizer | Blocks XSS, SQLi, and command injection before processing. |
| **Throttle** | Rate Limiter | 12 configurable rules with sliding window and burst support. |
| **Audit** | Audit Log | Immutable trail with 4 risk levels. Every action logged. |

---

## Project Structure

```
forgeai/
├── packages/
│   ├── shared/          # Types, utils, constants
│   ├── security/        # Vault, RBAC, Rate Limiter, Audit, Prompt Guard, JWT, 2FA, Sanitizer
│   ├── core/            # Gateway (Fastify), Session Manager, DB (Knex+MySQL), Telemetry, Autopilot
│   ├── agent/           # Agent Runtime, Multi-LLM Router (8 providers), Agentic Loop
│   ├── channels/        # WhatsApp, Telegram, Discord, Slack, Teams, Google Chat, WebChat
│   ├── tools/           # Tool Registry, 11 built-in tools, GitHub/Gmail/Calendar/Notion integrations
│   ├── plugins/         # Plugin Manager, AutoResponder, ContentFilter, ChatCommands
│   ├── workflows/       # Workflow Engine, step runner, dependency graph
│   ├── cli/             # CLI: start, doctor, status, onboard
│   └── dashboard/       # React 19 + Vite 6 + TailwindCSS 4 + Lucide Icons (16 pages)
├── .env.example         # Environment template
├── .forgeai/            # Runtime data (vault, sessions, autopilot — auto-created)
├── docker-compose.yml   # One-command Docker deployment
├── Dockerfile           # Multi-stage production build
├── ROADMAP.md           # Development roadmap
└── package.json         # Monorepo root (pnpm workspaces)
```

---

## Configuration

### Environment Variables (`.env`)

```bash
# Database
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=forgeai

# Gateway
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=18800
GATEWAY_SECRET=your-random-secret

# Security
VAULT_MASTER_PASSWORD=your-strong-password
JWT_SECRET=your-jwt-secret
```

**LLM API keys and channel tokens are managed via the Dashboard**, not `.env`. They are stored encrypted in the Vault.

### Workspace Files (`.forgeai/`)

| File | Purpose |
|------|---------|
| `AGENTS.md` | Define agent capabilities and behavior guidelines |
| `SOUL.md` | Agent personality and communication style |
| `IDENTITY.md` | Agent name, language, and identity |
| `USER.md` | Information about you (context for the agent) |
| `AUTOPILOT.md` | Scheduled tasks with `@startup`, `@hourly`, `@morning`, `@evening` tags |

All editable from the Dashboard → Workspace page.

---

## CLI Reference

```bash
# Interactive setup (first time)
pnpm forge onboard

# Start the Gateway (Dashboard included)
pnpm forge start

# Check system health
pnpm forge doctor

# Quick status check
pnpm forge status
```

### Chat Commands (from any channel)

| Command | Description |
|---------|-------------|
| `/status` | Current session info (model, tokens, cost) |
| `/new` | Start a new session |
| `/compact` | Compress session context |
| `/think <level>` | Set thinking depth: off, low, medium, high |
| `/usage <mode>` | Toggle usage footer: off, tokens, full |
| `/activation <mode>` | Group activation: mention or always |
| `/pair` | Redeem an invite code (DM pairing) |
| `/autopilot` | View autopilot task status |
| `/help` | List all commands |

---

## API Overview

ForgeAI exposes **140+ REST API endpoints** organized by domain:

| Domain | Endpoints | Examples |
|--------|-----------|---------|
| **Chat** | 8 | Send messages, stream responses, session history, persistent sessions |
| **Agent** | 6 | Config, thinking level, stats, multi-agent management |
| **Tools** | 5 | List, definitions, execute, tool registry |
| **Security** | 12 | Rate limits, IP filter, audit log, security summary |
| **Plugins** | 8 | Store, activate, disable, template generator |
| **Workflows** | 5 | Create, execute, list runs, status |
| **Providers** | 4 | List, add/remove API keys (via Vault), status |
| **Channels** | 6 | Status, configure tokens, DM pairing |
| **MCP** | 7 | Servers, connect, tools, resources, call |
| **Memory** | 5 | Store, search, delete, consolidate, stats |
| **RAG** | 6 | Ingest, search, context, documents, stats |
| **Integrations** | 30+ | GitHub, Gmail, Calendar, Notion, RSS |
| **System** | 15+ | Health, backup, GDPR, keys, OAuth, webhooks, telemetry |

Full endpoint list available at `GET /info` when the Gateway is running.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Language** | TypeScript (strict mode) |
| **Runtime** | Node.js ≥ 22 |
| **Gateway** | Fastify 5 + WebSocket |
| **Database** | MySQL 8 via Knex.js (10 tables) |
| **Encryption** | AES-256-GCM, PBKDF2, bcrypt, HMAC-SHA256 |
| **Auth** | JWT (access + refresh) + TOTP (2FA) |
| **Dashboard** | React 19, Vite 6, TailwindCSS, Lucide Icons, Recharts |
| **Channels** | grammY, discord.js, Baileys, Bolt SDK, Bot Framework |
| **Browser** | Puppeteer (headless Chromium) |
| **Build** | tsup, pnpm workspaces, Vitest (38 E2E tests) |
| **Deploy** | Docker multi-stage, docker-compose, GitHub Actions CI/CD |
| **Observability** | OpenTelemetry (OTLP/HTTP), structured logging |

---

## Roadmap

### Completed (22 phases)

- **Core Platform** — Gateway, sessions, database, migrations
- **Security** — 7 modules (Vault, RBAC, Rate Limiter, Prompt Guard, Sanitizer, 2FA, Audit)
- **Agent** — Multi-LLM router, agentic loop (25 iterations), thinking levels, cross-session memory
- **Channels** — WhatsApp, Telegram, Discord, Slack, Microsoft Teams, Google Chat, WebChat
- **Tools** — 11 built-in tools, Tool Registry, Puppeteer browser, shell execution
- **Plugins** — Plugin SDK, template generator, store, 3 built-in plugins
- **Workflows** — Multi-step engine with conditions, delays, transforms, parallel execution
- **Dashboard** — 16 pages (Overview, Chat, Tools, Usage, Plugins, Channels, Agents, Workspace, Gmail, Calendar, Memory, API Keys, Webhooks, Audit Log, Settings)
- **Integrations** — GitHub, Gmail, Google Calendar, Notion, RSS/Atom
- **Advanced** — RAG Engine, AutoPlanner, MCP Client, Autopilot, DM Pairing, Model Failover, Circuit Breaker, OpenTelemetry
- **Infrastructure** — Docker, CI/CD, E2E tests, Tailscale remote access, backup/restore, GDPR, OAuth2/SSO, IP filtering

### Planned

| Feature | Description | Priority |
|---------|-------------|----------|
| Log Aggregation | Structured logging for ELK/Loki/CloudWatch | Medium |
| Auto DB Migrations | Knex migrate:latest on startup | Low |
| Electron App | Desktop wrapper for the Dashboard | Medium |
| Mobile App | React Native / Expo (iOS + Android) | Medium |
| Voice Wake | Always-on wake word detection | Low |
| Signal Channel | Signal messenger support | Low |
| IoT Node Protocol | Lightweight device nodes connecting to the Gateway via WebSocket | Medium |

See [ROADMAP.md](./ROADMAP.md) for the full development history with details on each phase.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests (38 E2E tests)
pnpm test

# Development mode (auto-reload)
pnpm dev
```

---

## License

[MIT](./LICENSE)
