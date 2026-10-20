/**
 * RESCATE DE 22 H — EL FLUJO, con el n8n de mentira (`pruebas/lib/n8n-de-mentira.ts`).
 *
 * Corre de verdad el código del JSON versionado de Rubén (`Flujos/experimental/rescate-22h/rescate-22h.rroca-ruben.json`); solo los nodos de red
 * (`Reclamar rescates`, `Redactar rescate`, `Enviar a WhatsApp`, `Enviar respaldo`, `Reportar mensaje (saliente)`) llevan doble.
 *
 * Lo que esta suite niega: que el texto que sale no sea EXACTAMENTE el fijo cuando el modelo falla, devuelve FIJO o redacta algo que el código rechaza; que salga
 * un mensaje a un teléfono que el servidor no reclamó, a uno fuera de la lista de prueba, desde otra línea, o con la ventana de Meta por cerrar; que un 401, un 500
 * o un flujo no admitido pasen en silencio; que se llame al modelo sin rescates; que salgan más de 20; que un mensaje lleve botones o no diga «asistente virtual»;
 * que se reporte como enviado lo que Meta rechazó; y que el reporte lleve un `evento` (el rescate no enciende nada).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from './lib/flujo';
import { crearMundo, type LlamadaDoble, type ResultadoTurno } from './lib/n8n-de-mentira';

const ESTA = dirname(fileURLToPath(import.meta.url));
const FLUJO = JSON.parse(readFileSync(join(ESTA, '../../Flujos/experimental/rescate-22h/rescate-22h.rroca-ruben.json'), 'utf8')) as Flujo;
const DATOS = JSON.parse(readFileSync(join(ESTA, '../scripts/datos/rroca-ruben/rescate-22h.json'), 'utf8')) as J;
const FIJO: string = DATOS['configBase'].rescateTextoFijo;
const SALUDO: string = DATOS['configBase'].rescateSaludo;

const HORA = 3_600_000;
const AHORA = Date.UTC(2026, 9, 21, 15, 0, 0);
const LINEA = '123456789';
const TEL = '70011122';
const OTRO = '70011133';
const HISTORIAL = ['tengo una tienda de ropa en el mercado', 'quiero ordenar mis ventas con inteligencia artificial'];
const BUENO = 'Vi que tienes una tienda de ropa y quieres ordenar tus ventas. ¿Te quedó alguna duda para empezar?';

const gemini = (texto: string): J => ({ candidates: [{ content: { parts: [{ text: texto }] } }] });
const enviado = (id = 'wamid.PRUEBA'): J => ({ messages: [{ id }] });

interface Escenario {
  respuesta?: J | ((l: LlamadaDoble) => J);
  rescates?: J[];
  modelo?: (l: LlamadaDoble) => J;
  meta?: (l: LlamadaDoble) => J;
  respaldo?: (l: LlamadaDoble) => J;
  config?: Record<string, unknown>;
}
interface Corrida { r: ResultadoTurno; reclamos: J[]; modelos: number; reportes: J[] }

const rescate = (telefono: string, extra: J = {}): J => ({ telefono, ultimoEntranteMs: AHORA - 22.1 * HORA, textos: HISTORIAL, ...extra });

function correr(e: Escenario = {}): Corrida {
  const reclamos: J[] = [];
  let modelos = 0;
  const reportes: J[] = [];
  const mundo = crearMundo({
    flujo: FLUJO,
    ahoraMs: AHORA,
    configBase: { phoneNumberId: LINEA, telefonosDePrueba: `${TEL},${OTRO}`, ...(e.config ?? {}) },
    dobles: {
      'Reclamar rescates': (l) => {
        reclamos.push(l.cuerpo ?? {});
        const r = e.respuesta ?? { statusCode: 200, body: { phoneNumberId: LINEA, rescates: e.rescates ?? [rescate(TEL)] } };
        return typeof r === 'function' ? r(l) : r;
      },
      'Redactar rescate': (l) => { modelos++; return (e.modelo ?? (() => gemini(BUENO)))(l); },
      'Enviar a WhatsApp': (l) => (e.meta ?? (() => enviado()))(l),
      'Enviar respaldo': (l) => (e.respaldo ?? (() => enviado('wamid.RESPALDO')))(l),
      'Reportar mensaje (saliente)': (l) => { reportes.push(l.cuerpo ?? {}); return {}; },
    },
  });
  const r = mundo.turno({}, { via: 'Cada 10 minutos', tolerarFallo: true });
  return { r, reclamos, modelos, reportes };
}

/** Lo que vale para TODO mensaje que sale, venga del modelo o del texto fijo. */
function invariantes(c: Corrida): void {
  for (const m of c.r.mensajes) {
    expect(m.tipo, 'un rescate es texto, nunca botones ni plantilla').toBe('text');
    expect(JSON.stringify(m.payload)).not.toMatch(/interactive|buttons|template/);
    expect(m.cuerpo.toLowerCase()).toContain('asistente virtual');
  }
  for (const rep of c.reportes) expect(rep, 'el rescate no enciende nada: sin evento').not.toHaveProperty('evento');
}

describe('ruta feliz', () => {
  it('un mensaje de texto al teléfono reclamado, que empieza con el saludo, y un reporte con idMeta y sin evento', () => {
    const c = correr();
    expect(c.r.fallo).toBeNull();
    expect(c.r.mensajes).toHaveLength(1);
    const m = c.r.mensajes[0]!;
    expect(m.a).toBe(TEL);
    expect(m.cuerpo.startsWith(`${SALUDO} `)).toBe(true);
    expect(m.cuerpo).toContain(BUENO);
    expect(m.respaldo).toBe(false);
    expect(c.reportes).toHaveLength(1);
    expect(c.reportes[0]).toMatchObject({ telefono: TEL, direccion: 'saliente', tipo: 'text', texto: m.cuerpo, idMeta: 'wamid.PRUEBA' });
    invariantes(c);
  });

  it('el reclamo manda v: 1, el tope 20 y la lista de prueba, con el número de la línea en la cabecera', () => {
    const reclamos: LlamadaDoble[] = [];
    const mundo = crearMundo({
      flujo: FLUJO, ahoraMs: AHORA, configBase: { phoneNumberId: LINEA, telefonosDePrueba: `${TEL},${OTRO}` },
      dobles: { 'Reclamar rescates': (l) => { reclamos.push(l); return { statusCode: 200, body: { phoneNumberId: LINEA, rescates: [] } }; } },
    });
    mundo.turno({}, { via: 'Cada 10 minutos' });
    expect(reclamos[0]!.cuerpo).toEqual({ v: 1, tope: 20, excluir: [], soloTelefonos: [TEL, OTRO] });
    expect(reclamos[0]!.encabezados['X-NovuChat-Numero']).toBe(LINEA);
    expect(reclamos[0]!.url).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/reclamarRescates');
  });
});

describe('el modelo falla o redacta algo que el código rechaza: sale EXACTAMENTE el texto fijo', () => {
  const casos: [string, (l: LlamadaDoble) => J][] = [
    ['responde FIJO', () => gemini('FIJO')],
    ['una cifra', () => gemini('Con 60 Bs empiezas hoy mismo con tu negocio, ¿te animas a hacerlo?')],
    ['un enlace', () => gemini('Mira www.ejemplo.com para más detalles de tu negocio, ¿te quedó alguna duda?')],
    ['dos preguntas', () => gemini('Vi que tienes una tienda. ¿Qué vendes? ¿Te quedó alguna duda para empezar?')],
    ['sin pregunta', () => gemini('Vi que tienes una tienda de ropa y quieres ordenar tus ventas con calma.')],
    ['«acreditado»', () => gemini('Tu pago fue acreditado, ¿todo bien con tu negocio de ropa?')],
    ['«soy una persona»', () => gemini('Soy una persona real y quiero ayudarte con tu tienda, ¿tienes alguna duda?')],
    ['«ayer»', () => gemini('Ayer me contaste de tu negocio de ropa, ¿te quedó alguna duda para empezar?')],
    ['«QR»', () => gemini('Recuerda que tu negocio puede usar un QR sin problema, ¿tienes alguna duda?')],
    ['una promesa de Rubén', () => gemini('Rubén te escribirá pronto para ayudarte con tu tienda, ¿te quedó alguna duda?')],
    ['un saludo propio', () => gemini('Hola, vi que tienes una tienda de ropa y quieres crecer, ¿te quedó alguna duda?')],
    ['una respuesta vacía', () => ({})],
    ['un error HTTP del modelo', () => ({ error: { message: 'HTTP 500' } })],
    ['una excepción del nodo', () => { throw new Error('timeout'); }],
  ];
  for (const [nombre, modelo] of casos) {
    it(`el modelo ${nombre}`, () => {
      const c = correr({ modelo });
      expect(c.r.fallo).toBeNull();
      expect(c.r.mensajes).toHaveLength(1);
      expect(c.r.mensajes[0]!.cuerpo).toBe(FIJO);
      invariantes(c);
    });
  }

  it('un historial insuficiente sale con el texto fijo', () => {
    const c = correr({ rescates: [rescate(TEL, { textos: ['hola'] })] });
    expect(c.r.mensajes[0]!.cuerpo).toBe(FIJO);
    const sin = correr({ rescates: [rescate(TEL, { textos: [] })] });
    expect(sin.r.mensajes[0]!.cuerpo).toBe(FIJO);
    invariantes(c);
  });
});

describe('a quién sale y cuándo', () => {
  it('con 23 h 50 min ya cumplidas desde el último mensaje, no sale nada (la ventana de Meta cierra a las 24 h)', () => {
    const c = correr({ rescates: [rescate(TEL, { ultimoEntranteMs: AHORA - 23.9 * HORA })] });
    expect(c.r.fallo).toBeNull();
    expect(c.r.mensajes).toHaveLength(0);
    expect(c.modelos).toBe(0);
    expect(c.reportes).toHaveLength(0);
  });

  it('justo antes del corte sí sale', () => {
    expect(correr({ rescates: [rescate(TEL, { ultimoEntranteMs: AHORA - 23.8 * HORA })] }).r.mensajes).toHaveLength(1);
  });

  it('lista de prueba: con la lista vacía o con el marcador sin llenar, el reclamo lleva `soloTelefonos: []`', () => {
    for (const lista of ['', 'REEMPLAZAR_TELEFONOS_RESCATE_RROCA_RUBEN']) {
      const c = correr({ rescates: [], config: { telefonosDePrueba: lista } });
      expect(c.reclamos[0], lista).toMatchObject({ soloTelefonos: [] });
      expect(c.r.mensajes).toHaveLength(0);
    }
  });

  it('con `listaDePrueba: false` el reclamo NO lleva `soloTelefonos`', () => {
    const c = correr({ rescates: [], config: { listaDePrueba: false } });
    expect(c.reclamos[0]).not.toHaveProperty('soloTelefonos');
    expect(c.reclamos[0]).toMatchObject({ v: 1, tope: 20 });
  });

  it('defensa en profundidad: con la lista de prueba, un teléfono que el servidor devolvió pero NO está en la lista no recibe nada', () => {
    const c = correr({ rescates: [rescate('70099988'), rescate(TEL)] });
    expect(c.r.mensajes.map((m) => m.a)).toEqual([TEL]);
  });

  it('con `listaDePrueba: false`, salen todos los reclamados', () => {
    const c = correr({ rescates: [rescate('70099988'), rescate(TEL)], config: { listaDePrueba: false } });
    expect(c.r.mensajes.map((m) => m.a)).toEqual(['70099988', TEL]);
  });

  it('`payload.to` es siempre el teléfono reclamado (y no se repite uno)', () => {
    const c = correr({ rescates: [rescate(TEL), rescate(OTRO), rescate(TEL)] });
    expect(c.r.mensajes.map((m) => (m.payload['to'] as string))).toEqual([TEL, OTRO]);
    expect(c.r.mensajes.map((m) => m.a)).toEqual([TEL, OTRO]);
    invariantes(c);
  });

  it('un teléfono mal formado en la respuesta se descarta', () => {
    const c = correr({ rescates: [rescate('abc'), rescate('123'), rescate(TEL)] });
    expect(c.r.mensajes.map((m) => m.a)).toEqual([TEL]);
  });

  it('una línea distinta en la respuesta: falla con RS-LINEA y no sale nada', () => {
    const c = correr({ respuesta: { statusCode: 200, body: { phoneNumberId: '555555555', rescates: [rescate(TEL)] } } });
    expect(c.r.fallo?.mensaje).toContain('RS-LINEA');
    expect(c.r.mensajes).toHaveLength(0);
    expect(c.modelos).toBe(0);
  });

  it('con el número de la línea sin llenar (marcador), no hay línea que coincida: RS-LINEA', () => {
    const c = correr({ config: { phoneNumberId: 'REEMPLAZAR_PHONE_NUMBER_ID_RROCA_RUBEN' }, respuesta: { statusCode: 200, body: { phoneNumberId: '', rescates: [rescate(TEL)] } } });
    expect(c.r.fallo?.mensaje).toContain('RS-LINEA');
    expect(c.r.mensajes).toHaveLength(0);
  });

  it('21 rescates en la respuesta: salen 20 como máximo', () => {
    const muchos = Array.from({ length: 21 }, (_, i) => rescate(`7001${String(i).padStart(4, '0')}`));
    const c = correr({ rescates: muchos, config: { listaDePrueba: false } });
    expect(c.r.mensajes).toHaveLength(20);
    invariantes(c);
  });
});

describe('las respuestas del servidor', () => {
  it('401 y 500 fallan con RS-RECLAMO-<código> y no sale nada', () => {
    for (const codigo of [401, 500, 403]) {
      const c = correr({ respuesta: { statusCode: codigo, body: { error: 'x' } } });
      expect(c.r.fallo?.mensaje, String(codigo)).toContain(`RS-RECLAMO-${codigo}`);
      expect(c.r.mensajes).toHaveLength(0);
      expect(c.modelos).toBe(0);
    }
  });

  it('409 (comercio suspendido) termina sin mensajes y SIN fallo', () => {
    const c = correr({ respuesta: { statusCode: 409, body: { estado: 'suspendido' } } });
    expect(c.r.fallo).toBeNull();
    expect(c.r.mensajes).toHaveLength(0);
    expect(c.modelos).toBe(0);
  });

  it('409 `flujo_no_admitido` falla con RS-FLUJO', () => {
    const c = correr({ respuesta: { statusCode: 409, body: { estado: 'flujo_no_admitido' } } });
    expect(c.r.fallo?.mensaje).toContain('RS-FLUJO');
    expect(c.r.mensajes).toHaveLength(0);
  });

  it('el servidor sin rescates (por cualquier motivo): 0 llamadas al modelo y 0 mensajes', () => {
    for (const motivo of ['lista_vacia', 'tope_diario', 'servicio_no_operativo', undefined]) {
      const c = correr({ respuesta: { statusCode: 200, body: { phoneNumberId: LINEA, rescates: [], motivo } } });
      expect(c.r.fallo).toBeNull();
      expect(c.modelos).toBe(0);
      expect(c.r.mensajes).toHaveLength(0);
    }
  });

  it('un cuerpo que no es un objeto (o sin lista de rescates) no envía nada', () => {
    expect(correr({ respuesta: { statusCode: 200, body: { phoneNumberId: LINEA } } }).r.mensajes).toHaveLength(0);
    expect(correr({ respuesta: { statusCode: 200, body: { phoneNumberId: LINEA, rescates: 'x' } } }).r.mensajes).toHaveLength(0);
  });
});

describe('el envío y el reporte', () => {
  it('si Meta rechaza el original y el respaldo, no se reporta nada como enviado', () => {
    const c = correr({ meta: () => ({ error: { message: 'rechazado' } }), respaldo: () => ({ error: { message: 'rechazado' } }) });
    expect(c.r.mensajes).toHaveLength(2);
    expect(c.reportes).toHaveLength(0);
  });

  it('si Meta rechaza solo el original, sale el respaldo (el mismo texto) y se reporta una vez', () => {
    const c = correr({ meta: () => ({ error: { message: 'rechazado' } }) });
    expect(c.r.mensajes.map((m) => m.respaldo)).toEqual([false, true]);
    expect(c.r.mensajes[1]!.cuerpo).toBe(c.r.mensajes[0]!.cuerpo);
    expect(c.reportes).toHaveLength(1);
    expect(c.reportes[0]).toMatchObject({ idMeta: 'wamid.RESPALDO' });
    invariantes(c);
  });
});
