/**
 * «EL PUENTE» DE ANTONIO — «MD MODIFICADO» (24/10/2026): LAS ETIQUETAS DE LOS BOTONES, LOS PRECIOS Y EL AHORRO. De punta a punta y negando.
 *
 * Las etiquetas (nombre con su emoji, SIN monto) son DATO del tenant en «Config base» (`etiquetaPack`…, archivo `rroca-antonio.json`); el monto lo pone el código desde el catálogo de la Consola.
 * WhatsApp admite 20 caracteres en un botón y 24 en una fila; el largo se cuenta con `.length` (el emoji ocupa 2 unidades UTF-16). Aquí se fija el largo máximo para el catálogo del MD y para uno de tres cifras.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Mundo, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, crear, hablar, mBoton, mLista, mTexto, panelOk } from './mundo';
import { cargarLibrerias } from './librerias';
import { vigilarUx } from './vigilante-ux';
// @ts-expect-error el armador es un .mjs sin tipos
import { cargarDatos } from '../../../../Flujos/experimental/rroca-antonio/construir.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DATOS = JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/rroca-antonio/rroca-antonio.json'), 'utf8')) as { configBase: Record<string, string> };
const ETIQUETAS = Object.fromEntries(Object.entries(DATOS.configBase).filter(([k]) => k.startsWith('etiqueta')));
const LIB = cargarLibrerias('raEtiquetas, raAjustarEtiqueta, raTituloFila, raAhorro, raMenu, RA_PRODUCTOS') as J;

/** El catálogo del MD modificado (Consola). El precio de cada uno sale de aquí y de ningún otro lado. */
const catalogo = (p: { pack: number; libro: number; workbook: number; guia: number; calendario: number; preguntas: number }): J[] => [
  { id: 'pack-completo', nombre: 'Pack completo', precio: p.pack }, { id: 'libro', nombre: 'Libro', precio: p.libro }, { id: 'workbook', nombre: 'Workbook', precio: p.workbook },
  { id: 'guia-de-conversaciones', nombre: 'Guía de conversaciones', precio: p.guia }, { id: 'calendario-de-conexion', nombre: 'Calendario de conexión', precio: p.calendario }, { id: 'preguntas-profundas', nombre: 'Preguntas profundas', precio: p.preguntas },
];
const MD = { pack: 49, libro: 35, workbook: 20, guia: 18, calendario: 15, preguntas: 18 };
const TRES_CIFRAS = { pack: 149, libro: 135, workbook: 120, guia: 118, calendario: 115, preguntas: 118 };
const nuevo = (cat: J[] = catalogo(MD)): Mundo => { const w = crear({ base: ETIQUETAS, panel: panelOk({ catalogo: cat, datosDelNegocio: { nombreNegocio: 'Método Puente' } }) }); vigilarUx(w); return w; };
const charlar = (w: Mundo): void => { hablar(w, ANA, mTexto('hola')); hablar(w, ANA, mTexto('estamos pasando un momento difícil')); };
const botones = (t: ResultadoTurno): Array<{ id: string; title: string }> => ((t.mensajes[0]?.payload['interactive']?.action?.buttons ?? []) as J[]).map((b) => ({ id: String(b['reply'].id), title: String(b['reply'].title) }));
const filas = (t: ResultadoTurno): Array<{ id: string; title: string; description: string }> => ((t.mensajes[0]?.payload['interactive']?.action?.sections ?? []) as J[]).flatMap((s) => (s['rows'] ?? []) as J[]).map((r) => ({ id: String(r['id']), title: String(r['title']), description: String(r['description']) }));
const menu = (w: Mundo): ResultadoTurno => { charlar(w); return hablar(w, ANA, mTexto('quiero comprar')); };

describe('MD modificado · las etiquetas del tenant: botones principales y lista de bonos', () => {
  it('el archivo de datos trae las 7 etiquetas del MD, sin monto', () => {
    expect(ETIQUETAS).toEqual({
      etiquetaPack: '💛 Pack Completo', etiquetaLibro: '📘 Solo Libro', etiquetaBonos: '➕ Bonos Individuales', etiquetaWorkbook: '📓 Workbook',
      etiquetaGuia: '🗣️ Guía Conversaciones', etiquetaPreguntas: '💬 100 Preguntas', etiquetaCalendario: '📅 Calendario 30 Días',
    });
  });
  it('con el catálogo del MD: los tres botones del MD (el Pack sin el espacio tras el emoji para caber en 20) y la lista de los 4 bonos; los ids no cambian', () => {
    const w = nuevo();
    const m = menu(w);
    expect(botones(m)).toEqual([{ id: 'b_pack', title: '💛Pack Completo 49Bs' }, { id: 'b_libro', title: '📘 Solo Libro 35Bs' }, { id: 'b_comp', title: '➕ Bonos Individuales' }]);
    for (const b of botones(m)) expect(b.title.length, b.title).toBeLessThanOrEqual(20);
    const l = hablar(w, ANA, mBoton('b_comp'));
    expect(filas(l)).toEqual([
      { id: 'b_workbook', title: '📓 Workbook (20 Bs)', description: '20 Bs' },
      { id: 'b_guia', title: '🗣️ Guía Conversaciones', description: '18 Bs' },
      { id: 'b_preguntas', title: '💬 100 Preguntas (18 Bs)', description: '18 Bs' },
      { id: 'b_calendario', title: '📅 Calendario 30 Días', description: '15 Bs' },
    ].sort((a, b) => ['b_workbook', 'b_guia', 'b_calendario', 'b_preguntas'].indexOf(a.id) - ['b_workbook', 'b_guia', 'b_calendario', 'b_preguntas'].indexOf(b.id)));
    expect(filas(l)).toHaveLength(4);
    for (const f of filas(l)) expect(f.title.length, f.title).toBeLessThanOrEqual(24);
  });
  it('NEGANDO: con precios de TRES cifras las etiquetas siguen dentro de 20 y 24, el monto es el del catálogo y el emoji se conserva', () => {
    const w = nuevo(catalogo(TRES_CIFRAS));
    const m = menu(w);
    const t = botones(m).map((b) => b.title);
    expect(t).toEqual(['💛 Pack 149Bs', '📘 Solo Libro 135Bs', '➕ Bonos Individuales']);
    for (const x of t) expect(x.length, x).toBeLessThanOrEqual(20);
    const l = hablar(w, ANA, mBoton('b_comp'));
    expect(filas(l).map((f) => f.description)).toEqual(['120 Bs', '118 Bs', '115 Bs', '118 Bs']);
    for (const f of filas(l)) { expect(f.title.length, f.title).toBeLessThanOrEqual(24); expect(f.title, f.title).toMatch(/^\p{Extended_Pictographic}|^[➕]/u); }
  });
  it('NEGANDO: los precios salen SOLO del catálogo: con otros precios cambian botones, filas y descripciones, y no queda ningún monto del MD', () => {
    const w = nuevo(catalogo({ pack: 59, libro: 31, workbook: 22, guia: 21, calendario: 12, preguntas: 14 }));
    const m = menu(w);
    expect(botones(m).map((b) => b.title)).toEqual(['💛Pack Completo 59Bs', '📘 Solo Libro 31Bs', '➕ Bonos Individuales']);
    const l = hablar(w, ANA, mBoton('b_comp'));
    expect(filas(l).map((f) => f.description)).toEqual(['22 Bs', '21 Bs', '12 Bs', '14 Bs']);
    expect(filas(l).map((f) => f.title).join('|')).not.toMatch(/\b(20|18|15) Bs/);
  });
  it('la etiqueta con el nombre del catálogo sigue siendo el respaldo si el tenant no tiene etiquetas (el comportamiento anterior)', () => {
    const w = crear({ panel: panelOk() });   // sin etiquetas en «Config base»
    vigilarUx(w);
    expect(botones(menu(w)).map((b) => b.title)).toEqual(['Pack completo 49Bs', 'Libro 35Bs', 'Ver complementos']);
  });
  it('los ids viejos siguen funcionando: `b_bonos` abre la lista, una fila abre su QR, y los botones b_pack / b_libro abren el QR del catálogo', () => {
    const v = nuevo(); charlar(v);
    expect(filas(hablar(v, ANA, mBoton('b_bonos'))).map((f) => f.id)).toEqual(['b_workbook', 'b_guia', 'b_calendario', 'b_preguntas']);
    const q = hablar(v, ANA, mLista('b_calendario'));
    expect(q.mensajes[0]!.tipo).toBe('image');
    expect(q.llamadas.ingesta.filter((c) => c['evento'] === 'qr_enviado')[0]).toMatchObject({ monto: 15 });
    const p = nuevo(); charlar(p);
    hablar(p, ANA, mTexto('quiero comprar'));
    const r = hablar(p, ANA, mBoton('b_pack'));
    expect(r.mensajes[0]!.tipo).toBe('image');
    expect(r.llamadas.ingesta.filter((c) => c['evento'] === 'qr_enviado')[0]).toMatchObject({ monto: 49 });
  });
  it('la presentación dice «asistente virtual del Método Puente» y nunca «Antonio Dauber»', () => {
    const w = nuevo();
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.mensajes[0]!.cuerpo).toMatch(/asistente virtual del Método Puente/);
    expect(t.mensajes.map((m) => m.cuerpo).join(' ')).not.toMatch(/Dauber/);
  });
});

describe('MD modificado · las funciones de etiqueta, con el largo contado como WhatsApp (`.length`)', () => {
  const ajustar = LIB['raAjustarEtiqueta'] as (e: string, s: string, l: number) => string;
  const fila = LIB['raTituloFila'] as (e: string, m: number) => string;
  it('el recorte más pequeño primero: el espacio tras el emoji, luego palabras del final; nunca una preposición ni un número colgando', () => {
    expect(ajustar('💛 Pack Completo', ' 49Bs', 20)).toBe('💛Pack Completo 49Bs');
    expect(ajustar('📘 Solo Libro', ' 35Bs', 20)).toBe('📘 Solo Libro 35Bs');
    expect(ajustar('📅 Calendario 30 Días', ' 15Bs', 20)).toBe('📅 Calendario 15Bs');
    expect(ajustar('💬 100 Preguntas', ' 18Bs', 20)).toBe('💬100 Preguntas 18Bs');
    expect(ajustar('🗣️ Guía Conversaciones', ' 18Bs', 20)).toBe('🗣️ Guía 18Bs');
    expect(ajustar('➕ Bonos Individuales', '', 20)).toBe('➕ Bonos Individuales');
  });
  it('NEGANDO: ninguna etiqueta del MD pasa de 20 (botón) o 24 (fila) con ningún monto de 1 a 4 cifras, y el monto siempre va intacto al final del botón', () => {
    for (const e of ['💛 Pack Completo', '📘 Solo Libro', '📓 Workbook', '🗣️ Guía Conversaciones', '💬 100 Preguntas', '📅 Calendario 30 Días']) {
      for (const m of [5, 49, 100.5, 149, 1999]) {
        const b = ajustar(e, ' ' + String(m).replace('.', ',') + 'Bs', 20);
        expect(b.length, b).toBeLessThanOrEqual(20);
        expect(b, b).toMatch(new RegExp(` ${String(m).replace('.', ',').replace(/[,.]/g, '[.,]')}Bs$`));
        expect(fila(e, m).length, fila(e, m)).toBeLessThanOrEqual(24);
      }
    }
  });
  it('las etiquetas del código no llevan montos escritos y el recorte no inventa palabras', () => {
    const codigo = readFileSync(join(RAIZ, 'Flujos/experimental/rroca-antonio/src/lib/ra.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(codigo).not.toMatch(/\d+ ?Bs['"`]/);
    expect(codigo).not.toMatch(/Solo Libro|Bonos Individuales|💛|📘|➕/);   // los nombres y los emojis son dato del tenant, no del código
  });
});

describe('MD modificado · el ahorro lo calcula el código desde el catálogo (la promoción cambia el Pack en la Consola, no el código)', () => {
  const ahorro = LIB['raAhorro'] as (cat: Record<string, number>) => number | null;
  const cat = (pack: number): Record<string, number> => ({ pack, libro: 35, workbook: 20, guia: 18, calendario: 15, preguntas: 18 });
  it('con el Pack a 49 el ahorro es 57 (106 por separado); con el Pack a 69 baja a 37; el texto de las opciones lo dice con el del catálogo', () => {
    expect(ahorro(cat(49))).toBe(57);
    expect(ahorro(cat(69))).toBe(37);
    expect(ahorro({ ...cat(106) })).toBeNull();   // sin ahorro no se dice
    let n = 0;
    const w = crear({ base: ETIQUETAS, panel: panelOk({ catalogo: catalogo({ ...MD, pack: 69 }), datosDelNegocio: { nombreNegocio: 'Método Puente' } }), modeloDice: () => `Entiendo lo que cuentas, es un momento delicado. ¿Qué es lo que más te pesa hoy? (${'abcdefgh'[n++]})` });
    vigilarUx(w);
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('últimamente discutimos mucho y estoy cansada'));
    const t = hablar(w, ANA, mTexto('no sé si hay solución'));
    expect(t.mensajes[0]!.cuerpo).toMatch(/ahorras 37 Bs/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/\b57\b|\b69 Bs/);
    expect(botones(t)[0]!.title).toBe('💛Pack Completo 69Bs');
  });
  it('el bot dice SOLO el precio vigente del catálogo (49): nunca menciona el 69 ni agenda nada', () => {
    const w = nuevo();
    charlar(w);
    const t = hablar(w, ANA, mTexto('cuánto cuesta el pack'));
    const texto = t.mensajes.map((m) => m.cuerpo).join(' ');
    expect(texto).toMatch(/49 Bs/);
    expect(texto).not.toMatch(/\b69\b|hasta el|desde el|05\/11|06\/11|promoci/i);
  });
});

describe('MD modificado · una etiqueta con monto o enlace no entra: ni al construir ni en tiempo de ejecución', () => {
  const MALAS = ['Pack 49Bs', 'Pack $49', 'Pack 49 USD', 'wa.me/59100000011', 'https://x.com/pack', 'www.pack.com', 'pack.com/oferta'];
  const construir = (etiqueta: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'etiqueta-'));
    try {
      const d = JSON.parse(JSON.stringify(DATOS)) as { configBase: Record<string, string> };
      d.configBase['etiquetaPack'] = etiqueta;
      const ruta = join(dir, 'rroca-antonio.json');
      writeFileSync(ruta, JSON.stringify(Object.assign(JSON.parse(readFileSync(join(RAIZ, 'admin/scripts/datos/rroca-antonio/rroca-antonio.json'), 'utf8')), { configBase: d.configBase })));
      try { cargarDatos(ruta); return ''; } catch (e) { return String((e as Error).message); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  it('construir.mjs rechaza cada etiqueta mala y acepta las del MD', () => {
    for (const mala of MALAS) expect(construir(mala), mala).toMatch(/etiquetaPack/);
    for (const buena of Object.values(ETIQUETAS)) expect(construir(buena), buena).toBe('');
  });
  it('en tiempo de ejecución `raEtiquetas` ignora la mala (se usa el nombre del catálogo) y conserva las buenas', () => {
    const et = LIB['raEtiquetas'] as (b: J) => Record<string, string>;
    for (const mala of MALAS) expect(et({ etiquetaPack: mala, etiquetaLibro: '📘 Solo Libro' }), mala).toEqual({ libro: '📘 Solo Libro' });
    const w = crear({ base: { ...ETIQUETAS, etiquetaPack: 'Pack 49Bs' }, panel: panelOk() });
    expect(botones(menu(w))[0]!.title).toBe('Pack completo 49Bs');   // el del catálogo
  });
});
