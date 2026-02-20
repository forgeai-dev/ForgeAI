## Description

Add ESP32 MicroPython agent for the Node Protocol — the same WebSocket protocol as the Go agent but running on ESP32 microcontrollers via MicroPython. Includes WiFi auto-connect, GPIO control, sensor reading (DHT11/22), ADC, PWM, remote command execution, and 15+ built-in commands.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor (no functional changes)
- [x] Documentation
- [ ] Tests
- [ ] Security

## Changes Made

- **New package `packages/node-agent-esp32/`** with 3 MicroPython files:
  - `config.py` — WiFi, Gateway, token, intervals, GPIO pin config
  - `boot.py` — WiFi auto-connect on startup with timeout
  - `main.py` — Full agent: WebSocket client, auth, heartbeat, sysinfo, 15+ commands
- **15 built-in commands**: reboot, mem, freq, gpio_read, gpio_write, led, pwm, adc_read, temp, dht, scan_wifi, ls, cat, exec, help
- **Auto-detect capabilities**: gpio (always), sensor (DHT lib), camera (ESP32-CAM), bluetooth, neopixel
- **System info**: memory (free/alloc), filesystem, CPU freq, internal temp, uptime, IP
- **README.md** for ESP32 agent: supported boards, flashing instructions, Thonny/mpremote upload, wiring examples (DHT22, relay), troubleshooting
- **Main README.md** updated: ESP32 added to supported devices table (3 entries), monorepo now 13 packages

## How to Test

1. `pnpm -r build` — existing TS packages still build fine
2. Flash MicroPython on ESP32, upload the 3 .py files
3. Monitor serial output — should see WiFi connect + Gateway auth
4. Send commands via Dashboard: `POST /api/nodes/:id/command` with `{"cmd": "mem"}`

## Related Issue

N/A

## Screenshots

N/A

## Checklist

- [x] Code builds without errors (`pnpm -r build`)
- [x] Tests pass (`pnpm test`)
- [x] Commit messages follow Conventional Commits
- [x] No secrets or API keys committed
- [x] Documentation updated (if needed)

---

### Files Changed (5 files)

| File | Change |
|:-----|:-------|
| `packages/node-agent-esp32/config.py` | **NEW** — WiFi/Gateway/Node configuration |
| `packages/node-agent-esp32/boot.py` | **NEW** — WiFi auto-connect on boot |
| `packages/node-agent-esp32/main.py` | **NEW** — Full MicroPython agent (~400 lines) |
| `packages/node-agent-esp32/README.md` | **NEW** — Setup guide, commands, wiring examples |
| `README.md` | ESP32 in devices table, 13-package monorepo |
