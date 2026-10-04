/**
 * RECORDATORIO DE 24 H DE BELLIDO: el flujo DEFINITIVO (`recordatorio-bellido.v1.json`).
 *
 * El criterio de quién recibe el recordatorio y el cuerpo del mensaje los prueba `recordatorio-bellido.test.ts`
 * sobre el mismo código de `src/`. Esta suite prueba lo que es propio de la salida definitiva: que está al día con
 * el generador, que no trae nada de la prueba, que dispara a las 17:00 de La Paz, que solo escribe lo permitido
 * (el envío de la plantilla y la marca en la descripción), que un rechazo de Meta termina en ERROR sin marcar, y
 * que las credenciales son las nombradas.
 *
 * LO QUE NO PUEDE PROBAR: que n8n respete el orden de ramas del lienzo (salida 0 antes que la 1) ni que el cron se
 * dispare; se verifican en la primera corrida real, con el flujo todavía inactivo (corrida manual) y luego activo.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, expresion, type J } from './lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/recordatorio-bellido');
const TEXTO = readFileSync(join(RAIZ, 'recordatorio-bellido.v1.json'), 'utf8');
type Nodo = { name: string; type: string; disabled?: boolean; parameters: J; credentials?: Record<string, { id: string; name: string }> };
const FLUJO = JSON.parse(TEXTO) as {
  name: string; nodes: Nodo[]; settings: J;
  connections: Record<string, { main: { node: string }[][] }>;
};
const nodo = (nombre: string): Nodo => {
  const n = FLUJO.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
};
const codigo = (nombre: string): string => String(nodo(nombre).parameters['jsCode']);
const fuente = (archivo: string): string => readFileSync(join(RAIZ, 'src', archivo), 'utf8');
const destinos = (desde: string, salida = 0): string[] => (FLUJO.connections[desde]?.main[salida] ?? []).map((x) => x.node);

const TEL = '59100000021';
const SALIDA_PREPARAR: J = { eventoId: 'ev-1', telefono: TEL, parametros: ['a', 'b', 'c', 'd'], descripcionMarcada: 'x' };
const META_ACEPTA: J = { messaging_product: 'whatsapp', messages: [{ id: 'wamid.PRUEBA' }] };
const META_RECHAZA: J = { error: { code: 131030, message: `Recipient ${TEL} not in allowed list`, type: 'OAuthException' } };

const despues = (respuestas: J[]): J[] =>
  ejecutar(codigo('Después del envío'), respuestas, { 'Preparar recordatorios': respuestas.map(() => SALIDA_PREPARAR) });

describe('recordatorio de Bellido v1: la salida está al día con el generador', () => {
  it('es exactamente lo que genera `generar.py v1`', () => {
    const r = spawnSync('python3', [join(RAIZ, 'herramientas/generar.py'), 'v1'], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(TEXTO);
  });

  it('el código de los nodos es el de src/ (una sola fuente, la misma de la prueba)', () => {
    expect(codigo('Preparar recordatorios')).toBe(fuente('preparar-recordatorios.js'));
    expect(codigo('Después del envío')).toBe(fuente('despues-del-envio.js'));
    expect(codigo('Recordatorio no enviado')).toBe(fuente('envio-rechazado.js'));
    const prueba = JSON.parse(readFileSync(join(RAIZ, 'recordatorio-bellido.prueba.json'), 'utf8')) as { nodes: Nodo[] };
    for (const n of ['Preparar recordatorios', 'Después del envío']) {
      expect(prueba.nodes.find((x) => x.name === n)!.parameters['jsCode']).toBe(codigo(n));
    }
  });

  it('tiene el nombre definitivo', () => {
    expect(FLUJO.name).toBe('NovuChat Bellido — Recordatorio de citas (24 h)');
  });
});

describe('recordatorio de Bellido v1: nada de la prueba', () => {
  it('no trae webhooks ni citas ficticias ni la Config de la prueba', () => {
    expect(FLUJO.nodes.filter((n) => /webhook/i.test(n.type))).toEqual([]);
    for (const n of FLUJO.nodes) {
      expect(n.name).not.toMatch(/ficticia|prueba|Crear cita/i);
      expect(n.parameters).not.toHaveProperty('path');
    }
    expect(TEXTO).not.toMatch(/webhookId|REEMPLAZAR_RUTA|citas-ficticias|Citas ficticias|Config de la prueba/);
  });

  it('no trae teléfonos de prueba ni reales, ni ids, ni credenciales con valor', () => {
    // El Code compartido con la prueba nombra `telefonoPrueba…` solo para filtrar SI el Config las trae (no las trae):
    // lo que no puede haber es el marcador, el valor ni la clave en el Config.
    expect(TEXTO).not.toMatch(/TELEFONO_PRUEBA|REEMPLAZAR_CALENDARIO_ENSAYO/);
    const claves = (nodo('Config del recordatorio').parameters['assignments'].assignments as { name: string }[]).map((x) => x.name);
    expect(claves.filter((k) => /prueba/i.test(k))).toEqual([]);
    expect(TEXTO).not.toMatch(/\b\d{8,}\b/);
    expect(TEXTO).not.toMatch(/\b591[67]\d{7}\b/);
    for (const n of FLUJO.nodes) for (const c of Object.values(n.credentials ?? {})) expect(c.id).toBe('');
    // lo único por reemplazar es el calendario y el id del número de Bellido
    expect([...new Set(TEXTO.match(/REEMPLAZAR_[A-Z0-9_]+/g))].sort()).toEqual(['REEMPLAZAR_CALENDARIO_BELLIDO', 'REEMPLAZAR_PHONE_NUMBER_ID_BELLIDO']);
  });

  it('el estado del comercio es una clave de datos (operativo), no un nodo de red nuevo', () => {
    const config = nodo('Config del recordatorio').parameters['assignments'].assignments as { name: string; value: string }[];
    expect(config.find((a) => a.name === 'estadoComercio')!.value).toBe('operativo');
    expect(config.find((a) => a.name === 'calendarioId')!.value).toBe('REEMPLAZAR_CALENDARIO_BELLIDO');
    expect(config.find((a) => a.name === 'phoneNumberId')!.value).toBe('REEMPLAZAR_PHONE_NUMBER_ID_BELLIDO');
    expect(FLUJO.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest').map((n) => n.name)).toEqual(['Enviar plantilla']);
  });
});

describe('recordatorio de Bellido v1: dispara a las 17:00 de La Paz', () => {
  it('el único disparador es un cron diario a las 17:00, habilitado, en America/La_Paz', () => {
    const disparadores = FLUJO.nodes.filter((n) => /Trigger$/.test(n.type));
    expect(disparadores).toHaveLength(1);
    const d = disparadores[0]!;
    expect(d.type).toBe('n8n-nodes-base.scheduleTrigger');
    expect(d.disabled).not.toBe(true);
    expect(d.parameters['rule'].interval).toEqual([{ field: 'cronExpression', expression: '0 17 * * *' }]);
    expect(FLUJO.settings['timezone']).toBe('America/La_Paz');
    expect(FLUJO.settings['executionOrder']).toBe('v1');
    expect(destinos(d.name)).toEqual(['Config del recordatorio']);
  });
});

describe('recordatorio de Bellido v1: lee solo mañana y solo escribe lo permitido', () => {
  it('lee las citas de mañana de La Paz con timeMin/timeMax al nivel del nodo (no en options)', () => {
    const p = nodo('Citas de mañana').parameters;
    expect(p['operation']).toBe('getAll');
    expect(p['calendar'].value).toBe('={{ $json.calendarioId }}');
    expect(String(p['timeMin'])).toMatch(/setZone\('America\/La_Paz'\)\.plus\(\{days:1\}\)\.startOf\('day'\)/);
    expect(String(p['timeMax'])).toMatch(/setZone\('America\/La_Paz'\)\.plus\(\{days:1\}\)\.endOf\('day'\)/);
    expect(p['options']).toEqual({ singleEvents: true });
    expect(p['options']).not.toHaveProperty('timeMin');
    expect(p['options']).not.toHaveProperty('timeMax');
  });

  it('en Calendar solo hay una lectura y una actualización; no se crea ni se borra nada', () => {
    const calendarios = FLUJO.nodes.filter((n) => n.type === 'n8n-nodes-base.googleCalendar');
    expect(calendarios.map((n) => [n.name, n.parameters['operation']])).toEqual([
      ['Citas de mañana', 'getAll'], ['Marcar como recordada', 'update'],
    ]);
  });

  it('«Marcar como recordada» escribe solo la descripción', () => {
    const p = nodo('Marcar como recordada').parameters;
    expect(Object.keys(p).sort()).toEqual(['calendar', 'eventId', 'operation', 'updateFields']);
    expect(Object.keys(p['updateFields'])).toEqual(['description']);
    expect(p['updateFields'].description).toBe('={{ $json.descripcionMarcada }}');
  });

  it('el envío es solo la plantilla a la API de Meta, una por cita', () => {
    const p = nodo('Enviar plantilla').parameters;
    expect(p['method']).toBe('POST');
    expect(String(p['url'])).toMatch(/^=https:\/\/graph\.facebook\.com\/\{\{ \$json\.waGraphVersion \}\}\/\{\{ \$json\.phoneNumberId \}\}\/messages$/);
    expect(String(p['jsonBody'])).toContain("type: 'template'");
  });
});

describe('recordatorio de Bellido v1: si Meta rechaza, no se marca y la ejecución termina en error', () => {
  it('lo aceptado por Meta (con wamid) se marca; lo rechazado (sin wamid) no', () => {
    const [ok] = despues([META_ACEPTA]);
    expect(ok).toMatchObject({ enviado: true, causa: '' });
    const [no] = despues([META_RECHAZA]);
    expect(no).toMatchObject({ enviado: false });
    expect(String(no!['causa'])).toContain('131030');
    // el error de red de un nodo con «continuar» tampoco trae wamid
    expect(despues([{ error: 'timeout' }])[0]).toMatchObject({ enviado: false });
    expect(despues([{}])[0]).toMatchObject({ enviado: false });
  });

  it('«¿Se envió?» manda a marcar solo lo enviado, y lo no enviado va a un nodo distinto que no marca', () => {
    expect(nodo('¿Se envió?').parameters['conditions'].conditions[0].leftValue).toBe('={{ $json.enviado }}');
    expect(destinos('¿Se envió?', 0)).toEqual(['Marcar como recordada']);
    expect(destinos('¿Se envió?', 1)).toEqual(['Recordatorio no enviado']);
    // lo único que llega a «Marcar como recordada» es la salida «enviado» de «¿Se envió?»
    const quienes = Object.entries(FLUJO.connections)
      .filter(([, c]) => c.main.some((s) => s.some((x) => x.node === 'Marcar como recordada'))).map(([k]) => k);
    expect(quienes).toEqual(['¿Se envió?']);
    expect(FLUJO.connections['Recordatorio no enviado']).toBeUndefined();
    // con el orden v1 la rama de marcar (salida 0, más arriba en el lienzo) corre antes que el error
    const y = (n: string): number => (FLUJO.nodes.find((x) => x.name === n) as unknown as { position: number[] }).position[1]!;
    expect(y('Marcar como recordada')).toBeLessThan(y('Recordatorio no enviado'));
  });

  it('el nodo de rechazo lanza «Recordatorio no enviado: …» sin teléfono ni datos del paciente', () => {
    const [no] = despues([META_RECHAZA]);
    expect(() => ejecutar(codigo('Recordatorio no enviado'), [no!])).toThrow(/^Recordatorio no enviado: 1 cita\(s\) sin recordar\./);
    let mensaje = '';
    try { ejecutar(codigo('Recordatorio no enviado'), [{ ...no!, descripcionMarcada: 'Quispe Mamani, Valentina', summary: 'Quispe' }]); } catch (e) { mensaje = (e as Error).message; }
    expect(mensaje).toContain('131030');
    expect(mensaje).not.toContain(TEL);
    expect(mensaje).not.toMatch(/\d{7,}/);
    expect(mensaje).not.toMatch(/Valentina|Quispe|Mamani/);
  });

  it('con una mezcla, la enviada va a marcar y la rechazada termina la ejecución en error', () => {
    const salidas = despues([META_ACEPTA, META_RECHAZA, META_RECHAZA]);
    const aMarcar = salidas.filter((s) => expresion(nodo('¿Se envió?').parameters['conditions'].conditions[0].leftValue, s) === true);
    const aError = salidas.filter((s) => expresion(nodo('¿Se envió?').parameters['conditions'].conditions[0].leftValue, s) !== true);
    expect(aMarcar).toHaveLength(1);
    expect(aError).toHaveLength(2);
    expect(() => ejecutar(codigo('Recordatorio no enviado'), aError)).toThrow(/2 cita\(s\) sin recordar/);
  });
});

describe('recordatorio de Bellido v1: si la marca falla después de enviar, o la configuración es inválida, la ejecución termina en error', () => {
  const PREPARAR_CFG: J = {
    calendarioId: 'cal', phoneNumberId: 'pn', waGraphVersion: 'v26.0', plantilla: 'recordatorio_cita_consultorio', idiomaPlantilla: 'es',
    conQuienVariable: 'el Doctor Bellido', prefijosPermitidos: '591', estadoComercio: 'operativo', saludoVariable: 'te escribimos del consultorio',
    variablesCuerpo: '4',
  };
  const preparar = (cfg: J): J[] => ejecutar(codigo('Preparar recordatorios'), [{
    id: 'ev-9', status: 'confirmed', iCalUID: ['x', 'google.com'].join('@'), start: { dateTime: '2026-10-06T11:00:00-04:00' },
    description: ['Cliente: Valentina Quispe', `Telefono: ${TEL}`, 'Agendado por NovuChat.'].join('\n'),
  }], { 'Config del recordatorio': cfg });

  it('«Marcar como recordada» usa la salida de error, que va a «Enviado pero no marcado»', () => {
    expect(nodo('Marcar como recordada')).toMatchObject({ onError: 'continueErrorOutput' });
    expect(destinos('Marcar como recordada', 0)).toEqual([]);
    expect(destinos('Marcar como recordada', 1)).toEqual(['Enviado pero no marcado']);
    expect(FLUJO.connections['Enviado pero no marcado']).toBeUndefined();
  });

  it('«Enviado pero no marcado» lanza con la cuenta y el eventoId, sin teléfono ni datos del paciente, y manda a Retry', () => {
    const falladas = [{ eventoId: 'ev-1', telefono: TEL, descripcionMarcada: 'Cliente: Valentina Quispe', error: 'x' }, { eventoId: 'ev-2', telefono: TEL }];
    let mensaje = '';
    try { ejecutar(codigo('Enviado pero no marcado'), falladas); } catch (e) { mensaje = (e as Error).message; }
    expect(mensaje).toMatch(/^Enviado pero no marcado: 2 cita\(s\) \(eventoId: ev-1, ev-2\)/);
    expect(mensaje).toContain('Retry');
    expect(mensaje).not.toContain(TEL);
    expect(mensaje).not.toMatch(/Valentina|Quispe/);
    // sin eventoId en la salida de error, igual lanza
    expect(() => ejecutar(codigo('Enviado pero no marcado'), [{ error: 'x' }])).toThrow(/^Enviado pero no marcado: 1 cita\(s\)\./);
  });

  it('el LEEME dice que ante un error se usa «Retry» desde el nodo que falló, nunca una ejecución completa', () => {
    const leeme = readFileSync(join(RAIZ, 'LEEME.md'), 'utf8');
    expect(leeme).toMatch(/Retry/);
    expect(leeme).toMatch(/nunca una ejecución completa/);
  });

  it('una variable de más de 30 caracteres o los prefijos vacíos llegan a «Revisar omisión», que lanza; una omisión normal termina en verde', () => {
    expect(destinos('¿Hay recordatorios?', 1)).toEqual(['Revisar omisión']);
    expect(FLUJO.connections['Revisar omisión']).toBeUndefined();
    const larga = preparar({ ...PREPARAR_CFG, saludoVariable: 'te escribimos del consultorio del Dr. Bellido' });
    expect(() => ejecutar(codigo('Revisar omisión'), larga)).toThrow(/^Recordatorio no enviado: configuracion invalida \(variable de plantilla de mas de 30 caracteres\)/);
    const sinPrefijos = preparar({ ...PREPARAR_CFG, prefijosPermitidos: '' });
    expect(() => ejecutar(codigo('Revisar omisión'), sinPrefijos)).toThrow(/sin prefijos configurados/);
    // el opuesto: no hay citas que correspondan -> verde
    const ninguna = ejecutar(codigo('Preparar recordatorios'), [{ id: 'a', status: 'cancelled' }], { 'Config del recordatorio': PREPARAR_CFG });
    expect(ejecutar(codigo('Revisar omisión'), ninguna)).toEqual([]);
    // y el mensaje no trae datos del paciente
    let m = '';
    try { ejecutar(codigo('Revisar omisión'), larga); } catch (e) { m = (e as Error).message; }
    expect(m).not.toContain(TEL);
  });

  it('el flujo guarda solo las ejecuciones con error (no las exitosas, que llevan teléfonos y la descripción de la cita)', () => {
    expect(FLUJO.settings['saveDataSuccessExecution']).toBe('none');
    expect(FLUJO.settings).not.toHaveProperty('saveDataErrorExecution');
  });
});

describe('recordatorio de Bellido (prueba): el archivo de estado se crea con permisos 0600', () => {
  it('aplicar-prueba.py lo abre con os.open(…, 0o600), no con open(…, "w") seguido de chmod', () => {
    const py = readFileSync(join(RAIZ, 'herramientas/aplicar-prueba.py'), 'utf8');
    expect(py).toMatch(/os\.open\(estado_ruta, [^)]*0o600\)/);
    expect(py).not.toMatch(/\bopen\(estado_ruta, 'w'\)/);
  });
});

describe('recordatorio de Bellido v1: credenciales por nombre', () => {
  it('Calendar usa «Google Calendar account» y el envío «Graph WhatsApp Bellido (Bearer)»; no hay otras', () => {
    const cred = Object.fromEntries(FLUJO.nodes.filter((n) => n.credentials).map((n) => [n.name, n.credentials]));
    expect(cred).toEqual({
      'Citas de mañana': { googleCalendarOAuth2Api: { id: '', name: 'Google Calendar account' } },
      'Enviar plantilla': { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Bellido (Bearer)' } },
      'Marcar como recordada': { googleCalendarOAuth2Api: { id: '', name: 'Google Calendar account' } },
    });
  });
});
