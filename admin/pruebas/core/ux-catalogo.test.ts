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
import { ADAPTADORES, NO_SON_DE_VENTA, PUNTOS, dosCategorias, SIN_ADAPTADOR, flujosDeVenta, medir, type Medicion } from './ux/estandar-venta';
import { leerFuentes } from './fuente-vm';
import { ARCHIVOS_DE_PIEZAS, DADOS_DE_BAJA, SIN_PIEZAS_COMUNES, VENCE_MAXIMO, piezasFaltantes, problemasDeVencimiento, type ExcepcionConVencimiento } from './ux/piezas-de-catalogo';

const nombreDe = (ruta: string): string => idDeFlujo(ruta).split('/').pop()!;

const SIN_PIEZA = 'No usa las piezas comunes del catálogo (`lista-de-catalogo.js`, `intencion-de-catalogo.js`, `boton-del-catalogo.js`); la adopción es de su dueño.';
const SIN_PARTIDOR = 'No parte los párrafos del modelo con la pieza común (`ctParrafos`); su texto largo llega tal cual.';
const ex = (motivo: string): ExcepcionConVencimiento => ({ motivo, vence: VENCE_MAXIMO });
/** Excepciones declaradas: `<punto>|<flujo>` → porqué y vencimiento (31/01/2027). SOLO BAJA. */
export const EXCEPCIONES: Record<string, ExcepcionConVencimiento> = {
  'casa-bermejo.json|1.1': ex('Una pregunta de listado la contesta el modelo y puede salir «No encuentro eso en nuestro catálogo» tras el saludo; sin reconocedor por código. ' + SIN_PIEZA + ' (Casa Bermejo las adopta en el bloque B2, que retira estas excepciones.)'),
  'casa-bermejo.json|1.2': ex('El botón «Ver catálogo» no sale en el saludo ni al pedirlo ni cuando no se encuentra lo nombrado: no usa `cwConBotonCatalogo`. ' + SIN_PIEZA),
  'casa-bermejo.json|2.3': ex('No manda lista interactiva de catálogo; un toque de fila viejo llega al modelo. ' + SIN_PIEZA),
  'casa-bermejo.json|4.2': ex('El saludo sale solo como texto, sin botones ni lista. ' + SIN_PIEZA),
  'walisuma.json|1.1': ex('El listado lo contesta el modelo tras el saludo y puede negar el catálogo. ' + SIN_PIEZA + ' (Walisuma NO se migra en este PR.)'),
  'walisuma.json|2.3': ex('No manda lista interactiva de catálogo; un toque de fila viejo llega al modelo. ' + SIN_PIEZA + ' (Walisuma NO se migra en este PR.)'),
  'walisuma.json|3.1': ex(SIN_PARTIDOR + ' (Walisuma NO se migra en este PR.)'),
};
export const TOPE_EXCEPCIONES = 7;
export const TOPE_SIN_ADAPTADOR = 3;

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

describe('el registro de flujos de venta (descubierto de `flujosDeProduccion`, no escrito a mano)', () => {
  const produccion = flujosDeProduccion();
  const nombres = new Set(produccion.map(nombreDe));
  const venta = flujosDeVenta();
  it('I1: la lista de flujos de venta sale del registro: nunca vacía, sin los dados de baja ni los «no es de venta», y cada declaración nombra un flujo que existe', () => {
    expect(venta.length).toBeGreaterThan(0);
    for (const n of venta) expect(nombres.has(n), n).toBe(true);
    for (const n of Object.keys(DADOS_DE_BAJA)) { expect(nombres.has(n), `${n} dado de baja debe existir (si ya se retiró, bórrelo)`).toBe(true); expect(venta, n).not.toContain(n); }
    for (const n of Object.keys(NO_SON_DE_VENTA)) { expect(nombres.has(n), n).toBe(true); expect(venta, n).not.toContain(n); }
  });
  it('I1 NIEGA: todo flujo de producción con cobro («Cotejar en el servidor») que atiende clientes es de venta, «no es de venta» o dado de baja: no hay hueco', () => {
    const huecos = produccion.filter((r) => leerFlujo(r).nodes.some((n) => n.name === 'Cotejar en el servidor') && atiendeCliente(leerFlujo(r)))
      .map(nombreDe).filter((n) => !venta.includes(n) && !(n in NO_SON_DE_VENTA) && !(n in DADOS_DE_BAJA));
    expect(huecos, 'declare el flujo en NO_SON_DE_VENTA o en DADOS_DE_BAJA (con su porqué)').toEqual([]);
  });
  it('I1: Q\'Taco y Demo B ENTRAN a la lista de venta (declarados sin adaptador, con su porqué), no quedan fuera por omisión', () => {
    for (const n of ['venta-minima.qtaco.json', 'venta-minima.qtaco-3727.json', 'demo-b-venta-cobro.json']) { expect(venta, n).toContain(n); expect(n in SIN_ADAPTADOR, n).toBe(true); }
  });
  it('todo flujo de venta tiene su adaptador o su declaración en SIN_ADAPTADOR (con porqué), y ninguno está en los dos; la lista solo baja', () => {
    for (const n of venta) expect(n in ADAPTADORES !== n in SIN_ADAPTADOR, n).toBe(true);
    for (const n of Object.keys(SIN_ADAPTADOR)) expect(venta, `${n} está en SIN_ADAPTADOR pero no es un flujo de venta del registro`).toContain(n);
    expect(Object.keys(SIN_ADAPTADOR).length).toBeLessThanOrEqual(TOPE_SIN_ADAPTADOR);
  });
});

describe('I2: las piezas comunes del catálogo las USA todo flujo de venta, o figura en una excepción con vencimiento', () => {
  const venta = flujosDeVenta();
  const rutaDe = (n: string): string => flujosDeProduccion().find((r) => nombreDe(r) === n)!;
  for (const n of venta) {
    it(`${n}: ${n in SIN_PIEZAS_COMUNES ? 'excepción declarada y sigue sin usarlas (si ya las usa, SOBRA)' : 'usa la intención, la lista y el botón comunes'}`, () => {
      const faltan = piezasFaltantes(leerFlujo(rutaDe(n)));
      if (n in SIN_PIEZAS_COMUNES) expect(faltan.length, `la excepción de ${n} SOBRA: ya usa las piezas comunes; bórrela`).toBeGreaterThan(0);
      else expect(faltan, `${n} no usa las piezas comunes del catálogo: conéctelas o declare la excepción con su porqué y su vencimiento`).toEqual([]);
    });
  }
  it('toda excepción de piezas nombra un flujo de venta del registro; la lista no crece', () => {
    for (const n of Object.keys(SIN_PIEZAS_COMUNES)) expect(venta, n).toContain(n);
    expect(Object.keys(SIN_PIEZAS_COMUNES).length).toBeLessThanOrEqual(5);
  });
  // CONTRAPRUEBAS: con las piezas anuladas la invariante falla (antes pasaba en verde).
  const nodoCon = (codigo: string) => ({ nodes: [{ name: 'Armar mensajes', type: 'n8n-nodes-base.code', parameters: { jsCode: codigo } }], connections: {} }) as never;
  const COMPLETO = 'const i = icIntencion(t, v); const m = icMensajeLista(v, monto); cwConBotonCatalogo(m, url);';
  it('NIEGA: un flujo que llama a las tres piezas no tiene faltantes', () => {
    expect(piezasFaltantes(nodoCon(COMPLETO))).toEqual([]);
    expect(piezasFaltantes(nodoCon('icPideListado(t); icMensajeLista(v, m); cwConBotonCatalogo(x, u);'))).toEqual([]);
  });
  it('NIEGA: sin las piezas, o con una pieza solo declarada o solo en un comentario, falla y dice cuál falta', () => {
    expect(piezasFaltantes(nodoCon('return [];'))).toEqual(['intención de catálogo', 'lista de catálogo', 'botón del catálogo']);
    expect(piezasFaltantes(nodoCon(COMPLETO.replace('cwConBotonCatalogo(m, url);', '')))).toEqual(['botón del catálogo']);
    expect(piezasFaltantes(nodoCon('function icIntencion(a) { return a; } function icMensajeLista() {} function cwConBotonCatalogo() {}'))).toHaveLength(3);
    expect(piezasFaltantes(nodoCon('// icIntencion(t) icMensajeLista(v) cwConBotonCatalogo(m)\n/* icIntencion(t) */ return [];'))).toHaveLength(3);
  });
  it('NIEGA (I-A): un flujo que INCLUYE el texto de las piezas y no las llama sigue sin usarlas; si las llama, sí', () => {
    const piezas = leerFuentes(ARCHIVOS_DE_PIEZAS);
    expect(piezasFaltantes(nodoCon(`${piezas}\nreturn [];`))).toEqual(['intención de catálogo', 'lista de catálogo', 'botón del catálogo']);
    expect(piezasFaltantes(nodoCon(`${piezas}\n${COMPLETO}`))).toEqual([]);
  });
  it('NIEGA: anular la pieza en un flujo real que figura sin excepción hace fallar la invariante (se simula quitando las llamadas)', () => {
    const real = leerFlujo(rutaDe(venta[0]!));
    const anulado = JSON.parse(JSON.stringify(real).replace(/cwConBotonCatalogo|icMensajeLista|icIntencion|icPideListado/g, 'anulada')) as never;
    expect(piezasFaltantes(anulado)).toHaveLength(3);
  });
});

describe('I3: toda excepción vence el 31/01/2027 a más tardar, y vencida falla', () => {
  const TODAS: Array<[string, Record<string, ExcepcionConVencimiento>]> = [
    ['EXCEPCIONES por punto', EXCEPCIONES], ['SIN_ADAPTADOR', SIN_ADAPTADOR], ['SIN_PIEZAS_COMUNES', SIN_PIEZAS_COMUNES], ['DADOS_DE_BAJA', DADOS_DE_BAJA],
  ];
  for (const [nombre, mapa] of TODAS) {
    it(`${nombre}: todas con porqué y vigentes hoy`, () => {
      expect(Object.keys(mapa).length, nombre).toBeGreaterThan(0);
      expect(problemasDeVencimiento(mapa)).toEqual([]);
      for (const e of Object.values(mapa)) expect(e.vence <= VENCE_MAXIMO).toBe(true);
    });
  }
  const e = (parcial: Partial<ExcepcionConVencimiento> = {}): ExcepcionConVencimiento => ({ motivo: 'Un motivo con sustancia suficiente para valer.', vence: VENCE_MAXIMO, ...parcial });
  it('NIEGA: vencida falla (el día siguiente al 31/01/2027), el último día no', () => {
    expect(problemasDeVencimiento({ a: e() }, new Date('2027-01-31T12:00:00Z'))).toEqual([]);
    expect(problemasDeVencimiento({ a: e() }, new Date('2027-02-01T12:00:00Z'))).toEqual([expect.stringContaining('VENCIÓ')]);
    expect(problemasDeVencimiento(EXCEPCIONES, new Date('2027-03-01T00:00:00Z')).length).toBe(Object.keys(EXCEPCIONES).length);
  });
  it('NIEGA: sin fecha, fecha inválida, más allá del tope o sin porqué fallan', () => {
    expect(problemasDeVencimiento({ a: e({ vence: '' }) })).toEqual([expect.stringContaining('no es una fecha')]);
    expect(problemasDeVencimiento({ a: e({ vence: 'pronto' }) })).toEqual([expect.stringContaining('no es una fecha')]);
    expect(problemasDeVencimiento({ a: e({ vence: '2027-02-01' }) })).toEqual([expect.stringContaining('después del tope')]);
    expect(problemasDeVencimiento({ a: e({ motivo: 'corto' }) })).toEqual([expect.stringContaining('porqué')]);
  });
});

describe('3.2 NIEGA: la invariante se prueba a sí misma (viñetas enteras, con precio y de un producto vigente)', () => {
  const p32 = PUNTOS.find((p) => p.id === '3.2')!;
  const real = (): Medicion => medir(ADAPTADORES['casa-bermejo.json']!);
  const conTexto = (m: Medicion, cambia: (t: string) => string): Medicion => {
    const c = structuredClone(m);
    c.conVinetas.mensajes = c.conVinetas.mensajes.map((e) => ({ ...e, cuerpo: cambia(e.cuerpo) }));
    return c;
  };
  it('la medición real cumple 3.2 y el turno con pedido trae las 3 viñetas enteras, una por línea', () => {
    const m = real();
    expect(p32.evaluar(m)).toEqual([]);
    expect(m.lineasEsperadas).toHaveLength(3);
    for (const l of m.lineasEsperadas) expect(m.conVinetas.mensajes.map((e) => e.cuerpo).join('\n').split('\n')).toContain(l);
  });
  it('unir dos viñetas en una línea falla', () => {
    const m = conTexto(real(), (t) => t.replace(/(•[^\n]*)\n(?=•)/, '$1 '));
    expect(p32.evaluar(m).join('|')).toMatch(/más de una viñeta en una línea/);
  });
  it('quitar el precio falla', () => {
    const m = conTexto(real(), (t) => t.replace(/ — Bs [\d.]+/g, ''));
    expect(p32.evaluar(m).join('|')).toMatch(/viñeta sin precio/);
  });
  it('una viñeta con un producto inexistente falla; con otro precio, también', () => {
    expect(p32.evaluar(conTexto(real(), (t) => t.replace('Billetera de cuero', 'Poncho de oro'))).join('|')).toMatch(/producto que no está en el catálogo vigente/);
    expect(p32.evaluar(conTexto(real(), (t) => t.replace('— Bs 450', '— Bs 451'))).join('|')).toMatch(/otro precio/);
  });
  it('un adaptador con una sola categoría da el motivo distinto, sin dos categorías', () => {
    const base = ADAPTADORES['casa-bermejo.json']!;
    const una: typeof base = { ...base, catalogoVigente: () => base.catalogoVigente().map((p) => ({ ...p, categoria: 'Única' })) };
    expect(p32.evaluar(medir(una))).toEqual(['3.2 sin dos categorías en el catálogo del mundo']);
  });
  it('si el flujo descarta el texto del modelo con pedido, 3.2 falla con su motivo propio (nunca verde por omisión)', () => {
    const m = conTexto(real(), () => '¿Qué pieza te interesa?');
    expect(p32.evaluar(m)).toEqual(['3.2 no se puede medir: el flujo no deja pasar texto del modelo con pedido']);
  });
  it('las dos categorías salen por regla fija: las dos con más productos; en empate, la primera por nombre', () => {
    const c = (categoria: string) => ({ nombre: categoria + Math.random(), precio: 1, categoria });
    expect(dosCategorias([c('B'), c('A'), c('C'), c('C')])).toEqual(['C', 'A']);
    expect(dosCategorias([c('Z'), c('A'), c('M')])).toEqual(['A', 'M']);
    expect(dosCategorias([c('A'), c('A')])).toBeNull();
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
          expect(EXCEPCIONES[clave]!.motivo.length, `la excepción ${clave} necesita su porqué`).toBeGreaterThan(30);
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
