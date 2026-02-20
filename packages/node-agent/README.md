# ForgeAI Node Agent

Lightweight binary agent (~5MB) for embedded devices. Connects to the ForgeAI Gateway via WebSocket.

## Supported Platforms

| Platform | Binary | Target Devices |
|----------|--------|----------------|
| Linux AMD64 | `forgeai-node-linux-amd64` | Servers, x86 PCs |
| Linux ARM64 | `forgeai-node-linux-arm64` | Raspberry Pi 4/5, modern ARM |
| Linux ARMv7 | `forgeai-node-linux-armv7` | Raspberry Pi 2/3, older ARM |
| Windows | `forgeai-node-windows-amd64.exe` | Windows PCs |
| macOS Intel | `forgeai-node-darwin-amd64` | Intel Macs |
| macOS ARM | `forgeai-node-darwin-arm64` | Apple Silicon Macs |

## Quick Start

```bash
# On the device:
./forgeai-node --gateway http://YOUR_GATEWAY:18800 --token YOUR_API_KEY --name "My-RaspberryPi"

# Or with environment variables:
export FORGEAI_GATEWAY=http://192.168.1.100:18800
export FORGEAI_NODE_TOKEN=your-secret-key
export FORGEAI_NODE_NAME=RaspberryPi-Office
./forgeai-node
```

## CLI Options

| Flag | Env Var | Description |
|------|---------|-------------|
| `--gateway` | `FORGEAI_GATEWAY` | Gateway URL (required) |
| `--token` | `FORGEAI_NODE_TOKEN` | API key for auth (required) |
| `--id` | `FORGEAI_NODE_ID` | Unique node ID (auto if empty) |
| `--name` | `FORGEAI_NODE_NAME` | Display name (hostname if empty) |
| `--tags` | — | Comma-separated tags |

## Features

- **Auto-reconnect** with exponential backoff
- **Heartbeat** every 25s to detect disconnections
- **System info** reporting (CPU, RAM, disk, temp, uptime)
- **Remote command execution** from Gateway/AI
- **Node-to-Node relay** communication via Gateway
- **Auto-detect capabilities** (GPIO, camera, docker, network)
- **Cross-platform** — single binary, no dependencies

## Building from Source

Requires Go 1.21+.

```bash
cd packages/node-agent

# Build for current platform
make build

# Build for all platforms
make all

# Build for specific platform
make linux-arm64
```

Binaries are output to `dist/`.

## Protocol

The node communicates via JSON over WebSocket at `ws://gateway:port/ws/node`.

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | Node → GW | Authenticate with token + node info |
| `auth_ok` | GW → Node | Authentication success |
| `ping/pong` | Both | Heartbeat keepalive |
| `message` | Node → GW | Send text to AI |
| `response` | GW → Node | AI response |
| `command` | GW → Node | Execute command on device |
| `command_result` | Node → GW | Command output |
| `event` | Node → GW | Sensor data, alerts |
| `sysinfo` | Node → GW | System metrics |
| `relay` | Node ↔ Node | Message relay via Gateway |
| `node_list` | GW → Node | Connected nodes broadcast |

## Running as systemd Service

```bash
sudo tee /etc/systemd/system/forgeai-node.service << EOF
[Unit]
Description=ForgeAI Node Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/forgeai-node
Environment=FORGEAI_GATEWAY=http://YOUR_GATEWAY:18800
Environment=FORGEAI_NODE_TOKEN=your-secret-key
Environment=FORGEAI_NODE_NAME=my-device
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now forgeai-node
```
