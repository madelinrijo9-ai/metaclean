#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use keyring::Entry;
use base64::{Engine as _, engine::general_purpose};

#[tauri::command]
fn save_secret(service: String, username: String, secret: String) -> Result<(), String> {
    let entry = Entry::new(&service, &username).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_secret(service: String, username: String) -> Result<String, String> {
    let entry = Entry::new(&service, &username).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_secret(service: String, username: String) -> Result<(), String> {
    let entry = Entry::new(&service, &username).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file_native(path: String, data: String) -> Result<(), String> {
    let decoded = general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, decoded).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(())
    }
}

fn safe_path_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

#[tauri::command]
fn save_cleaned_song(
    filename: String,
    artist: Option<String>,
    album: Option<String>,
    data: String,
) -> Result<String, String> {
    let mut path = dirs::download_dir().ok_or_else(|| "Could not locate Downloads directory".to_string())?;
    
    path.push("MetaClean");
    
    let artist_str = artist.unwrap_or_default().trim().to_string();
    let album_str = album.unwrap_or_default().trim().to_string();
    
    let subfolder = if !artist_str.is_empty() && !album_str.is_empty() {
        format!("{} - {}", artist_str, album_str)
    } else if !artist_str.is_empty() {
        artist_str
    } else if !album_str.is_empty() {
        album_str
    } else {
        "Cleaned".to_string()
    };
    
    let safe_subfolder = safe_path_name(&subfolder);
    path.push(safe_subfolder);
    
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    
    path.push(filename);
    
    let decoded = general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| e.to_string())?;
    
    std::fs::write(&path, decoded).map_err(|e| e.to_string())?;
    
    Ok(path.to_string_lossy().into_owned())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle();
            
            // Standard App Menu (Mac only)
            #[cfg(target_os = "macos")]
            let app_submenu = Submenu::new(
                handle,
                "MetaClean",
                true,
            )?;
            
            let file_submenu = Submenu::new(
                handle,
                "File",
                true,
            )?;
            
            let edit_submenu = Submenu::new(
                handle,
                "Edit",
                true,
            )?;
            
            let window_submenu = Submenu::new(
                handle,
                "Window",
                true,
            )?;
            
            // Populate Edit menu (vital for input text boxes copy/paste on macOS)
            edit_submenu.append(&PredefinedMenuItem::undo(handle, None)?)?;
            edit_submenu.append(&PredefinedMenuItem::redo(handle, None)?)?;
            edit_submenu.append(&PredefinedMenuItem::separator(handle)?)?;
            edit_submenu.append(&PredefinedMenuItem::cut(handle, None)?)?;
            edit_submenu.append(&PredefinedMenuItem::copy(handle, None)?)?;
            edit_submenu.append(&PredefinedMenuItem::paste(handle, None)?)?;
            edit_submenu.append(&PredefinedMenuItem::select_all(handle, None)?)?;
            
            // Populate Window menu
            window_submenu.append(&PredefinedMenuItem::minimize(handle, None)?)?;
            window_submenu.append(&PredefinedMenuItem::separator(handle)?)?;
            
            // Populate File menu
            file_submenu.append(&PredefinedMenuItem::close_window(handle, None)?)?;
            
            #[cfg(target_os = "macos")]
            {
                app_submenu.append(&PredefinedMenuItem::about(handle, None, None)?)?;
                app_submenu.append(&PredefinedMenuItem::separator(handle)?)?;
                app_submenu.append(&PredefinedMenuItem::hide(handle, None)?)?;
                app_submenu.append(&PredefinedMenuItem::hide_others(handle, None)?)?;
                app_submenu.append(&PredefinedMenuItem::separator(handle)?)?;
                app_submenu.append(&PredefinedMenuItem::quit(handle, None)?)?;
            }
            
            let menu = Menu::new(handle)?;
            #[cfg(target_os = "macos")]
            menu.append(&app_submenu)?;
            menu.append(&file_submenu)?;
            menu.append(&edit_submenu)?;
            menu.append(&window_submenu)?;
            
            app.set_menu(menu)?;
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_secret,
            get_secret,
            delete_secret,
            save_file_native,
            save_cleaned_song,
            open_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
