//! # Wake Word Detection Engine
//!
//! Listens for voice activity using energy-based detection (VAD).
//! When speech is detected above the sensitivity threshold, emits
//! a `wake-word-detected` Tauri event to activate the companion.
//!
//! Architecture note: Picovoice Porcupine support can be added as
//! an optional feature once the `pv_porcupine` crate is republished
//! on crates.io (all v3.x versions are currently yanked).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Wake word engine state
pub struct WakeWordEngine {
    running: Arc<AtomicBool>,
    sensitivity: f32,
    access_key: Option<String>,
    keyword_path: Option<String>,
}

/// Event emitted when wake word is detected
#[derive(Clone, serde::Serialize)]
pub struct WakeWordEvent {
    pub keyword: String,
    pub timestamp: String,
}

/// Status of the wake word engine
#[derive(Clone, serde::Serialize)]
pub struct WakeWordStatus {
    pub running: bool,
    pub sensitivity: f32,
    pub has_access_key: bool,
    pub keyword: String,
    pub audio_device: Option<String>,
}

impl WakeWordEngine {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            sensitivity: 0.5,
            access_key: None,
            keyword_path: None,
        }
    }

    /// Configure the engine (access_key reserved for future Porcupine support)
    pub fn configure(&mut self, access_key: String, sensitivity: f32) {
        self.access_key = Some(access_key);
        self.sensitivity = sensitivity.clamp(0.0, 1.0);
    }

    /// Set custom keyword model path (reserved for future Porcupine support)
    pub fn set_keyword_path(&mut self, path: String) {
        self.keyword_path = Some(path);
    }

    /// Get current status
    pub fn status(&self) -> WakeWordStatus {
        let audio_device = cpal::default_host()
            .default_input_device()
            .and_then(|d| d.name().ok());

        WakeWordStatus {
            running: self.running.load(Ordering::Relaxed),
            sensitivity: self.sensitivity,
            has_access_key: self.access_key.is_some(),
            keyword: "Hey Forge".to_string(),
            audio_device,
        }
    }

    /// Start listening in a background thread
    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        if self.running.load(Ordering::Relaxed) {
            return Err("Wake word engine already running".into());
        }

        let sensitivity = self.sensitivity;
        let running = self.running.clone();

        running.store(true, Ordering::Relaxed);

        std::thread::spawn(move || {
            if let Err(e) = run_detection_loop(sensitivity, &running, &app_handle) {
                log::error!("Wake word engine error: {}", e);
                running.store(false, Ordering::Relaxed);
            }
        });

        log::info!(
            "Wake word engine started (sensitivity: {}, mode: energy-VAD)",
            self.sensitivity
        );
        Ok(())
    }

    /// Stop listening
    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
        log::info!("Wake word engine stopped");
    }

    /// Check if running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}

/// Energy-based voice activity detection loop.
/// Detects sustained speech energy above threshold and emits activation event.
/// This serves as a working fallback until Porcupine crate is available again.
fn run_detection_loop(
    sensitivity: f32,
    running: &Arc<AtomicBool>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No audio input device found")?;

    log::info!(
        "Wake word: using input device '{}'",
        device.name().unwrap_or_default()
    );

    let config = cpal::StreamConfig {
        channels: 1,
        sample_rate: cpal::SampleRate(16000),
        buffer_size: cpal::BufferSize::Default,
    };

    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(16);

    let stream = device
        .build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = tx.try_send(data.to_vec());
            },
            |err| {
                log::error!("Audio stream error: {}", err);
            },
            None,
        )
        .map_err(|e| format!("Failed to build audio stream: {}", e))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start audio stream: {}", e))?;

    log::info!("Wake word: audio stream active, listening (energy-VAD)...");

    // Energy threshold: lower sensitivity = harder to trigger
    // sensitivity 0.0 → threshold 0.10 (hard)
    // sensitivity 0.5 → threshold 0.03 (default)
    // sensitivity 1.0 → threshold 0.005 (very sensitive)
    let energy_threshold = 0.10 * (1.0 - sensitivity * 0.95);

    // Require sustained speech for ~300ms to avoid false triggers
    let sustained_frames_required = 5;
    let mut sustained_count: u32 = 0;

    while running.load(Ordering::Relaxed) {
        match rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(samples) => {
                let rms: f32 = (samples.iter().map(|s| s * s).sum::<f32>()
                    / samples.len().max(1) as f32)
                    .sqrt();

                if rms > energy_threshold {
                    sustained_count += 1;
                } else {
                    sustained_count = 0;
                }

                if sustained_count >= sustained_frames_required {
                    log::info!("Wake word: voice activity detected (RMS: {:.4})", rms);

                    let event = WakeWordEvent {
                        keyword: "Hey Forge".to_string(),
                        timestamp: chrono::Utc::now().to_rfc3339(),
                    };

                    let _ = app_handle.emit("wake-word-detected", event);

                    // Cooldown to prevent rapid re-triggers
                    sustained_count = 0;
                    std::thread::sleep(std::time::Duration::from_secs(3));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(stream);
    log::info!("Wake word: detection loop ended");
    Ok(())
}

/// Get available audio input devices
pub fn list_audio_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| d.name().ok())
                .collect()
        })
        .unwrap_or_default()
}
