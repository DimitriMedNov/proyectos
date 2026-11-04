// Una fila del menú: nombre del proyecto, su estado de git y los botones Claude, editor, servidor y GitHub.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export function etiqueta(texto, clase, params = {}) {
    return new St.Label({text: texto, style_class: clase, y_align: Clutter.ActorAlign.CENTER, ...params});
}

export function filaFija() {
    return new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
}

// ¿El proyecto tiene trabajo que se perdería si se borra la carpeta?
export function pendiente(p) {
    return p.git && p.estado !== null && (p.estado.cambios > 0 || p.estado.sinSubir > 0 || p.estado.sinRemoto);
}

// Texto y clase de color del estado de git.
export function textoEstado(p) {
    if (!p.git)
        return ['sin git: no hay copia en GitHub', 'pr-aviso'];
    if (p.estado === null)
        return ['revisando…', 'pr-detalle'];
    const partes = [];
    if (p.estado.cambios)
        partes.push(p.estado.cambios === 1 ? '1 cambio sin commit' : `${p.estado.cambios} cambios sin commit`);
    if (p.estado.sinRemoto)
        partes.push('nunca subido a GitHub');
    else if (p.estado.sinSubir)
        partes.push(p.estado.sinSubir === 1 ? '1 commit sin subir' : `${p.estado.sinSubir} commits sin subir`);
    return partes.length ? [partes.join(' · '), 'pr-aviso'] : ['al día con GitHub', 'pr-detalle'];
}

function boton(icono, nombre, alPulsar) {
    const b = new St.Button({
        style_class: 'pr-boton',
        child: new St.Icon({icon_name: icono, style_class: 'popup-menu-icon'}),
        accessible_name: nombre,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    b.connect('clicked', alPulsar);
    return b;
}

// Hueco del tamaño de un botón, para que las columnas de botones queden alineadas.
function hueco() {
    return new St.Widget({style_class: 'pr-boton', opacity: 0});
}

// acciones: {claude, editor, servidor, github}, cada una recibe el proyecto.
export function crearFila(p, acciones) {
    const fila = filaFija();

    const punto = new St.Widget({style_class: pendiente(p) || !p.git ? 'pr-punto pr-punto-aviso' : 'pr-punto',
        y_align: Clutter.ActorAlign.CENTER});
    fila.add_child(punto);

    const columna = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
        y_align: Clutter.ActorAlign.CENTER});
    columna.add_child(etiqueta(p.nombre, 'pr-nombre'));
    const [texto, clase] = textoEstado(p);
    const detalle = etiqueta(texto, `pr-detalle ${clase}`);
    columna.add_child(detalle);
    fila.add_child(columna);

    // Cambia solo el punto y el texto del estado, sin rehacer la fila (sirve con el menú abierto).
    fila.actualizar = q => {
        punto.style_class = pendiente(q) || !q.git ? 'pr-punto pr-punto-aviso' : 'pr-punto';
        const [t, c] = textoEstado(q);
        detalle.text = t;
        detalle.style_class = `pr-detalle ${c}`;
    };

    const botones = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER});
    botones.add_child(boton('utilities-terminal-symbolic', `Abrir Claude Code y el editor en ${p.nombre}`, () => acciones.claude(p)));
    botones.add_child(boton('text-editor-symbolic', `Abrir ${p.nombre} en el editor`, () => acciones.editor(p)));
    botones.add_child(p.dev
        ? boton('media-playback-start-symbolic', `Prender el servidor de desarrollo de ${p.nombre}`, () => acciones.servidor(p))
        : hueco());
    botones.add_child(p.github
        ? boton('web-browser-symbolic', `Abrir ${p.nombre} en GitHub`, () => acciones.github(p))
        : hueco());
    fila.add_child(botones);
    return fila;
}
