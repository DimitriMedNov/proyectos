// Proyectos: menú en la barra de GNOME con los proyectos de ~/Proyectos, del más reciente al más viejo.
// Cada uno abre Claude Code, el editor, su servidor de desarrollo o su GitHub, y avisa si tiene
// trabajo sin subir (cambios sin commit, commits sin push o sin git).

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {crearFila, etiqueta, filaFija, pendiente} from './fila.js';
import {abrirClaude, abrirEditor, abrirUrl, prenderServidor} from './lanzar.js';
import {estadoGit, listarProyectos, PROYECTOS} from './proyectos.js';

const REVISAR_CADA = 120; // segundos: la revisión normal, en segundo plano
const VIEJO_AL_ABRIR = 30; // s: al abrir el menú solo se revisa si lo último tiene más de esto
const ESPERA_AL_ABRIR = 350; // ms: se revisa cuando el menú ya terminó de abrirse
const GIT_A_LA_VEZ = 4; // procesos de git simultáneos (antes eran todos a la vez y trababan la barra)
const RECIENTES = 8; // los demás van en "Más proyectos"

const Indicador = GObject.registerClass(
class Indicador extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Proyectos');
        this._proyectos = [];
        this._estados = new Map(); // ruta → último estado de git conocido
        this._cancelable = new Gio.Cancellable();
        this._revisando = false;
        this._ultimaRevision = 0; // µs monotónicos
        this._filas = new Map(); // ruta → fila del menú
        this._firma = ''; // nombres en orden: si cambia, hay que rehacer el menú
        this._rehacerAlCerrar = false;
        this._esperaAbrir = 0;

        const caja = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        caja.add_child(new St.Icon({icon_name: 'folder-symbolic', style_class: 'system-status-icon'}));
        this._cuenta = etiqueta('', 'pr-cuenta', {visible: false});
        caja.add_child(this._cuenta);
        this.add_child(caja);
        this.accessible_name = 'Proyectos';

        this._contenido = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._contenido);
        // Al abrir se muestra al instante lo que ya se sabe; si es viejo, se revisa cuando el menú
        // terminó de abrirse. Al cerrar se rehace el menú si cambió la lista de proyectos.
        this.menu.connect('open-state-changed', (_m, abierto) => {
            if (abierto) {
                if (GLib.get_monotonic_time() - this._ultimaRevision > VIEJO_AL_ABRIR * 1e6 && !this._esperaAbrir) {
                    this._esperaAbrir = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ESPERA_AL_ABRIR, () => {
                        this._esperaAbrir = 0;
                        this._revisar();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else if (this._rehacerAlCerrar) {
                this._rehacerAlCerrar = false;
                this._pintar();
            }
        });

        this._acciones = {
            claude: p => this._hacer(() => abrirClaude(p.ruta)),
            editor: p => this._hacer(() => abrirEditor(p.ruta)),
            servidor: p => this._hacer(() => prenderServidor(p.ruta, p.dev)),
            github: p => this._hacer(() => abrirUrl(p.github)),
        };

        this._temporizador = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REVISAR_CADA, () => {
            this._revisar();
            return GLib.SOURCE_CONTINUE;
        });
        this._revisar();
    }

    _hacer(accion) {
        this.menu.close();
        try {
            accion();
        } catch (e) {
            logError(e, 'Proyectos');
            Main.notify('Proyectos', e.message);
        }
    }

    // Vuelve a leer la carpeta y pide el estado de git de cada proyecto, de GIT_A_LA_VEZ en GIT_A_LA_VEZ.
    _revisar() {
        if (this._revisando)
            return;
        this._revisando = true;
        this._ultimaRevision = GLib.get_monotonic_time();
        this._proyectos = listarProyectos();
        for (const p of this._proyectos)
            p.estado = this._estados.get(p.ruta) ?? null;
        this._pintar();

        const cola = this._proyectos.filter(p => p.git);
        let enCurso = 0;
        const siguiente = () => {
            if (this._cancelable.is_cancelled())
                return;
            if (cola.length === 0 && enCurso === 0) {
                this._revisando = false;
                this._pintar();
                return;
            }
            while (enCurso < GIT_A_LA_VEZ && cola.length) {
                const p = cola.shift();
                enCurso++;
                estadoGit(p.ruta, this._cancelable, estado => {
                    if (this._cancelable.is_cancelled())
                        return;
                    if (estado)
                        this._estados.set(p.ruta, estado);
                    p.estado = estado ?? p.estado;
                    enCurso--;
                    siguiente();
                });
            }
        };
        siguiente();
    }

    // Con el menú abierto no se rehace (se reacomodaba y trababa): solo se actualiza cada fila.
    _pintar() {
        const firma = this._proyectos.map(p => p.ruta).join('|');
        if (this.menu.isOpen && firma === this._firma) {
            this._actualizar();
            return;
        }
        if (this.menu.isOpen) {
            this._rehacerAlCerrar = true;
            this._actualizar();
            return;
        }
        this._firma = firma;
        this._rehacer();
    }

    _resumen() {
        const pendientes = this._proyectos.filter(pendiente).length;
        const sinGit = this._proyectos.filter(p => !p.git).length;
        this._cuenta.text = String(pendientes);
        this._cuenta.visible = pendientes > 0;
        const resumen = [pendientes === 1 ? '1 con trabajo sin subir' : `${pendientes} con trabajo sin subir`];
        if (sinGit)
            resumen.push(`${sinGit} sin git`);
        return resumen.join(' · ');
    }

    _actualizar() {
        if (this._etiquetaResumen)
            this._etiquetaResumen.text = this._resumen();
        for (const p of this._proyectos)
            this._filas.get(p.ruta)?.actualizar(p);
    }

    _rehacer() {
        this._contenido.removeAll();
        this._filas.clear();
        const titulo = filaFija();
        titulo.add_child(etiqueta('Proyectos', 'pr-titulo', {x_expand: true}));
        this._etiquetaResumen = etiqueta(this._resumen(), 'pr-detalle');
        titulo.add_child(this._etiquetaResumen);
        this._contenido.addMenuItem(titulo);

        if (this._proyectos.length === 0) {
            const vacio = filaFija();
            vacio.add_child(etiqueta(`No hay carpetas en ${PROYECTOS.replace(GLib.get_home_dir(), '~')}.`, 'pr-detalle'));
            this._contenido.addMenuItem(vacio);
            return;
        }
        const fila = p => {
            const f = crearFila(p, this._acciones);
            this._filas.set(p.ruta, f);
            return f;
        };
        for (const p of this._proyectos.slice(0, RECIENTES))
            this._contenido.addMenuItem(fila(p));

        const resto = this._proyectos.slice(RECIENTES);
        if (resto.length) {
            const mas = new PopupMenu.PopupSubMenuMenuItem(`Más proyectos (${resto.length})`);
            for (const p of resto)
                mas.menu.addMenuItem(fila(p));
            this._contenido.addMenuItem(mas);
        }
    }

    destroy() {
        this._cancelable.cancel();
        for (const id of [this._temporizador, this._esperaAbrir]) {
            if (id)
                GLib.source_remove(id);
        }
        this._temporizador = this._esperaAbrir = 0;
        super.destroy();
    }
});

export default class Proyectos extends Extension {
    enable() {
        this._indicador = new Indicador();
        // A la izquierda, al final: queda junto a Servidores de desarrollo y el nombre de la app abierta.
        Main.panel.addToStatusArea(this.uuid, this._indicador, -1, 'left');
    }

    disable() {
        this._indicador?.destroy();
        this._indicador = null;
    }
}
