//! # WebSocket Connection to ForgeAI Gateway
//!
//! Handles secure connection, authentication (Pairing + JWT),
//! message sending/receiving, and automatic reconnection.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use url::Url;

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
    pub jwt_token: String,
    pub refresh_token: String,
    pub node_api_key: String,
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

    /// Save credentials to Windows Credential Manager
    pub fn save_credentials(creds: &CompanionCredentials) -> Result<(), String> {
        let entry = keyring::Entry::new("forgeai-companion", "credentials")
            .map_err(|e| format!("Keyring error: {}", e))?;
        let json = serde_json::to_string(creds).map_err(|e| format!("Serialize error: {}", e))?;
        entry
            .set_password(&json)
            .map_err(|e| format!("Save error: {}", e))
    }

    /// Load credentials from Windows Credential Manager
    pub fn load_credentials() -> Option<CompanionCredentials> {
        let entry = keyring::Entry::new("forgeai-companion", "credentials").ok()?;
        let json = entry.get_password().ok()?;
        serde_json::from_str(&json).ok()
    }

    /// Delete stored credentials
    pub fn delete_credentials() -> Result<(), String> {
        let entry = keyring::Entry::new("forgeai-companion", "credentials")
            .map_err(|e| format!("Keyring error: {}", e))?;
        entry
            .delete_credential()
            .map_err(|e| format!("Delete error: {}", e))
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
            jwt_token: data["token"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            refresh_token: data["refreshToken"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            node_api_key: data["apiKey"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
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
        let ws_url = format!("{}/ws?token={}", ws_url, creds.jwt_token);

        let url = Url::parse(&ws_url).map_err(|e| format!("Invalid URL: {}", e))?;

        let (ws_stream, _) = connect_async(url)
            .await
            .map_err(|e| format!("WebSocket connection failed: {}", e))?;

        let (mut write, mut read) = ws_stream.split();

        // Outgoing channel
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        self.outgoing_tx = Some(tx);

        // Send task — forwards outgoing messages to WebSocket
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if write.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
        });

        // Receive task — forwards incoming messages to app
        let incoming_tx = self.incoming_tx.clone();
        let state = self.state.clone();

        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                match msg {
                    Message::Text(text) => {
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
