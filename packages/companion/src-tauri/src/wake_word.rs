//! # Wake Word Detection Engine
//!
//! Uses Picovoice Porcupine for on-device wake word detection.
//! Default keyword: "Hey Forge" (customizable).
//! Runs in a background thread, consuming <1% CPU when idle.
//! When triggered, emits an event to the Tauri frontend.

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

    /// Configure the engine with Picovoice access key
    pub fn configure(&mut self, access_key: String, sensitivity: f32) {
        self.access_key = Some(access_key);
        self.sensitivity = sensitivity.clamp(0.0, 1.0);
    }

    /// Set custom keyword model path
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

    /// Start listening for the wake word in a background thread
    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        if self.running.load(Ordering::Relaxed) {
            return Err("Wake word engine already running".into());
        }

        let access_key = self
            .access_key
            .clone()
            .ok_or("Picovoice access key not configured")?;

        let sensitivity = self.sensitivity;
        let running = self.running.clone();
        let keyword_path = self.keyword_path.clone();

        running.store(true, Ordering::Relaxed);

        std::thread::spawn(move || {
            if let Err(e) = run_detection_loop(
                &access_key,
                sensitivity,
                keyword_path.as_deref(),
                &running,
                &app_handle,
            ) {
                log::error!("Wake word engine error: {}", e);
                running.store(false, Ordering::Relaxed);
            }
        });

        log::info!(
            "Wake word engine started (sensitivity: {})",
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

/// Core detection loop — runs in a dedicated thread
fn run_detection_loop(
    access_key: &str,
    sensitivity: f32,
    keyword_path: Option<&str>,
    running: &Arc<AtomicBool>,
    app_handle: &AppHandle,
) -> Result<(), String> {
    // Initialize Porcupine
    let porcupine = if let Some(kw_path) = keyword_path {
        pv_porcupine::PorcupineBuilder::new_with_keyword_paths(access_key, &[kw_path])
            .sensitivities(&[sensitivity])
            .init()
            .map_err(|e| format!("Porcupine init failed: {}", e))?
    } else {
        // Use built-in "porcupine" keyword as fallback
        // Users should provide a custom "Hey Forge" .ppn file
        pv_porcupine::PorcupineBuilder::new_with_keywords(
            access_key,
            &[pv_porcupine::BuiltinKeywords::Porcupine],
        )
        .sensitivities(&[sensitivity])
        .init()
        .map_err(|e| format!("Porcupine init failed: {}", e))?
    };

    let frame_length = porcupine.frame_length() as usize;
    let sample_rate = porcupine.sample_rate();

    // Set up audio capture
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
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Fixed(frame_length as u32),
    };

    // Audio buffer shared between callback and processing
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<i16>>(16);

    let stream = device
        .build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Convert f32 samples to i16
                let samples: Vec<i16> = data.iter().map(|&s| (s * 32767.0) as i16).collect();
                let _ = tx.try_send(samples);
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

    log::info!("Wake word: audio stream active, listening...");

    // Processing loop
    let mut buffer: Vec<i16> = Vec::with_capacity(frame_length);

    while running.load(Ordering::Relaxed) {
        match rx.recv_timeout(std::time::Duration::from_millis(100)) {
            Ok(samples) => {
                buffer.extend_from_slice(&samples);

                // Process full frames
                while buffer.len() >= frame_length {
                    let frame: Vec<i16> = buffer.drain(..frame_length).collect();

                    match porcupine.process(&frame) {
                        Ok(keyword_index) if keyword_index >= 0 => {
                            log::info!("Wake word detected! (keyword index: {})", keyword_index);

                            let event = WakeWordEvent {
                                keyword: "Hey Forge".to_string(),
                                timestamp: chrono::Utc::now().to_rfc3339(),
                            };

                            let _ = app_handle.emit("wake-word-detected", event);

                            // Brief cooldown to prevent repeated triggers
                            std::thread::sleep(std::time::Duration::from_secs(2));
                        }
                        Ok(_) => {} // No detection
                        Err(e) => {
                            log::error!("Porcupine process error: {}", e);
                        }
                    }
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
