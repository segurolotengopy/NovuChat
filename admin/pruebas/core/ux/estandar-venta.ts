/**
 * ESTÁNDAR DEL ASISTENTE DE VENTA (27/11/2026, `NOVUCHAT_estandar-del-asistente-de-venta-v1-1_2026-11-27.md`): la conversación simulada, común a todos los flujos de venta.
 *
 * Corre el JSON de PRODUCCIÓN de cada flujo con el n8n de mentira (`lib/n8n-de-mentira`) y un MODELO SIMULADO (el nodo `Conversar con el modelo` es un doble
 * que dice lo que la prueba le manda decir, incluso lo que NO debe: «No encuentro eso en nuestro catálogo»). Lo que se mide es lo que el cliente RECIBE
 * (`Enviado`), nunca un regex sobre el prompt. Un flujo se conecta con un ADAPTADOR (su mundo de pruebas); un flujo de venta sin adaptador queda declarado en
 * `SIN_ADAPTADOR` con su porqué.
 *
 * Los nombres de comercio no entran al código común: los adaptadores reciben su mundo por ruta y lo importan como módulo de datos de prueba.
 */
import type { J } from '../../lib/flujo';
import type { Enviado, Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import * as bermejo from '../../tenants/casa-bermejo/mundo';
import * as walisuma from '../../tenants/walisuma/mundo';
import { flujosDeProduccion } from '../../lib/flujos-de-cliente';
import { leerFlujo } from '../../lib/flujo';
import { atiendeCliente, idDeFlujo } from '../migracion/comprobaciones';
import { parrafosLargos, problemasDeMensaje } from './catalogo';
import { DADOS_DE_BAJA, VENCE_MAXIMO, type ExcepcionConVencimiento } from './piezas-de-catalogo';
import { problemasDeLimites } from './vigilante';

/**
 * Los flujos de venta (nombre del JSON), DESCUBIERTOS del registro de flujos de producción (`flujosDeProduccion`): los que atienden a un cliente y cobran
 * («Cotejar en el servidor»), menos los declarados como «no es de venta» y los dados de baja. Un flujo nuevo entra solo; nunca una lista escrita a mano.
 */
export function flujosDeVenta(): string[] {
  return flujosDeProduccion()
    .filter((r) => { const f = leerFlujo(r); return f.nodes.some((n) => n.name === 'Cotejar en el servidor') && atiendeCliente(f); })
    .map((r) => idDeFlujo(r).split('/').pop()!)
    .filter((n) => !(n in NO_SON_DE_VENTA) && !(n in DADOS_DE_BAJA))
    .sort();
}

/** Flujos de producción con cobro que NO son de venta de productos (agenda con seña): el estándar de venta no los cubre. */
export const NO_SON_DE_VENTA: Record<string, string> = {
  'bellido-agendamiento.json': 'Agenda con seña: no vende productos de un catálogo.',
  'demo-a-agendamiento.json': 'Agenda con seña: no vende productos de un catálogo.',
};

export const ENLACE = 'https://catalogo.ejemplo.test/c/abc123';
export const PATRON_ID = /^[a-z0-9:_-]{1,200}$/;

export interface Turno { dijo: string; mensajes: Enviado[]; modeloLlamado: boolean; fallo: string | null }
export interface Conversacion { turnos: Turno[] }

export interface Adaptador {
  /** Abre un mundo del flujo de producción con el enlace del catálogo (o sin él) y un modelo simulado que contesta `texto` en cada turno. */
  abrir(op: { enlace?: string; texto?: string; qrEnCurso?: boolean }): { decir(msg: J): ResultadoTurno };
  mTexto(t: string): J;
  mLista(id: string, titulo: string): J;
}

const desdeMundo = (m: typeof bermejo | typeof walisuma, crear: (enlace: string | undefined, texto: string | undefined, qr: boolean) => Mundo): Adaptador => ({
  abrir: (op) => {
    const mundo = crear(op.enlace, op.texto, op.qrEnCurso === true);
    return { decir: (msg) => m.hablar(mundo, m.ANA, msg, { toleraFallo: true }) };
  },
  mTexto: m.mTexto,
  mLista: (id, titulo) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: titulo, description: '' } } }),
});

/** Los adaptadores, por nombre de JSON. */
export const ADAPTADORES: Record<string, Adaptador> = {
  'casa-bermejo.json': desdeMundo(bermejo, (enlace, texto, qr) => bermejo.crear({ enlaceCatalogo: enlace ?? '', panel: qr ? bermejo.panelConQr(450) : undefined, modeloDice: texto === undefined ? undefined : bermejo.modelo(texto) })),
  'walisuma.json': desdeMundo(walisuma, (enlace, texto, qr) => walisuma.crear({
    panel: enlace || qr ? (qr ? walisuma.panelConQr : (_m: number, x: J) => walisuma.panelOk(x))(450, enlace ? { catalogoWeb: { activo: true, enlace } } : {}) : undefined,
    modeloDice: texto === undefined ? undefined : walisuma.modelo(texto),
  })),
};

/**
 * Los flujos de venta sin conversación simulada común: se miden con su suite propia y quedan DECLARADOS aquí con su porqué y su vencimiento. Solo puede achicarse.
 * (El chat de captación no es un comercio con catálogo: no entra en `flujosDeVenta()`. Los rroca-* están en `DADOS_DE_BAJA`.)
 */
export const SIN_ADAPTADOR: Record<string, ExcepcionConVencimiento> = {
  'demo-b-venta-cobro.json': { vence: VENCE_MAXIMO, motivo: 'Su mundo de pruebas es el de venta-minima-flujo.test.ts (con sesión de mentira propia); aún no se envuelve en un adaptador común. Queda como excepción declarada, no fuera del estándar.' },
  'venta-minima.qtaco.json': { vence: VENCE_MAXIMO, motivo: 'Su mundo de pruebas es el de venta-minima-flujo.test.ts (con sesión de mentira propia); aún no se envuelve en un adaptador común. Q\'Taco tiene su propia sesión.' },
  'venta-minima.qtaco-3727.json': { vence: VENCE_MAXIMO, motivo: 'Misma base que venta-minima.qtaco.json: sin adaptador común todavía.' },
};

// ----------------------------------------------------------------------------- la conversación

const esLista = (e: Enviado): boolean => e.payload['type'] === 'interactive' && (e.payload['interactive'] as J | undefined)?.['type'] === 'list';
const filasDe = (e: Enviado): J[] => (((e.payload['interactive'] as J | undefined)?.['action'] as J | undefined)?.['sections'] as J[] | undefined)?.flatMap((s) => (s['rows'] as J[] | undefined) ?? []) ?? [];
const urlDeBoton = (e: Enviado): string => String((((e.payload['interactive'] as J | undefined)?.['action'] as J | undefined)?.['parameters'] as J | undefined)?.['url'] ?? '');
const esEnlace = (e: Enviado): boolean => e.payload['type'] === 'interactive' && (e.payload['interactive'] as J | undefined)?.['type'] === 'cta_url';
const esInteractivoE = (e: Enviado): boolean => e.payload['type'] === 'interactive';
const textoDe = (t: Turno): string => t.mensajes.map((e) => e.cuerpo).join('\n');

function turnoDe(dijo: string, r: ResultadoTurno): Turno {
  return { dijo, mensajes: r.mensajes, modeloLlamado: r.ejecutados.has('Conversar con el modelo'), fallo: r.fallo ? r.fallo.mensaje : null };
}
/** Una conversación: abre el mundo y manda cada mensaje en orden (texto de cliente, o un toque de lista con `{ lista: id }`). */
export function conversar(a: Adaptador, op: { enlace?: string; texto?: string; qrEnCurso?: boolean }, guion: Array<string | { lista: string }>): Conversacion {
  const c = a.abrir(op);
  return { turnos: guion.map((g) => (typeof g === 'string' ? turnoDe(g, c.decir(a.mTexto(g))) : turnoDe(`[toque ${g.lista}]`, c.decir(a.mLista(g.lista, 'x'))))) };
}

export const NIEGA_CATALOGO = 'No encuentro eso en nuestro catálogo.';
export const PIDE_LISTADO = ['¿qué tienen?', 'qué venden', 'catálogo', 'carta', 'productos', 'todo', 'lista'] as const;
const TEXTO_LARGO = 'Con gusto te ayudo. Tenemos muchas piezas. Todas son hechas a mano. Puedes pedir la que quieras. Dime cuál te interesa.';
const TEXTO_CON_VINETAS = 'Te sirven estas opciones:\n• Bufanda de vicuña\n• Billetera de cuero\n• Llavero de llama';

/** Todo lo que el estándar mide de un flujo, corrido una sola vez. */
export interface Medicion {
  /** 1.1: un turno por frase de listado, con el modelo diciendo que no lo encuentra. */
  listados: Turno[];
  saludo: Turno;
  /** 1.2: «catálogo» pedido y una pieza que no existe. */
  pideCatalogo: Turno;
  noEncuentra: Turno;
  /** 1.2: «catálogo» pedido con un QR en curso. */
  conQr: Turno;
  /** 2.2 y 2.3 */
  categoria: Turno;
  listado: Turno;
  toqueVigente: Turno | null;
  toquesViejos: Turno[];
  /** 3.1 y 3.2 */
  textoLargo: Turno;
  conVinetas: Turno;
  /** 3.2: una consulta de VARIAS categorías (las dos primeras de la lista del flujo): el texto con viñetas que arma el código. */
  variasCategorias: Turno | null;
}

export function medir(a: Adaptador): Medicion {
  const fraseNiega = (g: string) => conversar(a, { enlace: ENLACE, texto: NIEGA_CATALOGO }, [g]).turnos[0]!;
  const listados = PIDE_LISTADO.map(fraseNiega);
  const saludo = conversar(a, { enlace: ENLACE }, ['hola']).turnos[0]!;
  const pideCatalogo = conversar(a, { enlace: ENLACE, texto: NIEGA_CATALOGO }, ['catálogo']).turnos[0]!;
  const noEncuentra = conversar(a, { enlace: ENLACE, texto: NIEGA_CATALOGO }, ['quiero un televisor']).turnos[0]!;
  const conQr = conversar(a, { enlace: ENLACE, texto: NIEGA_CATALOGO, qrEnCurso: true }, ['catálogo']).turnos[0]!;
  const categoria = conversar(a, { enlace: ENLACE, texto: NIEGA_CATALOGO }, ['¿qué accesorios tienen?']).turnos[0]!;
  const lista = conversar(a, { enlace: ENLACE }, ['¿qué tienen?']);
  const listado = lista.turnos[0]!;
  const fila = listado.mensajes.filter(esLista).flatMap(filasDe)[0];
  const toqueVigente = fila ? conversar(a, { enlace: ENLACE }, ['¿qué tienen?', { lista: String(fila['id']) }]).turnos[1]! : null;
  const toquesViejos = ['pro:ya-no-existe', 'cat:ya-no-existe', 'mas:cats:99'].map((id) => conversar(a, { enlace: ENLACE }, [{ lista: id }]).turnos[0]!);
  const textoLargo = conversar(a, { enlace: ENLACE, texto: TEXTO_LARGO }, ['hola, quiero información de las piezas']).turnos[0]!;
  const conVinetas = conversar(a, { enlace: ENLACE, texto: TEXTO_CON_VINETAS }, ['hola, quiero información de las piezas']).turnos[0]!;
  const titulos = listado.mensajes.filter(esLista).flatMap(filasDe).map((x) => String(x['title'])).filter((x) => /^[\p{L} ]{3,24}$/u.test(x));
  const variasCategorias = titulos.length >= 2 ? conversar(a, { enlace: ENLACE, texto: NIEGA_CATALOGO }, [`¿qué ${titulos[0]!.toLowerCase()} y ${titulos[1]!.toLowerCase()} tienen?`]).turnos[0]! : null;
  return { listados, saludo, pideCatalogo, noEncuentra, conQr, categoria, listado, toqueVigente, toquesViejos, textoLargo, conVinetas, variasCategorias };
}

// ----------------------------------------------------------------------------- los puntos del estándar

const NEGACION = /no (lo )?encuentro|no (lo )?(tenemos|vendemos|manejamos)\b|no (hay|aparece|figura)\b/i;
const llevaCatalogo = (t: Turno): boolean => t.mensajes.some((e) => esLista(e) || (esEnlace(e) && urlDeBoton(e) === ENLACE) || /^•/m.test(e.cuerpo));
const conFallo = (t: Turno): string[] => (t.fallo ? [`el flujo falló: ${t.fallo.slice(0, 80)}`] : []);

export interface Punto { id: string; titulo: string; evaluar(m: Medicion): string[] }

export const PUNTOS: Punto[] = [
  { id: '1.1', titulo: 'nunca negar el catálogo', evaluar: (m) => m.listados.flatMap((t) => [
    ...conFallo(t),
    ...(NEGACION.test(textoDe(t)) ? [`«${t.dijo}» niega el catálogo: «${textoDe(t).slice(0, 70)}»`] : []),
    ...(llevaCatalogo(t) ? [] : [`«${t.dijo}» no responde con el catálogo (ni lista, ni botón, ni viñetas)`]),
  ]) },
  { id: '1.2', titulo: 'botón «Ver catálogo» en el saludo, al pedirlo y cuando no se encuentra lo que nombra', evaluar: (m) => [
    ...(m.saludo.mensajes.some((e) => esEnlace(e) && urlDeBoton(e) === ENLACE) ? [] : ['el saludo no trae el botón del catálogo']),
    ...(m.pideCatalogo.mensajes.some((e) => esEnlace(e) && urlDeBoton(e) === ENLACE) ? [] : ['«catálogo» no trae el botón del catálogo']),
    ...(m.noEncuentra.mensajes.some((e) => esEnlace(e) && urlDeBoton(e) === ENLACE) ? [] : ['una pieza que no existe no remite al botón del catálogo']),
    ...(m.conQr.mensajes.some((e) => esEnlace(e) && urlDeBoton(e) === ENLACE) ? [] : ['con un QR en curso, «catálogo» no trae el botón (el botón sale SIEMPRE que lo pidan)']),
  ] },
  { id: '1.3', titulo: 'el catálogo es simple: el botón lleva solo el enlace del dato del comercio, sin otros enlaces ni textos de sitio', evaluar: (m) => {
    const botones = [m.saludo, m.pideCatalogo, m.noEncuentra, m.conQr].flatMap((t) => t.mensajes.filter(esEnlace));
    return [
      ...botones.filter((e) => urlDeBoton(e) !== ENLACE).map((e) => `un botón de enlace apunta a otra dirección: ${urlDeBoton(e).slice(0, 50)}`),
      ...botones.filter((e) => /https?:\/\/(?!catalogo\.ejemplo\.test)/i.test(e.cuerpo)).map(() => 'el cuerpo del botón trae otro enlace'),
    ];
  } },
  { id: '2.1', titulo: 'nunca un listado plano: viñetas y lista o botones', evaluar: (m) => m.listados.flatMap((t) => {
    const planas = t.mensajes.filter((e) => !esLista(e)).flatMap((e) => e.cuerpo.split('\n').filter((l) => /\bBs\.?\s*\d/.test(l) && !l.trim().startsWith('•')));
    return planas.length >= 2 && !t.mensajes.some(esLista) ? [`«${t.dijo}» arma un listado plano (${planas.length} precios sin viñeta ni lista)`] : [];
  }) },
  { id: '2.2', titulo: 'listas completas o con remisión expresa (sin recortar en silencio)', evaluar: (m) => {
    const texto = textoDe(m.categoria) + '\n' + m.categoria.mensajes.filter(esLista).flatMap(filasDe).map((f) => `${f['title']} ${f['description']}`).join('\n');
    const completa = /Bufanda de vicu/i.test(texto) && /Billetera de cuero/i.test(texto);
    const remite = /ver más|faltan|catálogo/i.test(texto) && m.categoria.mensajes.some((e) => esEnlace(e) || filasDe(e).some((f) => String(f['id']).startsWith('mas:')));
    return completa || remite ? [] : ['«¿qué accesorios tienen?» ni muestra todos los productos de la categoría ni remite expresamente al catálogo'];
  } },
  { id: '2.3', titulo: 'lista interactiva con la pieza común; el toque se resuelve por código; un toque viejo recibe una respuesta clara', evaluar: (m) => {
    const out: string[] = [];
    const listas = m.listado.mensajes.filter(esLista);
    if (!listas.length) out.push('«¿qué tienen?» no sale como lista interactiva');
    for (const e of listas) {
      const filas = filasDe(e);
      if (filas.length > 10) out.push(`una lista con ${filas.length} filas (el máximo es 10)`);
      for (const f of filas) {
        if (!PATRON_ID.test(String(f['id']))) out.push(`id de fila fuera del patrón: ${String(f['id']).slice(0, 40)}`);
        if (String(f['title']).length > 24) out.push(`título de fila de más de 24 caracteres: ${f['title']}`);
        if (String(f['description'] ?? '').length > 72) out.push('descripción de fila de más de 72 caracteres');
      }
    }
    if (m.toqueVigente === null) out.push('sin lista no hay toque que resolver');
    else {
      if (m.toqueVigente.modeloLlamado) out.push('el toque de una fila llegó al modelo');
      if (!m.toqueVigente.mensajes.length) out.push('el toque de una fila no tuvo respuesta');
    }
    for (const t of m.toquesViejos) {
      if (t.modeloLlamado) out.push(`el toque viejo «${t.dijo}» llegó al modelo`);
      else if (!t.mensajes.length || t.fallo) out.push(`el toque viejo «${t.dijo}» no recibe una respuesta clara`);
    }
    return out;
  } },
  { id: '3.1', titulo: 'párrafos separados de 2 oraciones como máximo', evaluar: (m) => {
    const todos = [m.saludo, m.pideCatalogo, m.noEncuentra, m.categoria, m.listado, m.textoLargo, m.conVinetas, ...(m.variasCategorias ? [m.variasCategorias] : []), ...m.listados];
    return todos.flatMap((t) => t.mensajes.flatMap((e) => parrafosLargos(e.cuerpo).map((p) => `«${t.dijo}»: párrafo con más de 2 oraciones: «${p.slice(0, 50)}…»`)));
  } },
  { id: '3.2', titulo: 'el filtro de redacción conserva saltos de línea y viñetas', evaluar: (m) => {
    // Mide el MENSAJE QUE SALE: si el flujo deja pasar el texto del modelo, sus tres viñetas deben llegar enteras, una por línea; si lo responde el código (regla de «solo escribe el código»),
    // la respuesta a una consulta de varias categorías debe traer viñetas de a UN producto por línea, con su precio.
    const t = textoDe(m.conVinetas);
    if (/Bufanda de vicu/i.test(t)) return ['• Bufanda de vicuña', '• Billetera de cuero', '• Llavero de llama'].filter((l) => !t.includes(l)).map((l) => `se perdió la línea «${l}» del texto del modelo`);
    const v = m.variasCategorias ? textoDe(m.variasCategorias).split('\n').filter((l) => l.startsWith('•')) : [];
    if (v.length < 2) return ['ni el texto del modelo ni la respuesta del código a varias categorías traen viñetas (una por línea)'];
    return v.filter((l) => (l.match(/•/g) ?? []).length !== 1 || !/\d/.test(l)).map((l) => `viñeta mal formada (dos productos en una línea o sin precio): «${l.slice(0, 60)}»`);
  } },
  { id: '3.4', titulo: 'límites de WhatsApp respetados por código (texto 4096, interactivo 1024, botón 20, fila 24/72, 10 filas)', evaluar: (m) =>
    [m.saludo, m.pideCatalogo, m.noEncuentra, m.conQr, m.categoria, m.listado, m.textoLargo, m.conVinetas, ...m.listados, ...m.toquesViejos, ...(m.toqueVigente ? [m.toqueVigente] : [])]
      .flatMap((t) => t.mensajes.flatMap((e) => problemasDeLimites(e.payload).map((p) => `«${t.dijo}»: ${p}`))) },
  { id: '4.2', titulo: 'el saludo trae opciones (botones o lista)', evaluar: (m) => [
    ...conFallo(m.saludo),
    ...(m.saludo.mensajes.some(esInteractivoE) ? [] : ['el saludo sale solo como texto, sin botones ni lista']),
  ] },
  { id: 'UX-5', titulo: 'toda pregunta por opciones sale con botón o lista (invariante 5 de la batería, subida)', evaluar: (m) =>
    [m.saludo, m.pideCatalogo, m.noEncuentra, m.categoria, m.listado, m.textoLargo, m.conVinetas, ...m.listados].flatMap((t) =>
      t.mensajes.flatMap((e) => problemasDeMensaje({ texto: e.cuerpo, payload: e.payload as never }).filter((p) => p.startsWith('pregunta')).map((p) => `«${t.dijo}»: ${p}`))) },
];
