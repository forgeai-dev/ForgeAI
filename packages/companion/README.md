# ForgeAI Desktop Companion

Lightweight native Windows desktop assistant (~15MB) built with **Tauri 2 + Rust + React**.

Runs in the system tray, connects to your ForgeAI Gateway (local or remote VPS), and executes local machine actions with mandatory safety guardrails.

## Architecture

```
[Windows PC]                         [VPS / Local]
┌──────────────────────┐            ┌──────────────────┐
│ ForgeAI Companion    │◄── WSS ──►│ ForgeAI Gateway   │
│ (Tauri ~15MB, ~30MB) │  (secure)  │ (Node.js)         │
│                      │            │                   │
│ ▸ System Tray        │            │ ▸ LLM Router      │
│ ▸ Wake Word Engine   │            │ ▸ 15+ Tools       │
│ ▸ Voice I/O          │            │ ▸ Vault (AES-256) │
│ ▸ Safety System      │            │ ▸ 9 Security Mod  │
│ ▸ Local Actions      │            │                   │
└──────────────────────┘            └──────────────────┘
```

## Prerequisites

- **Windows 10/11** (64-bit)
- **Rust** — [Install via rustup](https://rustup.rs/) (stable toolchain)
- **Node.js 22+** and **pnpm 10+**
- **WebView2 Runtime** (included in Windows 11, auto-installed on Windows 10)

## Setup

```bash
# From the monorepo root
pnpm install

# Navigate to companion
cd packages/companion

# Install Rust dependencies (first time only, takes a few minutes)
cargo fetch --manifest-path src-tauri/Cargo.toml
```

## Development

```bash
# Hot-reload dev mode (Vite frontend + Rust backend)
pnpm dev
```

This opens the companion window with hot-reload. The Rust backend recompiles on save.

## Build

```bash
# Production build → MSI + NSIS installers
pnpm build
```

Output:
- `src-tauri/target/release/bundle/msi/ForgeAI Companion_1.0.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/ForgeAI Companion_1.0.0_x64-setup.exe`

## Icons

Generate all required icon sizes from the source SVG:

```bash
pnpm icons
```

This uses `tauri icon` to generate `.ico`, `.png` (32×32, 128×128, 256×256) from `src-tauri/icons/forge-icon.svg`.

## Modules

### Safety System (`safety.rs`)
Anti-disaster guardrails that **cannot be bypassed**:
- ❌ Delete/modify system directories (Windows, Program Files, etc.)
- ❌ Format, wipe, or partition disks
- ❌ Modify Windows Registry boot/security keys
- ❌ Disable Defender, firewall, UAC
- ❌ Kill system processes (csrss, lsass, svchost, etc.)
- ✅ All destructive actions require explicit user confirmation
- ✅ Read-only operations always allowed

### Wake Word (`wake_word.rs`)
- Picovoice Porcupine on-device detection
- Default: "Hey Forge" (customizable with `.ppn` files)
- <1% CPU when listening
- Requires [Picovoice Access Key](https://console.picovoice.ai/)

### Voice I/O (`voice.rs`)
- Microphone capture via `cpal` (16kHz mono)
- Silence detection (auto-stop recording)
- STT via Gateway `/api/voice/transcribe`
- TTS via Gateway `/api/voice/synthesize` → `rodio` playback

### Local Actions (`local_actions.rs`)
- File operations: read, write, delete, list, create, move, copy
- Shell command execution (with safety checks)
- Application launching, URL opening
- Process listing and management
- System info and disk usage

### Connection (`connection.rs`)
- WebSocket (WSS) to ForgeAI Gateway
- Pairing via 6-digit code from Dashboard
- JWT authentication
- Credentials stored in Windows Credential Manager

## CI/CD

The `companion-build.yml` workflow automatically:
1. Builds the Tauri app on `windows-latest`
2. Produces MSI and NSIS installers
3. Creates a GitHub Release with artifacts on push to `main`

Trigger manually via `workflow_dispatch` or automatically on changes to `packages/companion/`.

## Project Structure

```
packages/companion/
├── src/                        # React frontend
│   ├── App.tsx                 # Main UI (chat, setup, settings)
│   ├── main.tsx                # Entry point
│   ├── styles.css              # Tailwind + custom animations
│   └── components/
│       └── Avatar.tsx          # Animated avatar (4 states)
├── src-tauri/                  # Rust backend
│   ├── Cargo.toml              # Rust dependencies
│   ├── tauri.conf.json         # Tauri configuration
│   ├── capabilities/
│   │   └── default.json        # App permissions
│   ├── icons/
│   │   └── forge-icon.svg      # Source icon
│   └── src/
│       ├── main.rs             # Entry point + system tray
│       ├── safety.rs           # Anti-disaster guardrails
│       ├── connection.rs       # WebSocket + auth
│       ├── local_actions.rs    # File/shell/app actions
│       ├── commands.rs         # Tauri IPC bridge
│       ├── wake_word.rs        # Porcupine wake word
│       └── voice.rs            # Mic capture + TTS playback
├── package.json
├── vite.config.ts
├── tsconfig.json
└── README.md
```

## Picovoice Setup

1. Get a free access key at [console.picovoice.ai](https://console.picovoice.ai/)
2. Optionally train a custom "Hey Forge" keyword at [Picovoice Console](https://console.picovoice.ai/ppn)
3. Configure in the Companion settings or via the Dashboard

## Connecting to a Remote VPS

If your ForgeAI Gateway runs on a VPS:

1. **Option A — Direct WSS**: Expose port 18800 via Nginx/Caddy with TLS
2. **Option B — Tailscale** (recommended): Install Tailscale on both machines for zero-config VPN
3. **Option C — Cloudflare Tunnel**: Use `cloudflared` for zero-trust access

The Companion connects via WebSocket using the same protocol as Telegram/WhatsApp channels.
