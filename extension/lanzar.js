// Abrir cosas desde el menú: Claude Code o el servidor de desarrollo en una terminal,
// el editor y la página de GitHub. Cada función lanza un Error en español si no puede.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAVEGADOR = 'brave-browser.desktop';
// El primer editor instalado de esta lista es el que se abre.
const EDITORES = ['code', 'code-oss', 'cursor', 'codium', 'zed', 'gnome-text-editor'];

// Ghostty va primero. Ojo con Ptyxis: "--new-window" junto con "-- comando" abre dos ventanas.
// Cada terminal pide la carpeta y el comando de forma distinta. Se usa la primera que esté instalada.
const TERMINALES = [
    ['ghostty', (dir, cmd) => [`--working-directory=${dir}`, '-e', ...cmd]],
    ['ptyxis', (dir, cmd) => ['-d', dir, '--', ...cmd]],
    ['gnome-terminal', (dir, cmd) => [`--working-directory=${dir}`, '--', ...cmd]],
    ['kgx', (dir, cmd) => [`--working-directory=${dir}`, '--', ...cmd]],
    ['kitty', (dir, cmd) => ['--directory', dir, ...cmd]],
    ['alacritty', (dir, cmd) => ['--working-directory', dir, '-e', ...cmd]],
    ['wezterm', (dir, cmd) => ['start', '--cwd', dir, '--', ...cmd]],
];

// Busca en el PATH y en las carpetas donde se instalan bun y Claude Code.
function programa(nombre) {
    const casa = GLib.get_home_dir();
    for (const ruta of [GLib.find_program_in_path(nombre),
        GLib.build_filenamev([casa, '.local', 'bin', nombre]),
        GLib.build_filenamev([casa, '.bun', 'bin', nombre])]) {
        if (ruta && GLib.file_test(ruta, GLib.FileTest.IS_EXECUTABLE))
            return ruta;
    }
    return null;
}

function lanzar(carpeta, argv) {
    const lanzador = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    lanzador.set_cwd(carpeta);
    lanzador.spawnv(argv);
}

function enTerminal(carpeta, comando) {
    for (const [nombre, argumentos] of TERMINALES) {
        const terminal = programa(nombre);
        if (terminal) {
            lanzar(carpeta, [terminal, ...argumentos(carpeta, comando)]);
            return;
        }
    }
    throw new Error('No encontré una terminal instalada (ghostty, ptyxis, gnome-terminal, kgx, kitty, alacritty o wezterm).');
}

export function abrirClaude(carpeta) {
    const claude = programa('claude');
    if (!claude)
        throw new Error('No encontré el comando claude. Instala Claude Code o revisa que esté en ~/.local/bin.');
    enTerminal(carpeta, [claude]);
    abrirEditor(carpeta); // Claude en la terminal y el código al lado, en el editor
}

export function abrirEditor(carpeta) {
    const editor = EDITORES.map(programa).find(Boolean);
    if (!editor)
        throw new Error('No encontré un editor (VS Code, Cursor, Zed o Editor de texto).');
    lanzar(carpeta, [editor, carpeta]);
}

// comando = ['bun', 'run', 'dev'] por ejemplo. Si el gestor del proyecto no está instalado
// (p. ej. pnpm), se usa bun o npm: los dos corren "run dev" igual.
export function prenderServidor(carpeta, [gestor, ...resto]) {
    const ruta = [gestor, 'bun', 'npm'].map(programa).find(Boolean);
    if (!ruta)
        throw new Error(`No encontré ${gestor}, bun ni npm para prender el servidor.`);
    enTerminal(carpeta, [ruta, ...resto]);
}

export function abrirUrl(url) {
    const app = Gio.DesktopAppInfo.new(NAVEGADOR);
    if (app)
        app.launch_uris([url], global.create_app_launch_context(0, -1));
    else
        Gio.AppInfo.launch_default_for_uri(url, null); // sin Brave: el navegador por defecto
}
