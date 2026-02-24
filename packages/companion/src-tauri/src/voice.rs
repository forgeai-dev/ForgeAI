//! # Voice I/O Module
//!
//! Handles microphone capture → WAV encoding → send to Gateway STT,
//! and receives TTS audio from Gateway → plays back via speakers.
//! Uses cpal for capture and rodio for playback.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Captured audio result
#[derive(Clone, serde::Serialize)]
pub struct CapturedAudio {
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub samples: usize,
    /// Base64-encoded WAV data
    pub wav_base64: String,
}

/// Voice engine for capture and playback
pub struct VoiceEngine {
    recording: Arc<AtomicBool>,
    max_duration_secs: u32,
    silence_threshold: f32,
    silence_timeout_ms: u64,
}

impl VoiceEngine {
    pub fn new() -> Self {
        Self {
            recording: Arc::new(AtomicBool::new(false)),
            max_duration_secs: 30,
            silence_threshold: 0.01,
            silence_timeout_ms: 1500,
        }
    }

    /// Configure voice engine parameters
    pub fn configure(&mut self, max_duration_secs: u32, silence_threshold: f32, silence_timeout_ms: u64) {
        self.max_duration_secs = max_duration_secs;
        self.silence_threshold = silence_threshold;
        self.silence_timeout_ms = silence_timeout_ms;
    }

    /// Is currently recording?
    pub fn is_recording(&self) -> bool {
        self.recording.load(Ordering::Relaxed)
    }

    /// Stop recording
    pub fn stop_recording(&self) {
        self.recording.store(false, Ordering::Relaxed);
    }

    /// Record audio from microphone until silence or max duration.
    /// Returns base64-encoded WAV data ready to send to Gateway STT.
    pub fn record(&self) -> Result<CapturedAudio, String> {
        if self.recording.load(Ordering::Relaxed) {
            return Err("Already recording".into());
        }

        self.recording.store(true, Ordering::Relaxed);
        let recording = self.recording.clone();
        let max_samples = (16000 * self.max_duration_secs) as usize;
        let silence_threshold = self.silence_threshold;
        let silence_timeout_ms = self.silence_timeout_ms;

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or("No audio input device")?;

        let config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(16000),
            buffer_size: cpal::BufferSize::Default,
        };

        let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(64);

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let _ = tx.try_send(data.to_vec());
                },
                |err| log::error!("Audio capture error: {}", err),
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

        stream.play().map_err(|e| format!("Failed to start recording: {}", e))?;

        log::info!("Voice: recording started");

        let mut all_samples: Vec<f32> = Vec::with_capacity(max_samples);
        let mut last_voice_time = std::time::Instant::now();
        let start = std::time::Instant::now();

        // Capture loop — stops on silence, max duration, or manual stop
        while recording.load(Ordering::Relaxed) {
            match rx.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(samples) => {
                    // Check for voice activity (RMS energy)
                    let rms: f32 = (samples.iter().map(|s| s * s).sum::<f32>()
                        / samples.len() as f32)
                        .sqrt();

                    if rms > silence_threshold {
                        last_voice_time = std::time::Instant::now();
                    }

                    all_samples.extend_from_slice(&samples);

                    // Stop conditions
                    if all_samples.len() >= max_samples {
                        log::info!("Voice: max duration reached");
                        break;
                    }
                    if last_voice_time.elapsed().as_millis() as u64 > silence_timeout_ms
                        && all_samples.len() > 8000
                    {
                        log::info!("Voice: silence detected, stopping");
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if start.elapsed().as_secs() >= self.max_duration_secs as u64 {
                        break;
                    }
                    continue;
                }
                Err(_) => break,
            }
        }

        drop(stream);
        recording.store(false, Ordering::Relaxed);

        let duration_ms = (all_samples.len() as f64 / 16.0) as u64;
        log::info!(
            "Voice: recorded {} samples ({}ms)",
            all_samples.len(),
            duration_ms
        );

        if all_samples.len() < 1600 {
            return Err("Recording too short (< 100ms)".into());
        }

        // Encode to WAV
        let wav_data = encode_wav(&all_samples, 16000)?;
        let wav_base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &wav_data);

        Ok(CapturedAudio {
            duration_ms,
            sample_rate: 16000,
            samples: all_samples.len(),
            wav_base64,
        })
    }

    /// Send recorded audio to Gateway for STT transcription
    pub async fn transcribe(
        &self,
        gateway_url: &str,
        jwt_token: &str,
        audio: &CapturedAudio,
    ) -> Result<String, String> {
        let url = format!("{}/api/voice/transcribe", gateway_url.trim_end_matches('/'));

        let wav_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &audio.wav_base64,
        )
        .map_err(|e| format!("Base64 decode error: {}", e))?;

        // Build multipart form
        let part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| format!("MIME error: {}", e))?;

        let form = reqwest::multipart::Form::new().part("audio", part);

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Cookie", format!("forgeai_session={}", jwt_token))
            .multipart(form)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Transcribe request failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Transcription failed: {}", text));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Parse error: {}", e))?;

        data["text"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or("No transcription text in response".into())
    }

    /// Request TTS from Gateway and play the audio
    pub async fn speak(
        &self,
        gateway_url: &str,
        jwt_token: &str,
        text: &str,
    ) -> Result<(), String> {
        let url = format!(
            "{}/api/voice/synthesize",
            gateway_url.trim_end_matches('/')
        );

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("Cookie", format!("forgeai_session={}", jwt_token))
            .json(&serde_json::json!({ "text": text }))
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("TTS request failed: {}", e))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("TTS failed: {}", text));
        }

        let audio_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Read audio failed: {}", e))?;

        // Play audio using rodio
        play_audio(&audio_bytes)?;

        Ok(())
    }
}

/// Encode f32 samples to WAV bytes
fn encode_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::new();
    {
        let cursor = Cursor::new(&mut buffer);
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer =
            hound::WavWriter::new(cursor, spec).map_err(|e| format!("WAV writer error: {}", e))?;

        for &sample in samples {
            let s16 = (sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
            writer
                .write_sample(s16)
                .map_err(|e| format!("WAV write error: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("WAV finalize error: {}", e))?;
    }
    Ok(buffer)
}

/// Play audio bytes (WAV format) through the default output device
fn play_audio(audio_bytes: &[u8]) -> Result<(), String> {
    let (_stream, stream_handle) = rodio::OutputStream::try_default()
        .map_err(|e| format!("Audio output error: {}", e))?;

    let cursor = Cursor::new(audio_bytes.to_vec());
    let source = rodio::Decoder::new(cursor)
        .map_err(|e| format!("Audio decode error: {}", e))?;

    let sink = rodio::Sink::try_new(&stream_handle)
        .map_err(|e| format!("Sink error: {}", e))?;

    sink.append(source);
    sink.sleep_until_end();

    Ok(())
}

/// List available audio output devices
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}
