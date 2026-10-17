/**
 * EL FLUJO COMUN «SALIDA DE PERSONA» (H2-F): lo que consume del contrato de H2-3.
 *
 * Camino: timbre/barrido -> `Validar toque` -> `Reclamar` -> `Planificar lote` -> `Por canal` ->
 * (relé | Graph) -> `Resultado del envío` -> `Confirmar` -> `Verificar y seguir` -> vuelta a `Reclamar`.
 *
 * Los nodos Code del JSON versionado corren con `new Function` (el evaluador compartido de
 * `lib/flujo.ts`, que deja `URL`, `Buffer` y `crypto` vacios como en n8n). Los nodos HTTP no corren:
 * se evaluan sus expresiones (url, cabeceras, cuerpo) con el helper `expresion` y la respuesta la pone
 * la prueba. El «servidor» es una maquina de estados que repite las transiciones de
 * `reclamarSalidaPersona` / `confirmarSalidaPersona` (PR #510), para que el bucle de 11 mensajes y los
 * estados finales se midan, no se supongan.
 *
 * Cero mensajes por conversacion: el flujo solo entrega lo que la persona ya escribio.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GLOBALES_FUERA_DEL_SANDBOX, codigoDe, correr, destinos, entradas, expresion, leerFlujo, nodo, plantilla, type J,
} from '../lib/flujo.ts';

const ARCHIVO = 'salida-de-persona.json';
const flujo = leerFlujo(ARCHIVO);
/** Lo que entrega un reclamo como maximo (MAXIMO_POR_RECLAMO de H2-3); el servidor simulado lo usa igual. */
const MAXIMO_POR_RECLAMO = 10;
const NUMERO = '1000000001';
const RELE = 'http://rele-de-prueba:8082';
const CONFIG: J = { phoneNumberId: NUMERO, waGraphVersion: 'v26.0', releBaseUrl: RELE, maxVueltas: 10 };

// ---------------------------------------------------------------------------
// El servidor simulado (mismas transiciones que las Functions de H2-3)
// ---------------------------------------------------------------------------
type Estado = 'pendiente' | 'enviando' | 'aceptado' | 'rechazado' | 'incierto';
interface Doc { mensajeId: string; conversacionId: string; texto: string; estado: Estado; idMeta?: string; codigo?: string; reintentable?: boolean }

function servidor(canal: string, docs: Doc[]) {
  const reclamos: number[] = [];
  const confirmaciones: J[] = [];
  return {
    docs, reclamos, confirmaciones,
    reclamar(): J {
      const entregados: J[] = [];
      for (const d of docs) {
        if (entregados.length >= MAXIMO_POR_RECLAMO) break;
        if (d.estado !== 'pendiente') continue;
        d.estado = 'enviando';
        entregados.push({
          mensajeId: d.mensajeId, conversacionId: d.conversacionId, claveRele: ('c'.repeat(16) + d.mensajeId).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 48),
          to: d.conversacionId.slice(3), texto: d.texto, tipo: 'text', canal,
        });
      }
      reclamos.push(entregados.length);
      return { mensajes: entregados };
    },
    confirmar(c: J): { statusCode: number; body: J } {
      confirmaciones.push(c);
      const d = docs.find((x) => x.mensajeId === c['mensajeId']);
      if (!d) return { statusCode: 404, body: {} };
      if (d.estado !== 'enviando' && d.estado !== 'incierto') return { statusCode: 409, body: {} };
      d.estado = c['resultado'] as Estado;
      if (c['idMeta']) d.idMeta = c['idMeta'] as string;
      if (c['codigo']) d.codigo = c['codigo'] as string;
      if (c['reintentable'] !== undefined) d.reintentable = c['reintentable'] as boolean;
      return { statusCode: 200, body: { ok: true, estado: d.estado } };
    },
  };
}

const doc = (n: number, texto = `Hola ${n}`): Doc => ({
  mensajeId: `clave-de-envio-${String(n).padStart(4, '0')}`, conversacionId: `wa_5917000${String(n).padStart(4, '0')}`, texto, estado: 'pendiente',
});

interface Llamada { nodo: string; url: string; idempotencia?: string; cuerpo: J }
type Enviar = (nodoDeEnvio: 'Enviar por el relé' | 'Enviar por Graph', l: Llamada, i: number) => J;

/** Una ejecucion completa: lo que hace n8n desde el toque hasta que el reclamo llega vacio (o falla). */
function ejecutarFlujo(opciones: {
  servidor: ReturnType<typeof servidor>; enviar: Enviar; config?: J; timbre?: J;
  confirmarFalla?: (c: J, intento: number) => { statusCode: number; body: J } | null;
}) {
  const cfg = opciones.config ?? CONFIG;
  const refs: Record<string, J | J[]> = { 'Config base': cfg };
  if (opciones.timbre) refs['Timbre'] = opciones.timbre;
  const llamadas: Llamada[] = [];
  const confirmadas: J[] = [];
  let vueltas = 0;
  const intentosDeConfirmar: number[] = [];

  const valido = correr(codigoDe(flujo, 'Validar toque'), [{}], refs);
  if (valido.length === 0) return { llamadas, confirmadas, vueltas, descartado: true, intentosDeConfirmar };

  const reglas = (nodo(flujo, 'Por canal').parameters['rules'] as { values: { conditions: { conditions: { rightValue: string }[] } }[] }).values
    .map((r) => r.conditions.conditions[0]!.rightValue);

  for (let vuelta = 0; vuelta < 60; vuelta++) {
    vueltas = vuelta + 1;
    const respuesta = opciones.servidor.reclamar();
    const planeados = correr(codigoDe(flujo, 'Planificar lote'), [respuesta], refs).map((x) => x.json);
    if (planeados.length === 0) break;

    const resultados: J[] = [];
    const respuestasConfirmar: J[] = [];
    // El Switch separa por canal; cada rama corre entera antes de la siguiente (executionOrder v1).
    const porRama = [0, 1, 2].map((rama) => planeados.filter((p) => (reglas.indexOf(String(p['ruta'])) === -1 ? 2 : reglas.indexOf(String(p['ruta']))) === rama));
    porRama.forEach((items, rama) => {
      items.forEach((p, i) => {
        let r: J;
        if (rama === 2) r = p; // «sin envío»: entra tal cual a Resultado
        else {
          const n = rama === 0 ? 'Enviar por el relé' : 'Enviar por Graph';
          const params = nodo(flujo, n).parameters as J;
          const url = plantilla(params['url'], p, refs);
          const cab = (params['headerParameters'] as { parameters: { name: string; value: string }[] } | undefined)?.parameters ?? [];
          const idem = cab.find((c) => c.name === 'Idempotency-Key');
          const cuerpo = JSON.parse(String(expresion(params['jsonBody'], p, refs))) as J;
          const llamada: Llamada = { nodo: n, url, cuerpo, ...(idem ? { idempotencia: plantilla(idem.value, p, refs) } : {}) };
          llamadas.push(llamada);
          r = opciones.enviar(n as 'Enviar por el relé' | 'Enviar por Graph', llamada, llamadas.length - 1);
        }
        const res = (correr(codigoDe(flujo, 'Resultado del envío'), [r], { ...refs, 'Planificar lote': p }) as unknown as { json: J }).json;
        resultados.push(res);
        void i;
      });
    });
    for (const c of resultados) {
      const cuerpoConfirmar = JSON.parse(String(expresion(nodo(flujo, 'Confirmar').parameters['jsonBody'], c, refs))) as J;
      // El nodo `Confirmar` reintenta (retryOnFail) ante red/5xx/429 y, si se agota, la ejecucion FALLA.
      const parametros = nodo(flujo, 'Confirmar');
      const intentosMax = parametros.retryOnFail ? Number(parametros.maxTries ?? 3) : 1;
      let r: { statusCode: number; body: J } | null = null;
      for (let intento = 1; intento <= intentosMax; intento++) {
        intentosDeConfirmar.push(intento);
        const forzada = opciones.confirmarFalla?.(cuerpoConfirmar, intento) ?? null;
        const x = forzada ?? opciones.servidor.confirmar(cuerpoConfirmar);
        if (x.statusCode === 429 || x.statusCode >= 500) continue;
        if (x.statusCode >= 400) throw new Error(`Confirmar: HTTP ${x.statusCode}`);
        r = x; break;
      }
      if (!r) throw new Error('Confirmar: reintentos agotados');
      confirmadas.push(cuerpoConfirmar);
      respuestasConfirmar.push(r);
    }
    const sigue = correr(codigoDe(flujo, 'Verificar y seguir'), respuestasConfirmar, { ...refs, 'Resultado del envío': resultados }, { $runIndex: vuelta });
    if (sigue.length === 0) break;
  }
  return { llamadas, confirmadas, vueltas, descartado: false, intentosDeConfirmar };
}

const ok = (id: string) => ({ statusCode: 200, body: { messages: [{ id }], contacts: [{ wa_id: '59170000001' }] } });
const sinEnviar: Enviar = () => { throw new Error('no debia enviar'); };

describe('Salida de persona: el bucle', () => {
  it('reclamar vacio: no envia, no confirma y termina en una vuelta', () => {
    const s = servidor('rele', []);
    const r = ejecutarFlujo({ servidor: s, enviar: sinEnviar });
    expect(r.llamadas).toHaveLength(0);
    expect(r.confirmadas).toHaveLength(0);
    expect(s.reclamos).toEqual([0]);
  });

  it('un mensaje por el relé: Idempotency-Key = claveRele, URL interna del relé, aceptado con idMeta', () => {
    const s = servidor('rele', [doc(1, 'Hola, soy Ana')]);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.HBgM1') });
    expect(r.llamadas).toHaveLength(1);
    const l = r.llamadas[0]!;
    expect(l.nodo).toBe('Enviar por el relé');
    expect(l.url).toBe(`${RELE}/v1/envio/mensajes/${NUMERO}`);
    expect(l.idempotencia).toMatch(/^[A-Za-z0-9_.:-]{16,128}$/);
    expect(l.cuerpo).toEqual({ messaging_product: 'whatsapp', to: '59170000001', type: 'text', text: { body: 'Hola, soy Ana' } });
    expect(r.confirmadas).toEqual([{ mensajeId: s.docs[0]!.mensajeId, conversacionId: s.docs[0]!.conversacionId, resultado: 'aceptado', idMeta: 'wamid.HBgM1' }]);
    expect(s.docs[0]!.estado).toBe('aceptado');
  });

  it('un mensaje por Graph: usa Graph con la version configurada, sin Idempotency-Key, aceptado', () => {
    const s = servidor('graph', [doc(2)]);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.G1') });
    expect(r.llamadas[0]!.nodo).toBe('Enviar por Graph');
    expect(r.llamadas[0]!.url).toBe(`https://graph.facebook.com/v26.0/${NUMERO}/messages`);
    expect(r.llamadas[0]!.idempotencia).toBeUndefined();
    expect(s.docs[0]).toMatchObject({ estado: 'aceptado', idMeta: 'wamid.G1' });
  });

  it('504 del relé: incierto, UNA sola llamada, nunca se reenvia solo', () => {
    const s = servidor('rele', [doc(3)]);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ({ statusCode: 504, body: { error: { codigo: 'WM-3041', reintentable: false } } }) });
    expect(r.llamadas).toHaveLength(1);
    expect(s.docs[0]!.estado).toBe('incierto');
    expect(r.confirmadas[0]).toEqual({ mensajeId: s.docs[0]!.mensajeId, conversacionId: s.docs[0]!.conversacionId, resultado: 'incierto' });
    expect(s.reclamos).toEqual([1, 0]); // la segunda vuelta no encuentra nada que reenviar
  });

  it('tiempo agotado o red caida (error del nodo HTTP): incierto', () => {
    for (const canal of ['rele', 'graph']) {
      const s = servidor(canal, [doc(4)]);
      ejecutarFlujo({ servidor: s, enviar: () => ({ error: { message: 'timeout of 30000ms exceeded' } }) });
      expect(s.docs[0]!.estado).toBe('incierto');
    }
  });

  it('Graph 5xx o 2xx sin id: incierto (pudo haber salido)', () => {
    const a = servidor('graph', [doc(5)]);
    ejecutarFlujo({ servidor: a, enviar: () => ({ statusCode: 500, body: { error: { code: 2 } } }) });
    expect(a.docs[0]!.estado).toBe('incierto');
    const b = servidor('graph', [doc(6)]);
    ejecutarFlujo({ servidor: b, enviar: () => ({ statusCode: 200, body: {} }) });
    expect(b.docs[0]!.estado).toBe('incierto');
  });

  it('rechazo de Meta por el relé (WM-3040 con metaCodigo): rechazado con el codigo de Meta, no reintentable', () => {
    const s = servidor('rele', [doc(7)]);
    ejecutarFlujo({ servidor: s, enviar: () => ({ statusCode: 502, body: { error: { codigo: 'WM-3040', clase: 'FATAL', reintentable: false, metaCodigo: 131047 } } }) });
    expect(s.docs[0]).toMatchObject({ estado: 'rechazado', codigo: '131047', reintentable: false });
  });

  it('relé: WM-3040 sin metaCodigo, con un metaCodigo desconocido, y un WM desconocido o 3036 son INCIERTOS', () => {
    const casos: [number, J][] = [
      [502, { error: { codigo: 'WM-3040', reintentable: false } }],
      [502, { error: { codigo: 'WM-3040', metaCodigo: 999999 } }],
      [422, { error: { codigo: 'WM-3036' } }],
      [500, { error: { codigo: 'WM-3099' } }],
      [400, {}],
      [404, { error: { codigo: 'WM-3030' } }],
    ];
    for (const [statusCode, body] of casos) {
      const s = servidor('rele', [doc(18)]);
      ejecutarFlujo({ servidor: s, enviar: () => ({ statusCode, body }) });
      expect(s.docs[0]!.estado, JSON.stringify(body)).toBe('incierto');
    }
  });

  it.each(['WM-3010', 'WM-3011', 'WM-3012', 'WM-3031', 'WM-3032', 'WM-3033', 'WM-3034', 'WM-3039'])('relé: %s (rechazo previo a Graph) es rechazado', (wm) => {
    const s = servidor('rele', [doc(19)]);
    ejecutarFlujo({ servidor: s, enviar: () => ({ statusCode: 400, body: { error: { codigo: wm } } }) });
    expect(s.docs[0]).toMatchObject({ estado: 'rechazado', codigo: wm });
  });

  it('un envio que no devuelve ni error ni respuesta: ese item queda incierto con aviso y los otros dos se confirman bien', () => {
    const docs = [doc(23), doc(24), doc(25)];
    const s = servidor('graph', docs);
    const r = ejecutarFlujo({ servidor: s, enviar: (_n, _l, i) => (i === 1 ? {} : ok(`wamid.${i}`)) });
    expect(docs.map((d) => d.estado)).toEqual(['aceptado', 'incierto', 'aceptado']);
    expect(r.confirmadas).toHaveLength(3);
    // La marca no viaja al servidor: el cuerpo de Confirmar lista solo los campos del contrato.
    expect(Object.keys(r.confirmadas[1]!).sort()).toEqual(['conversacionId', 'mensajeId', 'resultado']);
    const directo = correr(codigoDe(flujo, 'Resultado del envío'), [{}], { 'Planificar lote': { mensajeId: docs[1]!.mensajeId, conversacionId: docs[1]!.conversacionId, canal: 'graph', sinEnvio: '' } }) as unknown as { json: J };
    expect(directo.json).toMatchObject({ resultado: 'incierto', aviso: 'sin-respuesta' });
    expect(JSON.stringify([directo.json['aviso'], directo.json['origen']])).not.toMatch(/Hola|5917/);
  });

  it('un lote mixto (validos y con defecto propio): cada mensaje se confirma una vez y hay un solo reclamo siguiente (la tanda unica la garantiza la topologia: ver «Juntar salidas»)', () => {
    const docs = [doc(20), { ...doc(21), texto: '' }, doc(22)];
    const s = servidor('rele', docs);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.M') });
    expect(r.llamadas).toHaveLength(2);
    expect(s.reclamos).toEqual([3, 0]);
    expect(docs.map((d) => d.estado)).toEqual(['aceptado', 'rechazado', 'aceptado']);
  });

  it('rechazo reintentable: 130429 por Graph y WM-3037 por el relé llevan reintentable true', () => {
    const g = servidor('graph', [doc(8)]);
    ejecutarFlujo({ servidor: g, enviar: () => ({ statusCode: 429, body: { error: { code: 130429, message: 'Rate limit' } } }) });
    expect(g.docs[0]).toMatchObject({ estado: 'rechazado', codigo: '130429', reintentable: true });
    const r = servidor('rele', [doc(9)]);
    ejecutarFlujo({ servidor: r, enviar: () => ({ statusCode: 429, body: { error: { codigo: 'WM-3037', reintentable: true } } }) });
    expect(r.docs[0]).toMatchObject({ estado: 'rechazado', codigo: 'WM-3037', reintentable: true });
  });

  it.each(['131026', '131049', '131051', '131052', '131053', '130429'])('el codigo de Meta %s se confirma tal cual como rechazado', (cod) => {
    const s = servidor('graph', [doc(10)]);
    ejecutarFlujo({ servidor: s, enviar: () => ({ statusCode: 400, body: { error: { code: Number(cod) } } }) });
    expect(s.docs[0]).toMatchObject({ estado: 'rechazado', codigo: cod });
  });

  it('un canal desconocido o un texto vacio se confirma rechazado SIN enviar nada', () => {
    const s = servidor('satelite', [doc(11)]);
    const r = ejecutarFlujo({ servidor: s, enviar: sinEnviar });
    expect(r.llamadas).toHaveLength(0);
    expect(s.docs[0]).toMatchObject({ estado: 'rechazado', codigo: 'NV-CANAL' });
    const t = servidor('rele', [doc(12, '   ')]);
    ejecutarFlujo({ servidor: t, enviar: sinEnviar });
    expect(t.docs[0]).toMatchObject({ estado: 'rechazado', codigo: 'NV-TEXTO' });
  });

  it('relé sin configurar (marcador): no se envia a una URL falsa; rechazado reintentable', () => {
    const s = servidor('rele', [doc(13)]);
    const r = ejecutarFlujo({ servidor: s, enviar: sinEnviar, config: { ...CONFIG, releBaseUrl: 'REEMPLAZAR_URL_INTERNA_DEL_RELE' } });
    expect(r.llamadas).toHaveLength(0);
    expect(s.docs[0]).toMatchObject({ estado: 'rechazado', codigo: 'NV-RELE-CONFIG', reintentable: true });
  });

  it('el relé solo se acepta por http interno (nada de https publico ni rutas)', () => {
    for (const malo of ['https://rele.ejemplo.com', 'http://rele:8082/v1', 'ftp://x']) {
      const s = servidor('rele', [doc(14)]);
      ejecutarFlujo({ servidor: s, enviar: sinEnviar, config: { ...CONFIG, releBaseUrl: malo } });
      expect(s.docs[0]!.codigo).toBe('NV-RELE-CONFIG');
    }
  });

  it('confirmacion que falla siempre (503): se reintenta 3 veces y la ejecucion FALLA visible', () => {
    const s = servidor('rele', [doc(15, 'texto privado del cliente')]);
    const intentos: number[] = [];
    expect(() => ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.X'), confirmarFalla: (_c, i) => { intentos.push(i); return { statusCode: 503, body: {} }; } }))
      .toThrow(/Confirmar: reintentos agotados/);
    expect(intentos).toEqual([1, 2, 3]);
    expect(s.docs[0]!.estado).toBe('enviando'); // el siguiente reclamo lo pasa a incierto; nunca se reenvia
  });

  it('503 y luego 200: la confirmacion se aplica UNA sola vez', () => {
    const s = servidor('rele', [doc(17)]);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.R'), confirmarFalla: (_c, i) => (i === 1 ? { statusCode: 503, body: {} } : null) });
    expect(s.confirmaciones).toHaveLength(1);
    expect(s.docs[0]!.estado).toBe('aceptado');
    expect(r.intentosDeConfirmar.slice(0, 2)).toEqual([1, 2]);
  });

  it('un 200 sin ok:true tampoco se toma por confirmado', () => {
    const s = servidor('rele', [doc(16)]);
    expect(() => ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.Y'), confirmarFalla: () => ({ statusCode: 200, body: {} }) })).toThrow(/no se pudo confirmar 1 mensaje/);
  });

  it('bucle con 11 mensajes: reclamos de 10, 1 y 0; los 11 enviados una vez, en orden, cada uno confirmado una vez', () => {
    const docs = Array.from({ length: 11 }, (_, i) => doc(i + 1));
    const s = servidor('rele', docs);
    let n = 0;
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok(`wamid.${++n}`) });
    expect(s.reclamos).toEqual([10, 1, 0]);
    expect(r.llamadas).toHaveLength(11);
    expect(new Set(r.llamadas.map((l) => l.idempotencia)).size).toBe(11);
    expect(r.llamadas.map((l) => (l.cuerpo['text'] as J)['body'])).toEqual(docs.map((d) => d.texto));
    expect(r.confirmadas).toHaveLength(11);
    expect(docs.every((d) => d.estado === 'aceptado')).toBe(true);
    expect(r.vueltas).toBe(3);
  });

  it('el tope de vueltas corta el bucle y deja lo demas al barrido', () => {
    const docs = Array.from({ length: 25 }, (_, i) => doc(i + 1));
    const s = servidor('rele', docs);
    ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.T'), config: { ...CONFIG, maxVueltas: 2 } });
    expect(s.reclamos).toEqual([10, 10]);
    expect(docs.filter((d) => d.estado === 'pendiente')).toHaveLength(5);
    expect(docs.filter((d) => d.estado === 'enviando')).toHaveLength(0);
  });

  it('un timbre y un barrido pegados no duplican: el segundo reclamo no encuentra nada', () => {
    const s = servidor('rele', [doc(1), doc(2)]);
    ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.A') });
    const otra = ejecutarFlujo({ servidor: s, enviar: sinEnviar });
    expect(otra.llamadas).toHaveLength(0);
  });
});

describe('Salida de persona: Validar toque', () => {
  it('sin phoneNumberId (marcador de la plantilla) falla visible', () => {
    expect(() => correr(codigoDe(flujo, 'Validar toque'), [{}], { 'Config base': { ...CONFIG, phoneNumberId: 'REEMPLAZAR_PHONE_NUMBER_ID' } })).toThrow(/phoneNumberId/);
  });
  it('un timbre de otro numero se descarta; el de este numero y el barrido pasan', () => {
    const refs = (h: J) => ({ 'Config base': CONFIG, Timbre: { headers: h } });
    expect(correr(codigoDe(flujo, 'Validar toque'), [{}], refs({ 'x-novuchat-numero': '1000000002' }))).toHaveLength(0);
    expect(correr(codigoDe(flujo, 'Validar toque'), [{}], refs({ 'x-novuchat-numero': NUMERO }))[0]!.json).toEqual({ origen: 'timbre', phoneNumberId: NUMERO });
    expect(correr(codigoDe(flujo, 'Validar toque'), [{}], { 'Config base': CONFIG })[0]!.json['origen']).toBe('barrido');
  });
});

describe('Salida de persona: la estructura del flujo', () => {
  it('los dos disparadores llegan a Config base; el timbre es POST con Header Auth, responde de inmediato y lleva ruta de marcador', () => {
    expect(destinos(flujo, 'Timbre')).toEqual(['Config base']);
    expect(destinos(flujo, 'Barrido cada minuto')).toEqual(['Config base']);
    const t = nodo(flujo, 'Timbre').parameters;
    expect(t).toMatchObject({ httpMethod: 'POST', authentication: 'headerAuth', responseMode: 'onReceived' });
    expect(String(t['path'])).toMatch(/^REEMPLAZAR_/);
    const b = nodo(flujo, 'Barrido cada minuto').parameters as { rule: { interval: { field: string; minutesInterval: number }[] } };
    expect(b.rule.interval[0]).toEqual({ field: 'minutes', minutesInterval: 1 });
  });

  it('el bucle: Verificar y seguir vuelve a Reclamar; Reclamar solo lo alimentan Validar toque y ese cierre', () => {
    expect(destinos(flujo, 'Verificar y seguir')).toEqual(['Reclamar']);
    expect(entradas(flujo, 'Reclamar').sort()).toEqual(['Validar toque', 'Verificar y seguir']);
    expect(destinos(flujo, 'Por canal', 0)).toEqual(['Enviar por el relé']);
    expect(destinos(flujo, 'Por canal', 1)).toEqual(['Enviar por Graph']);
    expect(destinos(flujo, 'Por canal', 2)).toEqual(['Juntar salidas']);
  });

  it('sin «Continue on Fail» silencioso en Reclamar, Confirmar ni Verificar; los envios no reintentan', () => {
    for (const n of ['Reclamar', 'Confirmar', 'Verificar y seguir', 'Planificar lote', 'Validar toque']) {
      expect(nodo(flujo, n).onError, n).toBeUndefined();
    }
    for (const n of ['Enviar por el relé', 'Enviar por Graph']) {
      expect(nodo(flujo, n).retryOnFail, n).toBeUndefined();
    }
  });

  it('el envio es en serie y el relé lleva Idempotency-Key; las credenciales son nombres, no valores', () => {
    for (const n of ['Enviar por el relé', 'Enviar por Graph']) {
      expect(JSON.stringify(nodo(flujo, n).parameters)).toContain('"batchSize":1');
    }
    expect(JSON.stringify(nodo(flujo, 'Enviar por el relé').parameters)).toContain('Idempotency-Key');
    for (const n of flujo.nodes) for (const c of Object.values(n.credentials ?? {})) expect(c.id, n.name).toBe('');
  });

  it('las tres salidas de «Por canal» pasan por «Juntar salidas» (UN camino por vuelta) antes de Resultado', () => {
    for (let i = 0; i < 3; i++) {
      const hasta = i === 2 ? destinos(flujo, 'Por canal', 2) : destinos(flujo, i === 0 ? 'Enviar por el relé' : 'Enviar por Graph');
      expect(hasta).toEqual(['Juntar salidas']);
    }
    expect(entradas(flujo, 'Resultado del envío')).toEqual(['Juntar salidas']);
    expect(entradas(flujo, 'Confirmar')).toEqual(['Resultado del envío']);
    const m = nodo(flujo, 'Juntar salidas');
    expect(m.type).toBe('n8n-nodes-base.merge');
    expect(m.parameters).toEqual({ numberInputs: 3 });
  });

  it('las ejecuciones exitosas y manuales no se guardan; la credencial del timbre es POR ALIAS; los envios esperan 10 s', () => {
    expect(flujo.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveManualExecutions: false, executionOrder: 'v1' });
    expect(nodo(flujo, 'Timbre').credentials?.['httpHeaderAuth']?.name).toMatch(/REEMPLAZAR_ALIAS/);
    for (const n of ['Enviar por el relé', 'Enviar por Graph']) {
      expect((nodo(flujo, n).parameters['options'] as J)['timeout'], n).toBe(10000);
    }
    // El peor caso sale de LOS NODOS, no de constantes: tope por reclamo x (timeout + intervalo) < 2 min del `enviando`.
    for (const n of ['Enviar por el relé', 'Enviar por Graph']) {
      const o = nodo(flujo, n).parameters['options'] as { timeout: number; batching: { batch: { batchSize: number; batchInterval: number } } };
      expect(o.batching.batch.batchSize, n).toBe(1);
      expect(MAXIMO_POR_RECLAMO * (o.timeout + o.batching.batch.batchInterval), n).toBeLessThan(2 * 60_000);
    }
  });

  it('Reclamar no reintenta solo; Confirmar reintenta 3 veces y falla visible', () => {
    expect(nodo(flujo, 'Reclamar').retryOnFail).toBeUndefined();
    expect(nodo(flujo, 'Confirmar')).toMatchObject({ retryOnFail: true, maxTries: 3 });
    expect(JSON.stringify(nodo(flujo, 'Confirmar').parameters)).not.toContain('neverError":true');
  });

  it('el relé se llama solo por http interno y la URL sale de Config base', () => {
    const url = String(nodo(flujo, 'Enviar por el relé').parameters['url']);
    expect(url).toContain('releBaseUrl');
    const cfg = nodo(flujo, 'Config base').parameters as { assignments: { assignments: { name: string; value: unknown }[] } };
    const v = Object.fromEntries(cfg.assignments.assignments.map((a) => [a.name, a.value]));
    expect(String(v['releBaseUrl'])).toMatch(/^REEMPLAZAR_/);
    expect(String(v['phoneNumberId'])).toMatch(/^REEMPLAZAR_/);
  });

  it('ningun nodo Code usa un global que n8n no tiene', () => {
    for (const n of flujo.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
      const js = String(n.parameters['jsCode']);
      for (const g of GLOBALES_FUERA_DEL_SANDBOX) {
        expect(new RegExp(`(?<![\\w$.])${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[.(]`).test(js), `${n.name} usa ${g}`).toBe(false);
      }
    }
  });

  it('ningun secreto ni ruta real en el JSON ni en los modulos', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const textos = [
      readFileSync(join(aqui, '../../../Flujos', ARCHIVO), 'utf8'),
      ...['validar-toque', 'planificar-lote', 'resultado-del-envio', 'verificar-y-seguir']
        .map((m) => readFileSync(join(aqui, '../../../Flujos/src/core/salida-persona', `${m}.js`), 'utf8')),
    ].join('\n');
    expect(textos).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]|\/home\/|webhook\/[0-9a-f]{8}-/);
    expect(textos).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('no hay texto ni nombre de cliente en el modulo comun', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    for (const m of ['validar-toque', 'planificar-lote', 'resultado-del-envio', 'verificar-y-seguir']) {
      const js = readFileSync(join(aqui, '../../../Flujos/src/core/salida-persona', `${m}.js`), 'utf8');
      expect(js, m).not.toMatch(/Bellido|Platinum|Q'?Taco|Dhermacore/i);
    }
  });
});
