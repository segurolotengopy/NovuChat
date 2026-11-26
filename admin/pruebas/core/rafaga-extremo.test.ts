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
import type { J } from '../lib/flujo';
import { crearMundo } from '../lib/n8n-de-mentira';
import { RAIZ_FLUJOS } from '../../scripts/ensamblar-flujo.mjs';
import { injertarRafaga } from '../../../Flujos/src/core/rafaga/rafaga.mjs';
import { ANA, PRODUCCION, crear, hablar, mAudio, mTexto, panelOk, valorMeta } from '../tenants/walisuma/mundo';

const ANCLA_WALISUMA = { nodo: '¿Bajar medio?', salida: 1, destino: 'Decidir turno' };
const frag = (idMeta: string, texto: string, ms: number, tipo = 'text') => ({ idMeta, tipo, texto, ms });
const UNO = 'quiero 2 cajas';
const DOS = 'de la grande, para mañana';

function conRafaga(): J {
  return injertarRafaga(structuredClone(PRODUCCION), { ancla: ANCLA_WALISUMA, fuente: 'Normalizar entrada', campos: { texto: 'texto' } }) as J;
}

describe('rafaga de punta a punta: Walisuma (flujo real, pieza injertada en memoria)', () => {
  it('dos textos seguidos: el primero se calla, el segundo manda UN mensaje y el texto del turno trae AMBOS', () => {
    const m = crear({ flujo: conRafaga() });
    const consultas: J[] = [];
    // El servidor de mentira: el hilo al terminar la espera de cada ejecución ya tiene los dos textos.
    m.dobles['Consultar ráfaga'] = (ll) => { consultas.push(ll.cuerpo as J); return { rafaga: { v: 1, fragmentos: [frag('wamid.A', UNO, 1000), frag('wamid.B', DOS, 1800)] } }; };

    const t1 = hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    expect(t1.esperas.map((e) => e.nodo)).toContain('Esperar ráfaga');
    expect(t1.mensajes, 'el primer texto no envía nada').toHaveLength(0);
    expect(t1.porNodo['Agrupar ráfaga'] ?? [], 'el primer texto termina en «Agrupar ráfaga» sin salida').toHaveLength(0);
    expect(t1.ejecutados.has('Decidir turno'), 'ni siquiera llega a decidir el turno').toBe(false);

    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    const [agrupado] = t2.porNodo['Agrupar ráfaga'];
    expect(agrupado.rafaga).toEqual({ accion: 'agrupado', ids: ['wamid.A', 'wamid.B'] });
    expect(agrupado.textoDelTurno, 'el texto del turno trae AMBOS mensajes, en orden').toBe(`${UNO}\n${DOS}`);
    expect(agrupado.textoDelTurno).toContain(UNO);
    expect(agrupado.textoDelTurno).toContain(DOS);
    expect(t2.mensajes, 'UN solo envío para los dos textos').toHaveLength(1);
    expect(t1.mensajes.length + t2.mensajes.length).toBe(1);
    // La consulta lleva el id y el teléfono del mensaje, leídos de la fuente.
    expect(consultas.map((c) => c.rafaga)).toEqual([{ v: 1, idMeta: 'wamid.A' }, { v: 1, idMeta: 'wamid.B' }]);
    expect(consultas[0]).toMatchObject({ telefono: ANA });
  });

  it('el texto propio llega por el campo `texto` (no por `userInput`): el último mensaje NUNCA queda en blanco', () => {
    const m = crear({ flujo: conRafaga() });
    m.dobles['Consultar ráfaga'] = () => ({ rafaga: { v: 1, fragmentos: [frag('wamid.A', UNO, 1000), frag('wamid.B', DOS, 1800)] } });
    hablar(m, ANA, mTexto(UNO), { wamid: 'wamid.A' });
    const t2 = hablar(m, ANA, mTexto(DOS), { wamid: 'wamid.B' });
    expect(t2.porNodo['Agrupar ráfaga'][0].textoDelTurno).not.toMatch(/\n\s*$/);
    expect(t2.porNodo['Agrupar ráfaga'][0].textoDelTurno.endsWith(DOS)).toBe(true);
  });

  it('un mensaje aislado responde como hoy (solo), sin textoDelTurno', () => {
    const m = crear({ flujo: conRafaga() });
    m.dobles['Consultar ráfaga'] = () => ({ rafaga: { v: 1, fragmentos: [frag('wamid.A', UNO, 1000)] } });
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

  it('con el `userInput` por defecto (campo que Walisuma no emite) la pieza se NIEGA a armarse: no hay un grupo con el último mensaje en blanco', () => {
    expect(() => injertarRafaga(structuredClone(PRODUCCION), { ancla: ANCLA_WALISUMA, fuente: 'Normalizar entrada' })).toThrow(/no emite texto \(«userInput»\)/);
  });
});

describe('rafaga de punta a punta: Bellido (agenda-minima.v0, flujo real, pieza injertada en memoria)', () => {
  /** Bellido con la pieza (fuente «Interpretar entrada», que es el nodo que emite `texto`), corrido por el motor genérico con dobles de red. */
  function mundoBellido(consulta: (cuerpo: J) => J) {
    const original = JSON.parse(readFileSync(join(RAIZ_FLUJOS, 'clientes/agenda-minima/agenda-minima.v0.json'), 'utf8')) as J;
    const flujo = injertarRafaga(original, { ancla: { nodo: '¿Atención normal?', salida: 0, destino: '¿Bajar medio?' }, fuente: 'Interpretar entrada', campos: { texto: 'texto' } }) as J;
    const dobles: Record<string, (ll: J) => J> = {};
    for (const n of flujo.nodes as { name: string; type: string }[]) if (/httpRequest|google/.test(n.type)) dobles[n.name] = () => ({ ok: true });
    dobles['Traer configuración'] = () => panelOk();
    dobles['Reportar mensaje (entrante)'] = () => ({ atencion: { estado: 'normal' }, servicio: { estado: 'activo' } });
    dobles['Consultar ráfaga'] = (ll) => consulta(ll.cuerpo as J);
    return crearMundo({ flujo, dobles, ahoraMs: Date.UTC(2026, 9, 5, 14), roles: { ingesta: ['Reportar mensaje (entrante)', 'Reportar mensaje (saliente)'] } });
  }
  const hablarBellido = (m: ReturnType<typeof mundoBellido>, texto: string, wamid: string) => m.turno(valorMeta(mTexto(texto), '59100000011', { wamid }), { via: 'WhatsApp Trigger', tolerarFallo: true });

  it('dos textos seguidos: el primero termina en «Agrupar ráfaga» sin seguir y el segundo entrega el texto con AMBOS mensajes y sigue al flujo', () => {
    const m = mundoBellido(() => ({ rafaga: { v: 1, fragmentos: [frag('wamid.A', UNO, 1000), frag('wamid.B', DOS, 1800)] } }));
    const t1 = hablarBellido(m, UNO, 'wamid.A');
    expect(t1.ejecutados.has('Agrupar ráfaga')).toBe(true);
    expect(t1.porNodo['Agrupar ráfaga'] ?? []).toHaveLength(0);
    expect(t1.ejecutados.has('¿Bajar medio?'), 'el primer texto no sigue al flujo').toBe(false);
    expect(t1.ejecutados.has('Enviar a WhatsApp')).toBe(false);

    const t2 = hablarBellido(m, DOS, 'wamid.B');
    const [agrupado] = t2.porNodo['Agrupar ráfaga'];
    expect(agrupado.rafaga).toEqual({ accion: 'agrupado', ids: ['wamid.A', 'wamid.B'] });
    expect(agrupado.textoDelTurno).toBe(`${UNO}\n${DOS}`);
    expect(t2.ejecutados.has('Decidir turno'), 'el segundo sí sigue al flujo').toBe(true);
  });

  it('el texto propio sale del campo `texto` de «Interpretar entrada»: nunca queda en blanco; y con «Normalizar entrada» (que no emite el mensaje) la pieza ni se arma', () => {
    const original = JSON.parse(readFileSync(join(RAIZ_FLUJOS, 'clientes/agenda-minima/agenda-minima.v0.json'), 'utf8')) as J;
    expect(() => injertarRafaga(original, { ancla: { nodo: '¿Atención normal?', salida: 0, destino: '¿Bajar medio?' }, fuente: 'Normalizar entrada', campos: { texto: 'texto' } })).toThrow(/no emite/);
  });

  it('con la consulta caída responde solo (falla abierto) y un mensaje aislado también', () => {
    const m = mundoBellido(() => { throw new Error('fetch failed'); });
    const t = hablarBellido(m, UNO, 'wamid.A');
    expect(t.porNodo['Agrupar ráfaga'][0].rafaga).toEqual({ accion: 'solo', ids: ['wamid.A'] });
    expect(t.ejecutados.has('Decidir turno')).toBe(true);
  });
});
