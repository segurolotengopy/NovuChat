/**
 * EL FLUJO PROGRAMADO DE SEGUIMIENTOS (`Flujos/agendamiento-seguimientos.json`).
 *
 * Cada hora le pregunta al servidor a quién le toca el recordatorio de
 * solicitud pendiente, LO MARCA, y recién entonces manda: texto si la ventana
 * de 24 h sigue abierta, plantilla de utilidad si venció (bloque 4,
 * `Analisis/31` §4).
 *
 * Como en las demás suites, el código y las expresiones se extraen del JSON
 * versionado y se ejecutan: si alguien edita el flujo en n8n y exporta, la
 * prueba corre el código nuevo. Lo que se protege:
 *
 *   1. LA MARCA VA ANTES DEL ENVÍO, y no se envía si el servidor no marcó.
 *      Es lo que hace cierto «nunca dos recordatorios a la misma solicitud».
 *   2. UN SOLO ENVÍO POR ITEM: las dos ramas son excluyentes y ninguna cuelga
 *      de la otra.
 *   3. EL FLUJO NO DECIDE A QUIÉN SE LE ESCRIBE: manda lo que el servidor le
 *      devolvió, sin filtrar ni recalcular el modo.
 *   4. LOS TEXTOS no dicen «interés», «promoción» ni precio, no afirman un
 *      pago y no prometen un horario que podría no existir.
 *   5. LA PLANTILLA lleva EXACTAMENTE dos parámetros, en su orden.
 *   6. Con el panel caído o el comercio no operativo salen CERO items.
 *   7. Ningún valor real: solo el marcador del número de Platinum.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

type J = Record<string, any>;
interface Nodo {
  id: string; name: string; type: string; typeVersion: number; position: [number, number];
  parameters: J; credentials?: Record<string, { id: string; name: string }>;
  onError?: string; retryOnFail?: boolean; maxTries?: number; notes?: string;
}
interface Flujo {
  name: string; settings: J; nodes: Nodo[];
  connections: Record<string, Record<string, { node: string; type: string; index: number }[][]>>;
}

const TEXTO = readFileSync(join(aqui, '../../Flujos/agendamiento-seguimientos.json'), 'utf8');
const f = JSON.parse(TEXTO) as Flujo;
const nodo = (nombre: string): Nodo => {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
};
const codigo = (nombre: string) => String(nodo(nombre).parameters['jsCode']);
const destinos = (desde: string, salida = 0) =>
  (f.connections[desde]?.['main']?.[salida] ?? []).map((x) => x.node);

function ejecutar(js: string, items: J[], referencias: Record<string, J[]> = {}): J[] {
  const entrada = { all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) };
  const $ = (n: string) => ({
    first: () => ({ json: referencias[n]?.[0] ?? {} }),
    all: () => (referencias[n] ?? []).map((json) => ({ json })),
  });
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
/** Renderiza una plantilla de n8n (`=texto {{ expresión }} texto`). */
function plantillaN8n(texto: unknown, referencias: Record<string, J> = {}): string {
  const t = String(texto);
  if (!t.startsWith('=')) throw new Error('no es una plantilla de n8n');
  const $ = (n: string) => ({ first: () => ({ json: referencias[n] ?? {} }), item: { json: referencias[n] ?? {} } });
  return t.slice(1).replace(/\{\{([\s\S]*?)\}\}/g, (_, expr: string) => {
    // nosemgrep: devsecops.js-eval-prohibido
    const v = (new Function('$', `return (${expr});`) as (a: unknown) => unknown)($);
    return v === undefined || v === null ? '' : String(v);
  });
}
const configBase = (): J => Object.fromEntries(
  (nodo('Config base').parameters['assignments'].assignments as { name: string; value: unknown }[])
    .map((a) => [a.name, a.value]),
);

const panel = (extra: J = {}) => ({
  statusCode: 200,
  body: {
    tenantId: 'platinum', flujo: 'agendamiento', estadoComercio: 'activo', phoneNumberId: '1000000001',
    operacion: { moneda: 'BOB' },
    datosDelNegocio: { nombreNegocio: 'Clínica Platinum' },
    funcionarios: [], catalogo: [], voz: {}, ...extra,
  },
});
const listado = (pendientes: J[], statusCode = 200) => ({ statusCode, body: { pendientes } });

const PEND_TEXTO = {
  telefono: '59170000001', nombreContacto: 'Ana', etapa: 'horarios', modo: 'texto',
  ultimoEn: '2026-09-17T14:00:00.000Z',
};
const PEND_PLANTILLA = {
  telefono: '59170000002', nombreContacto: 'Beto', etapa: 'horarios', modo: 'plantilla',
  ultimoEn: '2026-09-16T13:30:00.000Z',
};
const PEND_SENA = {
  telefono: '59170000003', nombreContacto: 'Carla', etapa: 'qr_enviado', modo: 'texto',
  ultimoEn: '2026-09-17T14:00:00.000Z', importe: 50,
  evento: { id: 'ev-77', calendario: 'agenda@ejemplo.com' },
};

const items = (pendientes: J[], cfg: J = panel()): J[] => ejecutar(
  codigo('Un item por solicitud'), [listado(pendientes) as J],
  { 'Config base': [configBase()], 'Traer configuración': [cfg] },
);

// ---------------------------------------------------------------------------

describe('1. Forma del flujo: programado, orden v1, ids cortos', () => {
  it('se llama como el cliente y corre cada hora al minuto 15', () => {
    expect(f.name).toBe('NovuChat — Clínica Platinum (Seguimientos)');
    expect(f.settings['executionOrder']).toBe('v1');
    expect(f.settings['timezone']).toBe('America/La_Paz');
    expect(nodo('Cada hora').parameters['rule'].interval[0].expression).toBe('15 * * * *');
  });

  it('los ids son cortos, propios de este flujo, sin UUID, y no se repiten', () => {
    const ids = f.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^sg-[a-z0-9-]+$/);
      expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it('no hay disparador de webhook: es un barrido, no responde a nadie', () => {
    expect(f.nodes.filter((n) => /Trigger$/.test(n.type) && n.id !== 'sg-cada-hora')).toEqual([]);
  });

  it('las credenciales van por nombre con id vacío, y la de ingesta NUNCA en un nodo de Meta', () => {
    const ingesta = ['Traer configuración', 'Pendientes', 'Marcar seguimiento', 'Reportar seguimiento (saliente)'];
    for (const n of ingesta) {
      expect(nodo(n).credentials?.['httpHeaderAuth']).toEqual({
        id: '', name: 'NovuChat ingesta (Clínica Platinum)',
      });
    }
    for (const n of ['Enviar texto', 'Enviar plantilla']) {
      expect(nodo(n).credentials?.['whatsAppApi']).toEqual({
        id: '', name: 'WhatsApp Clínica Platinum (envío)',
      });
      expect(nodo(n).credentials?.['httpHeaderAuth']).toBeUndefined();
    }
  });

  it('el único valor de `Config base` que parece un dato es el marcador del número', () => {
    expect(configBase()).toEqual({
      phoneNumberId: 'REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM',
      waGraphVersion: 'v26.0',
      plantilla: 'solicitud_cita_sin_confirmar',
      idiomaPlantilla: 'es',
    });
  });
});

describe('2. La marca va ANTES del envío, y sin marca no se envía', () => {
  it('el cableado: pendientes → items → marcar → ¿se marcó? → ¿en ventana? → enviar', () => {
    expect(destinos('Pendientes')).toEqual(['Un item por solicitud']);
    expect(destinos('Un item por solicitud')).toEqual(['Marcar seguimiento']);
    expect(destinos('Marcar seguimiento')).toEqual(['¿Se marcó?']);
    expect(destinos('¿Se marcó?', 0)).toEqual(['¿En ventana?']);
    // La rama falsa de `¿Se marcó?` no va a ninguna parte: ese item muere ahí.
    expect(destinos('¿Se marcó?', 1)).toEqual([]);
    expect(destinos('¿En ventana?', 0)).toEqual(['Enviar texto']);
    expect(destinos('¿En ventana?', 1)).toEqual(['Enviar plantilla']);
  });

  it('NINGÚN nodo de envío cuelga de un camino que no pase por `Marcar seguimiento`', () => {
    // Recorrido desde el disparador: el primer nodo que escribe a WhatsApp
    // tiene que aparecer DESPUÉS de la marca, sin ningún atajo.
    const orden: string[] = [];
    const visitar = (n: string) => {
      if (orden.includes(n)) return;
      orden.push(n);
      for (const salida of f.connections[n]?.['main'] ?? []) for (const d of salida) visitar(d.node);
    };
    visitar('Cada hora');
    const marca = orden.indexOf('Marcar seguimiento');
    for (const envio of ['Enviar texto', 'Enviar plantilla']) {
      expect(orden.indexOf(envio), envio).toBeGreaterThan(marca);
    }
  });

  it('`¿Se marcó?` solo deja pasar `marcado: true` del servidor', () => {
    const cond = nodo('¿Se marcó?').parameters['conditions'].conditions[0].leftValue;
    expect(expresion(cond, { statusCode: 200, body: { marcado: true, repetido: false } })).toBe(true);
    // Otra corrida se adelantó: no se manda nada.
    expect(expresion(cond, { statusCode: 200, body: { marcado: false, repetido: true } })).toBe(false);
    expect(expresion(cond, { statusCode: 200, body: { marcado: false, motivo: 'sin_solicitud' } })).toBe(false);
    // El servidor no contestó, o contestó mal: tampoco.
    expect(expresion(cond, { statusCode: 500, body: {} })).toBe(false);
    expect(expresion(cond, {})).toBe(false);
  });

  it('`Marcar seguimiento` manda el teléfono y el modo del item, y nada más', () => {
    const cuerpo = JSON.parse(String(expresion(
      nodo('Marcar seguimiento').parameters['jsonBody'], { telefono: '59170000001', modo: 'texto' })));
    expect(cuerpo).toEqual({ telefono: '59170000001', modo: 'texto' });
  });
});

describe('3. Un solo envío por item, y el flujo no recalcula a quién le toca', () => {
  it('`¿En ventana?` usa el modo que decidió el SERVIDOR, no el reloj del flujo', () => {
    const cond = nodo('¿En ventana?').parameters['conditions'].conditions[0];
    expect(cond.rightValue).toBe('texto');
    expect(expresion(cond.leftValue, {}, { 'Un item por solicitud': { modo: 'texto' } })).toBe('texto');
    expect(expresion(cond.leftValue, {}, { 'Un item por solicitud': { modo: 'plantilla' } })).toBe('plantilla');
    // Y en el código del flujo no hay ninguna ventana de horas que compita con
    // la del servidor. La única cuenta de tiempo que queda es el desfase fijo
    // de America/La_Paz (−4 h), que sirve para escribir la fecha, no para
    // decidir a quién se le escribe.
    expect(codigo('Un item por solicitud')).not.toMatch(/\b(2|24|48)\s*\*\s*3600000\b/);
    expect(codigo('Un item por solicitud')).not.toMatch(/\bDate\.now\(\)/);
  });

  it('las dos ramas convergen en UN solo reporte, y ninguna manda dos mensajes', () => {
    expect(destinos('Enviar texto')).toEqual(['Reportar seguimiento (saliente)']);
    expect(destinos('Enviar plantilla')).toEqual(['Reportar seguimiento (saliente)']);
    // Ningún nodo de envío cuelga del otro.
    expect(destinos('Enviar texto')).not.toContain('Enviar plantilla');
    expect(destinos('Enviar plantilla')).not.toContain('Enviar texto');
    // Y hay exactamente dos nodos que escriben al cliente.
    // El host se reconoce por el COMIENZO de la URL: `includes` acepta
    // graph.facebook.com.ejemplo.net, y CodeQL lo marca con razón.
    const META = /^=?https:\/\/graph\.facebook\.com\//;
    const envian = f.nodes.filter((n) => n.type.endsWith('.whatsApp')
      || (n.type.endsWith('.httpRequest') && META.test(String(n.parameters['url']))));
    expect(envian.map((n) => n.name).sort()).toEqual(['Enviar plantilla', 'Enviar texto']);
  });

  it('el flujo NO filtra la lista: manda tal cual lo que el servidor devolvió', () => {
    const salida = items([PEND_TEXTO, PEND_PLANTILLA, PEND_SENA]);
    expect(salida.map((i) => i['telefono'])).toEqual(
      [PEND_TEXTO.telefono, PEND_PLANTILLA.telefono, PEND_SENA.telefono]);
    expect(salida.map((i) => i['modo'])).toEqual(['texto', 'plantilla', 'texto']);
  });
});

describe('4. Cuando no se sabe, no se escribe', () => {
  it('con el panel caído, el comercio suspendido o el listado sin responder: cero items', () => {
    expect(items([PEND_TEXTO], { statusCode: 502, body: {} })).toEqual([]);
    expect(items([PEND_TEXTO], panel({ estadoComercio: 'suspendido' }))).toEqual([]);
    expect(items([PEND_TEXTO], { statusCode: 200, body: {} })).toEqual([]);
    expect(ejecutar(codigo('Un item por solicitud'), [listado([], 500) as J],
      { 'Config base': [configBase()], 'Traer configuración': [panel()] })).toEqual([]);
  });

  it('una lista vacía, o un item sin teléfono o sin modo, no produce ningún envío', () => {
    expect(items([])).toEqual([]);
    expect(items([{ telefono: 'abc', modo: 'texto' }])).toEqual([]);
    expect(items([{ telefono: '59170000001', modo: 'carta' }])).toEqual([]);
    expect(items([{ telefono: '59170000001' }])).toEqual([]);
  });
});

describe('5. Los textos: sin lenguaje comercial, sin precio y sin prometer de más', () => {
  const salida = () => items([PEND_TEXTO, PEND_PLANTILLA, PEND_SENA]);
  const todosLosTextos = () => salida().flatMap((i) => [String(i['texto']), String(i['textoReportado'])]);

  /** Lo que convierte una plantilla de utilidad en marketing (memoria del 14/09). */
  const COMERCIAL = /inter[eé]s|interesad|promoci[oó]n|oferta|descuento|te esperamos|continuar la atenci[oó]n|prospecto|aprovech/i;
  /** Prohibición 3 de CLAUDE.md: nunca afirmar que un pago entró. */
  const AFIRMA_PAGO = /acreditad|verificad|recibimos tu pago|pago confirmad/i;

  it('ninguno usa vocabulario comercial', () => {
    for (const t of todosLosTextos()) expect(t, t).not.toMatch(COMERCIAL);
  });

  it('ninguno lleva un precio: ni el importe de la seña, ni ninguna cifra con moneda', () => {
    // El importe llega en el item (`importe: 50`) y NO se escribe: una cifra en
    // un recordatorio lo vuelve una oferta, que es justo lo que Meta clasifica
    // como marketing. El monto ya viajó en el caption del QR.
    for (const t of todosLosTextos()) {
      expect(t, t).not.toMatch(/\d+\s*(Bs|BOB|bolivianos|USD|\$)/i);
      expect(t, t).not.toContain('50');
    }
  });

  it('el de la seña no afirma ningún pago ni promete un horario que podría no existir', () => {
    const conSena = salida().find((i) => i['etapa'] === 'qr_enviado');
    expect(String(conSena?.['texto'])).not.toMatch(AFIRMA_PAGO);
    expect(String(conSena?.['texto'])).not.toMatch(/sigue reservado|está reservado|te guard/i);
    expect(String(conSena?.['texto'])).toMatch(/comprobante/i);
  });

  it('están en tuteo, no en voseo (CLAUDE.md)', () => {
    for (const t of todosLosTextos()) {
      expect(t, t).not.toMatch(/\b(quer[ée]s|dec[ií]me|mand[aá]me|ten[ée]s|pod[ée]s|serv[ií]s|elig[ií])\b/i);
    }
    expect(String(salida()[0]?.['texto'])).toMatch(/\bdime\b/);
  });

  it('el nombre del cliente entra saneado, y sin nombre el saludo sigue funcionando', () => {
    const sucio = items([{ ...PEND_TEXTO, nombreContacto: 'Ana\nBcc: alguien@ejemplo.com' }]);
    expect(String(sucio[0]?.['texto'])).not.toContain('\n');
    const sinNombre = items([{ ...PEND_TEXTO, nombreContacto: '' }]);
    expect(String(sinNombre[0]?.['texto'])).toMatch(/^Hola 👋 /);
  });

  it('el nombre del negocio sale del panel, no del flujo', () => {
    const otro = items([PEND_TEXTO], panel({ datosDelNegocio: { nombreNegocio: 'Otra Clínica' } }));
    expect(String(otro[0]?.['texto'])).toContain('Otra Clínica');
    expect(String(otro[0]?.['nombreNegocio'])).toBe('Otra Clínica');
  });
});

describe('6. La plantilla: dos parámetros, en su orden, y de utilidad', () => {
  const item = () => items([PEND_PLANTILLA])[0] ?? {};

  it('el cuerpo del envío a Graph es un `template` con dos parámetros de texto', () => {
    const cuerpo = JSON.parse(String(expresion(
      nodo('Enviar plantilla').parameters['jsonBody'], {}, { 'Un item por solicitud': item() })));
    expect(cuerpo.messaging_product).toBe('whatsapp');
    expect(cuerpo.type).toBe('template');
    expect(cuerpo.to).toBe(PEND_PLANTILLA.telefono);
    expect(cuerpo.template.name).toBe('solicitud_cita_sin_confirmar');
    expect(cuerpo.template.language).toEqual({ code: 'es' });
    expect(cuerpo.template.components).toHaveLength(1);
    expect(cuerpo.template.components[0].type).toBe('body');
    expect(cuerpo.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Clínica Platinum' },
      { type: 'text', text: 'el 16 de septiembre' },
    ]);
  });

  it('sin botones: Meta no acepta wa.me, y un botón de llamada llama al negocio', () => {
    const cuerpo = String(nodo('Enviar plantilla').parameters['jsonBody']);
    expect(cuerpo).not.toContain('buttons');
    expect(cuerpo).not.toContain('wa.me');
  });

  it('la URL de Graph se arma con la versión y el número de la configuración', () => {
    const url = plantillaN8n(nodo('Enviar plantilla').parameters['url'],
      { 'Un item por solicitud': { waGraphVersion: 'v26.0', phoneNumberId: '1000000001' } });
    expect(url).toBe('https://graph.facebook.com/v26.0/1000000001/messages');
  });

  it('la fecha de la solicitud se calcula en UTC−4, que es lo que ve el paciente', () => {
    // 2026-09-16T13:30Z son las 09:30 del 16 en La Paz: mismo día.
    expect(item()['fechaSolicitud']).toBe('el 16 de septiembre');
    // 2026-09-17T02:00Z son las 22:00 del 16: el día ANTERIOR.
    const cruce = items([{ ...PEND_PLANTILLA, ultimoEn: '2026-09-17T02:00:00.000Z' }])[0];
    expect(cruce?.['fechaSolicitud']).toBe('el 16 de septiembre');
    // Y una fecha ilegible no rompe el mensaje ni escribe «Invalid Date».
    const rota = items([{ ...PEND_PLANTILLA, ultimoEn: 'ayer' }])[0];
    expect(String(rota?.['fechaSolicitud'])).not.toMatch(/invalid|nan/i);
  });
});

describe('7. El reporte a la ingesta: lo que la persona recibió', () => {
  it('reporta el saliente con el texto que salió, en los dos modos', () => {
    for (const p of [PEND_TEXTO, PEND_PLANTILLA]) {
      const item = items([p])[0] ?? {};
      const cuerpo = JSON.parse(String(expresion(
        nodo('Reportar seguimiento (saliente)').parameters['jsonBody'],
        { messages: [{ id: 'wamid.sg1' }] }, { 'Un item por solicitud': item })));
      expect(cuerpo).toMatchObject({
        telefono: p.telefono, direccion: 'saliente', tipo: 'text', idMeta: 'wamid.sg1',
      });
      expect(String(cuerpo.texto).length).toBeGreaterThan(20);
    }
  });

  it('en modo plantilla reporta el cuerpo resuelto, no el nombre de la plantilla', () => {
    const item = items([PEND_PLANTILLA])[0] ?? {};
    expect(String(item['textoReportado'])).toContain('Clínica Platinum');
    expect(String(item['textoReportado'])).toContain('el 16 de septiembre');
    expect(String(item['textoReportado'])).not.toContain('solicitud_cita_sin_confirmar');
  });

  it('el reporte NO manda ningún `evento`: el hecho ya lo anotó `seguimientoEnviado`', () => {
    const cuerpo = String(nodo('Reportar seguimiento (saliente)').parameters['jsonBody']);
    expect(cuerpo).not.toContain('evento:');
  });
});

describe('8. Mensajes declarados y saneo', () => {
  it('+1 mensaje por solicitud pendiente, y ninguno más: un envío por item', () => {
    const salida = items([PEND_TEXTO, PEND_PLANTILLA, PEND_SENA]);
    expect(salida).toHaveLength(3);
    // Cada item pasa por UNA sola rama de envío: no hay ningún camino que
    // mande el texto y además la plantilla.
    for (const i of salida) expect(['texto', 'plantilla']).toContain(i['modo']);
  });

  it('ningún valor real en el JSON versionado', () => {
    expect(TEXTO).toContain('REEMPLAZAR_PHONE_NUMBER_ID_PLATINUM');
    // Ninguna secuencia larga de dígitos (identificadores de Meta, teléfonos).
    expect(TEXTO.replace(/REEMPLAZAR_[A-Z_]+/g, '')).not.toMatch(/\b\d{10,}\b/);
    expect(TEXTO).not.toMatch(/EAA[A-Za-z0-9]{20,}/);
    for (const n of f.nodes) {
      for (const c of Object.values(n.credentials ?? {})) expect(c.id).toBe('');
    }
  });
});
