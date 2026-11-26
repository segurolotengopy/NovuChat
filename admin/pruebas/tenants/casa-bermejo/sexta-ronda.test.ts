/**
 * SEXTA RONDA DE REVISIÓN de la entrega de Casa Bermejo (25/11/2026): el principio es decidir por ESTADO, no por listas de palabras. Cada hallazgo trae su prueba NEGADA (el caso adverso) y su caso sano.
 * La primera parte prueba la librería pura (`bm-venta.js`); la segunda corre el JSON versionado con el n8n de mentira (`mundo.ts`). Mensajes por conversación: 0 agregados (todo va en el mismo mensaje).
 * Datos ficticios: ninguna URL ni teléfono es real.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';
import { ANA, CATALOGO, catalogoOk, crear, hablar, modelo, modeloAdverso, modeloDeNombre, modeloSano, mTexto, mToque, textoAlModelo, textos, conPedidoListo } from './mundo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '../../../../Flujos/experimental');
const RUTAS = [
  'venta-digital/src/cobro.js', 'venta-digital/src/diferencias.js', '../src/modulos/pedidos/comprobante-diferencias.js', 'venta-digital/src/avisos.js', 'venta-digital/src/conversacion.js', 'venta-digital/src/carrito.js', 'venta-digital/src/catalogo-externo.js',
  '../src/core/sin-agente/mensajes.js', '../src/core/texto/filtro-redaccion.js', '../src/core/texto/identidad.js', '../src/modulos/pedidos/confirmar-pedido.js', '../clientes/casa-bermejo/src/lib/bm.js', '../clientes/casa-bermejo/src/lib/bm-venta.js', 'venta-digital/src/nodos/_comun.js',
].map((r) => join(FLUJOS, r));
const NOMBRES = ['bmMapaTienda', 'bmCiudadDelTexto', 'bmCiDelTexto', 'bmCiDelTextoDet', 'bmFlotaDelTexto', 'bmNombreValido', 'bmPidioDato', 'bmEntregaDeTurno', 'bmEntregaFalta', 'bmEsConsulta', 'bmPideUbicacion', 'bmPreguntaDeTienda', 'bmNorm', 'bmEsEnvio'];
const B = cargarFuente<Record<string, any>>(RUTAS, NOMBRES); // eslint-disable-line @typescript-eslint/no-explicit-any
type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const b = (n: string): Fn => B[n] as Fn;
const MODOS = ['recojo en tienda', 'envío'];
const E = (nueva: unknown, antes: unknown, texto: string, estado: Record<string, unknown> = {}) => b('bmEntregaDeTurno')(nueva, antes, texto, MODOS, estado);
const ENVIO = { modo: 'envío' };

describe('S1. el enlace del mapa: en maps.google.com y google.com la ruta es vacía, «/» o /maps, sin «//» ni los recursos `url` / `local_url`', () => {
  const M = (v: string): string => b('bmMapaTienda')({ mapaTienda: v }) as string;
  const MALOS = ['https://maps.google.com/local_url?q=https://evil.example', 'https://www.google.com/maps/url?q=x', 'https://maps.google.com//evil.example', 'https://www.google.com/search?q=x', 'https://google.com/imgres?imgurl=x', 'https://maps.google.com/maps//x', 'https://maps.google.com/maps/local_url?q=x'];
  for (const malo of MALOS) it(`NEGADO: «${malo}» no es un enlace de mapa`, () => expect(M(malo)).toBe(''));
  for (const bueno of ['https://maps.google.com/?q=ejemplo', 'https://maps.google.com/maps?q=x', 'https://maps.google.com', 'https://www.google.com/maps/place/Ejemplo', 'https://google.com/maps', 'https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123']) {
    it(`sano: «${bueno}» sí`, () => expect(M(bueno)).toBe(bueno));
  }
});

describe('1. la ciudad: «a», «en» y «para» + nombre propio solo si el asistente la pidió; nunca lo ya capturado como nombre o flota', () => {
  const C = (t: string, s = 0, o: Record<string, unknown> = {}): { ciudad: string; rotulada: boolean } => b('bmCiudadDelTexto')(t, s, o);
  it('NEGADO: «envío para Ana Pérez» y «envío a Ana Pérez» sin que se haya pedido la ciudad no dejan ciudad', () => {
    expect(C('envío para Ana Pérez').ciudad).toBe('');
    expect(C('envío a Ana Pérez').ciudad).toBe('');
    const r = E({}, { ...ENVIO }, 'envío para Ana Pérez', { esperaCiudad: false });
    expect(r.entrega.ciudad).toBeUndefined();
  });
  it('NEGADO: aunque se haya pedido la ciudad, lo ya capturado como nombre o como flota no es la ciudad', () => {
    expect(C('para Ana Pérez', 0, { pidio: true, excluir: ['Ana Pérez'] }).ciudad).toBe('');
    expect(C('a Trans Copacabana', 0, { pidio: true, excluir: ['Trans Copacabana'] }).ciudad).toBe('');
    expect(E({}, { ...ENVIO, nombre: 'Ana Pérez' }, 'para Ana Pérez', { esperaCiudad: true }).entrega.ciudad).toBeUndefined();
    expect(E({}, { ...ENVIO, flota: 'Trans Copacabana' }, 'a Trans Copacabana', { esperaCiudad: true }).entrega.ciudad).toBeUndefined();
  });
  it('sano: pedida la ciudad, «a Cochabamba» sí; «ciudad Oruro» y «hasta Tarija» siempre; en un mensaje de datos el tramo «envío a Cochabamba» también', () => {
    expect(C('a Cochabamba', 0, { pidio: true }).ciudad).toBe('Cochabamba');
    const c = C('ciudad Oruro');
    expect(c.ciudad).toBe('Oruro');
    expect(c.rotulada).toBe(true);
    expect(C('hasta Tarija').ciudad).toBe('Tarija');
    expect(E({}, { ...ENVIO }, 'Cochabamba, envío a Cochabamba', { modoPedido: false }).entrega.ciudad).toBeUndefined();
    expect(E({}, {}, 'Ana Pérez, 4412345, envío a Cochabamba, flota Bolivar', { modoPedido: true }).entrega).toMatchObject({ modo: 'envío', ciudad: 'Cochabamba', documento: '4412345', flota: 'Bolivar' });
  });
});

describe('2. el CI: una cifra SIN rótulo solo vale si el asistente pidió el CI, y nunca cuenta como «reconocido»', () => {
  it('NEGADO: «10500» y «celular 591712345» sin rótulo y sin que se haya pedido el CI no son un CI', () => {
    for (const t of ['10500', 'son 10500 bolivianos', 'celular 591712345']) {
      expect(b('bmCiDelTexto')(t, false), t).toBe('');
      expect(E({}, { ...ENVIO }, t, { esperaDocumento: false }).entrega.documento, t).toBeUndefined();
    }
  });
  it('NEGADO: con el CI pedido, el celular con su palabra («celular 591712345») ni el teléfono suelto de 8 dígitos (70012345) son el CI', () => {
    for (const t of ['celular 591712345', '70012345']) expect(E({}, { ...ENVIO }, t, { esperaDocumento: true }).entrega.documento, t).toBeUndefined();
  });
  it('NEGADO: una cifra sin rótulo, aunque se acepte porque se pidió, NO es «reconocido» (no desvía un `quiereHablar` del modelo); con rótulo sí', () => {
    const suelta = E({}, { ...ENVIO }, '4412345', { esperaDocumento: true });
    expect(suelta.entrega.documento).toBe('4412345');
    expect(suelta.reconocido).toBe(false);
    const rotulada = E({}, { ...ENVIO }, 'mi CI es 4412345', { esperaDocumento: false });
    expect(rotulada.entrega.documento).toBe('4412345');
    expect(rotulada.reconocido).toBe(true);
    expect(b('bmCiDelTextoDet')('CI 4412345', false)).toEqual({ valor: '4412345', rotulado: true });
  });
  it('NEGADO: el CI que propone el modelo sin que se pidiera ni se rotulara no se guarda', () => {
    expect(E({ documento: '4412345' }, { ...ENVIO }, 'mi numero es 4412345 pues', { esperaDocumento: false }).entrega.documento).toBeUndefined();
  });
});

describe('3. lo ya capturado no se corrige por texto suelto: solo si el asistente lo pidió o el cliente lo rotula', () => {
  const ANT = { ...ENVIO, nombre: 'Ana Pérez', documento: '4412345', ciudad: 'Oruro', flota: 'Bolivar' };
  it('NEGADO: una cifra, una ciudad o una flota SIN rótulo no sobrescriben el dato guardado', () => {
    expect(E({}, ANT, '5512345', { esperaDocumento: false }).entrega.documento).toBeUndefined();
    expect(E({}, ANT, 'Cochabamba', { esperaCiudad: false }).entrega.ciudad).toBeUndefined();
    expect(E({}, ANT, 'Trans Copacabana', {}).entrega.flota).toBeUndefined();
    expect(E({}, ANT, 'a Cochabamba', { esperaCiudad: false }).entrega.ciudad).toBeUndefined();
  });
  it('sano: «el CI es …», «ciudad …» y «flota …» corrigen el dato guardado; una cifra suelta con el CI pedido también', () => {
    expect(E({}, ANT, 'el CI es 5512345', {}).entrega.documento).toBe('5512345');
    expect(E({}, ANT, 'ciudad Cochabamba', {}).entrega.ciudad).toBe('Cochabamba');
    expect(E({}, ANT, 'flota Trans Copacabana', {}).entrega.flota).toBe('Trans Copacabana');
    expect(E({}, ANT, '5512345', { esperaDocumento: true }).entrega.documento).toBe('5512345');
  });
  it('NEGADO: si el modelo propone un valor DISTINTO al guardado y el código no lo cambió, lo marca (`contradice`): su texto ya no es cierto; el mismo valor no lo marca', () => {
    expect(E({ ciudad: 'La Paz' }, ANT, 'gracias', {}).contradice).toBe(true);
    expect(E({ documento: '9999999' }, ANT, 'gracias', {}).contradice).toBe(true);
    expect(E({ flota: 'Otra' }, ANT, 'gracias', {}).contradice).toBe(true);
    expect(E({ ciudad: 'Oruro', documento: '4.412.345', flota: 'bolivar', nombre: 'Ana Perez' }, ANT, 'gracias', {}).contradice).toBe(false);
    expect(E({}, ANT, 'gracias', {}).contradice).toBe(false);
  });
  it('Argentina: la dirección, el CP y la provincia guardados solo cambian si el cliente los rotula', () => {
    const ar = { ...ENVIO, nombre: 'Ana Pérez', documento: '30123456', direccion: 'Calle Falsa 123', cp: '5500', provincia: 'Mendoza' };
    expect(E({ direccion: 'Av Santa Fe 55' }, ar, 'Av Santa Fe 55', { mercado: 'AR' }).entrega.direccion).toBeUndefined();
    expect(E({ direccion: 'Av Santa Fe 55' }, ar, 'Dirección: Av Santa Fe 55', { mercado: 'AR' }).entrega.direccion).toBe('Av Santa Fe 55');
    expect(E({ provincia: 'Salta' }, ar, 'Salta', { mercado: 'AR' }).entrega.provincia).toBeUndefined();
  });
});

describe('4. el nombre de UNA palabra que bastaba para el retiro no sirve en el envío', () => {
  const sin = { modo: 'envío', ciudad: 'Oruro', nombre: 'Ana', documento: '1234567', flota: 'Bolivar' };
  it('NEGADO: con el envío y «Ana», falta el nombre completo; con «Ana Pérez» no falta nada; el retiro con «Ana» no falta nada', () => {
    expect(b('bmEntregaFalta')(sin, 'BO')).toEqual(['nombre completo']);
    expect(b('bmEntregaFalta')({ ...sin, nombre: 'Ana Pérez' }, 'BO')).toEqual([]);
    expect(b('bmEntregaFalta')({ modo: 'recojo en tienda', nombre: 'Ana' }, 'BO')).toEqual([]);
  });
});

describe('5. el nombre: una cortesía suelta no es un nombre, y el de una palabra lleva mayúscula inicial en lo que escribió el cliente', () => {
  const N = (v: string, texto: string, min = 1): string => b('bmNombreValido')(v, texto, min) as string;
  it('NEGADO: «Gracias», «Perfecto», «Listo», «Ok», «Gracias perfecto» no son nombre', () => {
    for (const t of ['Gracias', 'Perfecto', 'Listo', 'Ok', 'Gracias perfecto', 'Buenas tardes']) expect(N(t, t), t).toBe('');
  });
  it('NEGADO: el nombre de una palabra escrito en minúscula no pasa; con mayúscula sí', () => {
    expect(N('silvana', 'silvana')).toBe('');
    expect(N('Silvana', 'Silvana')).toBe('Silvana');
    expect(N('Silvana', 'me llamo silvana')).toBe('');
  });
  it('sano: «Vale», «Mariana», «Ana Pérez» y «Ana Factura» se aceptan', () => {
    for (const t of ['Vale', 'Mariana']) expect(N(t, t), t).toBe(t);
    expect(N('Ana Pérez', 'ana pérez', 2)).toBe('Ana Pérez');
    expect(N('Ana Factura', 'Ana Factura', 2)).toBe('Ana Factura');
  });
});

describe('6. la flota se corta en la preposición del destino', () => {
  const F = (t: string): string => b('bmFlotaDelTexto')(t) as string;
  it('NEGADO: «flota Bolívar a Tarija», «terminal Trans Copacabana para Oruro» y «flota Bolívar hasta Sucre» no meten el destino en la flota', () => {
    expect(F('flota Bolívar a Tarija')).toBe('Bolívar');
    expect(F('terminal Trans Copacabana para Oruro')).toBe('Trans Copacabana');
    expect(F('flota Bolívar hasta Sucre')).toBe('Bolívar');
  });
  it('sano: «flota Bolivar» y «flota Bolívar, ciudad Oruro» siguen igual', () => {
    expect(F('flota Bolivar')).toBe('Bolivar');
    expect(F('flota Bolívar, ciudad Oruro')).toBe('Bolívar');
  });
});

describe('7 y 10. «¿y dónde está?» con un pedido en curso no contesta la dirección; el compuesto horario + dónde se detecta entero', () => {
  const U = (t: string, enCurso: boolean): boolean => b('bmPideUbicacion')(b('bmNorm')(t), t, enCurso) as boolean;
  it('NEGADO: con pedido en curso, «¿y dónde está?» sin sujeto de tienda no piden la ubicación; sin pedido sí', () => {
    for (const t of ['¿y dónde está?', 'y dónde están']) { expect(U(t, true), t).toBe(false); expect(U(t, false), t).toBe(true); }
  });
  it('sano: con pedido en curso, con el sujeto de tienda o «ubicados» sí', () => {
    for (const t of ['dónde queda', '¿dónde queda la tienda?', '¿dónde están ubicados?', '¿dónde está el local?', '¿dónde están ustedes?']) expect(U(t, true), t).toBe(true);
  });
  it('el compuesto «¿Cuál es el horario y dónde están?» trae las dos preguntas y nada de resto', () => {
    expect(b('bmPreguntaDeTienda')('¿Cuál es el horario y dónde están?', false)).toEqual({ ubicacion: true, horario: true, resto: '' });
  });
  it('NEGADO: «¿y dónde está?» con pedido en curso queda como resto para el modelo (no es una pregunta de la tienda)', () => {
    const r = b('bmPreguntaDeTienda')('¿y dónde está?', true);
    expect(r.ubicacion).toBe(false);
    expect(r.resto).not.toBe('');
  });
});

describe('13. «Mi nombre es Hacen Torrez» no es una consulta por llevar «hacen» de apellido', () => {
  const C = (t: string): boolean => b('bmEsConsulta')(t) as boolean;
  it('NEGADO: el nombre dicho con su rótulo no es consulta; lo que de verdad pregunta sí', () => {
    for (const t of ['Mi nombre es Hacen Torrez', 'Me llamo Hacen Torrez', 'mi nombre es Ana Pérez']) expect(C(t), t).toBe(false);
    for (const t of ['Mi nombre es Ana, hacen envíos', 'hacen envíos', '¿Mi nombre es Ana? ¿hacen envío?', 'Hacen envío a Oruro']) expect(C(t), t).toBe(true);
  });
});

describe('12. el estado «el asistente pidió el dato» sale de la PREGUNTA real, no de que el texto nombre la palabra', () => {
  const P = (t: string, clase: string): boolean => b('bmPidioDato')(t, clase) as boolean;
  it('sano: las preguntas y la lista del código piden el nombre, la ciudad y el CI', () => {
    expect(P('¿A nombre de quién retira?', 'nombre')).toBe(true);
    expect(P('¿Me indicas tu nombre?', 'nombre')).toBe(true);
    const lista = 'Para continuar con su pedido, indíqueme por favor: nombre completo, carnet de identidad (CI), ciudad de destino, empresa de flota o terminal.';
    for (const clase of ['nombre', 'ciudad', 'documento']) expect(P(lista, clase), clase).toBe(true);
    expect(P('¿A qué ciudad lo enviamos?', 'ciudad')).toBe(true);
  });
  it('NEGADO: nombrar el dato sin pedirlo no lo pide («a nombre de Ana», «Nombre: Ana», la ciudad de la tienda, el recibo del CI)', () => {
    expect(P('Anoté tu pedido a nombre de Ana Pérez.', 'nombre')).toBe(false);
    expect(P('Datos de entrega: Nombre: Ana Pérez', 'nombre')).toBe(false);
    expect(P('Estamos en la ciudad de La Paz.', 'ciudad')).toBe(false);
    expect(P('Recibí tu CI, gracias.', 'documento')).toBe(false);
    expect(P('Con gusto, sigo atento a lo que necesite.', 'nombre')).toBe(false);
  });
});

// ------------------------------------------------------------------------------ el flujo versionado
const DIR = 'Calle Ejemplo 123, zona Centro';
const MAPA = 'https://maps.app.goo.gl/EjemploDePrueba1';
const HORARIO = 'lunes a sábado de 9 a 19';
const DATOS = { ubicacionTienda: DIR, mapaTienda: MAPA, horarioTienda: HORARIO };
const J = (x: unknown): string => JSON.stringify(x);
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
type FichaT = { carrito: { id: string }[]; entrega: Record<string, string>; hist: { r: string; t: string }[] };
const ficha = (m: Mund): FichaT => (m.sd['casabermejo'] as Record<string, FichaT>)[ANA]!;
const corridos = (t: Turno): string[] => t.registro.map((r) => r.nodo);
const llamoAlModelo = (t: Turno): boolean => corridos(t).includes('Conversar con el modelo');
const plan = (t: Turno): string => String(((t.porNodo['Armar mensajes']?.[0] ?? {}) as { plan?: string }).plan ?? '');
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
const cuerpoDe = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' ');
const cuerpoInteractivo = (t: Turno): string => String(((t.mensajes[0]?.payload['interactive'] as { body?: { text?: string } } | undefined)?.body?.text) ?? '');

describe('9. la respuesta de la tienda sale también cuando el resto del mensaje lo decide el código (identidad, factura, QR), en el mismo mensaje', () => {
  it('«¿Dónde están ubicados? ¿Eres un bot?»: UN mensaje con la dirección, el mapa y la identidad, sin modelo ni aviso', () => {
    const t = hablar(crear({ base: DATOS, modeloDice: modeloAdverso() }), ANA, mTexto('¿Dónde están ubicados? ¿Eres un bot?'));
    expect(t.mensajes).toHaveLength(1);
    expect(plan(t)).toBe('identidad');
    expect(cuerpoDe(t)).toContain(DIR);
    expect(J(t.mensajes)).toContain(MAPA);
    expect(cuerpoDe(t)).toMatch(/asistente virtual/i);
    expect(llamoAlModelo(t)).toBe(false);
    expect(t.avisos).toHaveLength(0);
  });
  it('NEGADO: sin el dato de la tienda no se inventa nada ni se contesta la identidad a medias: pasa con recepción (aviso + botón)', () => {
    const t = hablar(crear({ modeloDice: modeloAdverso() }), ANA, mTexto('¿Dónde están ubicados? ¿Eres un bot?'));
    expect(plan(t)).toBe('derivar');
    expect(t.avisos).toHaveLength(1);
    expect(J(t.mensajes)).not.toContain(DIR);
  });
  it('«¿A qué hora abren? Necesito factura»: la derivación a recepción lleva el horario antepuesto, en el mismo mensaje', () => {
    const t = hablar(crear({ base: DATOS, modeloDice: modeloAdverso() }), ANA, mTexto('¿A qué hora abren? Necesito factura'));
    expect(t.mensajes).toHaveLength(1);
    expect(plan(t)).toBe('derivar');
    expect(J(t.mensajes)).toContain(HORARIO);
    expect(t.avisos).toHaveLength(1);
    expect(J(t.mensajes)).not.toContain(DIR);
  });
  it('«¿Dónde están ubicados? Quiero pagar» con el pedido listo: el QR sale y el texto que lo acompaña lleva la dirección (2 mensajes, igual que sin la pregunta)', () => {
    const m = conPedidoListo({ base: DATOS });
    const t = hablar(m, ANA, mTexto('¿Dónde están ubicados? Quiero pagar'));
    expect(hayQr(t)).toBe(true);
    expect(t.mensajes).toHaveLength(2);
    expect(cuerpoDe(t)).toContain(DIR);
    const sin = hablar(conPedidoListo({ base: DATOS }), ANA, mTexto('Quiero pagar'));
    expect(sin.mensajes).toHaveLength(2);
    expect(cuerpoDe(sin)).not.toContain(DIR);
  });
  it('la memoria guarda el turno COMPLETO: lo que escribió el cliente entero y la respuesta de la tienda', () => {
    const m = crear({ base: DATOS, modeloDice: modeloSano(() => ({}), 'Con gusto, lo anoto.') });
    hablar(m, ANA, mTexto('¿Dónde están ubicados? Quiero una billetera'));
    const h = ficha(m).hist;
    expect(h.some((x) => x.r === 'u' && /ubicados/.test(x.t) && /billetera/.test(x.t))).toBe(true);
    expect(h.some((x) => x.r === 'm' && x.t.includes('Calle Ejemplo'))).toBe(true);
  });
});

describe('10. «¿Cuál es el horario y dónde están?»: las dos preguntas; sin el horario cargado no se contesta la dirección dejando la otra pregunta sin respuesta', () => {
  it('con los dos datos: UN mensaje con la dirección y el horario, sin modelo', () => {
    const t = hablar(crear({ base: DATOS, modeloDice: modeloAdverso() }), ANA, mTexto('¿Cuál es el horario y dónde están?'));
    expect(t.mensajes).toHaveLength(1);
    expect(cuerpoDe(t)).toContain(DIR);
    expect(cuerpoDe(t)).toContain(HORARIO);
    expect(llamoAlModelo(t)).toBe(false);
  });
  it('NEGADO: con la dirección pero SIN horario, no contesta solo la dirección: pasa con recepción (aviso + botón)', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA }, modeloDice: modeloAdverso() }), ANA, mTexto('¿Cuál es el horario y dónde están?'));
    expect(plan(t)).toBe('derivar');
    expect(t.avisos).toHaveLength(1);
    expect(J(t.mensajes)).not.toContain(DIR);
    expect(llamoAlModelo(t)).toBe(false);
  });
});

describe('7. «¿y dónde está?» con un pedido en curso no contesta la dirección de la tienda', () => {
  it('NEGADO: con la billetera en el pedido, «¿y dónde está?» sigue al modelo y no sale la dirección; «¿dónde queda la tienda?» sí la contesta', () => {
    const m = crear({ base: DATOS, modeloDice: modeloSano(() => ({}), 'Con gusto.') });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t = hablar(m, ANA, mTexto('¿y dónde está?'));
    expect(plan(t)).not.toBe('ubicacion_tienda');
    expect(J(t.mensajes)).not.toContain(DIR);
    expect(llamoAlModelo(t)).toBe(true);
    const t2 = hablar(m, ANA, mTexto('¿dónde queda la tienda?'));
    expect(plan(t2)).toBe('ubicacion_tienda');
    expect(cuerpoDe(t2)).toContain(DIR);
  });
  it('sano: sin pedido en curso, «¿y dónde está?» sí la contesta (sin modelo)', () => {
    const t = hablar(crear({ base: DATOS, modeloDice: modeloAdverso() }), ANA, mTexto('¿y dónde está?'));
    expect(plan(t)).toBe('ubicacion_tienda');
    expect(cuerpoDe(t)).toContain(DIR);
    expect(llamoAlModelo(t)).toBe(false);
  });
});

describe('8. «domicilio» y «delivery» se anotan como envío por flota: piden CI, ciudad y flota o terminal', () => {
  it('la frase «delivery» fija el modo de envío y el asistente pide los datos del envío por flota (la lista del comercio es la que decide los modos)', () => {
    const m = crear({ base: { modosDeEntrega: 'Retiro en tienda, Envío a domicilio' }, modeloDice: modeloSano() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t = hablar(m, ANA, mTexto('delivery'));
    expect(ficha(m).entrega['modo']).toBe('Envío a domicilio');
    expect(cuerpoDe(t)).toMatch(/carnet de identidad \(CI\)/);
    expect(cuerpoDe(t)).toMatch(/empresa de flota o terminal/);
  });
  it('NEGADO: «tienen delivery?» es una consulta: no elige el modo', () => {
    const m = crear({ base: { modosDeEntrega: 'Retiro en tienda, Envío a domicilio' }, modeloDice: modeloSano() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('¿tienen delivery?'));
    expect(ficha(m).entrega['modo']).toBe('');
  });
});

describe('12. el estado del asistente: derivar lo deja en la memoria, y «nombre» a secas en el texto no es pedirlo', () => {
  const conNombrePedido = (): Mund => {
    const m = crear({ modeloDice: modeloDeNombre() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    return m;
  };
  it('NEGADO: tras derivar con recepción (el asistente ya no está pidiendo el nombre) el «Silvana» siguiente no se guarda; el asistente lo vuelve a pedir y con eso sí', () => {
    const m = conNombrePedido();
    const t = hablar(m, ANA, mTexto('quiero hablar con una persona'));
    expect(plan(t)).toBe('derivar');
    expect(ficha(m).hist.filter((x) => x.r === 'm').pop()?.t ?? '').not.toMatch(/nombre/i);
    hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega['nombre']).toBe('');
    hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega['nombre']).toBe('Silvana');
  });
  it('sano: sin derivar, «Silvana» se guarda en el turno que sigue a la pregunta', () => {
    const m = conNombrePedido();
    hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega['nombre']).toBe('Silvana');
  });
  it('NEGADO: un último mensaje del asistente que solo nombra el nombre («anoté tu pedido a nombre de Ana») no es pedirlo; con la pregunta real sí', () => {
    const m = conNombrePedido();
    for (const h of ficha(m).hist) if (h.r === 'm') h.t = 'Anoté tu pedido a nombre de Ana Pérez.';
    hablar(m, ANA, mTexto('Silvana'));
    expect(ficha(m).entrega['nombre']).toBe('');
    const m2 = conNombrePedido();
    for (const h of ficha(m2).hist) if (h.r === 'm') h.t = '¿A nombre de quién retira?';
    hablar(m2, ANA, mTexto('Silvana'));
    expect(ficha(m2).entrega['nombre']).toBe('Silvana');
  });
});

describe('11. el cuerpo de «Confirmar pedido» cabe en 1.024 caracteres con un pedido grande, sin cortar el mapa ni los datos', () => {
  const PIEZAS = Array.from({ length: 24 }, (_, i) => ({ id: `pieza-${String(i + 1).padStart(2, '0')}`, nombre: `Pieza decorativa de colección número ${String(i + 1).padStart(2, '0')} en cuero y alpaca`, descripcion: 'Pieza.', area: 'Hogar', precio: 100 + i, moneda: 'BOB', activo: true }));
  const items = (cuantas: number): Record<string, unknown>[] => PIEZAS.slice(0, cuantas).map((c) => ({ ...c, precioCentavos: Math.round(c.precio * 100), stock: 10, disponible: true }));
  const charla = (cuantas: number, ultimo: string): Turno => {
    const lineas = PIEZAS.slice(0, cuantas).map((p) => ({ id: p.id, cantidad: 1 }));
    let n = 0;
    const m = crear({ base: DATOS, catalogo: catalogoOk({}, items(cuantas) as never), modeloDice: (ll: LlamadaDoble) => { n++; return modelo('Anoté todo.', { lineas, entrega: n === 1 ? {} : { nombre: textoAlModelo(ll) } }); } });
    hablar(m, ANA, mTexto('quiero todo'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    return hablar(m, ANA, mTexto(ultimo));
  };
  it('NEGADO: con 24 piezas y la pregunta de la tienda en el mismo turno el cuerpo mide a lo más 1.024; el mapa entero, los datos, «Corregir datos», el total y la instrucción siguen', () => {
    const t = charla(24, '¿Dónde están ubicados? Ana Pérez');
    const cuerpo = cuerpoInteractivo(t);
    expect(cuerpo.length).toBeLessThanOrEqual(1024);
    expect(cuerpo).toContain(MAPA);
    expect(cuerpo).toContain('Retira: Ana Pérez');
    expect(cuerpo).toContain('Corregir datos');
    expect(cuerpo).toContain('Total:');
    expect(cuerpo).toMatch(/Si todo está bien, toca/);
    expect(cuerpo).toMatch(/y \d+ piezas? más/);
    expect(t.mensajes).toHaveLength(1);
  });
  it('sano: con una sola pieza no se quita nada (sin «piezas más») y el mensaje es el de siempre', () => {
    const t = charla(1, 'Ana Pérez');
    const cuerpo = cuerpoInteractivo(t);
    expect(cuerpo).not.toMatch(/piezas? más/);
    expect(cuerpo).toContain('Retira: Ana Pérez');
    expect(cuerpo.length).toBeLessThanOrEqual(1024);
  });
});

describe('0 mensajes agregados por conversación: lo de esta ronda va en el mismo mensaje', () => {
  it('un turno con la pregunta de la tienda y la billetera sigue siendo UN mensaje', () => {
    const t = hablar(crear({ base: DATOS, modeloDice: modeloSano(() => ({}), 'Con gusto.') }), ANA, mTexto('¿Dónde están ubicados? Quiero una billetera'));
    expect(t.mensajes).toHaveLength(1);
    expect(textos(t).join(' ')).toContain(DIR);
  });
  it('el catálogo de prueba no cambia: la billetera sigue existiendo (guarda de la propia suite)', () => {
    expect(CATALOGO.some((c) => c.id === 'billetera-cuero')).toBe(true);
  });
});
