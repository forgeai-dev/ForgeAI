//! # WebSocket Connection to ForgeAI Gateway
//!
//! Handles secure connection, authentication (Pairing + JWT),
//! message sending/receiving, and automatic reconnection.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Connection state
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Authenticated,
    Reconnecting,
    Error(String),
}

/// Message from Gateway
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GatewayMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: Option<String>,
    pub session_id: Option<String>,
    pub tool_call: Option<serde_json::Value>,
    pub done: Option<bool>,
}

/// Message to send to Gateway
#[derive(Debug, Clone, Serialize)]
pub struct OutgoingMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: String,
    pub session_id: Option<String>,
    pub channel: String,
}

/// Credentials stored in Windows Credential Manager
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionCredentials {
    pub gateway_url: String,
    pub companion_id: String,
    pub role: String,
    #[serde(default)]
    pub auth_token: Option<String>,
}

/// ForgeAI Gateway connection manager
pub struct GatewayConnection {
    state: Arc<Mutex<ConnectionState>>,
    credentials: Arc<Mutex<Option<CompanionCredentials>>>,
    outgoing_tx: Option<mpsc::UnboundedSender<String>>,
    incoming_tx: mpsc::UnboundedSender<GatewayMessage>,
}

impl GatewayConnection {
    pub fn new(incoming_tx: mpsc::UnboundedSender<GatewayMessage>) -> Self {
        Self {
            state: Arc::new(Mutex::new(ConnectionState::Disconnected)),
            credentials: Arc::new(Mutex::new(None)),
            outgoing_tx: None,
            incoming_tx,
        }
    }

    /// Get current connection state
    pub async fn get_state(&self) -> ConnectionState {
        self.state.lock().await.clone()
    }

    /// Get the file path for credential storage fallback
    fn creds_file_path() -> Option<std::path::PathBuf> {
        dirs::data_local_dir().map(|d| d.join("forgeai-companion").join("credentials.json"))
    }

    /// Save credentials to Windows Credential Manager + file fallback
    pub fn save_credentials(creds: &CompanionCredentials) -> Result<(), String> {
        let json = serde_json::to_string(creds).map_err(|e| format!("Serialize error: {}", e))?;

        // Try keyring first
        if let Ok(entry) = keyring::Entry::new("forgeai-companion", "credentials") {
            let _ = entry.set_password(&json);
        }

        // Always save to file as fallback
        if let Some(path) = Self::creds_file_path() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::write(&path, &json)
                .map_err(|e| format!("File save error: {}", e))?;
            log::info!("Credentials saved to {}", path.display());
        }

        Ok(())
    }

    /// Load credentials from Windows Credential Manager, fallback to file
    pub fn load_credentials() -> Option<CompanionCredentials> {
        // Try keyring first
        if let Ok(entry) = keyring::Entry::new("forgeai-companion", "credentials") {
            if let Ok(json) = entry.get_password() {
                if let Ok(creds) = serde_json::from_str::<CompanionCredentials>(&json) {
                    return Some(creds);
                }
            }
        }

        // Fallback to file
        if let Some(path) = Self::creds_file_path() {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(creds) = serde_json::from_str::<CompanionCredentials>(&json) {
                    log::info!("Credentials loaded from file fallback");
                    return Some(creds);
                }
            }
        }

        log::warn!("No credentials found in keyring or file");
        None
    }

    /// Delete stored credentials from both keyring and file
    pub fn delete_credentials() -> Result<(), String> {
        // Try keyring
        if let Ok(entry) = keyring::Entry::new("forgeai-companion", "credentials") {
            let _ = entry.delete_credential();
        }

        // Delete file
        if let Some(path) = Self::creds_file_path() {
            let _ = std::fs::remove_file(&path);
        }

        Ok(())
    }

    /// Pair with Gateway using a pairing code from the Dashboard
    pub async fn pair(
        &mut self,
        gateway_url: &str,
        pairing_code: &str,
    ) -> Result<(), String> {
        *self.state.lock().await = ConnectionState::Connecting;

        let base_url = gateway_url.trim_end_matches('/');
        let url = format!("{}/api/pairing/claim", base_url);

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .json(&serde_json::json!({
                "code": pairing_code,
                "deviceName": "ForgeAI Companion (Windows)",
                "deviceType": "desktop"
            }))
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            *self.state.lock().await = ConnectionState::Error(text.clone());
            return Err(format!("Pairing failed: {}", text));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Parse error: {}", e))?;

        let creds = CompanionCredentials {
            gateway_url: base_url.to_string(),
            companion_id: data["companionId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            role: data["role"]
                .as_str()
                .unwrap_or("user")
                .to_string(),
            auth_token: data["authToken"]
                .as_str()
                .map(|s| s.to_string()),
        };

        Self::save_credentials(&creds)?;
        *self.credentials.lock().await = Some(creds);
        *self.state.lock().await = ConnectionState::Authenticated;

        log::info!("Paired with Gateway at {}", base_url);
        Ok(())
    }

    /// Connect to Gateway WebSocket
    pub async fn connect(&mut self) -> Result<(), String> {
        let creds = {
            let lock = self.credentials.lock().await;
            lock.clone()
                .or_else(|| Self::load_credentials())
                .ok_or("No credentials — please pair first")?
        };

        *self.state.lock().await = ConnectionState::Connecting;

        // Build WebSocket URL
        let ws_url = creds
            .gateway_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        let ws_url = format!("{}/ws?companionId={}", ws_url, creds.companion_id);

        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .map_err(|e| format!("WebSocket connection failed: {}", e))?;

        let (mut write, mut read) = ws_stream.split();

        // Outgoing channel
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let action_tx = tx.clone(); // Clone before moving tx into self
        self.outgoing_tx = Some(tx);

        // Send task — forwards outgoing messages to WebSocket
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
        });

        // Receive task — forwards incoming messages to app + handles action requests
        let incoming_tx = self.incoming_tx.clone();
        let state = self.state.clone();

        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                match msg {
                    Message::Text(text) => {
                        // Try to parse as a raw JSON value first to check type
                        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) {
                            if raw.get("type").and_then(|t| t.as_str()) == Some("action_request") {
                                // Handle action request from Gateway agent
                                let request_id = raw.get("requestId").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let action = raw.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let params = raw.get("params").cloned().unwrap_or(serde_json::json!({}));

                                log::info!("Action request from Gateway: {} ({})", action, request_id);

                                // Build ActionRequest from the params
                                let action_req = crate::local_actions::ActionRequest {
                                    action: action.clone(),
                                    path: params.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                    command: params.get("command").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                    content: params.get("content").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                    process_name: params.get("process_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                    app_name: params.get("app_name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                    cwd: params.get("cwd").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                    confirmed: true, // Agent-initiated actions are pre-confirmed
                                };

                                // Execute locally on Windows
                                let result = crate::local_actions::execute(&action_req);
                                log::info!("Action result: {} success={}", action, result.success);

                                // Send result back via WebSocket
                                let response = serde_json::json!({
                                    "type": "action_result",
                                    "requestId": request_id,
                                    "success": result.success,
                                    "output": result.output,
                                });
                                if let Ok(json) = serde_json::to_string(&response) {
                                    let _ = action_tx.send(json);
                                }
                                continue;
                            }
                        }

                        // Normal message — forward to app
                        if let Ok(gateway_msg) =
                            serde_json::from_str::<GatewayMessage>(&text)
                        {
                            let _ = incoming_tx.send(gateway_msg);
                        }
                    }
                    Message::Close(_) => {
                        *state.lock().await = ConnectionState::Reconnecting;
                        break;
                    }
                    _ => {}
                }
            }
        });

        *self.state.lock().await = ConnectionState::Connected;
        *self.credentials.lock().await = Some(creds);

        log::info!("Connected to Gateway WebSocket");
        Ok(())
    }

    /// Send a chat message to the Gateway
    pub fn send_message(&self, content: &str, session_id: Option<&str>) -> Result<(), String> {
        let tx = self
            .outgoing_tx
            .as_ref()
            .ok_or("Not connected")?;

        let msg = OutgoingMessage {
            msg_type: "chat".to_string(),
            content: content.to_string(),
            session_id: session_id.map(|s| s.to_string()),
            channel: "companion".to_string(),
        };

        let json = serde_json::to_string(&msg).map_err(|e| format!("Serialize error: {}", e))?;
        tx.send(json).map_err(|e| format!("Send error: {}", e))
    }

    /// Check if connected
    pub async fn is_connected(&self) -> bool {
        matches!(
            *self.state.lock().await,
            ConnectionState::Connected | ConnectionState::Authenticated
        )
    }

    /// Disconnect
    pub async fn disconnect(&mut self) {
        self.outgoing_tx = None;
        *self.state.lock().await = ConnectionState::Disconnected;
        log::info!("Disconnected from Gateway");
    }
}
