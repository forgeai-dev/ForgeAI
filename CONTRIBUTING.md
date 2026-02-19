# Contributing to ForgeAI

Thank you for your interest in contributing to ForgeAI! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Code Style](#code-style)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Feature Requests](#feature-requests)

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ForgeAI.git
   cd ForgeAI
   ```
3. **Add upstream** remote:
   ```bash
   git remote add upstream https://github.com/forgeai-dev/ForgeAI.git
   ```

## Development Setup

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 9.0.0
- **MySQL** 8.0+

### Install & Run

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env with your MySQL credentials

# Run database migrations
pnpm db:migrate

# Build all packages
pnpm build

# Start in development mode
pnpm dev
```

### Running Tests

```bash
# Run all E2E tests
pnpm test

# Run with coverage
pnpm test -- --coverage

# Type checking
pnpm lint
```

## Project Structure

```
packages/
├── shared/      # Types, utils, constants (no dependencies)
├── security/    # Vault, RBAC, Rate Limiter, Audit, JWT, 2FA
├── core/        # Gateway (Fastify), Session Manager, DB, Telemetry
├── agent/       # AgentRuntime, LLMRouter, providers
├── channels/    # Telegram, Discord, WhatsApp, Slack, Teams, Google Chat, WebChat
├── tools/       # Tool Registry + 11 tools + integrations
├── plugins/     # Plugin Manager + SDK
├── workflows/   # Workflow Engine
├── cli/         # CLI commands
└── dashboard/   # React 19 + Vite + TailwindCSS
```

### Package dependency order

```
shared → security → core → agent → channels/tools/plugins/workflows → cli → dashboard
```

Changes to `shared` affect everything. Changes to `dashboard` affect nothing else.

## Making Changes

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```
2. **Make your changes** — keep commits focused and atomic
3. **Test your changes**:
   ```bash
   pnpm build
   pnpm test
   pnpm lint
   ```
4. **Push** to your fork:
   ```bash
   git push origin feature/my-feature
   ```

## Code Style

- **TypeScript** strict mode — no `any` unless absolutely necessary
- **Imports** — use `.js` extension for local imports (ESM)
- **Naming** — `camelCase` for variables/functions, `PascalCase` for classes/types, `UPPER_SNAKE_CASE` for constants
- **Files** — `kebab-case.ts` for filenames
- **Comments** — JSDoc for public APIs, inline comments for complex logic only
- **Error handling** — always catch and log, never swallow errors silently

### Dashboard

- **React 19** with functional components and hooks
- **TailwindCSS** for styling — no inline styles, no CSS modules
- **Lucide React** for icons
- **API calls** through `src/lib/api.ts`

## Pull Request Process

1. **Update tests** if you changed behavior
2. **Ensure CI passes** (build + test + lint)
3. **Write a clear PR description** explaining:
   - What changed and why
   - How to test it
   - Screenshots for UI changes
4. **Link related issues** using `Closes #123`
5. PRs require **1 approval** before merge

### Commit Messages

Use clear, descriptive commit messages:

```
feat: add Signal channel support
fix: resolve WhatsApp reconnection loop
docs: update API endpoint documentation
refactor: extract common channel logic to base class
test: add E2E tests for Calendar integration
```

## Reporting Bugs

Use the [Bug Report](https://github.com/forgeai-dev/ForgeAI/issues/new?template=bug_report.md) template. Include:

- Steps to reproduce
- Expected vs actual behavior
- OS, Node.js version, browser
- Error logs (if any)

## Feature Requests

Use the [Feature Request](https://github.com/forgeai-dev/ForgeAI/issues/new?template=feature_request.md) template. Include:

- Clear description of the feature
- Why it would be useful
- Possible implementation approach (optional)

---

## Need Help?

- Check existing [Issues](https://github.com/forgeai-dev/ForgeAI/issues) and [Discussions](https://github.com/forgeai-dev/ForgeAI/discussions)
- Look for issues labeled [`good first issue`](https://github.com/forgeai-dev/ForgeAI/labels/good%20first%20issue)
- Open a Discussion for questions

Thank you for contributing! 🔥
