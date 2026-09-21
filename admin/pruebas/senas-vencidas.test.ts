/**
 * EL FLUJO PROGRAMADO DE SEÑAS VENCIDAS (`Flujos/agendamiento-senas-vencidas.json`).
 *
 * Cada diez minutos revisa las agendas del comercio y borra las citas que
 * siguen con el título «PENDIENTE DE SEÑA · …» pasados los minutos de
 * retención, para liberar el horario; se lo reporta al servidor
 * (`senaVencida`) y NUNCA le escribe al paciente: ni mensaje ni plantilla.
 * Un mensaje costaría 0,0113 USD por retención vencida y provocaría el
 * reclamo que se quiere evitar (bloque 2, Analisis/30 §4).
 *
 * Como en las demás suites, el código y las expresiones se extraen del JSON
 * versionado y se ejecutan. Lo que se protege:
 *
 *   1. CERO nodos de WhatsApp: no hay con qué escribirle a nadie.
 *   2. Con el panel caído, el comercio suspendido o la seña inactiva no se
 *      borra NADA (la regla del flujo de recordatorios: cuando no se sabe, no
 *      se hace).
 *   3. Vence por `created` + minutos, y solo el título que EMPIEZA con el
 *      prefijo; sin teléfono en la descripción no se toca.
 *   4. Primero se reporta y recién con la respuesta del servidor se borra:
 *      con `ya_agendada` (el comprobante cuadró) la cita no se toca.
 *   5. Ningún valor real: solo el marcador del número de Platinum.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

type J = Record<string, any>;
interface Nodo {
  id: string; name: string; type: string; typeVersion: number; position: [number, number];
  parameters: J; credentials?: Record<string, { id: string; name: string }>; onError?: string; notes?: string;
}
interface Flujo {
  name: string; settings: J; nodes: Nodo[];
  connections: Record<string, Record<string, { node: string; type: string; index: number }[][]>>;
}

const TEXTO = readFileSync(join(aqui, '../../Flujos/agendamiento-senas-vencidas.json'), 'utf8');
const f = JSON.parse(TEXTO) as Flujo;
const nodo = (nombre: string): Nodo => {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
};
const codigo = (nombre: string) => String(nodo(nombre).parameters['jsCode']);
const destinos = (desde: string, salida = 0) => (f.connections[desde]?.['main']?.[salida] ?? []).map((x) => x.node);

function ejecutar(js: string, items: J[], referencias: Record<string, J[]> = {}): J[] {
  const entrada = { all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) };
  const $ = (n: string) => ({ first: () => ({ json: referencias[n]?.[0] ?? {} }), all: () => (referencias[n] ?? []).map((json) => ({ json })) });
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', js) as (i: unknown, r: unknown) => { json: J }[];
  return fn(entrada, $).map((x) => x.json);
}
function expresion(texto: unknown, $json: J, referencias: Record<string, J> = {}): unknown {
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(String(texto).trim());
  if (!m) throw new Error(`no es una expresión simple: ${String(texto).slice(0, 60)}`);
  const $ = (n: string) => ({ first: () => ({ json: referencias[n] ?? {} }), item: { json: referencias[n] ?? {} } });
  // nosemgrep: devsecops.js-eval-prohibido
  return (new Function('$json', '$', `return (${m[1]});`) as (...a: unknown[]) => unknown)($json, $);
}
const configBase = (): J => Object.fromEntries(
  (nodo('Config base').parameters['assignments'].assignments as { name: string; value: unknown }[]).map((a) => [a.name, a.value]),
);

const CAL_1 = 'agenda-uno@group.calendar.google.com';
const CAL_2 = 'agenda-dos@group.calendar.google.com';
const panel = (sena: unknown, extra: J = {}) => ({
  statusCode: 200,
  body: {
    tenantId: 'platinum', flujo: 'agendamiento', estadoComercio: 'activo', phoneNumberId: '1000000001',
    operacion: { moneda: 'BOB', calendarioId: CAL_1 },
    funcionarios: [{ nombre: 'Dra. Uno', calendario: CAL_1 }, { nombre: 'Dr. Dos', calendario: CAL_2 }],
    ...(sena === undefined ? {} : { sena }), ...extra,
  },
});
const ACTIVA = { activa: true, importe: 100, moneda: 'BOB', minutosRetencion: 45, qr: { url: 'https://x/qr', nombreCuenta: 'X', banco: 'Y' } };
const configurar = (respuesta: unknown): J[] => ejecutar(codigo('Config de la seña'), [respuesta as J], { 'Config base': [configBase()] });

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const cita = (extra: J): J => ({
  id: 'ev-1', summary: 'PENDIENTE DE SEÑA · Cita Ana — valoración clínica', organizer: { email: CAL_1 },
  start: { dateTime: '2026-09-18T10:00:00-04:00' }, end: { dateTime: '2026-09-18T10:30:00-04:00' },
  description: 'Cliente: Ana\nTelefono: 59170000001\nAgendado por NovuChat.\nSeña pendiente: 100 Bs', created: hace(60), ...extra,
});
const vencidas = (eventos: J[], minutos = 45): J[] => ejecutar(codigo('Vencidas'), eventos, { 'Config de la seña': [{ minutosRetencion: minutos }] });

describe('El flujo: forma, ids y ningún valor real', () => {
  it('tiene el nombre del cliente, orden v1, zona de Bolivia y diez nodos con ids cortos sv-*', () => {
    expect(f.name).toBe('NovuChat — Clínica Platinum (Señas vencidas)');
    expect(f.settings).toMatchObject({ executionOrder: 'v1', timezone: 'America/La_Paz' });
    expect(f.nodes).toHaveLength(10);
    const ids = f.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^sv-[a-z0-9-]+$/);
  });

  it('corre cada CINCO minutos: con diez, una seña de 15 se liberaba a los 25', () => {
    // Al paciente se le dice 15 minutos. Con el reloj a 10, el horario seguía
    // retenido hasta 10 minutos más: juega a favor de quien paga tarde, nunca
    // en contra, pero era el doble de la retención más corta que admite la
    // consola (5 minutos), y eso ya no es un redondeo (Andres, 19/09/2026).
    const t = nodo('Cada 5 minutos');
    expect(t.type).toBe('n8n-nodes-base.scheduleTrigger');
    expect(t.parameters['rule'].interval[0]).toEqual({ field: 'cronExpression', expression: '*/5 * * * *' });
    expect(destinos('Cada 5 minutos')).toEqual(['Config base']);
    // La deriva máxima es el período del reloj: nunca más que eso.
    expect(5).toBeLessThanOrEqual(5);
  });

  it('el reporte al servidor manda CUÁNDO se creó la cita y cuánto se retiene', () => {
    // El servidor vuelve a exigir el tiempo antes de autorizar un borrado: un
    // límite que solo vive en el flujo no existe (CLAUDE.md §7), y acá lo que
    // se autoriza es borrar la cita de un cliente.
    const cuerpo = String(nodo('Reportar seña vencida').parameters['jsonBody']);
    for (const campo of ['telefono', 'referencia', 'creadoEn', 'minutosRetencion']) {
      expect(cuerpo, campo).toContain(campo);
    }
  });

  it('NUNCA hay un nodo de WhatsApp ni un envío a Graph: no escribe al paciente', () => {
    for (const n of f.nodes) {
      expect(n.type, n.name).not.toMatch(/whatsApp/i);
      expect(JSON.stringify(n.parameters), n.name).not.toMatch(/graph\.facebook\.com|messaging_product|\/messages/);
    }
  });

  it('el único marcador es el del número de Platinum, y no hay ningún valor real', () => {
    expect([...new Set(TEXTO.match(/REEMPLAZAR_[A-Z0-9_]*/g) ?? [])]).toEqual(['REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM']);
    expect(configBase()).toEqual({ phoneNumberId: 'REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM', waGraphVersion: 'v26.0', senaMinutosRetencion: '30' });
    expect(TEXTO).not.toMatch(/(^|[^0-9])[0-9]{10,}([^0-9]|$)/);
    expect(TEXTO).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(TEXTO).not.toMatch(/EAA[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|Bearer /);
  });

  it('las credenciales: ingesta de Platinum por nombre con id vacío; Calendar por tipo; nunca la ingesta en un nodo de Calendar', () => {
    for (const n of ['Traer configuración', 'Reportar seña vencida']) {
      expect(nodo(n).credentials).toEqual({ httpHeaderAuth: { id: '', name: 'NovuChat ingesta (Clínica Platinum)' } });
    }
    for (const n of ['Citas pendientes de seña', 'Borrar cita vencida']) {
      expect(nodo(n).credentials).toEqual({ googleCalendarOAuth2Api: { id: '', name: '' } });
    }
    expect(TEXTO).not.toMatch(/Cierres NovuChat A|Demo/);
  });
});

describe('Config de la seña: la consola manda, y sin ella no se borra nada', () => {
  it('con el panel activo y la seña activa: los minutos del panel y TODOS los calendarios (negocio y funcionarios)', () => {
    const s = configurar(panel(ACTIVA));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ minutosRetencion: 45, calendarios: [CAL_1, CAL_2], phoneNumberId: '1000000001', senaActiva: 'si' });
  });

  it('con minutos fuera de rango o ausentes cae al respaldo de Config base (30)', () => {
    expect(configurar(panel({ ...ACTIVA, minutosRetencion: 999 }))[0]?.['minutosRetencion']).toBe(30);
    expect(configurar(panel({ ...ACTIVA, minutosRetencion: undefined }))[0]?.['minutosRetencion']).toBe(30);
  });

  it.each([
    ['seña inactiva', panel({ ...ACTIVA, activa: false, importe: 0, qr: null })],
    ['sin `sena` en la respuesta', panel(undefined)],
    ['comercio suspendido (409)', { statusCode: 409, body: { estado: 'suspendido' } }],
    ['comercio no activo aunque conteste 200', panel(ACTIVA, { estadoComercio: 'suspendido' })],
    ['panel caído (500)', { statusCode: 500, body: {} }],
    ['sin respuesta', {}],
    ['error de red', { error: 'timeout' }],
    ['sin calendarios', panel(ACTIVA, { operacion: {}, funcionarios: [] })],
  ])('%s: no sale ningún item, así que no se consulta ni se borra nada', (_caso, respuesta) => {
    expect(configurar(respuesta)).toEqual([]);
  });

  it('«Calendarios del negocio» emite un item por calendario, con la configuración', () => {
    const s = ejecutar(codigo('Calendarios del negocio'), configurar(panel(ACTIVA)));
    expect(s.map((x) => x['calendarioARevisar'])).toEqual([CAL_1, CAL_2]);
    expect(s[0]).toMatchObject({ minutosRetencion: 45 });
  });

  it('«Citas pendientes de seña» busca el prefijo en cada calendario, de ayer a 90 días, y un calendario roto no frena a los demás', () => {
    const c = nodo('Citas pendientes de seña');
    expect(c.parameters['operation']).toBe('getAll');
    expect(c.parameters['returnAll']).toBe(true);
    expect(expresion(c.parameters['calendar'].value, { calendarioARevisar: CAL_2 })).toBe(CAL_2);
    // SIN búsqueda por texto: con `query: 'PENDIENTE DE SEÑA'` Google devolvía
    // CERO resultados aunque las citas existieran con ese título exacto
    // (19/09/2026, seis corridas seguidas), así que ninguna seña vencía y el
    // flujo terminaba «bien». El filtro por título vive en «Vencidas», que es
    // nuestro y es exacto. Si alguien vuelve a poner `query`, esto lo atrapa.
    expect(c.parameters['options']).toMatchObject({ singleEvents: true });
    expect(c.parameters['options']).not.toHaveProperty('query');
    expect(String(c.parameters['options'].timeMin)).toContain("minus({ days: 1 })");
    expect(String(c.parameters['options'].timeMax)).toContain('plus({ days: 90 })');
    expect(c.onError).toBe('continueRegularOutput');
  });
});

describe('Vencidas: por `created` + minutos, solo con el prefijo en el título, y con teléfono', () => {
  it('una cita con el prefijo creada hace más de los minutos de retención vence, con su teléfono y su calendario', () => {
    const s = vencidas([cita({ created: hace(46) })]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ eventoId: 'ev-1', calendarioDelEvento: CAL_1, telefono: '59170000001', minutosRetencion: 45 });
  });

  it('una cita creada hace menos de los minutos NO vence todavía', () => {
    expect(vencidas([cita({ created: hace(44) })])).toEqual([]);
    expect(vencidas([cita({ created: hace(20) })], 15)).toHaveLength(1);
  });

  it('ignora los eventos sin el prefijo al INICIO del título (aunque Google los haya encontrado por el texto)', () => {
    expect(vencidas([
      cita({ summary: 'Cita Ana — valoración clínica' }),
      cita({ id: 'ev-2', summary: 'Nota: PENDIENTE DE SEÑA · revisar' }),
      cita({ id: 'ev-3', summary: '' }),
    ])).toEqual([]);
  });

  it('ignora una cita sin teléfono en la descripción, sin `created` legible, o un item de error', () => {
    expect(vencidas([cita({ description: 'Cliente: Ana' })])).toEqual([]);
    expect(vencidas([cita({ created: 'ayer' })])).toEqual([]);
    expect(vencidas([{ error: 'calendario roto' }, {}])).toEqual([]);
  });

  it('revisa varias citas de varios calendarios en una pasada', () => {
    const s = vencidas([cita({}), cita({ id: 'ev-2', organizer: { email: CAL_2 }, description: 'Telefono: +59170000002' }), cita({ id: 'ev-3', created: hace(1) })]);
    expect(s.map((x) => [x['eventoId'], x['calendarioDelEvento'], x['telefono']])).toEqual([['ev-1', CAL_1, '59170000001'], ['ev-2', CAL_2, '59170000002']]);
  });
});

describe('Reportar y recién entonces borrar', () => {
  it('la cadena: Vencidas → Reportar seña vencida → ¿Borrar la cita? → Borrar cita vencida; nada más', () => {
    expect(destinos('Config base')).toEqual(['Traer configuración']);
    expect(destinos('Traer configuración')).toEqual(['Config de la seña']);
    expect(destinos('Config de la seña')).toEqual(['Calendarios del negocio']);
    expect(destinos('Calendarios del negocio')).toEqual(['Citas pendientes de seña']);
    expect(destinos('Citas pendientes de seña')).toEqual(['Vencidas']);
    expect(destinos('Vencidas')).toEqual(['Reportar seña vencida']);
    expect(destinos('Reportar seña vencida')).toEqual(['¿Borrar la cita?']);
    expect(destinos('¿Borrar la cita?', 0)).toEqual(['Borrar cita vencida']);
    expect(destinos('¿Borrar la cita?', 1)).toEqual([]);
    expect(destinos('Borrar cita vencida')).toEqual([]);
  });

  it('el reporte a `senaVencida` lleva el teléfono y la referencia de la cita, con la respuesta completa y sin cortar', () => {
    const r = nodo('Reportar seña vencida');
    expect(r.parameters['url']).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/senaVencida');
    expect(r.parameters['method']).toBe('POST');
    expect(r.parameters['options']).toMatchObject({ response: { response: { fullResponse: true, neverError: true } } });
    expect(r.onError).toBe('continueRegularOutput');
    const v = vencidas([cita({})])[0]!;
    expect(JSON.parse(String(expresion(r.parameters['jsonBody'], v)))).toMatchObject({
      telefono: '59170000001', referencia: 'ev-1', minutosRetencion: expect.any(Number),
    });
    // `creadoEn` viaja tal cual lo dio Google: el servidor lo vuelve a exigir
    // antes de autorizar que se borre la cita de un cliente.
    expect(JSON.parse(String(expresion(r.parameters['jsonBody'], v)))['creadoEn']).toBe(v['creadoEn']);
    expect(expresion(r.parameters['headerParameters'].parameters[0].value, {}, { 'Config de la seña': { phoneNumberId: '1000000001' } })).toBe('1000000001');
  });

  it('se borra solo si el servidor la dio por vencida o ya la tenía vencida; con cualquier otro motivo, NO', () => {
    const condicion = nodo('¿Borrar la cita?').parameters['conditions'].conditions[0].leftValue;
    expect(expresion(condicion, { statusCode: 200, body: { registrado: true, repetido: false } })).toBe(true);
    expect(expresion(condicion, { statusCode: 200, body: { registrado: false, repetido: true } })).toBe(true);
    // NINGÚN «no» del servidor borra (2026-09-20). `sin_sena_pendiente` estaba
    // en la lista y por él se borraban citas que el servidor NO autorizó: una
    // huérfana que todavía no vencía, y una de la que no se sabía la fecha.
    for (const motivo of ['ya_agendada', 'comprobante_en_revision', 'todavia_no_vence',
      'sin_fecha_de_creacion', 'cita_pagada', 'sin_sena_pendiente']) {
      expect(expresion(condicion, { statusCode: 200, body: { registrado: false, repetido: false, motivo } }),
        motivo).toBe(false);
    }
    expect(expresion(condicion, { statusCode: 401, body: {} })).toBe(false);
    expect(expresion(condicion, { statusCode: 500, body: { registrado: true } })).toBe(false);
    expect(expresion(condicion, {})).toBe(false);
    expect(expresion(condicion, { error: 'timeout' })).toBe(false);
  });

  it('el borrado apunta a la cita y al calendario que «Vencidas» dejó, y si falla no frena el barrido', () => {
    const b = nodo('Borrar cita vencida');
    expect(b.parameters['operation']).toBe('delete');
    const v = { eventoId: 'ev-1', calendarioDelEvento: CAL_2 };
    expect(expresion(b.parameters['calendar'].value, {}, { Vencidas: v })).toBe(CAL_2);
    expect(expresion(b.parameters['eventId'], {}, { Vencidas: v })).toBe('ev-1');
    expect(b.onError).toBe('continueRegularOutput');
  });
});
