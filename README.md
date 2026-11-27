# Sonora
 
Sonora es un reproductor de música local de escritorio, hecho con **Tauri 2** (backend en Rust y interfaz web en HTML, CSS y JavaScript sin frameworks). Lee las carpetas de música que le indiques, organiza tu biblioteca por canciones, álbumes y artistas, y reproduce todo sin conexión a internet.
 
## Características
 
- Formatos: MP3, FLAC, WAV, OGG, Opus, M4A y AAC. La reproducción usa el motor multimedia del sistema, así que la compatibilidad exacta depende del WebView de cada sistema operativo.
- Biblioteca: escaneo de una o varias carpetas con sus subcarpetas, etiquetas y portadas incluidas, con caché para abrir rápido.
- Vistas: canciones (lista virtualizada, filtro instantáneo y ordenación), álbumes, artistas y búsqueda sin distinguir mayúsculas ni acentos.
- Fila de reproducción: salta a cualquier canción, quita canciones, límpiala, guárdala como playlist y reordénala arrastrando las canciones. Funciona en la página **Fila** y en el panel lateral.
- Arrastrar a la fila: arrastra canciones (desde cualquier lista) o álbumes y artistas (desde sus tarjetas) hasta la pestaña **Fila** del panel derecho. Una línea marca dónde se insertarán; el panel se desplaza solo al acercarte a sus bordes y `Esc` cancela. Si el panel está en **Detalles** no acepta canciones (el cursor muestra "no permitido"); si no hay nada sonando, se agregan y empiezan a sonar.
- Scroll por página: al navegar (barra lateral, álbumes, artistas, atrás/adelante, búsqueda) cada página recupera el punto exacto donde la dejaste.
- Aleatorio: reordena de verdad la fila y la restaura al desactivarlo.
- Playlists M3U: crea, renombra, elimina, agrega y quita canciones, e importa archivos `.m3u` y `.m3u8`. Cada playlist es un archivo real. Las páginas de álbum y artista tienen un botón **A playlist** para agregar todo su contenido.
- Ecualizador de 5 bandas con curva interactiva, ancho (Q) de las bandas medias, conversión estéreo/mono, presets incluidos y presets propios.
- Tema claro y oscuro.
## Atajos de teclado
 
| Atajo | Acción |
| --- | --- |
| `Espacio` | Reproducir / pausa |
| `←` `→` | Retroceder / avanzar 5 s |
| `Ctrl+←` `Ctrl+→` | Anterior / siguiente canción |
| `↑` `↓` | Subir / bajar volumen |
| `Alt+←` `Alt+→` | Atrás / adelante entre vistas |
| `M` | Silenciar |
| `Ctrl+F` | Buscar |
 
La barra de volumen también responde a la rueda del ratón, y los botones laterales del ratón navegan entre vistas.
 
## Requisitos
 
Necesitas tres cosas: **Node.js**, **Rust** y las dependencias de sistema de Tauri. El orden de instalación no importa, pero conviene abrir una terminal nueva al terminar para que todas las herramientas queden disponibles.
 
### 1. Node.js 18 o superior
 
Descárgalo desde <https://nodejs.org> (versión LTS) y comprueba la instalación:
 
```bash
node --version
npm --version
```
 
### 2. Rust (versión estable)
 
Instálalo con rustup desde <https://rustup.rs>. En Linux y macOS:
 
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
 
En Windows, descarga y ejecuta `rustup-init.exe` desde la misma página. Después comprueba:
 
```bash
rustc --version
cargo --version
```
 
### 3. Dependencias de sistema
 
**Windows**
 
1. Instala las *Microsoft C++ Build Tools* desde <https://visualstudio.microsoft.com/visual-cpp-build-tools/> y marca la carga de trabajo **Desarrollo para el escritorio con C++**.
2. WebView2 ya viene incluido en Windows 10 (versión 1803 o posterior) y en Windows 11. Si no lo tienes, instálalo desde <https://developer.microsoft.com/microsoft-edge/webview2/>.
3. Si Rust se instaló con el toolchain GNU, cambia al de MSVC:
```bash
rustup default stable-msvc
```
 
**macOS**
 
```bash
xcode-select --install
```
 
**Linux (Debian / Ubuntu)**
 
```bash
sudo apt update
sudo apt install -y build-essential curl wget file pkg-config libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev libxdo-dev libayatana-appindicator3-dev patchelf
```
 
Para que suene el audio hace falta que el WebView tenga códecs de GStreamer:
 
```bash
sudo apt install -y gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```
 
Para Fedora, Arch y otras distribuciones consulta <https://v2.tauri.app/start/prerequisites/>.
 
## Instalar el proyecto
 
Desde la carpeta del proyecto (la que contiene `package.json`):
 
```bash
npm install
npm install --save-dev @tauri-apps/cli
```
 
Esto instala la CLI de Tauri (`@tauri-apps/cli`). Las dependencias de Rust se descargan solas la primera vez que compilas o ejecutas la aplicación.
 
## Probar la aplicación (modo desarrollo)
 
```bash
npm run dev
```
 
Se abre la ventana de Sonora. La primera ejecución tarda varios minutos porque compila todas las dependencias de Rust; las siguientes son mucho más rápidas. La interfaz se sirve desde la carpeta `src/`, así que al cambiar un archivo de `src/` basta con recargar la ventana (`Ctrl+R`, o `Cmd+R` en macOS). Los cambios en `src-tauri/` reinician la aplicación automáticamente.
 
> La interfaz necesita las APIs de Tauri, así que no funciona abriendo `src/index.html` directamente en un navegador. Hay que usar `npm run dev`.
 
### Lista de comprobación manual
 
Este proyecto no incluye pruebas automáticas. Para verificar que todo funciona, ejecuta `npm run dev` y revisa:
 
1. **Biblioteca:** pulsa **Biblioteca** en la barra lateral, luego **Agregar carpeta** y elige una carpeta con música. Debe aparecer el progreso del escaneo y, al terminar, las canciones, álbumes y artistas.
2. **Reproducción:** pulsa **Reproducir** en la vista Canciones. Comprueba pausa, anterior/siguiente, barra de progreso, volumen (con la barra, la rueda del ratón y las flechas `↑`/`↓`) y los atajos de teclado.
3. **Fila:** abre **Fila** en la barra lateral. Arrastra una canción a otra posición: el cursor pasa a la mano cerrada, una copia de la fila sigue al cursor y una línea marca el destino. Repite en la pestaña **Fila** del panel derecho. Pulsa `Esc` durante el arrastre para cancelarlo.
4. **Playlists:** abre un álbum o un artista y pulsa **A playlist**. Elige una playlist existente o **Nueva playlist…** y comprueba que las canciones aparecen en ella.
5. **Ecualizador:** pulsa el botón de ecualizador de la barra del reproductor, actívalo, aplica un preset y arrastra los puntos de la curva mientras suena una canción. El cambio debe oírse. Prueba también **Estéreo / Mono**: el sonido debe pasar a un único canal y volver a estéreo.
6. **Tema:** alterna entre claro y oscuro con el botón de la barra superior y revisa que ambos se vean bien.
7. **Arrastrar a la fila:** con una canción sonando, arrastra una fila de la lista de Canciones al panel derecho (pestaña **Fila**): debe aparecer la línea de destino y, al soltar, la canción queda en ese hueco sin interrumpir la reproducción. Repite con una tarjeta de **Álbumes** o **Artistas** (se insertan todas sus canciones) y comprueba que al soltar fuera del panel no ocurre nada ni se abre la página.
8. **Scroll por página:** baja en Canciones, ve a Álbumes, baja un poco y abre un álbum; al volver con la flecha atrás, o desde la barra lateral, cada página debe quedar donde la dejaste.
## Compilar el programa
 
Tauri compila para el sistema en el que lo ejecutas: el `.exe` se genera en Windows, la app de macOS en un Mac y los paquetes de Linux en Linux. No hay compilación cruzada sencilla.
 
```bash
npm run build
```
 
La primera compilación de producción también tarda varios minutos. Para generar un solo tipo de paquete:
 
```bash
npm run build -- --bundles nsis
```
 
Valores posibles: `nsis` y `msi` (Windows), `dmg` y `app` (macOS), `deb`, `rpm` y `appimage` (Linux).
 
### Dónde queda el resultado
 
Todo queda dentro de `src-tauri/target/release/`:
 
| Sistema | Ejecutable suelto | Instaladores (`bundle/`) |
| --- | --- | --- |
| Windows | `sonora.exe` | `bundle/nsis/Sonora_0.1.0_x64-setup.exe`, `bundle/msi/Sonora_0.1.0_x64_en-US.msi` |
| macOS | `bundle/macos/Sonora.app` | `bundle/dmg/Sonora_0.1.0_*.dmg` |
| Linux | `sonora` | `bundle/deb/*.deb`, `bundle/rpm/*.rpm`, `bundle/appimage/*.AppImage` |
 
El ejecutable suelto necesita WebView2 (Windows) o WebKitGTK (Linux) instalado en el equipo; los instaladores se encargan de eso.
 
## Solución de problemas
 
| Problema | Qué hacer |
| --- | --- |
| `linker 'link.exe' not found` en Windows | Instala las *Microsoft C++ Build Tools* con la carga de trabajo de C++ y usa el toolchain `stable-msvc`. |
| `webkit2gtk-4.1` no encontrado en Linux | Instala `libwebkit2gtk-4.1-dev` y las demás dependencias de la sección de Linux. |
| `cargo` o `rustc` no se reconocen | Abre una terminal nueva tras instalar Rust, o añade `~/.cargo/bin` al `PATH`. |
| Una canción no suena en Linux | Instala los plugins de GStreamer indicados arriba. |
| Una canción no suena en Windows o macOS | El formato depende del códec que tenga el WebView del sistema; prueba con MP3 o AAC. |
| El ecualizador no tiene efecto | Actívalo con el interruptor. Si el WebView no admite Web Audio, aparecerá como no disponible. |
| Windows SmartScreen o macOS Gatekeeper avisan al abrir el instalador | Es normal: la aplicación no está firmada. Para distribuirla hay que firmarla con un certificado de desarrollador. |
 
## Dónde se guardan los datos
 
En la carpeta de datos de la aplicación (`com.sonora.player`):
 
| Sistema | Ruta |
| --- | --- |
| Windows | `%APPDATA%\com.sonora.player` |
| macOS | `~/Library/Application Support/com.sonora.player` |
| Linux | `~/.local/share/com.sonora.player` |
 
Dentro hay `playlists/` (archivos `.m3u`), `covers/` (portadas extraídas), `config.json` y `library.json`. El tema, el volumen y los presets del ecualizador se guardan en el almacenamiento local de la aplicación.
 
## Estructura del proyecto
 
| Ruta | Contenido |
| --- | --- |
| `src/` | Interfaz: `index.html`, `styles.css` y los módulos de `src/js/` |
| `src/js/` | Reproductor, fila, vistas, ecualizador, playlists y utilidades |
| `src-tauri/src/` | Backend en Rust: escaneo de la biblioteca (`library.rs`) y playlists (`playlists.rs`) |
| `src-tauri/tauri.conf.json` | Configuración de la ventana, seguridad y empaquetado |
| `app-icon.png` | Icono original de 1024×1024 |
 
Para cambiar el icono, reemplaza `app-icon.png` y ejecuta:
 
```bash
npx tauri icon app-icon.png
```
