mod library;
mod playlists;

use library::Track;
use playlists::Playlist;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Config {
    directories: Vec<String>,
}

struct AppState {
    root: PathBuf,
    directories: Mutex<Vec<String>>,
    tracks: Mutex<Vec<Track>>,
    scanning: AtomicBool,
}

impl AppState {
    fn covers_dir(&self) -> PathBuf {
        self.root.join("covers")
    }

    fn playlists_dir(&self) -> PathBuf {
        self.root.join("playlists")
    }

    fn config_file(&self) -> PathBuf {
        self.root.join("config.json")
    }

    fn library_file(&self) -> PathBuf {
        self.root.join("library.json")
    }

    fn save_config(&self) -> Result<(), String> {
        let config = Config {
            directories: self.directories.lock().unwrap().clone(),
        };
        let data = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(self.config_file(), data).map_err(|e| e.to_string())
    }

    fn save_library(&self, tracks: &[Track]) {
        if let Ok(data) = serde_json::to_vec(tracks) {
            let _ = fs::write(self.library_file(), data);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackView {
    #[serde(flatten)]
    track: Track,
    cover_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    directories: Vec<String>,
    tracks: Vec<TrackView>,
    playlists_dir: String,
}

#[derive(Clone, Serialize)]
struct ScanProgress {
    done: usize,
    total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    name: String,
    total: usize,
    imported: usize,
    skipped: usize,
    missing: Vec<String>,
}

fn to_views(tracks: Vec<Track>, covers: &Path) -> Vec<TrackView> {
    tracks
        .into_iter()
        .map(|track| {
            let cover_path = track
                .cover
                .as_ref()
                .map(|name| covers.join(name).to_string_lossy().into_owned());
            TrackView { track, cover_path }
        })
        .collect()
}

fn load_config(root: &Path) -> Config {
    fs::read(root.join("config.json"))
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

fn load_tracks(root: &Path) -> Vec<Track> {
    fs::read(root.join("library.json"))
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}

fn normalized_key(path: &str) -> String {
    path.replace('\\', "/")
        .trim()
        .trim_start_matches('/')
        .to_lowercase()
}

fn file_name(key: &str) -> &str {
    key.rsplit('/').next().unwrap_or(key)
}

// Cuántos componentes coinciden desde el final: permite encontrar la canción
// aunque el .m3u venga de otra carpeta o de otro sistema operativo.
fn suffix_score(candidate: &str, track: &str) -> usize {
    candidate
        .split('/')
        .rev()
        .zip(track.split('/').rev())
        .take_while(|(a, b)| a == b)
        .count()
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> Snapshot {
    let tracks = state.tracks.lock().unwrap().clone();
    Snapshot {
        directories: state.directories.lock().unwrap().clone(),
        tracks: to_views(tracks, &state.covers_dir()),
        playlists_dir: state.playlists_dir().to_string_lossy().into_owned(),
    }
}

#[tauri::command]
fn add_directory(
    app: AppHandle,
    state: State<AppState>,
    path: String,
) -> Result<Vec<String>, String> {
    if !Path::new(&path).is_dir() {
        return Err("La carpeta seleccionada no existe".into());
    }
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())?;
    {
        let mut directories = state.directories.lock().unwrap();
        if directories.contains(&path) {
            return Err("Esa carpeta ya está en la biblioteca".into());
        }
        directories.push(path);
    }
    state.save_config()?;
    Ok(state.directories.lock().unwrap().clone())
}

#[tauri::command]
fn remove_directory(state: State<AppState>, path: String) -> Result<Vec<String>, String> {
    state.directories.lock().unwrap().retain(|d| d != &path);
    state.save_config()?;
    Ok(state.directories.lock().unwrap().clone())
}

#[tauri::command]
async fn scan_library(app: AppHandle) -> Result<Vec<TrackView>, String> {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("Ya hay un escaneo en curso".into());
    }

    let directories = state.directories.lock().unwrap().clone();
    let previous: HashMap<String, Track> = state
        .tracks
        .lock()
        .unwrap()
        .iter()
        .map(|t| (t.path.clone(), t.clone()))
        .collect();
    let covers = state.covers_dir();
    let emitter = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        library::scan(&directories, &covers, &previous, |done, total| {
            let _ = emitter.emit("scan-progress", ScanProgress { done, total });
        })
    })
    .await;

    state.scanning.store(false, Ordering::SeqCst);
    let tracks = result.map_err(|e| e.to_string())?;

    state.save_library(&tracks);
    *state.tracks.lock().unwrap() = tracks.clone();
    Ok(to_views(tracks, &state.covers_dir()))
}

#[tauri::command]
fn list_playlists(state: State<AppState>) -> Result<Vec<Playlist>, String> {
    playlists::list(&state.playlists_dir())
}

#[tauri::command]
fn create_playlist(
    state: State<AppState>,
    name: String,
    paths: Option<Vec<String>>,
) -> Result<Playlist, String> {
    let tracks = state.tracks.lock().unwrap().clone();
    playlists::create(
        &state.playlists_dir(),
        &name,
        paths.unwrap_or_default(),
        &tracks,
    )
}

#[tauri::command]
fn save_playlist(
    state: State<AppState>,
    name: String,
    paths: Vec<String>,
) -> Result<Playlist, String> {
    let tracks = state.tracks.lock().unwrap().clone();
    playlists::save(&state.playlists_dir(), &name, paths, &tracks)
}

#[tauri::command]
fn rename_playlist(
    state: State<AppState>,
    old_name: String,
    new_name: String,
) -> Result<Playlist, String> {
    playlists::rename(&state.playlists_dir(), &old_name, &new_name)
}

#[tauri::command]
fn delete_playlist(state: State<AppState>, name: String) -> Result<(), String> {
    playlists::delete(&state.playlists_dir(), &name)
}

#[tauri::command]
fn import_playlist(state: State<AppState>, path: String) -> Result<ImportResult, String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err("El archivo .m3u seleccionado no existe".into());
    }
    let bytes = fs::read(&file).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    let base = file.parent().unwrap_or_else(|| Path::new(""));
    let lines = playlists::parse(&text, base);
    let total = lines.len();

    let tracks = state.tracks.lock().unwrap().clone();
    let mut exact: HashMap<String, String> = HashMap::new();
    let mut by_name: HashMap<String, Vec<String>> = HashMap::new();
    for track in &tracks {
        let key = normalized_key(&track.path);
        exact.insert(key.clone(), track.path.clone());
        by_name
            .entry(file_name(&key).to_string())
            .or_default()
            .push(track.path.clone());
    }

    let mut paths: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut missing: Vec<String> = Vec::new();
    for line in lines {
        let key = normalized_key(&line);
        if key.contains("://") {
            continue; // emisoras/URLs no se pueden adaptar a archivos locales
        }
        let name = file_name(&key).to_string();
        let matched = exact.get(&key).cloned().or_else(|| {
            by_name.get(&name).and_then(|candidates| {
                candidates
                    .iter()
                    .max_by_key(|candidate| suffix_score(&key, &normalized_key(candidate)))
                    .cloned()
            })
        });
        if let Some(track_path) = matched {
            if seen.insert(track_path.clone()) {
                paths.push(track_path);
            }
        } else if missing.len() < 5 {
            missing.push(name);
        }
    }

    let stem = file
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Playlist importada".into());
    let name = playlists::unique_name(&state.playlists_dir(), &stem)?;
    let playlist = playlists::create(&state.playlists_dir(), &name, paths.clone(), &tracks)?;
    Ok(ImportResult {
        name: playlist.name,
        total,
        imported: paths.len(),
        skipped: total.saturating_sub(paths.len()),
        missing,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            fs::create_dir_all(root.join("covers"))?;
            fs::create_dir_all(root.join("playlists"))?;

            let directories = load_config(&root).directories;
            let tracks = load_tracks(&root);

            let scope = app.asset_protocol_scope();
            let _ = scope.allow_directory(root.join("covers"), true);
            for directory in &directories {
                let _ = scope.allow_directory(directory, true);
            }

            app.manage(AppState {
                root,
                directories: Mutex::new(directories),
                tracks: Mutex::new(tracks),
                scanning: AtomicBool::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            add_directory,
            remove_directory,
            scan_library,
            list_playlists,
            create_playlist,
            save_playlist,
            rename_playlist,
            delete_playlist,
            import_playlist,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación");
}
