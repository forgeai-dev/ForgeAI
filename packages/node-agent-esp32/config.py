# ForgeAI Node Agent — ESP32 Configuration
# Edit these values before uploading to your ESP32

# ─── WiFi ─────────────────────────────────────────────────
WIFI_SSID = "YOUR_WIFI_SSID"
WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"

# ─── ForgeAI Gateway ─────────────────────────────────────
GATEWAY_HOST = "192.168.1.100"  # Your Gateway IP
GATEWAY_PORT = 18800
GATEWAY_SSL = False             # Set True for wss://

# ─── Node Identity ───────────────────────────────────────
NODE_TOKEN = "YOUR_NODE_API_KEY"  # From Dashboard → Settings → Node Protocol
NODE_NAME = "ESP32-Device"
NODE_ID = ""                      # Leave empty for auto-generate
NODE_TAGS = []                    # e.g. ["office", "sensor", "floor2"]

# ─── Intervals (seconds) ─────────────────────────────────
HEARTBEAT_INTERVAL = 25
SYSINFO_INTERVAL = 60
RECONNECT_BASE = 2
RECONNECT_MAX = 60

# ─── GPIO Pins (customize for your board) ────────────────
LED_PIN = 2          # Built-in LED (most ESP32 boards)
SENSOR_PIN = None    # Set to GPIO number if DHT22/etc attached
