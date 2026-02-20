# ForgeAI Node Agent — ESP32 (MicroPython)
# Lightweight WebSocket agent for ESP32 microcontrollers

import ujson
import utime
import machine
import gc
import os
import sys
import network
import ubinascii
import uwebsocket
import usocket

import config

VERSION = "0.1.0"

# ─── WebSocket Helpers ────────────────────────────────────

def ws_connect(host, port, path, ssl=False):
    """Create a WebSocket connection manually (MicroPython compatible)."""
    addr = usocket.getaddrinfo(host, port)[0][-1]
    sock = usocket.socket()
    sock.settimeout(10)
    sock.connect(addr)

    if ssl:
        import ussl
        sock = ussl.wrap_socket(sock, server_hostname=host)

    # WebSocket handshake
    key = ubinascii.b2a_base64(os.urandom(16)).strip()
    handshake = (
        "GET %s HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    ) % (path, host, port, key.decode())

    sock.send(handshake.encode())

    # Read response headers
    header = b""
    while b"\r\n\r\n" not in header:
        chunk = sock.recv(1)
        if not chunk:
            raise OSError("WebSocket handshake failed: no response")
        header += chunk

    if b"101" not in header:
        sock.close()
        raise OSError("WebSocket handshake failed: %s" % header[:80].decode())

    # Wrap in uwebsocket
    ws = uwebsocket.websocket(sock)
    return ws, sock


def ws_send_json(ws, data):
    """Send a JSON message over WebSocket."""
    payload = ujson.dumps(data)
    ws.write(payload)


def ws_recv_json(ws, timeout_ms=100):
    """Try to receive a JSON message from WebSocket (non-blocking)."""
    try:
        data = ws.read()
        if data:
            return ujson.loads(data)
    except OSError:
        pass
    return None


# ─── System Info ──────────────────────────────────────────

def get_node_id():
    """Generate unique node ID from MAC address."""
    if config.NODE_ID:
        return config.NODE_ID
    wlan = network.WLAN(network.STA_IF)
    mac = ubinascii.hexlify(wlan.config("mac")).decode()
    return "esp32-" + mac[-6:]


def get_platform():
    """Get platform string."""
    plat = sys.platform  # 'esp32'
    impl = sys.implementation.name  # 'micropython'
    return "%s-%s" % (plat, impl)


def get_ip():
    """Get current IP address."""
    wlan = network.WLAN(network.STA_IF)
    if wlan.isconnected():
        return wlan.ifconfig()[0]
    return "0.0.0.0"


def collect_sysinfo():
    """Collect system information from ESP32."""
    gc.collect()
    free_mem = gc.mem_free()
    alloc_mem = gc.mem_alloc()
    total_mem = free_mem + alloc_mem

    # Filesystem info
    try:
        stat = os.statvfs("/")
        disk_total = stat[0] * stat[2] / (1024 * 1024)  # MB
        disk_free = stat[0] * stat[3] / (1024 * 1024)    # MB
    except:
        disk_total = 0
        disk_free = 0

    # CPU frequency
    freq_mhz = machine.freq() / 1_000_000

    info = {
        "hostname": config.NODE_NAME,
        "ipAddress": get_ip(),
        "memTotalMB": round(total_mem / (1024 * 1024), 2),
        "memUsedMB": round(alloc_mem / (1024 * 1024), 2),
        "diskTotalGB": round(disk_total / 1024, 3),
        "diskUsedGB": round((disk_total - disk_free) / 1024, 3),
        "uptimeSeconds": utime.ticks_ms() // 1000,
        "cpuPercent": 0,  # Not easily measurable on ESP32
    }

    # Temperature (ESP32 has internal temp sensor)
    try:
        import esp32
        info["tempCelsius"] = round(esp32.raw_temperature() * 0.01, 1)  # Rough conversion
    except:
        pass

    # Add CPU frequency as extra data
    info["cpuFreqMHz"] = freq_mhz

    return info


def detect_capabilities():
    """Detect available capabilities on this ESP32."""
    caps = ["shell", "system"]

    # GPIO is always available on ESP32
    caps.append("gpio")

    # Check for common sensor libraries
    try:
        import dht
        caps.append("sensor")
    except ImportError:
        pass

    # Check for camera (ESP32-CAM)
    try:
        import camera
        caps.append("camera")
    except ImportError:
        pass

    # Check for Bluetooth
    try:
        import ubluetooth
        caps.append("bluetooth")
    except ImportError:
        pass

    # Check for NeoPixel
    try:
        import neopixel
        caps.append("neopixel")
    except ImportError:
        pass

    return caps


# ─── Command Execution ───────────────────────────────────

def execute_command(cmd, args=None, timeout=10):
    """Execute a command on the ESP32. Supports special ESP32 commands."""
    start = utime.ticks_ms()
    stdout = ""
    stderr = ""
    exit_code = 0

    try:
        # Special ESP32 commands
        if cmd == "reboot":
            stdout = "Rebooting..."
            machine.reset()

        elif cmd == "mem":
            gc.collect()
            stdout = "Free: %d bytes, Allocated: %d bytes, Total: %d bytes" % (
                gc.mem_free(), gc.mem_alloc(), gc.mem_free() + gc.mem_alloc()
            )

        elif cmd == "freq":
            if args and len(args) > 0:
                try:
                    mhz = int(args[0])
                    machine.freq(mhz * 1_000_000)
                    stdout = "CPU frequency set to %d MHz" % mhz
                except:
                    stderr = "Invalid frequency"
                    exit_code = 1
            else:
                stdout = "CPU frequency: %d MHz" % (machine.freq() // 1_000_000)

        elif cmd == "gpio_read":
            if args and len(args) > 0:
                pin_num = int(args[0])
                pin = machine.Pin(pin_num, machine.Pin.IN)
                stdout = "GPIO %d = %d" % (pin_num, pin.value())
            else:
                stderr = "Usage: gpio_read <pin>"
                exit_code = 1

        elif cmd == "gpio_write":
            if args and len(args) >= 2:
                pin_num = int(args[0])
                value = int(args[1])
                pin = machine.Pin(pin_num, machine.Pin.OUT)
                pin.value(value)
                stdout = "GPIO %d set to %d" % (pin_num, value)
            else:
                stderr = "Usage: gpio_write <pin> <0|1>"
                exit_code = 1

        elif cmd == "led":
            if args and len(args) > 0:
                value = int(args[0])
                led = machine.Pin(config.LED_PIN, machine.Pin.OUT)
                led.value(value)
                stdout = "LED %s" % ("ON" if value else "OFF")
            else:
                stderr = "Usage: led <0|1>"
                exit_code = 1

        elif cmd == "pwm":
            if args and len(args) >= 2:
                pin_num = int(args[0])
                duty = int(args[1])
                pin = machine.Pin(pin_num, machine.Pin.OUT)
                pwm = machine.PWM(pin)
                pwm.duty(duty)
                stdout = "PWM on GPIO %d, duty=%d" % (pin_num, duty)
            else:
                stderr = "Usage: pwm <pin> <duty 0-1023>"
                exit_code = 1

        elif cmd == "adc_read":
            if args and len(args) > 0:
                pin_num = int(args[0])
                adc = machine.ADC(machine.Pin(pin_num))
                adc.atten(machine.ADC.ATTN_11DB)
                value = adc.read()
                stdout = "ADC GPIO %d = %d (0-4095)" % (pin_num, value)
            else:
                stderr = "Usage: adc_read <pin>"
                exit_code = 1

        elif cmd == "temp":
            try:
                import esp32
                raw = esp32.raw_temperature()
                # ESP32 internal temp (Fahrenheit by default on some firmware)
                stdout = "Internal temperature: raw=%d" % raw
            except:
                stderr = "Temperature sensor not available"
                exit_code = 1

        elif cmd == "dht":
            if args and len(args) > 0:
                try:
                    import dht
                    pin_num = int(args[0])
                    sensor_type = args[1] if len(args) > 1 else "22"
                    pin = machine.Pin(pin_num)
                    if sensor_type == "11":
                        d = dht.DHT11(pin)
                    else:
                        d = dht.DHT22(pin)
                    d.measure()
                    stdout = "Temperature: %.1f°C, Humidity: %.1f%%" % (d.temperature(), d.humidity())
                except ImportError:
                    stderr = "DHT library not available"
                    exit_code = 1
            else:
                stderr = "Usage: dht <pin> [11|22]"
                exit_code = 1

        elif cmd == "scan_wifi":
            wlan = network.WLAN(network.STA_IF)
            wlan.active(True)
            networks = wlan.scan()
            lines = []
            for net in networks[:10]:
                ssid = net[0].decode()
                rssi = net[3]
                lines.append("  %s (RSSI: %d)" % (ssid, rssi))
            stdout = "WiFi networks:\n" + "\n".join(lines)

        elif cmd == "ls":
            path = args[0] if args and len(args) > 0 else "/"
            try:
                files = os.listdir(path)
                stdout = "\n".join(files)
            except:
                stderr = "Cannot list: %s" % path
                exit_code = 1

        elif cmd == "cat":
            if args and len(args) > 0:
                try:
                    with open(args[0], "r") as f:
                        stdout = f.read()[:2048]  # Limit output
                except:
                    stderr = "Cannot read: %s" % args[0]
                    exit_code = 1
            else:
                stderr = "Usage: cat <file>"
                exit_code = 1

        elif cmd == "exec":
            # Execute arbitrary MicroPython code
            if args and len(args) > 0:
                code = " ".join(args)
                try:
                    exec(code)
                    stdout = "Executed: %s" % code
                except Exception as e:
                    stderr = str(e)
                    exit_code = 1
            else:
                stderr = "Usage: exec <python code>"
                exit_code = 1

        elif cmd == "help":
            stdout = (
                "Available commands:\n"
                "  reboot         — Restart ESP32\n"
                "  mem            — Show memory usage\n"
                "  freq [mhz]    — Get/set CPU frequency\n"
                "  gpio_read <p>  — Read GPIO pin\n"
                "  gpio_write <p> <v> — Write GPIO pin\n"
                "  led <0|1>      — Toggle built-in LED\n"
                "  pwm <p> <duty> — Set PWM on pin\n"
                "  adc_read <p>   — Read ADC value\n"
                "  temp           — Internal temperature\n"
                "  dht <p> [type] — Read DHT sensor\n"
                "  scan_wifi      — Scan WiFi networks\n"
                "  ls [path]      — List files\n"
                "  cat <file>     — Read file\n"
                "  exec <code>    — Execute MicroPython\n"
                "  help           — Show this help"
            )

        else:
            stderr = "Unknown command: %s. Type 'help' for available commands." % cmd
            exit_code = 127

    except Exception as e:
        stderr = str(e)
        exit_code = 1

    duration = utime.ticks_diff(utime.ticks_ms(), start)
    return exit_code, stdout, stderr, duration


# ─── Agent ────────────────────────────────────────────────

class ForgeAINodeAgent:
    def __init__(self):
        self.node_id = get_node_id()
        self.ws = None
        self.sock = None
        self.session_id = None
        self.connected = False
        self.last_heartbeat = 0
        self.last_sysinfo = 0

    def now_ms(self):
        return utime.ticks_ms()

    def connect(self):
        """Connect to ForgeAI Gateway via WebSocket."""
        print("[ForgeAI] Connecting to %s:%d ..." % (config.GATEWAY_HOST, config.GATEWAY_PORT))

        try:
            self.ws, self.sock = ws_connect(
                config.GATEWAY_HOST,
                config.GATEWAY_PORT,
                "/ws/node",
                ssl=config.GATEWAY_SSL,
            )
            print("[ForgeAI] WebSocket connected!")

            # Send auth
            auth_msg = {
                "type": "auth",
                "ts": utime.time() * 1000,
                "token": config.NODE_TOKEN,
                "node": {
                    "nodeId": self.node_id,
                    "name": config.NODE_NAME,
                    "platform": get_platform(),
                    "version": VERSION,
                    "capabilities": detect_capabilities(),
                    "tags": config.NODE_TAGS,
                },
            }
            ws_send_json(self.ws, auth_msg)
            print("[ForgeAI] Auth sent, waiting for response...")

            # Wait for auth response (blocking, with timeout)
            start = utime.ticks_ms()
            while utime.ticks_diff(utime.ticks_ms(), start) < 5000:
                msg = ws_recv_json(self.ws)
                if msg:
                    if msg.get("type") == "auth_ok":
                        self.session_id = msg.get("sessionId", "")
                        self.connected = True
                        print("[ForgeAI] Authenticated! Session:", self.session_id)
                        return True
                    elif msg.get("type") == "error":
                        print("[ForgeAI] Auth FAILED:", msg.get("message", "unknown"))
                        self.close()
                        return False
                utime.sleep_ms(100)

            print("[ForgeAI] Auth timeout!")
            self.close()
            return False

        except Exception as e:
            print("[ForgeAI] Connection failed:", e)
            self.close()
            return False

    def close(self):
        """Close WebSocket connection."""
        self.connected = False
        if self.ws:
            try:
                self.ws.close()
            except:
                pass
            self.ws = None
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None

    def send(self, msg):
        """Send a message to Gateway."""
        if not self.ws:
            return False
        try:
            ws_send_json(self.ws, msg)
            return True
        except Exception as e:
            print("[ForgeAI] Send error:", e)
            self.connected = False
            return False

    def send_heartbeat(self):
        """Send ping heartbeat."""
        return self.send({"type": "ping", "ts": utime.time() * 1000})

    def send_sysinfo(self):
        """Send system info to Gateway."""
        info = collect_sysinfo()
        return self.send({
            "type": "sysinfo",
            "ts": utime.time() * 1000,
            "info": info,
        })

    def handle_message(self, msg):
        """Process incoming message from Gateway."""
        msg_type = msg.get("type", "")

        if msg_type == "pong":
            pass  # Heartbeat response, ignore

        elif msg_type == "ping":
            self.send({"type": "pong", "ts": utime.time() * 1000})

        elif msg_type == "command":
            cmd = msg.get("cmd", "")
            args = msg.get("args", [])
            timeout = msg.get("timeout", 10)
            msg_id = msg.get("msgId", "")

            print("[ForgeAI] Command: %s %s" % (cmd, " ".join(args) if args else ""))

            exit_code, stdout, stderr, duration = execute_command(cmd, args, timeout)

            self.send({
                "type": "command_result",
                "ts": utime.time() * 1000,
                "replyTo": msg_id,
                "exitCode": exit_code,
                "stdout": stdout[:4096],  # Limit output size
                "stderr": stderr[:1024],
                "durationMs": duration,
            })

        elif msg_type == "response":
            # AI response from Gateway
            content = msg.get("content", "")
            print("[ForgeAI] AI:", content[:200])

        elif msg_type == "node_list":
            nodes = msg.get("nodes", [])
            print("[ForgeAI] Connected nodes: %d" % len(nodes))

        elif msg_type == "relay":
            from_id = msg.get("fromNodeId", "?")
            payload = msg.get("payload", {})
            print("[ForgeAI] Relay from %s: %s" % (from_id, str(payload)[:100]))

        else:
            print("[ForgeAI] Unknown message type:", msg_type)

    def run_loop(self):
        """Main event loop — non-blocking read + periodic tasks."""
        self.last_heartbeat = utime.ticks_ms()
        self.last_sysinfo = utime.ticks_ms()

        # Send initial sysinfo
        self.send_sysinfo()

        while self.connected:
            now = utime.ticks_ms()

            # Read incoming messages
            try:
                msg = ws_recv_json(self.ws)
                if msg:
                    self.handle_message(msg)
            except Exception as e:
                print("[ForgeAI] Read error:", e)
                self.connected = False
                break

            # Heartbeat
            if utime.ticks_diff(now, self.last_heartbeat) >= config.HEARTBEAT_INTERVAL * 1000:
                if not self.send_heartbeat():
                    break
                self.last_heartbeat = now

            # System info
            if utime.ticks_diff(now, self.last_sysinfo) >= config.SYSINFO_INTERVAL * 1000:
                self.send_sysinfo()
                self.last_sysinfo = now

            # Garbage collect periodically
            gc.collect()

            # Small sleep to avoid busy loop
            utime.sleep_ms(50)

    def run(self):
        """Main entry point with auto-reconnect."""
        print()
        print("=" * 44)
        print("  ForgeAI Node Agent v%s (ESP32)" % VERSION)
        print("=" * 44)
        print("  ID:       %s" % self.node_id)
        print("  Name:     %s" % config.NODE_NAME)
        print("  Platform: %s" % get_platform())
        print("  Caps:     %s" % ",".join(detect_capabilities()))
        print("  Gateway:  %s:%d" % (config.GATEWAY_HOST, config.GATEWAY_PORT))
        print("=" * 44)
        print()

        attempt = 0
        while True:
            if attempt > 0:
                delay = min(config.RECONNECT_BASE * (2 ** min(attempt, 5)), config.RECONNECT_MAX)
                print("[ForgeAI] Reconnecting in %ds (attempt %d)..." % (delay, attempt))
                utime.sleep(delay)

            # Check WiFi
            wlan = network.WLAN(network.STA_IF)
            if not wlan.isconnected():
                print("[ForgeAI] WiFi disconnected, reconnecting...")
                from boot import connect_wifi
                connect_wifi()
                if not wlan.isconnected():
                    attempt += 1
                    continue

            if self.connect():
                attempt = 0
                self.run_loop()
                self.close()
                print("[ForgeAI] Disconnected from Gateway")
            else:
                attempt += 1


# ─── Start ────────────────────────────────────────────────

if __name__ == "__main__" or True:  # Always run on ESP32
    agent = ForgeAINodeAgent()
    agent.run()
