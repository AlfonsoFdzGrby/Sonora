const tauri = window.__TAURI__;

export const invoke = (command, args) => tauri.core.invoke(command, args);

export const fileUrl = (path) => tauri.core.convertFileSrc(path);

export const listen = (event, handler) => tauri.event.listen(event, (e) => handler(e.payload));

export async function pickDirectory() {
  const selected = await tauri.dialog.open({
    directory: true,
    multiple: false,
    title: 'Selecciona una carpeta de música',
  });
  return typeof selected === 'string' ? selected : null;
}

export async function pickPlaylistFile() {
  const selected = await tauri.dialog.open({
    directory: false,
    multiple: false,
    title: 'Selecciona una playlist .m3u',
    filters: [{ name: 'Playlists M3U', extensions: ['m3u', 'm3u8'] }],
  });
  return typeof selected === 'string' ? selected : null;
}
