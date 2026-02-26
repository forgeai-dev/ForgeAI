//! # Tauri IPC Commands
//!
//! These are the commands exposed to the React frontend via Tauri's invoke system.
//! Every command that performs a local action goes through the safety system.

use base64::Engine as _;
use crate::local_actions::{self, ActionRequest, ActionResult};
use crate::safety;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tokio::sync::Notify;

static GATEWAY_WS_ACTIVE: AtomicBool = AtomicBool::new(false);
static RECONNECT_NOTIFY: OnceLock<Notify> = OnceLock::new();

fn get_reconnect_notify() -> &'static Notify {
    RECONNECT_NOTIFY.get_or_init(|| Notify::new())
}

/// Build a reqwest::RequestBuilder with auth cookie if available
fn with_auth(builder: reqwest::RequestBuilder, creds: &crate::connection::CompanionCredentials) -> reqwest::RequestBuilder {
    if let Some(ref token) = creds.auth_token {
        builder.header("Cookie", format!("forgeai_session={}", token))
    } else {
        builder
    }
}

/// Status response for the frontend
#[derive(Debug, Clone, Serialize)]
pub struct CompanionStatus {
    pub connected: bool,
    pub gateway_url: Option<String>,
    pub companion_id: Option<String>,
    pub auth_token: Option<String>,
    pub safety_active: bool,
    pub version: String,
}

/// Pairing request from frontend
#[derive(Debug, Clone, Deserialize)]
pub struct PairRequest {
    pub gateway_url: String,
    pub pairing_code: String,
}

/// Execute a local action (called by the Gateway via LLM tool calls)
#[tauri::command]
pub fn execute_action(request: ActionRequest) -> ActionResult {
    log::info!("Executing action: {} (confirmed: {})", request.action, request.confirmed);
    let result = local_actions::execute(&request);
    log::info!(
        "Action result: success={}, risk={:?}",
        result.success,
        result.safety.risk
    );
    result
}

/// Check if an action is safe without executing it
#[tauri::command]
pub fn check_safety(action: String, path: Option<String>, command: Option<String>) -> safety::SafetyVerdict {
    if let Some(cmd) = &command {
        return safety::check_shell_command(cmd);
    }
    if let Some(p) = &path {
        return safety::check_file_operation(&action, p);
    }
    safety::SafetyVerdict {
        allowed: true,
        risk: safety::RiskLevel::Safe,
        reason: "No path or command to check".into(),
        requires_confirmation: false,
    }
}

/// Get the safety system prompt (injected into every LLM request)
#[tauri::command]
pub fn get_safety_prompt() -> String {
    safety::get_safety_system_prompt()
}

/// Get companion status
#[tauri::command]
pub fn get_status() -> CompanionStatus {
    let creds = crate::connection::GatewayConnection::load_credentials();
    CompanionStatus {
        connected: creds.is_some(),
        gateway_url: creds.as_ref().map(|c| c.gateway_url.clone()),
        companion_id: creds.as_ref().map(|c| c.companion_id.clone()),
        auth_token: creds.as_ref().and_then(|c| c.auth_token.clone()),
        safety_active: true,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

/// Pair with a ForgeAI Gateway by redeeming a pairing code
#[tauri::command]
pub async fn pair_with_gateway(gateway_url: String, pairing_code: String) -> Result<String, String> {
    let url = format!("{}/api/companion/pair", gateway_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "code": pairing_code,
            "deviceName": hostname::get()
                .map(|h| h.to_string_lossy().to_string())
                .unwrap_or_else(|_| "Unknown".into()),
        }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Gateway returned HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    let success = body["success"].as_bool().unwrap_or(false);
    if !success {
        let msg = body["message"].as_str().unwrap_or("Pairing failed");
        return Err(msg.to_string());
    }

    let companion_id = body["companionId"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();
    let role = body["role"].as_str().unwrap_or("user").to_string();

    let auth_token = body["authToken"]
        .as_str()
        .map(|s| s.to_string());

    let creds = crate::connection::CompanionCredentials {
        gateway_url: gateway_url.trim_end_matches('/').to_string(),
        companion_id,
        role,
        auth_token,
    };

    crate::connection::GatewayConnection::save_credentials(&creds)?;
    log::info!("Paired with Gateway at {}", creds.gateway_url);

    Ok("Paired successfully!".into())
}

/// Start dragging the window
#[tauri::command]
pub fn window_start_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// Minimize the main window
#[tauri::command]
pub fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// Hide the main window (close to tray)
#[tauri::command]
pub fn window_hide(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Toggle maximize/restore
#[tauri::command]
pub fn window_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

/// Send a chat message to the Gateway and get AI response.
/// Uses streaming mode: Gateway sends heartbeat spaces to keep connection alive
/// during long agent runs, then the final JSON result at the end.
#[tauri::command]
pub async fn chat_send(message: String, session_id: Option<String>) -> Result<serde_json::Value, String> {
    let creds = crate::connection::GatewayConnection::load_credentials()
        .ok_or("Not connected — pair first")?;

    let url = format!("{}/api/chat", creds.gateway_url);

    // No total timeout — Gateway sends heartbeat spaces every 10s to keep alive.
    // Only connect_timeout to fail fast if server is unreachable.
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let payload = serde_json::json!({
        "message": message,
        "sessionId": session_id,
        "userId": creds.companion_id,
        "channelType": "companion",
        "stream": true,
    });

    let mut last_err = String::new();
    let mut resp_opt = None;
    for attempt in 0..2 {
        let mut req = client.post(&url).json(&payload);
        if let Some(ref token) = creds.auth_token {
            req = req.header("Cookie", format!("forgeai_session={}", token));
        }
        match req.send().await {
            Ok(r) => { resp_opt = Some(r); break; }
            Err(e) => {
                last_err = format!("{}", e);
                log::warn!("chat_send: Gateway request attempt {} failed: {}", attempt + 1, last_err);
                if attempt == 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                }
            }
        }
    }

    let resp = resp_opt.ok_or(format!("Gateway unreachable after 2 attempts: {}", last_err))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Gateway HTTP {}: {}", status, body));
    }

    // Response is streamed: heartbeat spaces followed by JSON.
    // Read full body as text, trim leading spaces, then parse.
    let raw = resp.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Empty response from Gateway".into());
    }

    let body: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Invalid JSON response: {}", e))?;

    // Check for server-side error in response
    if let Some(err) = body.get("error").and_then(|v| v.as_str()) {
        return Err(format!("Gateway error: {}", err));
    }

    Ok(body)
}

/// Full voice pipeline: record mic → send to Gateway STT+AI+TTS → play response → return text
/// This is the "Jarvis" command — speak to ForgeAI, get a spoken answer back.
/// Emits events: voice-state (listening/processing/speaking/idle), voice-audio-level
#[tauri::command]
pub async fn chat_voice(
    app_handle: tauri::AppHandle,
    state: State<'_, VoiceState>,
    session_id: Option<String>,
) -> Result<serde_json::Value, String> {
    use tauri::Emitter;
    let creds = crate::connection::GatewayConnection::load_credentials()
        .ok_or("Not connected — pair first")?;

    // Emit: LISTENING
    let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "listening" }));

    // Step 1: Record audio from microphone (emits audio levels in real-time)
    log::info!("Jarvis: recording...");
    let audio = {
        let engine = state.0.lock().map_err(|e| {
            let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "idle" }));
            e.to_string()
        })?;
        match engine.record_with_events(&app_handle) {
            Ok(a) => a,
            Err(e) => {
                let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "idle" }));
                return Err(e);
            }
        }
    };
    log::info!("Jarvis: recorded {}ms of audio", audio.duration_ms);

    // Emit: PROCESSING
    let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "processing" }));

    // Step 2: Send audio to Gateway /api/chat/voice for STT → AI → TTS
    // Retry once on connection errors (server may be busy with agent tools)
    let url = format!("{}/api/chat/voice", creds.gateway_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let payload = serde_json::json!({
        "audio": audio.wav_base64,
        "format": "wav",
        "sessionId": session_id,
        "userId": creds.companion_id,
        "ttsResponse": true,
    });

    let mut last_err = String::new();
    let mut resp_opt = None;
    for attempt in 0..2 {
        let mut req = client.post(&url).json(&payload);
        if let Some(ref token) = creds.auth_token {
            req = req.header("Cookie", format!("forgeai_session={}", token));
        }
        match req.send().await {
            Ok(r) => { resp_opt = Some(r); break; }
            Err(e) => {
                last_err = format!("{}", e);
                log::warn!("Jarvis: Gateway request attempt {} failed: {}", attempt + 1, last_err);
                if attempt == 0 {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                }
            }
        }
    }

    let resp = match resp_opt {
        Some(r) => r,
        None => {
            let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "idle" }));
            return Err(format!("Gateway unreachable after 2 attempts: {}", last_err));
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "idle" }));
        return Err(format!("Gateway HTTP {}: {}", status, body));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| {
            let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "idle" }));
            format!("Invalid response: {}", e)
        })?;

    let transcription = body["transcription"].as_str().unwrap_or("").to_string();
    let content = body["content"].as_str().unwrap_or("").to_string();
    log::info!("Jarvis: user said '{}', AI replied '{}'",
        transcription.chars().take(50).collect::<String>(),
        content.chars().take(50).collect::<String>());

    // Step 3: Play TTS audio response if available
    if let Some(tts_audio) = body["ttsAudio"].as_str() {
        if let Ok(audio_bytes) = base64::engine::general_purpose::STANDARD.decode(tts_audio) {
            log::info!("Jarvis: playing TTS response ({} bytes)", audio_bytes.len());
            // Emit: SPEAKING
            let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "speaking" }));
            if let Err(e) = crate::voice::play_audio_bytes(&audio_bytes) {
                log::error!("Jarvis: TTS playback failed: {}", e);
            }
        }
    }

    // Emit: IDLE
    let _ = app_handle.emit("voice-state", serde_json::json!({ "state": "idle" }));

    Ok(body)
}

/// Play base64-encoded audio through speakers (for TTS responses)
#[tauri::command]
pub async fn play_tts(audio_base64: String) -> Result<String, String> {
    use base64::Engine as _;
    let audio_bytes = base64::engine::general_purpose::STANDARD
        .decode(&audio_base64)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    crate::voice::play_audio_bytes(&audio_bytes)?;
    Ok("Audio played".into())
}

/// Delete stored credentials (disconnect)
#[tauri::command]
pub fn disconnect() -> Result<String, String> {
    crate::connection::GatewayConnection::delete_credentials()?;
    Ok("Disconnected and credentials removed".into())
}

// ─── Gateway WebSocket Background Loop ──────────────────────────────

/// Spawn the persistent Gateway WebSocket loop (idempotent — only one loop runs)
pub fn spawn_gateway_ws() {
    if GATEWAY_WS_ACTIVE.swap(true, Ordering::SeqCst) {
        log::info!("[GatewayWS] Loop already active");
        return;
    }
    tauri::async_runtime::spawn(async {
        gateway_ws_loop().await;
        GATEWAY_WS_ACTIVE.store(false, Ordering::SeqCst);
    });
}

/// Tauri command: ensure the Gateway WS is running (called after pairing)
#[tauri::command]
pub async fn connect_gateway_ws() -> Result<String, String> {
    spawn_gateway_ws();
    Ok("Gateway WS connection started".into())
}

/// Tauri command: force the WS loop to reconnect with fresh credentials (call after re-pairing)
#[tauri::command]
pub async fn force_reconnect_gateway_ws() -> Result<String, String> {
    log::info!("[GatewayWS] Force reconnect requested");
    get_reconnect_notify().notify_one();
    // Wait for old loop to exit, then start fresh
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    GATEWAY_WS_ACTIVE.store(false, Ordering::SeqCst);
    spawn_gateway_ws();
    Ok("Reconnect initiated".into())
}

async fn gateway_ws_loop() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    // Brief delay so the app is fully initialized
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    loop {
        // Reload credentials each iteration (handles re-pairing)
        let creds = match crate::connection::GatewayConnection::load_credentials() {
            Some(c) => c,
            None => {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                continue;
            }
        };

        // Build WS URL with companionId + auth token
        let ws_base = creds.gateway_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        let mut ws_url = format!("{}/ws?companionId={}", ws_base, creds.companion_id);
        if let Some(ref token) = creds.auth_token {
            ws_url.push_str(&format!("&token={}", token));
        }

        log::info!("[GatewayWS] Connecting: companionId={}", creds.companion_id);

        match connect_async(&ws_url).await {
            Ok((ws_stream, _)) => {
                log::info!("[GatewayWS] Connected to {}", creds.gateway_url);
                let (mut write, mut read) = ws_stream.split();
                let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

                // Send task: forwards outgoing messages to WS
                let send_handle = tokio::spawn(async move {
                    while let Some(msg) = rx.recv().await {
                        if write.send(Message::Text(msg.into())).await.is_err() {
                            log::error!("[GatewayWS] Write failed, send task exiting");
                            break;
                        }
                    }
                });

                // Keepalive ping interval (30s)
                let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(30));
                ping_interval.tick().await; // consume initial tick

                // Receive loop with keepalive
                let mut alive = true;
                while alive {
                    tokio::select! {
                        msg = read.next() => {
                            match msg {
                                Some(Ok(Message::Text(text))) => {
                                    let text_str: String = text.to_string();
                                    let raw: serde_json::Value = match serde_json::from_str(&text_str) {
                                        Ok(v) => v,
                                        Err(e) => {
                                            log::warn!("[GatewayWS] JSON parse error: {}", e);
                                            continue;
                                        }
                                    };
                                    let msg_type = raw.get("type").and_then(|t| t.as_str()).unwrap_or("");

                                    match msg_type {
                                        "action_request" => {
                                            let request_id = raw.get("requestId")
                                                .and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let action = raw.get("action")
                                                .and_then(|v| v.as_str()).unwrap_or("").to_string();
                                            let params = raw.get("params")
                                                .cloned().unwrap_or(serde_json::json!({}));

                                            log::info!("[GatewayWS] >>> Action request: {} (id={})", action, request_id);

                                            // Execute in a blocking thread so we don't stall the async loop
                                            let action_clone = action.clone();
                                            let tx_clone = tx.clone();
                                            let req_id = request_id.clone();
                                            tokio::task::spawn_blocking(move || {
                                                // Desktop actions get raw params; others use ActionRequest
                                                let result = if action_clone == "desktop" {
                                                    local_actions::execute_desktop(&params)
                                                } else {
                                                    let action_req = ActionRequest {
                                                        action: action_clone.clone(),
                                                        path: params.get("path").and_then(|v| v.as_str()).map(String::from),
                                                        command: params.get("command").and_then(|v| v.as_str()).map(String::from),
                                                        content: params.get("content").and_then(|v| v.as_str()).map(String::from),
                                                        process_name: params.get("process_name").and_then(|v| v.as_str()).map(String::from),
                                                        app_name: params.get("app_name").and_then(|v| v.as_str()).map(String::from),
                                                        cwd: params.get("cwd").and_then(|v| v.as_str()).map(String::from),
                                                        confirmed: true,
                                                    };
                                                    local_actions::execute(&action_req)
                                                };
                                                log::info!("[GatewayWS] <<< Action result: {} success={} output_len={}",
                                                    action_clone, result.success, result.output.len());

                                                let response = serde_json::json!({
                                                    "type": "action_result",
                                                    "requestId": req_id,
                                                    "success": result.success,
                                                    "output": result.output,
                                                });
                                                if let Ok(json) = serde_json::to_string(&response) {
                                                    if let Err(e) = tx_clone.send(json) {
                                                        log::error!("[GatewayWS] Failed to queue response: {}", e);
                                                    } else {
                                                        log::info!("[GatewayWS] Response queued for {}", req_id);
                                                    }
                                                }
                                            });
                                        }
                                        "health.pong" => {
                                            log::debug!("[GatewayWS] Keepalive pong received");
                                        }
                                        _ => {
                                            log::debug!("[GatewayWS] Received: {}", msg_type);
                                        }
                                    }
                                }
                                Some(Ok(Message::Ping(data))) => {
                                    log::debug!("[GatewayWS] Ping frame received");
                                    let pong = serde_json::json!({"type":"pong"}).to_string();
                                    let _ = tx.send(pong);
                                    let _ = data; // auto-pong handled by tungstenite
                                }
                                Some(Ok(Message::Close(_))) => {
                                    log::warn!("[GatewayWS] Server closed connection");
                                    alive = false;
                                }
                                Some(Err(e)) => {
                                    log::error!("[GatewayWS] Read error: {}", e);
                                    alive = false;
                                }
                                None => {
                                    log::warn!("[GatewayWS] Stream ended");
                                    alive = false;
                                }
                                _ => {}
                            }
                        }
                        _ = ping_interval.tick() => {
                            let ping = serde_json::json!({
                                "type": "health.ping",
                                "id": "keepalive",
                            }).to_string();
                            if tx.send(ping).is_err() {
                                log::warn!("[GatewayWS] Ping send failed — connection dead");
                                alive = false;
                            } else {
                                log::debug!("[GatewayWS] Keepalive ping sent");
                            }
                        }
                        _ = get_reconnect_notify().notified() => {
                            log::info!("[GatewayWS] Reconnect signal received, closing current connection");
                            alive = false;
                        }
                    }
                }

                send_handle.abort();
                log::warn!("[GatewayWS] Disconnected, reconnecting in 5s...");
            }
            Err(e) => {
                log::error!("[GatewayWS] Connection failed: {}, retry in 5s...", e);
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }
}

/// Get system info (safe, no confirmation needed)
#[tauri::command]
pub fn get_system_info() -> ActionResult {
    local_actions::execute(&ActionRequest {
        action: "system_info".into(),
        path: None,
        command: None,
        content: None,
        process_name: None,
        app_name: None,
        cwd: None,
        confirmed: false,
    })
}

// ─── Wake Word Commands ──────────────────────────────

use crate::wake_word::{self, WakeWordEngine, WakeWordStatus};
use crate::voice::{self, VoiceEngine, CapturedAudio};
use std::sync::Mutex;
use tauri::State;

/// Managed state for wake word engine
pub struct WakeWordState(pub Mutex<WakeWordEngine>);

/// Managed state for voice engine
pub struct VoiceState(pub Mutex<VoiceEngine>);

/// Configure wake word with Picovoice access key
#[tauri::command]
pub fn wake_word_configure(
    state: State<'_, WakeWordState>,
    access_key: String,
    sensitivity: f32,
    keyword_path: Option<String>,
) -> Result<String, String> {
    let mut engine = state.0.lock().map_err(|e| e.to_string())?;
    engine.configure(access_key, sensitivity);
    if let Some(kw) = keyword_path {
        engine.set_keyword_path(kw);
    }
    Ok("Wake word configured".into())
}

/// Start wake word detection
#[tauri::command]
pub fn wake_word_start(
    state: State<'_, WakeWordState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let engine = state.0.lock().map_err(|e| e.to_string())?;
    engine.start(app_handle)?;
    Ok("Wake word detection started".into())
}

/// Stop wake word detection
#[tauri::command]
pub fn wake_word_stop(state: State<'_, WakeWordState>) -> Result<String, String> {
    let engine = state.0.lock().map_err(|e| e.to_string())?;
    engine.stop();
    Ok("Wake word detection stopped".into())
}

/// Get wake word engine status
#[tauri::command]
pub fn wake_word_status(state: State<'_, WakeWordState>) -> Result<WakeWordStatus, String> {
    let engine = state.0.lock().map_err(|e| e.to_string())?;
    Ok(engine.status())
}

// ─── Voice Commands ──────────────────────────────────

/// Record audio from microphone (stops on silence or manual stop)
#[tauri::command]
pub fn voice_record(state: State<'_, VoiceState>) -> Result<CapturedAudio, String> {
    let engine = state.0.lock().map_err(|e| e.to_string())?;
    engine.record()
}

/// Stop an ongoing recording
#[tauri::command]
pub fn voice_stop(state: State<'_, VoiceState>) -> Result<String, String> {
    let engine = state.0.lock().map_err(|e| e.to_string())?;
    engine.stop_recording();
    Ok("Recording stopped".into())
}

/// Send text to Gateway TTS and play the response audio
#[tauri::command]
pub async fn voice_speak(text: String) -> Result<String, String> {
    let creds = crate::connection::GatewayConnection::load_credentials()
        .ok_or("Not connected — pair first")?;

    let engine = VoiceEngine::new();
    engine
        .speak(&creds.gateway_url, &creds.companion_id, &text)
        .await?;

    Ok("Speech played".into())
}

/// Read a screenshot and return it as a base64 data URL.
/// Strategy: try local file first (fast), then fall back to Gateway HTTP (remote VPS).
#[tauri::command]
pub async fn read_screenshot(path: String, gateway_url: Option<String>) -> Result<String, String> {
    let ext = path.rsplit('.').next().unwrap_or("png").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };

    // 1) Try local file first (works when Gateway runs on same machine)
    if let Ok(data) = tokio::fs::read(&path).await {
        log::info!("Screenshot loaded locally: {}", path);
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        return Ok(format!("data:{};base64,{}", mime, b64));
    }

    // 2) Fallback: fetch from Gateway HTTP endpoint (works for remote VPS)
    if let Some(gw_url) = gateway_url {
        let normalized = path.replace("\\\\", "/").replace('\\', "/");
        if let Some(idx) = normalized.find(".forgeai/") {
            let rel_path = &normalized[idx + 9..]; // after ".forgeai/"
            let url = format!("{}/api/files/{}", gw_url.trim_end_matches('/'), rel_path);
            log::info!("Screenshot not local, fetching from Gateway: {}", url);

            let client = reqwest::Client::new();
            let mut req = client
                .get(&url)
                .timeout(std::time::Duration::from_secs(15));
            // Try to add auth if credentials are available
            if let Some(creds) = crate::connection::GatewayConnection::load_credentials() {
                if let Some(ref token) = creds.auth_token {
                    req = req.header("Cookie", format!("forgeai_session={}", token));
                }
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("Gateway fetch failed: {}", e))?;

            if resp.status().is_success() {
                let bytes = resp.bytes().await.map_err(|e| format!("Read bytes failed: {}", e))?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return Ok(format!("data:{};base64,{}", mime, b64));
            } else {
                return Err(format!("Gateway returned {}: {}", resp.status(), url));
            }
        }
    }

    Err(format!("Screenshot not found locally or via Gateway: {}", path))
}

/// List chat sessions from Gateway (companion-only)
#[tauri::command]
pub async fn list_sessions() -> Result<serde_json::Value, String> {
    let creds = crate::connection::GatewayConnection::load_credentials()
        .ok_or("Not connected — pair first")?;

    let url = format!("{}/api/chat/sessions", creds.gateway_url);
    let client = reqwest::Client::new();
    let req = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10));
    let resp = with_auth(req, &creds)
        .send()
        .await
        .map_err(|e| format!("Gateway request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Gateway HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Invalid response: {}", e))?;

    // Filter to only companion sessions (by userId)
    if let Some(sessions) = body["sessions"].as_array() {
        let companion_id = &creds.companion_id;
        let filtered: Vec<&serde_json::Value> = sessions
            .iter()
            .filter(|s| {
                s["channelType"].as_str() == Some("companion")
                    || s["userId"].as_str().map_or(false, |u| u == companion_id)
            })
            .collect();
        Ok(serde_json::json!({ "sessions": filtered }))
    } else {
        Ok(body)
    }
}

/// Get session history from Gateway
#[tauri::command]
pub async fn get_session_history(session_id: String) -> Result<serde_json::Value, String> {
    let creds = crate::connection::GatewayConnection::load_credentials()
        .ok_or("Not connected — pair first")?;

    let url = format!("{}/api/chat/history/{}", creds.gateway_url, session_id);
    let client = reqwest::Client::new();
    let req = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10));
    let resp = with_auth(req, &creds)
        .send()
        .await
        .map_err(|e| format!("Gateway request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Gateway HTTP {}", resp.status()));
    }

    resp.json().await.map_err(|e| format!("Invalid response: {}", e))
}

/// Delete a session from Gateway
#[tauri::command]
pub async fn delete_session(session_id: String) -> Result<serde_json::Value, String> {
    let creds = crate::connection::GatewayConnection::load_credentials()
        .ok_or("Not connected — pair first")?;

    let url = format!("{}/api/chat/sessions/{}", creds.gateway_url, session_id);
    let client = reqwest::Client::new();
    let req = client
        .delete(&url)
        .timeout(std::time::Duration::from_secs(10));
    let resp = with_auth(req, &creds)
        .send()
        .await
        .map_err(|e| format!("Gateway request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Gateway HTTP {}", resp.status()));
    }

    resp.json().await.map_err(|e| format!("Invalid response: {}", e))
}

/// List available audio input/output devices
#[tauri::command]
pub fn list_audio_devices() -> Result<serde_json::Value, String> {
    let inputs = wake_word::list_audio_devices();
    let outputs = voice::list_output_devices();
    Ok(serde_json::json!({
        "inputs": inputs,
        "outputs": outputs,
    }))
}
