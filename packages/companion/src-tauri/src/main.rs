//! # ForgeAI Desktop Companion — Main Entry Point
//!
//! Lightweight native Windows assistant powered by Tauri.
//! Runs in system tray, activates on wake word or click.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod connection;
mod local_actions;
mod safety;
mod voice;
mod wake_word;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .manage(commands::WakeWordState(std::sync::Mutex::new(
            wake_word::WakeWordEngine::new(),
        )))
        .manage(commands::VoiceState(std::sync::Mutex::new(
            voice::VoiceEngine::new(),
        )))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second instance tried to launch — focus existing window instead
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            commands::execute_action,
            commands::check_safety,
            commands::get_safety_prompt,
            commands::get_status,
            commands::pair_with_gateway,
            commands::chat_send,
            commands::chat_voice,
            commands::play_tts,
            commands::window_start_drag,
            commands::window_minimize,
            commands::window_hide,
            commands::window_maximize,
            commands::disconnect,
            commands::get_system_info,
            commands::wake_word_start,
            commands::wake_word_stop,
            commands::wake_word_status,
            commands::wake_word_configure,
            commands::voice_record,
            commands::voice_stop,
            commands::voice_speak,
            commands::read_screenshot,
            commands::list_sessions,
            commands::get_session_history,
            commands::delete_session,
            commands::list_audio_devices,
            commands::connect_gateway_ws,
            commands::force_reconnect_gateway_ws,
        ])
        .setup(|app| {
            // ─── System Tray ───
            let toggle = MenuItem::with_id(app, "toggle", "Mostrar/ocultar janela", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("ForgeAI Companion")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, tauri::tray::TrayIconEvent::Click { .. }) {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            log::info!("ForgeAI Companion started — system tray active");

            // Auto-connect Gateway WS if credentials exist
            commands::spawn_gateway_ws();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ForgeAI Companion");
}
