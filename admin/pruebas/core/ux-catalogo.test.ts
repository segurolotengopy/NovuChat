/**
 * EL ESTÁNDAR DEL ASISTENTE DE VENTA COMO INVARIANTE GLOBAL (27/11/2026; `NOVUCHAT_estandar-del-asistente-de-venta-v1-1_2026-11-27.md`, secciones
 * 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.4 y 4.2, más 4.3 en el vigilante común), más las invariantes 4 y 5 de la batería del chat de NovuChat subidas a lo común (párrafos de 2 oraciones
 * como máximo = 3.1; toda pregunta por opciones sale con botón o lista = UX-5).
 *
 * Cada punto corre sobre los flujos de venta de `flujosDeProduccion()` con el n8n de mentira y un MODELO SIMULADO (incluso uno que niega el catálogo):
 * se mide lo que el cliente RECIBE, no un regex del prompt (`ux/estandar-venta.ts`). Lo que un flujo hoy incumple va a `EXCEPCIONES` con su porqué; la prueba
 * exige que (a) todo incumplimiento tenga su excepción y (b) toda excepción siga incumpliendo (si ya cumple, SOBRA y hay que borrarla). La lista solo baja:
 * `TOPE_EXCEPCIONES` es la cuenta medida el 27/11/2026. Un flujo de venta sin conversación simulada común queda en `SIN_ADAPTADOR` (también solo baja).
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from './fuente-vm';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { leerFlujo } from '../lib/flujo';
import { atiendeCliente, idDeFlujo } from './migracion/comprobaciones';
import { idsDeOpciones, problemasDeLimites, estadoUxNuevo, violacionesDeTurno, toqueDeEntrada, vigilarUx } from './ux/vigilante';
import type { Mundo } from '../lib/n8n-de-mentira';
import { esInteractivo, parrafosLargos, preguntaPorOpciones, problemasDeMensaje } from './ux/catalogo';
import { ADAPTADORES, FLUJOS_DE_VENTA, NO_SON_DE_VENTA, PUNTOS, SIN_ADAPTADOR, medir, type Medicion } from './ux/estandar-venta';

const nombreDe = (ruta: string): string => idDeFlujo(ruta).split('/').pop()!;

const SIN_PIEZA = 'No usa las piezas comunes del catálogo (`lista-de-catalogo.js`, `intencion-de-catalogo.js`, `boton-del-catalogo.js`); la adopción es de su dueño.';
const SIN_PARTIDOR = 'No parte los párrafos del modelo con la pieza común (`ctParrafos`); su texto largo llega tal cual.';
/** Excepciones declaradas: `<punto>|<flujo>` → porqué. SOLO BAJA. */
export const EXCEPCIONES: Record<string, string> = {
  'casa-bermejo.json|1.1': 'Una pregunta de listado la contesta el modelo y puede salir «No encuentro eso en nuestro catálogo» tras el saludo; sin reconocedor por código. ' + SIN_PIEZA + ' (Casa Bermejo la adopta en su rama.)',
  'casa-bermejo.json|1.2': 'El botón «Ver catálogo» no sale en el saludo ni al pedirlo ni cuando no se encuentra lo nombrado: no usa `cwConBotonCatalogo`. ' + SIN_PIEZA,
  'casa-bermejo.json|2.2': 'Una categoría pedida no sale completa ni remite expresamente al catálogo. ' + SIN_PIEZA,
  'casa-bermejo.json|2.3': 'No manda lista interactiva de catálogo; un toque de fila viejo llega al modelo. ' + SIN_PIEZA,
  'casa-bermejo.json|3.1': SIN_PARTIDOR,
  'casa-bermejo.json|4.2': 'El saludo sale solo como texto, sin botones ni lista. ' + SIN_PIEZA,
  'walisuma.json|1.1': 'El listado lo contesta el modelo tras el saludo y puede negar el catálogo. ' + SIN_PIEZA + ' (Walisuma tiene el PR #1129 abierto.)',
  'walisuma.json|2.3': 'No manda lista interactiva de catálogo; un toque de fila viejo llega al modelo. ' + SIN_PIEZA + ' (Walisuma tiene el PR #1129 abierto.)',
  'walisuma.json|3.1': SIN_PARTIDOR + ' (Walisuma tiene el PR #1129 abierto.)',
};
export const TOPE_EXCEPCIONES = 9;
export const TOPE_SIN_ADAPTADOR = 6;

const TEXTO = (t: string) => ({ texto: t, payload: { type: 'text' } });
const LISTA = (t: string) => ({ texto: t, payload: { type: 'interactive', interactive: { type: 'list' } } });

describe('las piezas puras: párrafos y preguntas por opciones', () => {
  it('3.1 dos oraciones por párrafo pasan; tres juntas son un párrafo largo (NIEGA)', () => {
    expect(parrafosLargos('Hola. Bienvenido a la tienda.\n\nTenemos de todo. Mira el catálogo.')).toEqual([]);
    expect(parrafosLargos('Hola. Bienvenido a la tienda. Tenemos de todo. Mira el catálogo.')).toHaveLength(1);
    expect(parrafosLargos('Uno es esto. Dos es aquello. Tres es lo otro.')).toHaveLength(1);
  });
  it('3.1 una lista con viñetas o de varias líneas no se parte; vacío y no textual no rompen', () => {
    expect(parrafosLargos('• Mesa — Bs 100\n• Silla — Bs 50\n• Cama — Bs 900')).toEqual([]);
    expect(parrafosLargos('Hola. Esto. Aquello.\nOtra línea.')).toEqual([]);
    expect(parrafosLargos('')).toEqual([]);
    expect(parrafosLargos(undefined as unknown as string)).toEqual([]);
  });
  it('UX-5 detecta «¿A o B?» y la enumeración numerada; NIEGA: una pregunta abierta o sí/no no lo es', () => {
    expect(preguntaPorOpciones('¿Quieres ver los planes o prefieres hablar con el equipo?')).toBe(true);
    expect(preguntaPorOpciones('Elige:\n1) Planes\n2) Equipo')).toBe(true);
    expect(preguntaPorOpciones('¿Cómo te llamas?')).toBe(false);
    expect(preguntaPorOpciones('¿Quieres que te muestre los planes?')).toBe(false);
    expect(preguntaPorOpciones('')).toBe(false);
  });
  it('UX-5 NIEGA: una pregunta por opciones en texto plano es un problema; con lista, no; un párrafo largo en una lista sigue siéndolo', () => {
    const q = '¿Quieres ver el catálogo o prefieres hablar con alguien?';
    expect(problemasDeMensaje(TEXTO(q))).toEqual(['pregunta por opciones sin botón ni lista']);
    expect(problemasDeMensaje(LISTA(q))).toEqual([]);
    expect(esInteractivo(TEXTO(q))).toBe(false);
    expect(problemasDeMensaje(LISTA('Uno es esto. Dos es aquello. Tres es lo otro.'))).toHaveLength(1);
  });
  it('lo que arma el helper de catálogo común cumple las dos reglas', () => {
    const ic = cargarFuente<{ icMensajeLista: (v: unknown[], m: (c: number) => string) => { texto: string; respaldo: string; payload: { interactive: { type: string } } } | null }>([
      'Flujos/src/core/sin-agente/mensajes.js', 'Flujos/src/core/texto/parrafos.js', 'Flujos/src/modulos/productos/lista-de-catalogo.js', 'Flujos/src/modulos/productos/intencion-de-catalogo.js',
    ], ['icMensajeLista']);
    const v = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, nombre: `Producto ${i}`, area: `Cat ${i % 4}`, precioCentavos: 1000 + i }));
    const m = ic.icMensajeLista(v, (c) => 'Bs ' + c / 100)!;
    expect(problemasDeMensaje({ texto: m.texto, payload: { type: 'interactive', interactive: { type: m.payload.interactive.type } } })).toEqual([]);
    expect(parrafosLargos(m.respaldo)).toEqual([]);
  });
});

const BOTONES = (...ids: string[]) => ({ type: 'interactive', interactive: { type: 'button', body: { text: 'x' }, action: { buttons: ids.map((id) => ({ type: 'reply', reply: { id, title: 'Opción' } })) } } });
const msgA = (a: string, cuerpo: string, payload: Record<string, unknown>) => ({ a, cuerpo, payload });
const toqueEntrada = (from: string, id: string) => ({ body: { value: { messages: [{ from, interactive: { type: 'button_reply', button_reply: { id } } }] } } });

describe('el vigilante común (sube las copias de tenants/<t>/vigilante-ux.ts): 3.1, 3.4, 4.3 y UX-5', () => {
  it('3.4 NIEGA: texto de más de 4096, cuerpo interactivo de más de 1024, botón de más de 20, 4 botones, 11 filas, título de fila de 25 y clave `link`', () => {
    expect(problemasDeLimites({ type: 'text', text: { body: 'x'.repeat(4096) } })).toEqual([]);
    expect(problemasDeLimites({ type: 'text', text: { body: 'x'.repeat(4097) } })).toHaveLength(1);
    expect(problemasDeLimites({ type: 'interactive', interactive: { type: 'button', body: { text: 'x'.repeat(1025) }, action: { buttons: [] } } })).toHaveLength(1);
    expect(problemasDeLimites({ type: 'interactive', interactive: { type: 'button', body: { text: 'x' }, action: { buttons: [{ reply: { id: 'a', title: 'x'.repeat(21) } }] } } })).toHaveLength(1);
    expect(problemasDeLimites(BOTONES('a', 'b', 'c', 'd'))).toHaveLength(1);
    expect(problemasDeLimites(BOTONES('a', 'b', 'c'))).toEqual([]);
    const fila = (t: string, d = '') => ({ id: 'cat:x', title: t, description: d });
    const lista = (rows: unknown[]) => ({ type: 'interactive', interactive: { type: 'list', body: { text: 'x' }, action: { sections: [{ rows }] } } });
    expect(problemasDeLimites(lista(Array.from({ length: 11 }, () => fila('a'))))).toHaveLength(1);
    expect(problemasDeLimites(lista([fila('x'.repeat(25))]))).toHaveLength(1);
    expect(problemasDeLimites(lista([fila('a', 'x'.repeat(73))]))).toHaveLength(1);
    expect(problemasDeLimites(lista([fila('x'.repeat(24), 'x'.repeat(72))]))).toEqual([]);
    expect(problemasDeLimites({ type: 'text', text: { body: 'x' }, link: 'https://a.test' })).toHaveLength(1);
  });
  it('4.3 NIEGA: un botón ya pulsado que reaparece en un mensaje posterior, por teléfono; otro teléfono no cuenta', () => {
    const e = estadoUxNuevo();
    expect(violacionesDeTurno(e, null, [msgA('591', 'Elige.', BOTONES('planes'))])).toEqual([]);
    expect(violacionesDeTurno(e, ['591', 'planes'], [msgA('591', 'Listo.', BOTONES('equipo'))])).toEqual([]);
    expect(violacionesDeTurno(e, null, [msgA('591', 'Otra vez.', BOTONES('planes'))])).toHaveLength(1);
    expect(violacionesDeTurno(e, null, [msgA('592', 'Otra persona.', BOTONES('planes'))])).toEqual([]);
    expect(idsDeOpciones(BOTONES('a', 'b'))).toEqual(['a', 'b']);
    expect(toqueDeEntrada(toqueEntrada('591', 'planes'))).toEqual(['591', 'planes']);
    expect(toqueDeEntrada({ body: { value: { messages: [{ from: '591', text: { body: 'hola' } }] } } })).toBeNull();
  });
  it('3.1 y UX-5 NIEGA dentro del turno: párrafo largo y pregunta por opciones en texto plano', () => {
    const e = estadoUxNuevo();
    const t = { type: 'text', text: { body: 'x' } };
    expect(violacionesDeTurno(e, null, [msgA('591', 'Hola. Tenemos de todo. Mira lo que quieras.', t)]).some((x) => x.startsWith('3.1'))).toBe(true);
    expect(violacionesDeTurno(e, null, [msgA('591', '¿Quieres planes o prefieres hablar con el equipo?', t)])).toEqual(['UX-5 pregunta por opciones sin botón ni lista']);
    expect(violacionesDeTurno(e, null, [msgA('591', '¿Quieres planes o prefieres hablar con el equipo?', BOTONES('a', 'b'))])).toEqual([]);
  });
  it('vigilarUx envuelve el turno, lo cuenta y rompe ante una violación', () => {
    const turnos = [
      { mensajes: [msgA('591', 'Hola. Bienvenido.', { type: 'text' })] },
      { mensajes: [msgA('591', 'Uno es esto. Dos es aquello. Tres es lo otro.', { type: 'text' })] },
    ];
    let i = 0;
    const mundo = { turno: () => turnos[i++] } as unknown as Mundo;
    const c = vigilarUx(mundo);
    expect(() => mundo.turno({})).not.toThrow();
    expect(() => mundo.turno({})).toThrow(/vigilante de UX violado/);
    expect(c.turnos).toBe(2);
  });
});

describe('el registro de flujos de venta', () => {
  const produccion = flujosDeProduccion();
  const nombres = new Set(produccion.map(nombreDe));
  it('todo flujo de venta nombrado existe entre los de producción', () => {
    expect(FLUJOS_DE_VENTA.filter((n) => !nombres.has(n))).toEqual([]);
  });
  it('NIEGA: un flujo de producción con cobro («Cotejar en el servidor») que no está en la lista de venta ni declarado como «no es de venta» es un hueco', () => {
    const huecos = produccion.filter((r) => leerFlujo(r).nodes.some((n) => n.name === 'Cotejar en el servidor') && atiendeCliente(leerFlujo(r)))
      .map(nombreDe).filter((n) => !(FLUJOS_DE_VENTA as readonly string[]).includes(n) && !(n in NO_SON_DE_VENTA));
    expect(huecos, 'declare el flujo en FLUJOS_DE_VENTA o en NO_SON_DE_VENTA').toEqual([]);
  });
  it('todo flujo de venta tiene su adaptador o su declaración en SIN_ADAPTADOR (con porqué), y ninguno está en los dos; la lista solo baja', () => {
    for (const n of FLUJOS_DE_VENTA) expect(n in ADAPTADORES !== n in SIN_ADAPTADOR, n).toBe(true);
    for (const [n, porque] of Object.entries(SIN_ADAPTADOR)) { expect(porque.length, n).toBeGreaterThan(30); expect(FLUJOS_DE_VENTA as readonly string[], n).toContain(n); }
    expect(Object.keys(SIN_ADAPTADOR).length).toBeLessThanOrEqual(TOPE_SIN_ADAPTADOR);
  });
});

describe('el estándar del asistente de venta, con modelo simulado sobre el JSON de producción', () => {
  const mediciones = new Map<string, Medicion>();
  const de = (flujo: string): Medicion => {
    let m = mediciones.get(flujo);
    if (!m) { m = medir(ADAPTADORES[flujo]!); mediciones.set(flujo, m); }
    return m;
  };
  for (const flujo of Object.keys(ADAPTADORES)) {
    for (const punto of PUNTOS) {
      const clave = `${flujo}|${punto.id}`;
      it(`${punto.id} ${punto.titulo} — ${flujo}`, () => {
        const problemas = punto.evaluar(de(flujo));
        if (clave in EXCEPCIONES) {
          expect(EXCEPCIONES[clave]!.length, `la excepción ${clave} necesita su porqué`).toBeGreaterThan(30);
          expect(problemas.length, `la excepción ${clave} SOBRA: el flujo ya cumple ${punto.id}; bórrela`).toBeGreaterThan(0);
        } else {
          expect(problemas, `${flujo} incumple ${punto.id}: arréglelo o declare la excepción con su porqué`).toEqual([]);
        }
      });
    }
  }
  it('toda excepción nombra un flujo con adaptador y un punto que existe; la lista no crece', () => {
    const ids = new Set(PUNTOS.map((p) => p.id));
    for (const clave of Object.keys(EXCEPCIONES)) {
      const [flujo, punto] = clave.split('|') as [string, string];
      expect(flujo in ADAPTADORES, clave).toBe(true);
      expect(ids.has(punto), clave).toBe(true);
    }
    expect(Object.keys(EXCEPCIONES).length).toBeLessThanOrEqual(TOPE_EXCEPCIONES);
  });
});
