# ForgeAI Node Agent — ESP32 Boot
# Connects to WiFi on startup

import network
import time
import config

def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    if wlan.isconnected():
        print("[WiFi] Already connected:", wlan.ifconfig()[0])
        return wlan

    print("[WiFi] Connecting to", config.WIFI_SSID, "...")
    wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)

    timeout = 20
    while not wlan.isconnected() and timeout > 0:
        time.sleep(1)
        timeout -= 1
        print("[WiFi] Waiting... (%ds)" % (20 - timeout))

    if wlan.isconnected():
        ip = wlan.ifconfig()[0]
        print("[WiFi] Connected! IP:", ip)
        return wlan
    else:
        print("[WiFi] FAILED to connect!")
        return None

wlan = connect_wifi()
