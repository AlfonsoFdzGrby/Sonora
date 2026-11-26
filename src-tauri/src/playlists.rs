use crate::library::Track;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Serialize)]
pub struct Playlist {
    pub name: String,
    pub paths: Vec<String>,
}

const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn clean_name(name: &str) -> Result<String, String> {
    let filtered: String = name
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*".contains(*c))
        .collect();
    let cleaned = filtered.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() {
        return Err("El nombre de la playlist no es válido".into());
    }
    if cleaned.chars().count() > 80 {
        return Err("El nombre de la playlist es demasiado largo".into());
    }
    if RESERVED.contains(&cleaned.to_uppercase().as_str()) {
        return Err("Ese nombre está reservado por el sistema".into());
    }
    Ok(cleaned)
}

fn is_playlist_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            e == "m3u" || e == "m3u8"
        })
        .unwrap_or(false)
}

fn file_for(dir: &Path, name: &str) -> PathBuf {
    let m3u = dir.join(format!("{name}.m3u"));
    let m3u8 = dir.join(format!("{name}.m3u8"));
    if !m3u.exists() && m3u8.exists() {
        m3u8
    } else {
        m3u
    }
}

fn exists(dir: &Path, name: &str) -> bool {
    dir.join(format!("{name}.m3u")).exists() || dir.join(format!("{name}.m3u8")).exists()
}

pub fn parse(content: &str, base: &Path) -> Vec<String> {
    content
        .trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            if Path::new(line).is_absolute() {
                line.to_string()
            } else {
                base.join(line).to_string_lossy().into_owned()
            }
        })
        .collect()
}

fn read_paths(file: &Path) -> Result<Vec<String>, String> {
    let bytes = fs::read(file).map_err(|e| format!("No se pudo leer la playlist: {e}"))?;
    let text = String::from_utf8_lossy(&bytes);
    Ok(parse(&text, file.parent().unwrap_or_else(|| Path::new(""))))
}

fn render(paths: &[String], tracks: &[Track]) -> String {
    let lookup: HashMap<&str, &Track> = tracks.iter().map(|t| (t.path.as_str(), t)).collect();
    let mut out = String::from("#EXTM3U\n");
    for path in paths {
        if let Some(track) = lookup.get(path.as_str()) {
            let label = if track.artist.is_empty() {
                track.title.clone()
            } else {
                format!("{} - {}", track.artist, track.title)
            };
            out.push_str(&format!(
                "#EXTINF:{},{}\n",
                track.duration_ms / 1000,
                label.replace(['\r', '\n'], " ")
            ));
        }
        out.push_str(&path.replace(['\r', '\n'], ""));
        out.push('\n');
    }
    out
}

fn write(file: &Path, paths: &[String], tracks: &[Track]) -> Result<(), String> {
    let tmp = file.with_extension("tmp");
    fs::write(&tmp, render(paths, tracks))
        .map_err(|e| format!("No se pudo guardar la playlist: {e}"))?;
    fs::rename(&tmp, file).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("No se pudo guardar la playlist: {e}")
    })
}

pub fn list(dir: &Path) -> Result<Vec<Playlist>, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut playlists: Vec<Playlist> = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || !is_playlist_file(&path) {
            continue;
        }
        let name = match path.file_stem() {
            Some(stem) => stem.to_string_lossy().into_owned(),
            None => continue,
        };
        if playlists.iter().any(|p| p.name == name) {
            continue;
        }
        let paths = read_paths(&path).unwrap_or_default();
        playlists.push(Playlist { name, paths });
    }
    playlists.sort_by_key(|p| p.name.to_lowercase());
    Ok(playlists)
}

pub fn unique_name(dir: &Path, name: &str) -> Result<String, String> {
    let base = clean_name(name)?;
    if !exists(dir, &base) {
        return Ok(base);
    }
    for index in 2..100 {
        let candidate = format!("{base} ({index})");
        if !exists(dir, &candidate) {
            return Ok(candidate);
        }
    }
    Err("No se pudo encontrar un nombre libre para la playlist".into())
}

pub fn create(
    dir: &Path,
    name: &str,
    paths: Vec<String>,
    tracks: &[Track],
) -> Result<Playlist, String> {
    let name = clean_name(name)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if exists(dir, &name) {
        return Err("Ya existe una playlist con ese nombre".into());
    }
    write(&file_for(dir, &name), &paths, tracks)?;
    Ok(Playlist { name, paths })
}

pub fn save(
    dir: &Path,
    name: &str,
    paths: Vec<String>,
    tracks: &[Track],
) -> Result<Playlist, String> {
    let name = clean_name(name)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write(&file_for(dir, &name), &paths, tracks)?;
    Ok(Playlist { name, paths })
}

pub fn rename(dir: &Path, old: &str, new: &str) -> Result<Playlist, String> {
    let old = clean_name(old)?;
    let new = clean_name(new)?;
    if !exists(dir, &old) {
        return Err("La playlist no existe".into());
    }
    let source = file_for(dir, &old);
    if old != new {
        if exists(dir, &new) && old.to_lowercase() != new.to_lowercase() {
            return Err("Ya existe una playlist con ese nombre".into());
        }
        let extension = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("m3u")
            .to_string();
        let target = dir.join(format!("{new}.{extension}"));
        fs::rename(&source, &target)
            .map_err(|e| format!("No se pudo renombrar la playlist: {e}"))?;
        let paths = read_paths(&target)?;
        return Ok(Playlist { name: new, paths });
    }
    let paths = read_paths(&source)?;
    Ok(Playlist { name: new, paths })
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    let name = clean_name(name)?;
    if !exists(dir, &name) {
        return Err("La playlist no existe".into());
    }
    fs::remove_file(file_for(dir, &name))
        .map_err(|e| format!("No se pudo eliminar la playlist: {e}"))
}
