/**
 * LA RÁFAGA — DE PUNTA A PUNTA sobre flujos REALES, con la pieza injertada EN MEMORIA (los JSON no se tocan).
 *
 * Walisuma (mundo de `tenants/walisuma/mundo.ts`: el código de los nodos es el real, la red son dobles): dos textos seguidos, «quiero 2 cajas» y
 * «de la grande, para mañana». Con `fuente: 'Normalizar entrada'` y `campos: {texto: 'texto'}` (Walisuma emite `texto`, no `userInput`):
 *   - la ejecución del primer texto termina en SILENCIO: ningún envío;
 *   - la del segundo manda UN solo mensaje y «Agrupar ráfaga» entrega `textoDelTurno` con AMBOS mensajes, en orden, y sin dejar el último en blanco;
 *   - un mensaje aislado responde como hoy; con la consulta caída responde solo (falla abierto); un audio no espera ni se calla.
 * El simulador de la «consulta» es el servidor de mentira: devuelve el hilo tal como estaría al terminar la espera de cada ejecución.
 * Bellido (agenda-minima.v0, motor propio de su suite): se prueba que, con la pieza, el primer texto se calla y el segundo entrega el texto agrupado; el resto del flujo
 * (calendario, Gemini) lo cubre su suite, aquí responden dobles vacíos y un fallo posterior a «Agrupar ráfaga» se tolera.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { correr, type J } from '../lib/flujo';
import { crearMundo } from '../lib/n8n-de-mentira';
import { RAIZ_FLUJOS } from '../../scripts/ensamblar-flujo.mjs';
import { NORMALIZADORES_VERIFICADOS, huellaDe, injertarRafaga, quitarRafaga } from '../../../Flujos/src/core/rafaga/rafaga.mjs';
import { cablearBellido, cablearWalisuma } from './rafaga-cableado';
import { ANA, PRODUCCION, crear, hablar, mAudio, mTexto, modelo, panelOk, valorMeta } from '../tenants/walisuma/mundo';

const ANCLA_WALISUMA = { nodo: '¿Bajar medio?', salida: 1, destino: 'Decidir turno' };
const frag = (idMeta: string, texto: string, ms: number, tipo = 'text') => ({ idMeta, tipo, texto, ms });
const UNO = 'quiero 2 cajas';
const DOS = 'de la grande, para mañana';
const TRES = 'y que sean de cuero';

/**
 * Walisuma con la pieza y el CABLEADO MÍNIMO (`rafaga-cableado.ts`: «Decidir turno» lee `textoDelTurno`, como en el PR del flujo): sin consumidor, la pieza sola PIERDE el primer texto.
 * `consumidor: 'Decidir turno'` es obligatorio y verificado por el injerto.
 */
function conRafaga(): J {
  return injertarRafaga(cablearWalisuma(structuredClone(PRODUCCION)), { ancla: ANCLA_WALISUMA, fuente: 'Normalizar entrada', campos: { texto: 'texto' }, consumidor: 'Decidir turno' }) as J;
}
/** El servidor de mentira: el hilo tal como estaría al terminar la espera de cada ejecución (ya trae lo que llegó dentro de la ventana). */
const hilo = (...textos: string[]) => ({ rafaga: { v: 1, fragmentos: textos.map((t, i) => frag(`wamid.${'ABC'[i]}`, t, 1000 + i * 800)) } });
const ordenado = (cuerpo: unknown, ...textos: string[]): boolean => {
  const t = JSON.stringify(cuerpo);
  const posiciones = textos.map((x) => t.indexOf(x));
  return posiciones.every((p) => p >= 0) && posiciones.every((p, i) => i === 0 || p > posiciones[i - 1]);
};

describe('rafaga de punta a punta: Walisuma (flujo real + cableado mínimo, pieza injertada en memoria)', () => {
  it('SIN el consumidor la pieza pierde un mensaje: «Decidir turno» solo ve el último texto (por eso el injerto exige el consumidor)', () => {
    const sinCablear = injertarRafaga(structuredClone(PRODUCCION), { ancla: ANCLA_WALISUMA, fuente: 'Normalizar entrada', campos: { texto: 'texto' }, consumidor: null }) as J;
    const m = crear({ flujo: sinCablear, modeloDice: modelo('Anotado.') });
    m.dobles['Consultar ráfaga'] = () => hilo(UNO, DOS);
    hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    const decidido = t2.porNodo['Decidir turno'][0];
    expect(JSON.stringify(decidido)).toContain(DOS);
    expect(JSON.stringify(decidido), 'sin consumidor el primer texto NO llega').not.toContain(UNO);
  });

  it('DOS textos: el primero se calla; el segundo manda UN solo mensaje y «Decidir turno» y el modelo reciben AMBOS textos, en orden', () => {
    const m = crear({ flujo: conRafaga(), modeloDice: modelo('Anotado: 2 cajas grandes para mañana.') });
    const alModelo: unknown[] = [];
    const respuesta = m.dobles['Conversar con el modelo'];
    m.dobles['Conversar con el modelo'] = (ll) => { alModelo.push(ll.cuerpo); return respuesta(ll); };
    m.dobles['Consultar ráfaga'] = () => hilo(UNO, DOS);

    const t1 = hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    expect(t1.esperas.map((e) => e.nodo)).toContain('Esperar ráfaga');
    expect(t1.mensajes, 'el primer texto no envía nada').toHaveLength(0);
    expect(t1.porNodo['Agrupar ráfaga'] ?? []).toHaveLength(0);
    expect(t1.ejecutados.has('Decidir turno')).toBe(false);
    expect(alModelo, 'el modelo no corre en el turno callado').toHaveLength(0);

    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    const [agrupado] = t2.porNodo['Agrupar ráfaga'];
    expect(agrupado.rafaga).toEqual({ accion: 'agrupado', ids: ['wamid.A', 'wamid.B'] });
    expect(agrupado.textoDelTurno).toBe(`${UNO}\n${DOS}`);
    const [decidido] = t2.porNodo['Decidir turno'];
    expect(decidido.textoCliente, 'lo que decide el turno lleva AMBOS mensajes').toContain(UNO);
    expect(decidido.textoCliente).toContain(DOS);
    expect(ordenado(decidido.textoCliente, UNO, DOS)).toBe(true);
    expect(alModelo.length, 'el modelo corrió una vez').toBe(1);
    expect(ordenado(alModelo[0], UNO, DOS), 'lo que recibe el MODELO trae los dos mensajes, en orden').toBe(true);
    expect(t2.mensajes, 'UN solo envío para los dos textos').toHaveLength(1);
    expect(t1.mensajes.length + t2.mensajes.length).toBe(1);
  });

  it('TRES textos: los dos primeros callan y el tercero responde con los TRES, en orden, en un solo envío', () => {
    const m = crear({ flujo: conRafaga(), modeloDice: modelo('Anotado.') });
    const alModelo: unknown[] = [];
    const respuesta = m.dobles['Conversar con el modelo'];
    m.dobles['Conversar con el modelo'] = (ll) => { alModelo.push(ll.cuerpo); return respuesta(ll); };
    m.dobles['Consultar ráfaga'] = () => hilo(UNO, DOS, TRES);
    const t1 = hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    expect(t1.mensajes.length + t2.mensajes.length).toBe(0);
    expect(alModelo).toHaveLength(0);
    const t3 = hablar(m, ANA, mTexto(TRES), { wamid: 'wamid.C' });
    expect(t3.porNodo['Agrupar ráfaga'][0].rafaga).toEqual({ accion: 'agrupado', ids: ['wamid.A', 'wamid.B', 'wamid.C'] });
    expect(ordenado(t3.porNodo['Decidir turno'][0].textoCliente, UNO, DOS, TRES)).toBe(true);
    expect(alModelo).toHaveLength(1);
    expect(ordenado(alModelo[0], UNO, DOS, TRES)).toBe(true);
    expect(t3.mensajes).toHaveLength(1);
  });

  it('el texto propio llega por el campo `texto` (no por `userInput`): el último mensaje NUNCA queda en blanco', () => {
    const m = crear({ flujo: conRafaga() });
    m.dobles['Consultar ráfaga'] = () => hilo(UNO, DOS);
    hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    expect(t2.porNodo['Agrupar ráfaga'][0].textoDelTurno.endsWith(DOS)).toBe(true);
    expect(t2.porNodo['Agrupar ráfaga'][0].textoDelTurno).not.toMatch(/\n\s*$/);
  });

  it('un mensaje aislado responde como hoy (solo), sin textoDelTurno', () => {
    const m = crear({ flujo: conRafaga() });
    m.dobles['Consultar ráfaga'] = () => hilo(UNO);
    const t = hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    expect(t.porNodo['Agrupar ráfaga'][0].rafaga).toEqual({ accion: 'solo', ids: ['wamid.A'] });
    expect('textoDelTurno' in t.porNodo['Agrupar ráfaga'][0]).toBe(false);
    expect(t.mensajes).toHaveLength(1);
  });

  it('con la consulta caída responde solo (falla abierto): los dos textos se contestan, nadie se pierde', () => {
    const m = crear({ flujo: conRafaga() });
    m.dobles['Consultar ráfaga'] = () => { throw new Error('fetch failed: red caída'); };
    const t1 = hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    expect(t1.mensajes.length + t2.mensajes.length).toBe(2);
    expect(t2.porNodo['Agrupar ráfaga'][0].rafaga.accion).toBe('solo');
  });

  it('un audio no espera ni se calla: la ráfaga ni siquiera corre', () => {
    const m = crear({ flujo: conRafaga() });
    const t = hablar(m, ANA, mAudio(), { wamid: 'wamid.AUD' });
    expect(t.ejecutados.has('Esperar ráfaga')).toBe(false);
    expect(t.ejecutados.has('Consultar ráfaga')).toBe(false);
  });

  it('control: SIN la pieza, los dos textos cuestan dos mensajes (el ahorro es real)', () => {
    const m = crear({ flujo: PRODUCCION });
    const t1 = hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    expect(t1.mensajes.length + t2.mensajes.length).toBe(2);
  });

  it('con un campo de texto que Walisuma no emite (`userInput`) la pieza se NIEGA a armarse: no hay un grupo con el último mensaje en blanco', () => {
    expect(() => injertarRafaga(cablearWalisuma(structuredClone(PRODUCCION)), { ancla: ANCLA_WALISUMA, fuente: 'Normalizar entrada', campos: { texto: 'userInput' }, consumidor: 'Decidir turno' })).toThrow(/no emite texto \(«userInput»\)/);
  });
});

describe('rafaga de punta a punta: Bellido (agenda-minima.v0, flujo real + cableado mínimo, pieza injertada en memoria)', () => {
  /** Bellido con la pieza (fuente «Interpretar entrada», que es el nodo que emite `texto`) y su cableado (`Decidir turno` lee `textoDelTurno`), corrido por el motor genérico con dobles de red. */
  function mundoBellido(consulta: (cuerpo: J) => J, conCableado = true) {
    const real = quitarRafaga(JSON.parse(readFileSync(join(RAIZ_FLUJOS, 'clientes/agenda-minima/agenda-minima.v0.json'), 'utf8'))) as J;
    // Sin cableado: el «Decidir turno» de Bellido (que YA lee `textoDelTurno`) se vuelve ciego a «Agrupar ráfaga», como un flujo sin consumidor.
    if (!conCableado) {
      const decidir = real.nodes.find((n: J) => n.name === 'Decidir turno');
      decidir.parameters.jsCode = decidir.parameters.jsCode.replace("cnPrimero('Agrupar ráfaga')", 'null');
    }
    const original = conCableado ? cablearBellido(real) : real;
    const flujo = injertarRafaga(original, { ancla: { nodo: '¿Atención normal?', salida: 0, destino: '¿Bajar medio?' }, fuente: 'Interpretar entrada', campos: { texto: 'texto' }, consumidor: conCableado ? 'Decidir turno' : null }) as J;
    const dobles: Record<string, (ll: J) => J> = {};
    for (const n of flujo.nodes as { name: string; type: string }[]) if (/httpRequest|google/.test(n.type)) dobles[n.name] = () => ({ ok: true });
    dobles['Traer configuración'] = () => panelOk();
    dobles['Reportar mensaje (entrante)'] = () => ({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } });
    dobles['Enviar a WhatsApp'] = () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.OUT' }] });
    dobles['Consultar ráfaga'] = (ll) => consulta(ll.cuerpo as J);
    return crearMundo({ flujo, dobles, ahoraMs: Date.UTC(2026, 9, 5, 14), roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'] } });
  }
  const hablarBellido = (m: ReturnType<typeof mundoBellido>, texto: string, wamid: string) => m.turno(valorMeta(mTexto(texto), '59100000011', { wamid }), { via: 'WhatsApp Trigger', tolerarFallo: true });
  const envios = (t: ReturnType<typeof hablarBellido>) => t.registro.filter((r) => r.nodo === 'Enviar a WhatsApp').length;

  it('SIN el consumidor la pieza pierde un mensaje: «Decidir turno» solo ve el último texto', () => {
    const m = mundoBellido(() => hilo(UNO, DOS), false);
    hablarBellido(m, UNO, 'wamid.A');
    const t2 = hablarBellido(m, DOS, 'wamid.B');
    expect(JSON.stringify(t2.porNodo['Decidir turno'][0])).toContain(DOS);
    expect(JSON.stringify(t2.porNodo['Decidir turno'][0])).not.toContain(UNO);
  });

  it('DOS textos: el primero termina en «Agrupar ráfaga» sin seguir; el segundo sigue, «Decidir turno» ve AMBOS textos en orden y sale UN solo envío', () => {
    const m = mundoBellido(() => hilo(UNO, DOS));
    const t1 = hablarBellido(m, UNO, 'wamid.A');
    expect(t1.ejecutados.has('Agrupar ráfaga')).toBe(true);
    expect(t1.porNodo['Agrupar ráfaga'] ?? []).toHaveLength(0);
    expect(t1.ejecutados.has('¿Bajar medio?'), 'el primer texto no sigue al flujo').toBe(false);
    expect(envios(t1)).toBe(0);

    const t2 = hablarBellido(m, DOS, 'wamid.B');
    expect(t2.porNodo['Agrupar ráfaga'][0].rafaga).toEqual({ accion: 'agrupado', ids: ['wamid.A', 'wamid.B'] });
    expect(t2.porNodo['Agrupar ráfaga'][0].textoDelTurno).toBe(`${UNO}\n${DOS}`);
    const [decidido] = t2.porNodo['Decidir turno'];
    expect(ordenado(decidido.texto, UNO, DOS), `«Decidir turno» ve ambos textos en orden: ${JSON.stringify(decidido.texto)}`).toBe(true);
    expect(envios(t1) + envios(t2), 'UN solo envío para los dos textos').toBe(1);
    // y, si el turno llama al modelo de extracción, también recibe los dos
    for (const r of t2.registro.filter((x) => x.nodo === 'Extraer')) expect(ordenado(r.cuerpo, UNO, DOS)).toBe(true);
  });

  it('TRES textos: los dos primeros callan; el tercero decide con los TRES, en orden, y sale UN solo envío', () => {
    const m = mundoBellido(() => hilo(UNO, DOS, TRES));
    const ts = [hablarBellido(m, UNO, 'wamid.A'), hablarBellido(m, DOS, 'wamid.B'), hablarBellido(m, TRES, 'wamid.C')];
    expect(ts.slice(0, 2).map((t) => envios(t))).toEqual([0, 0]);
    expect(ts[2].porNodo['Agrupar ráfaga'][0].rafaga.ids).toEqual(['wamid.A', 'wamid.B', 'wamid.C']);
    expect(ordenado(ts[2].porNodo['Decidir turno'][0].texto, UNO, DOS, TRES)).toBe(true);
    expect(ts.reduce((n, t) => n + envios(t), 0)).toBe(1);
  });

  it('con «Normalizar entrada» (que no emite el mensaje) la pieza ni se arma', () => {
    const original = cablearBellido(quitarRafaga(JSON.parse(readFileSync(join(RAIZ_FLUJOS, 'clientes/agenda-minima/agenda-minima.v0.json'), 'utf8'))) as J);
    expect(() => injertarRafaga(original, { ancla: { nodo: '¿Atención normal?', salida: 0, destino: '¿Bajar medio?' }, fuente: 'Normalizar entrada', campos: { texto: 'texto' }, consumidor: 'Decidir turno' })).toThrow(/no emite/);
  });

  it('con la consulta caída responde solo (falla abierto): cada texto se contesta', () => {
    const m = mundoBellido(() => { throw new Error('fetch failed'); });
    const t1 = hablarBellido(m, UNO, 'wamid.A');
    const t2 = hablarBellido(m, DOS, 'wamid.B');
    expect(t2.porNodo['Agrupar ráfaga'][0].rafaga).toEqual({ accion: 'solo', ids: ['wamid.B'] });
    expect(t1.ejecutados.has('Decidir turno') && t2.ejecutados.has('Decidir turno')).toBe(true);
    expect(envios(t1), 'el primer texto se contesta').toBeGreaterThan(0);
    expect(envios(t2), 'el segundo texto se contesta').toBeGreaterThan(0);
  });
});

describe('rafaga: los normalizadores de los demos que se aceptan por huella, EJECUTADOS', () => {
  /** El item que le llega al normalizador en un demo: el payload del webhook + «Config base» (un Set con `includeOtherFields`), que es de donde sale `phoneNumberId`. */
  const ejecutar = (ruta: string) => {
    const f = JSON.parse(readFileSync(join(RAIZ_FLUJOS, ruta), 'utf8')) as J;
    const nodo = f.nodes.find((n: J) => n.name === 'Normalizar entrada');
    const base: J = {};
    for (const a of f.nodes.find((n: J) => n.name === 'Config base').parameters.assignments.assignments) base[a.name] = a.value;
    const entrada = { ...valorMeta(mTexto('hola'), '59100000011', { wamid: 'wamid.X' }), ...base };
    const salida = correr(nodo.parameters.jsCode, [entrada]);
    return { codigo: nodo.parameters.jsCode as string, item: salida[0].json };
  };
  it.each(['clientes/demo-a/demo-a-agendamiento.json', 'clientes/demo-b/demo-b-venta-cobro.json'])('%s: «Normalizar entrada» está verificado y SÍ emite tipo, mensajeId, from, phoneNumberId y userInput', (ruta) => {
    const { codigo, item } = ejecutar(ruta);
    expect(Object.keys(NORMALIZADORES_VERIFICADOS), 'la huella del código actual tiene que estar en NORMALIZADORES_VERIFICADOS (si el normalizador cambió, se vuelve a verificar y se actualiza)').toContain(huellaDe(codigo));
    expect(item).toMatchObject({ tipo: 'text', mensajeId: 'wamid.X', from: '59100000011', userInput: 'hola' });
    expect(String(item.phoneNumberId)).not.toBe('');
    expect(item.phoneNumberId).not.toBeUndefined();
  });
});
