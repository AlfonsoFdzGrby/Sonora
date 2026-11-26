use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::PictureType;
use lofty::prelude::*;
use lofty::tag::{ItemKey, Tag};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::panic::{self, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "aac"];

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub year: Option<u32>,
    pub track_no: Option<u32>,
    pub disc_no: Option<u32>,
    pub duration_ms: u64,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub cover: Option<String>,
    pub mtime: u64,
    pub size: u64,
}

pub fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub fn scan<F: FnMut(usize, usize)>(
    dirs: &[String],
    covers: &Path,
    previous: &HashMap<String, Track>,
    mut progress: F,
) -> Vec<Track> {
    let mut seen = HashSet::new();
    let mut files: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        for entry in WalkDir::new(dir)
            .follow_links(true)
            .into_iter()
            .filter_map(Result::ok)
        {
            if entry.file_type().is_file()
                && is_audio(entry.path())
                && seen.insert(entry.path().to_path_buf())
            {
                files.push(entry.into_path());
            }
        }
    }

    let total = files.len();
    progress(0, total);
    let mut tracks = Vec::with_capacity(total);

    for (index, file) in files.iter().enumerate() {
        let key = file.to_string_lossy().into_owned();
        let (mtime, size) = stamp(file);
        match previous.get(&key) {
            Some(old) if old.mtime == mtime && old.size == size && cover_exists(old, covers) => {
                tracks.push(old.clone())
            }
            _ => tracks.push(read_track(file, covers, mtime, size)),
        }
        if (index + 1) % 25 == 0 {
            progress(index + 1, total);
        }
    }

    progress(total, total);
    tracks
}

fn stamp(path: &Path) -> (u64, u64) {
    match fs::metadata(path) {
        Ok(meta) => {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (mtime, meta.len())
        }
        Err(_) => (0, 0),
    }
}

fn cover_exists(track: &Track, covers: &Path) -> bool {
    match &track.cover {
        Some(name) => covers.join(name).exists(),
        None => true,
    }
}

fn clean(value: Option<impl AsRef<str>>) -> String {
    value
        .map(|s| s.as_ref().trim().to_string())
        .unwrap_or_default()
}

fn read_track(path: &Path, covers: &Path, mtime: u64, size: u64) -> Track {
    let mut track = Track {
        path: path.to_string_lossy().into_owned(),
        title: path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        format: path
            .extension()
            .map(|e| e.to_string_lossy().to_uppercase())
            .unwrap_or_default(),
        mtime,
        size,
        ..Track::default()
    };

    let parsed = panic::catch_unwind(AssertUnwindSafe(|| lofty::read_from_path(path)));
    let tagged = match parsed {
        Ok(Ok(tagged)) => tagged,
        _ => return track,
    };

    let props = tagged.properties();
    track.duration_ms = props.duration().as_millis() as u64;
    track.bitrate = props.audio_bitrate();
    track.sample_rate = props.sample_rate();
    track.channels = props.channels();
    track.bit_depth = props.bit_depth();

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        let title = clean(tag.title());
        if !title.is_empty() {
            track.title = title;
        }
        track.artist = clean(tag.artist());
        track.album = clean(tag.album());
        track.album_artist = clean(tag.get_string(&ItemKey::AlbumArtist));
        track.genre = clean(tag.genre());
        track.year = tag.year().filter(|y| *y > 0);
        track.track_no = tag.track();
        track.disc_no = tag.disk();
        track.cover = save_cover(tag, covers);
    }

    track
}

fn save_cover(tag: &Tag, covers: &Path) -> Option<String> {
    let pictures = tag.pictures();
    let picture = pictures
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| pictures.first())?;
    let data = picture.data();
    let extension = image_extension(data)?;
    let name = format!("{:016x}.{}", fnv1a(data), extension);
    let target = covers.join(&name);
    if !target.exists() {
        fs::create_dir_all(covers).ok()?;
        fs::write(&target, data).ok()?;
    }
    Some(name)
}

fn image_extension(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if data.starts_with(b"GIF8") {
        Some("gif")
    } else if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("webp")
    } else if data.starts_with(b"BM") {
        Some("bmp")
    } else {
        None
    }
}

fn fnv1a(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in data {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
