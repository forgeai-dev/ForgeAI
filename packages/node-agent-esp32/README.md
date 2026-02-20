# ForgeAI Node Agent — ESP32 (MicroPython)

Lightweight MicroPython agent for ESP32 microcontrollers. Connects to the ForgeAI Gateway via WebSocket using the same Node Protocol as the Go agent.

## Supported Boards

| Board | Status | Notes |
|:------|:-------|:------|
| **ESP32 DevKit V1** | ✅ Full support | Most common board |
| **ESP32-WROOM-32** | ✅ Full support | Standard module |
| **ESP32-S3** | ✅ Full support | Dual-core, USB-C |
| **ESP32-C3** | ✅ Full support | RISC-V, low power |
| **ESP32-CAM** | ✅ Camera support | OV2640 camera module |
| **ESP32-S2** | ✅ Full support | Single-core, USB |
| **ESP8266** | ⚠️ Limited | Less RAM, may need trimming |

## Requirements

- ESP32 board with WiFi
- [MicroPython firmware](https://micropython.org/download/esp32/) flashed on the board
- USB cable for initial setup
- [Thonny IDE](https://thonny.org/) or `mpremote` for uploading files

## Quick Start

### 1. Flash MicroPython firmware

```bash
# Install esptool
pip install esptool

# Erase flash
esptool.py --chip esp32 --port COM3 erase_flash

# Flash MicroPython (download from micropython.org)
esptool.py --chip esp32 --port COM3 write_flash -z 0x1000 esp32-20240105-v1.22.1.bin
```

> Replace `COM3` with your port (`/dev/ttyUSB0` on Linux, `/dev/cu.usbserial-*` on macOS).

### 2. Configure

Edit `config.py` with your settings:

```python
WIFI_SSID = "MyWiFi"
WIFI_PASSWORD = "MyPassword"
GATEWAY_HOST = "192.168.1.100"   # Your ForgeAI Gateway IP
GATEWAY_PORT = 18800
NODE_TOKEN = "fnode_abc123..."   # From Dashboard → Settings → Node Protocol
NODE_NAME = "ESP32-Living-Room"
```

### 3. Upload to ESP32

**Using Thonny IDE:**
1. Open Thonny → Tools → Options → Interpreter → MicroPython (ESP32)
2. Open each file and save to device: `config.py`, `boot.py`, `main.py`

**Using mpremote:**
```bash
pip install mpremote

mpremote connect COM3 cp config.py :config.py
mpremote connect COM3 cp boot.py :boot.py
mpremote connect COM3 cp main.py :main.py
mpremote connect COM3 reset
```

### 4. Monitor

```bash
# Using mpremote
mpremote connect COM3 repl

# Using Thonny
# Just open Thonny with the board connected — REPL shows at the bottom
```

You should see:
```
[WiFi] Connecting to MyWiFi ...
[WiFi] Connected! IP: 192.168.1.42
============================================
  ForgeAI Node Agent v0.1.0 (ESP32)
============================================
  ID:       esp32-a1b2c3
  Name:     ESP32-Living-Room
  Platform: esp32-micropython
  Caps:     shell,system,gpio
  Gateway:  192.168.1.100:18800
============================================
[ForgeAI] Connecting to 192.168.1.100:18800 ...
[ForgeAI] WebSocket connected!
[ForgeAI] Auth sent, waiting for response...
[ForgeAI] Authenticated! Session: abc123
```

## Available Commands

Commands are executed remotely via the Gateway AI or Dashboard:

| Command | Args | Description |
|:--------|:-----|:------------|
| `help` | — | List all available commands |
| `reboot` | — | Restart the ESP32 |
| `mem` | — | Show free/allocated memory |
| `freq` | `[mhz]` | Get or set CPU frequency |
| `gpio_read` | `<pin>` | Read digital GPIO pin value |
| `gpio_write` | `<pin> <0\|1>` | Write digital GPIO pin |
| `led` | `<0\|1>` | Toggle built-in LED |
| `pwm` | `<pin> <duty>` | Set PWM output (duty 0-1023) |
| `adc_read` | `<pin>` | Read analog value (0-4095) |
| `temp` | — | Read internal temperature sensor |
| `dht` | `<pin> [11\|22]` | Read DHT11/DHT22 temperature & humidity |
| `scan_wifi` | — | Scan nearby WiFi networks |
| `ls` | `[path]` | List files on filesystem |
| `cat` | `<file>` | Read file contents |
| `exec` | `<code>` | Execute arbitrary MicroPython code |

## Features

- **Auto-reconnect** with exponential backoff (2s → 60s max)
- **WiFi auto-reconnect** if connection drops
- **Heartbeat** every 25s to detect disconnections
- **System info** reporting: memory, disk, CPU freq, temperature, uptime
- **GPIO control** — read/write digital pins, PWM, ADC
- **Sensor support** — DHT11/DHT22 temperature & humidity
- **Remote code execution** — run any MicroPython code remotely
- **Same protocol** as Go agent — fully compatible with Gateway
- **Auto-detect capabilities** — GPIO, camera, Bluetooth, NeoPixel, DHT sensors
- **Node-to-Node relay** — communicate with other nodes via Gateway AI
- **Minimal footprint** — ~15KB of Python code, runs on 520KB SRAM

## File Structure

```
packages/node-agent-esp32/
├── config.py   → WiFi, Gateway, and node settings (EDIT THIS)
├── boot.py     → WiFi connection on startup
├── main.py     → Agent: WebSocket, auth, heartbeat, commands
└── README.md   → This file
```

## Wiring Examples

### DHT22 Temperature Sensor
```
ESP32 GPIO4 ──── DHT22 DATA
ESP32 3.3V  ──── DHT22 VCC
ESP32 GND   ──── DHT22 GND
(10K pull-up resistor between DATA and VCC)
```

Then read via AI: *"Read the temperature from the DHT sensor on pin 4"*
→ Gateway sends: `{"type": "command", "cmd": "dht", "args": ["4", "22"]}`

### Relay Module (for lights, fans, etc.)
```
ESP32 GPIO5 ──── Relay IN
ESP32 3.3V  ──── Relay VCC
ESP32 GND   ──── Relay GND
```

Then control via AI: *"Turn on the relay on pin 5"*
→ Gateway sends: `{"type": "command", "cmd": "gpio_write", "args": ["5", "1"]}`

## Troubleshooting

| Issue | Solution |
|:------|:---------|
| WiFi won't connect | Check SSID/password in `config.py`, verify ESP32 is in range |
| WebSocket fails | Verify Gateway IP is reachable from ESP32's network |
| Auth fails | Check `NODE_TOKEN` matches the key in Dashboard → Settings |
| Out of memory | Reduce `SYSINFO_INTERVAL`, disable unused features |
| Import errors | Some modules (camera, dht) need to be installed separately |
