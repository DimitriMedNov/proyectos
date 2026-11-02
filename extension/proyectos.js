// Datos de los proyectos de ~/Proyectos: cuáles hay, cuál se tocó hace menos, su estado de git,
// su repositorio de GitHub y cómo se prende su servidor de desarrollo. Solo GLib/Gio, sin pantalla.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// La primera de estas carpetas que exista es donde viven los proyectos.
const CANDIDATAS = ['Proyectos', 'proyectos', 'Projects', 'projects', 'Code', 'code', 'dev', 'src', 'repos'];
export const PROYECTOS = CANDIDATAS.map(n => GLib.build_filenamev([GLib.get_home_dir(), n]))
    .find(r => GLib.file_test(r, GLib.FileTest.IS_DIR)) ?? GLib.build_filenamev([GLib.get_home_dir(), 'Proyectos']);

// El primer archivo de bloqueo (lockfile) que exista decide el gestor de paquetes.
const GESTORES = [
    ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'], ['package-lock.json', 'npm'],
];

function leer(ruta) {
    try {
        const [, bytes] = GLib.file_get_contents(ruta);
        return new TextDecoder().decode(bytes);
    } catch {
        return null; // no existe o no se puede leer
    }
}

function fechaCambio(ruta) {
    try {
        return Gio.File.new_for_path(ruta).query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint64('time::modified');
    } catch {
        return 0;
    }
}

// git@github.com:usuario/repo.git o https://github.com/usuario/repo.git → https://github.com/usuario/repo
export function urlGithub(textoConfig) {
    const m = textoConfig?.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/);
    if (!m)
        return null;
    const r = m[1].match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
    return r ? `https://github.com/${r[1]}` : null;
}

// Comando para prender el servidor de desarrollo, o null si el proyecto no tiene script "dev".
function comandoDev(ruta) {
    const texto = leer(GLib.build_filenamev([ruta, 'package.json']));
    if (!texto)
        return null;
    try {
        if (!JSON.parse(texto).scripts?.dev)
            return null;
    } catch {
        return null; // package.json roto
    }
    const gestor = GESTORES.find(([archivo]) => GLib.file_test(GLib.build_filenamev([ruta, archivo]), GLib.FileTest.EXISTS));
    return [gestor ? gestor[1] : 'npm', 'run', 'dev'];
}

// Lista de proyectos, del tocado más recientemente al más viejo. El estado de git se llena después.
export function listarProyectos() {
    const proyectos = [];
    let lista;
    try {
        lista = Gio.File.new_for_path(PROYECTOS).enumerate_children(
            'standard::name,standard::type,standard::is-hidden,time::modified', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return proyectos; // no existe ~/Proyectos
    }
    let info;
    while ((info = lista.next_file(null))) {
        if (info.get_file_type() !== Gio.FileType.DIRECTORY || info.get_is_hidden())
            continue;
        const ruta = GLib.build_filenamev([PROYECTOS, info.get_name()]);
        const git = GLib.file_test(GLib.build_filenamev([ruta, '.git']), GLib.FileTest.IS_DIR);
        proyectos.push({
            nombre: info.get_name(),
            ruta,
            git,
            github: git ? urlGithub(leer(GLib.build_filenamev([ruta, '.git', 'config']))) : null,
            dev: comandoDev(ruta),
            // El índice de git cambia con cada add/commit/checkout: mejor señal de uso que la carpeta sola.
            cambio: Math.max(info.get_attribute_uint64('time::modified'),
                git ? fechaCambio(GLib.build_filenamev([ruta, '.git', 'index'])) : 0),
            estado: null,
        });
    }
    lista.close(null);
    proyectos.sort((a, b) => b.cambio - a.cambio);
    return proyectos;
}

// Lee la salida de `git status --porcelain=v1 -b`: archivos sin commit y commits sin subir.
export function leerEstado(salida) {
    const lineas = salida.split('\n').filter(l => l.length);
    const rama = lineas[0]?.startsWith('## ') ? lineas.shift() : '';
    const adelante = Number(rama.match(/ahead (\d+)/)?.[1] ?? 0);
    return {cambios: lineas.length, sinSubir: adelante, sinRemoto: !rama.includes('...')};
}

// Pide el estado de git de un proyecto sin bloquear GNOME. alTerminar(estado | null).
export function estadoGit(ruta, cancelable, alTerminar) {
    let proceso;
    try {
        proceso = Gio.Subprocess.new(['git', '-C', ruta, 'status', '--porcelain=v1', '-b'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
    } catch (e) {
        logError(e, `Proyectos: no se pudo correr git en ${ruta}`);
        alTerminar(null);
        return;
    }
    proceso.communicate_utf8_async(null, cancelable, (_p, resultado) => {
        try {
            const [, salida] = proceso.communicate_utf8_finish(resultado);
            alTerminar(proceso.get_successful() ? leerEstado(salida ?? '') : null);
        } catch {
            alTerminar(null); // cancelado o git falló
        }
    });
}
