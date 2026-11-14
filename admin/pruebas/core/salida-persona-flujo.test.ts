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
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  GLOBALES_FUERA_DEL_SANDBOX, codigoDe, correr, destinos, entradas, expresion, leerFlujo, nodo, plantilla, type J,
} from '../lib/flujo.ts';

const ARCHIVO = 'salida-de-persona.json';
const MODULOS = ['validar-toque', 'planificar-lote', 'resultado-del-envio', 'verificar-y-seguir', 'preparar-subida', 'preparar-envio-del-adjunto'];
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
interface Doc { mensajeId: string; conversacionId: string; texto: string; estado: Estado; idMeta?: string; codigo?: string; reintentable?: boolean; tipo?: string; adjunto?: J }

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
          to: d.conversacionId.slice(3), texto: d.texto, tipo: d.tipo ?? 'text', canal,
          ...(d.adjunto !== undefined ? { adjunto: d.adjunto } : {}),
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
type NodoDeEnvio = 'Enviar por el relé' | 'Enviar por Graph' | 'Enviar adjunto por Graph';
type Enviar = (nodoDeEnvio: NodoDeEnvio, l: Llamada, i: number) => J;
/** Respuesta de `Leer adjunto` (response `file` + fullResponse): estado y cabeceras en el json, bytes en `binary.adjunto`. */
interface Lectura { json: J; binary?: J }

/** Corre un Code "cada item" con binario (el evaluador compartido no lo modela; los globales vacios son los mismos). */
function correrConBinario(codigo: string, entrada: Lectura, referencias: Record<string, J>): { json: J; binary?: J } {
  const $ = (n: string) => ({ item: { json: referencias[n] ?? {} }, first: () => ({ json: referencias[n] ?? {} }) });
  const vacios = GLOBALES_FUERA_DEL_SANDBOX;
  const fn = vm.compileFunction(codigo, ['$input', '$', ...vacios]) as (...a: unknown[]) => { json: J; binary?: J };
  return fn({ item: entrada }, $, ...vacios.map(() => undefined));
}
/** Los traza cada paso del adjunto para que las pruebas midan lo que SALE de cada nodo. */
interface Traza { lecturas: Llamada[]; subidas: (Llamada & { binario?: J })[]; preparados: J[] }

/** Una ejecucion completa: lo que hace n8n desde el toque hasta que el reclamo llega vacio (o falla). */
function ejecutarFlujo(opciones: {
  servidor: ReturnType<typeof servidor>; enviar: Enviar; config?: J; timbre?: J;
  confirmarFalla?: (c: J, intento: number) => { statusCode: number; body: J } | null;
  leer?: (l: Llamada) => Lectura; subir?: (l: Llamada & { binario?: J }) => J;
}) {
  const traza: Traza = { lecturas: [], subidas: [], preparados: [] };
  const cfg = opciones.config ?? CONFIG;
  const refs: Record<string, J | J[]> = { 'Config base': cfg };
  if (opciones.timbre) refs['Timbre'] = opciones.timbre;
  const llamadas: Llamada[] = [];
  const confirmadas: J[] = [];
  let vueltas = 0;
  const intentosDeConfirmar: number[] = [];

  const valido = correr(codigoDe(flujo, 'Validar toque'), [{}], refs);
  if (valido.length === 0) return { llamadas, confirmadas, vueltas, descartado: true, intentosDeConfirmar, traza };

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
    const porRama = [0, 1, 2, 3].map((rama) => planeados.filter((p) => (reglas.indexOf(String(p['ruta'])) === -1 ? 3 : reglas.indexOf(String(p['ruta']))) === rama));
    porRama.forEach((items, rama) => {
      items.forEach((p, i) => {
        let r: J;
        if (rama === 3) r = p; // «sin envío»: entra tal cual a Resultado
        else if (rama === 2) {
          // Cadena del adjunto: Leer -> Preparar subida -> ¿Se sube? -> Subir -> Preparar envío -> ¿Se envía? -> Enviar adjunto.
          const L = nodo(flujo, 'Leer adjunto').parameters as J;
          const lec: Llamada = { nodo: 'Leer adjunto', url: String(L['url']), cuerpo: JSON.parse(String(expresion(L['jsonBody'], p, refs))) as J };
          traza.lecturas.push(lec);
          const lectura = opciones.leer ? opciones.leer(lec) : { json: { statusCode: 0 } };
          const ref1 = { ...refs, 'Planificar lote': p };
          const prep = correrConBinario(codigoDe(flujo, 'Preparar subida'), lectura, { ...(ref1 as Record<string, J>) });
          traza.preparados.push(prep.json);
          const sube = nodo(flujo, '¿Se sube?').parameters as { rules: { values: { conditions: { conditions: { rightValue: string }[] } }[] } };
          if (String(prep.json['ruta']) !== sube.rules.values[0]!.conditions.conditions[0]!.rightValue) {
            r = prep.json;
          } else {
            const S = nodo(flujo, 'Subir a Meta').parameters as { bodyParameters: { parameters: { name: string; value?: string; inputDataFieldName?: string }[] } };
            const campos: J = {};
            for (const c of S.bodyParameters.parameters) campos[c.name] = c.value !== undefined ? (c.value.startsWith('=') ? expresion(c.value, prep.json, refs) : c.value) : { desdeBinario: c.inputDataFieldName };
            const sub = { nodo: 'Subir a Meta', url: plantilla((S as J)['url'], prep.json, refs), cuerpo: campos, binario: prep.binary?.['adjunto'] as J | undefined };
            traza.subidas.push(sub);
            const resp = opciones.subir ? opciones.subir(sub) : { statusCode: 0 };
            const prep2 = correrConBinario(codigoDe(flujo, 'Preparar envío del adjunto'), { json: resp }, { 'Planificar lote': p });
            traza.preparados.push(prep2.json);
            const envia = nodo(flujo, '¿Se envía el adjunto?').parameters as { rules: { values: { conditions: { conditions: { rightValue: string }[] } }[] } };
            if (String(prep2.json['ruta']) !== envia.rules.values[0]!.conditions.conditions[0]!.rightValue) r = prep2.json;
            else {
              const E = nodo(flujo, 'Enviar adjunto por Graph').parameters as J;
              const llamada: Llamada = { nodo: 'Enviar adjunto por Graph', url: plantilla(E['url'], prep2.json, refs), cuerpo: JSON.parse(String(expresion(E['jsonBody'], prep2.json, refs))) as J };
              llamadas.push(llamada);
              r = opciones.enviar('Enviar adjunto por Graph', llamada, llamadas.length - 1);
            }
          }
        } else {
          const n = rama === 0 ? 'Enviar por el relé' : 'Enviar por Graph';
          const params = nodo(flujo, n).parameters as J;
          const url = plantilla(params['url'], p, refs);
          const cab = (params['headerParameters'] as { parameters: { name: string; value: string }[] } | undefined)?.parameters ?? [];
          const idem = cab.find((c) => c.name === 'Idempotency-Key');
          const cuerpo = JSON.parse(String(expresion(params['jsonBody'], p, refs))) as J;
          const llamada: Llamada = { nodo: n, url, cuerpo, ...(idem ? { idempotencia: plantilla(idem.value, p, refs) } : {}) };
          llamadas.push(llamada);
          r = opciones.enviar(n as NodoDeEnvio, llamada, llamadas.length - 1);
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
  return { llamadas, confirmadas, vueltas, descartado: false, intentosDeConfirmar, traza };
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
    expect(destinos(flujo, 'Por canal', 2)).toEqual(['Leer adjunto']);
    expect(destinos(flujo, 'Por canal', 3)).toEqual(['Juntar salidas']);
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

  it('las salidas de «Por canal» pasan por «Juntar salidas» (UN camino por vuelta) antes de Resultado', () => {
    for (let i = 0; i < 3; i++) {
      const hasta = i === 2 ? destinos(flujo, 'Por canal', 3) : destinos(flujo, i === 0 ? 'Enviar por el relé' : 'Enviar por Graph');
      expect(hasta).toEqual(['Juntar salidas']);
    }
    expect(destinos(flujo, 'Enviar adjunto por Graph')).toEqual(['Juntar salidas']);
    expect(entradas(flujo, 'Resultado del envío')).toEqual(['Juntar salidas']);
    expect(entradas(flujo, 'Confirmar')).toEqual(['Resultado del envío']);
    const m = nodo(flujo, 'Juntar salidas');
    expect(m.type).toBe('n8n-nodes-base.merge');
    expect(m.parameters).toEqual({ numberInputs: 6 });
  });

  it('ninguna ejecucion se guarda (exitosa, fallida, manual ni su progreso); la credencial del timbre es POR ALIAS; los envios esperan 10 s', () => {
    // D-B3-1 (Andres, 13/11/2026): una ejecucion FALLIDA guardaria en n8n el binario y la leyenda del adjunto.
    // Igual que los medios entrantes (30/10/2026, contrato v2 §8.1). `toEqual` y no `toMatchObject`: una clave
    // ausente vale el ajuste de la instancia, que guarda las fallidas.
    expect(flujo.settings).toEqual({
      executionOrder: 'v1', timezone: 'America/La_Paz', executionTimeout: 300,
      saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveExecutionProgress: false, saveManualExecutions: false,
    });
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
      ...MODULOS
        .map((m) => readFileSync(join(aqui, '../../../Flujos/src/core/salida-persona', `${m}.js`), 'utf8')),
    ].join('\n');
    expect(textos).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]|\/home\/|webhook\/[0-9a-f]{8}-/);
    expect(textos).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('no hay texto ni nombre de cliente en el modulo comun', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    for (const m of MODULOS) {
      const js = readFileSync(join(aqui, '../../../Flujos/src/core/salida-persona', `${m}.js`), 'utf8');
      expect(js, m).not.toMatch(/Bellido|Platinum|Q'?Taco|Dhermacore/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Adjuntos (B3): leer, subir a Meta y enviar por id. Nunca `link`.
// ---------------------------------------------------------------------------
describe('Salida de persona: adjuntos (B3)', () => {
  const SHA = 'ab'.repeat(32);
  const TAMANO = 1234;
  const MIME_DOC = 'application/pdf';
  const adj = (n: number, tipo: string, mime: string, extra: J = {}, canal = 'graph', texto = ''): [Doc, string] => [
    { ...doc(n, texto), tipo, adjunto: { mime, tamano: TAMANO, sha256: SHA, voz: false, ...extra } }, canal,
  ];
  const lecturaBuena = (mime: string, cambios: { json?: J; headers?: J; sinBinario?: boolean } = {}): Lectura => ({
    json: { statusCode: 200, headers: { 'x-novuchat-mime': mime, 'x-novuchat-sha256': SHA, 'content-length': String(TAMANO), ...cambios.headers }, ...cambios.json },
    ...(cambios.sinBinario ? {} : { binary: { adjunto: { mimeType: 'application/octet-stream', fileName: 'bytes', data: 'filesystem-v2', id: 'ref-1' } } }),
  });
  const subidaBuena = (id = 'MEDIA.1_a-b') => ({ statusCode: 200, body: { id } });
  /** Todas las claves de un valor, a cualquier profundidad. */
  const claves = (v: unknown): string[] => (v && typeof v === 'object' ? Object.entries(v as J).flatMap(([k, x]) => [k, ...claves(x)]) : []);

  function correrAdj(par: [Doc, string], opciones: { leer?: (l: Llamada) => Lectura; subir?: (l: Llamada) => J; enviar?: Enviar; otros?: Doc[] } = {}) {
    const [d, canal] = par;
    const s = servidor(canal, [d, ...(opciones.otros ?? [])]);
    const mime = String((d.adjunto as J)['mime']);
    const r = ejecutarFlujo({
      servidor: s,
      enviar: opciones.enviar ?? (() => ok('wamid.ADJ1')),
      leer: opciones.leer ?? (() => lecturaBuena(mime)),
      subir: opciones.subir ?? (() => subidaBuena()),
    });
    return { s, r, d };
  }

  it('1. imagen con leyenda de punta a punta: lectura, subida a /media y envio por id', () => {
    const { s, r, d } = correrAdj(adj(1, 'image', 'image/jpeg', { leyenda: 'Mira esto' }));
    const lec = r.traza.lecturas[0]!;
    expect(lec.url).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/leerAdjuntoPersona');
    expect(lec.cuerpo).toEqual({ mensajeId: d.mensajeId, conversacionId: d.conversacionId });
    expect(Object.keys(lec.cuerpo)).toHaveLength(2);
    const sub = r.traza.subidas[0]!;
    expect(sub.url).toBe(`https://graph.facebook.com/v26.0/${NUMERO}/media`);
    expect(sub.cuerpo).toEqual({ messaging_product: 'whatsapp', type: 'image/jpeg', file: { desdeBinario: 'adjunto' } });
    expect(sub.binario).toMatchObject({ mimeType: 'image/jpeg', fileName: 'adjunto.jpg', fileExtension: 'jpg' });
    expect(r.llamadas).toHaveLength(1);
    expect(r.llamadas[0]!.nodo).toBe('Enviar adjunto por Graph');
    expect(r.llamadas[0]!.url).toBe(`https://graph.facebook.com/v26.0/${NUMERO}/messages`);
    expect(r.llamadas[0]!.cuerpo).toEqual({ messaging_product: 'whatsapp', to: '59170000001', type: 'image', image: { id: 'MEDIA.1_a-b', caption: 'Mira esto' } });
    expect(s.docs[0]).toMatchObject({ estado: 'aceptado', idMeta: 'wamid.ADJ1' });
    expect(r.confirmadas).toEqual([{ mensajeId: d.mensajeId, conversacionId: d.conversacionId, resultado: 'aceptado', idMeta: 'wamid.ADJ1' }]);
  });

  it('2. documento: {id, caption, filename}; sin nombre no va `filename`', () => {
    const a = correrAdj(adj(2, 'document', MIME_DOC, { leyenda: 'Lista', nombre: 'precios.pdf' }));
    expect(a.r.llamadas[0]!.cuerpo['document']).toEqual({ id: 'MEDIA.1_a-b', caption: 'Lista', filename: 'precios.pdf' });
    expect(a.r.traza.subidas[0]!.binario).toMatchObject({ mimeType: MIME_DOC, fileName: 'adjunto.pdf' });
    const b = correrAdj(adj(3, 'document', MIME_DOC));
    expect(b.r.llamadas[0]!.cuerpo['document']).toEqual({ id: 'MEDIA.1_a-b' });
    expect(Object.keys(b.r.llamadas[0]!.cuerpo['document'])).not.toContain('filename');
  });

  it('3. audio con voz: {id, voice:true}; sin voz no existe la clave `voice`', () => {
    const a = correrAdj(adj(4, 'audio', 'audio/ogg', { voz: true }));
    expect(a.r.llamadas[0]!.cuerpo).toEqual({ messaging_product: 'whatsapp', to: '59170000004', type: 'audio', audio: { id: 'MEDIA.1_a-b', voice: true } });
    const b = correrAdj(adj(5, 'audio', 'audio/mpeg', { voz: false }));
    expect(b.r.llamadas[0]!.cuerpo['audio']).toEqual({ id: 'MEDIA.1_a-b' });
    expect('voice' in b.r.llamadas[0]!.cuerpo['audio']).toBe(false);
  });

  it('4. NUNCA `link`: ni en un cuerpo enviado ni en el JSON ni en los modulos', () => {
    const casos: [string, string, J][] = [['image', 'image/png', { leyenda: 'a' }], ['document', MIME_DOC, { nombre: 'a.pdf' }], ['audio', 'audio/ogg', { voz: true }]];
    casos.forEach(([tipo, mime, extra], i) => {
      const { r } = correrAdj(adj(10 + i, tipo, mime, extra));
      for (const c of [...r.llamadas, ...r.traza.subidas, ...r.traza.lecturas]) expect(claves(c.cuerpo), tipo).not.toContain('link');
    });
    const aqui = dirname(fileURLToPath(import.meta.url));
    const carpeta = join(aqui, '../../../Flujos/src/core/salida-persona');
    const textos = [readFileSync(join(aqui, '../../../Flujos', ARCHIVO), 'utf8'), ...readdirSync(carpeta).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(carpeta, f), 'utf8'))];
    for (const t of textos) expect(t).not.toMatch(/["']?link["']?\s*:/);
  });

  it('5b. sin `Content-Length` en la respuesta (supuesto S6) el adjunto sale igual: mime y sha256 siguen exigidos', () => {
    const sinLargo = lecturaBuena('image/jpeg');
    delete (sinLargo.json['headers'] as J)['content-length'];
    const { s, r } = correrAdj(adj(60, 'image', 'image/jpeg'), { leer: () => sinLargo });
    expect(r.traza.subidas).toHaveLength(1);
    expect(s.docs[0]).toMatchObject({ estado: 'aceptado' });
  });

  it('5. una lectura fallida NO envia ni sube: rechazado con su codigo y reintentable', () => {
    const MIME = 'image/jpeg';
    const casos: [string, Lectura, string][] = [
      ['404', { json: { statusCode: 404, headers: {} } }, 'NV-ADJUNTO-NO-EXISTE'],
      ['409', { json: { statusCode: 409, headers: {} } }, 'NV-ADJUNTO-ESTADO'],
      ['503', { json: { statusCode: 503, headers: {} } }, 'NV-ADJUNTO-LECTURA-503'],
      ['401', { json: { statusCode: 401, headers: {} } }, 'NV-ADJUNTO-LECTURA-401'],
      ['400', { json: { statusCode: 400, headers: {} } }, 'NV-ADJUNTO-LECTURA-400'],
      ['red', { json: { error: { message: 'timeout' } } }, 'NV-ADJUNTO-LECTURA'],
      ['sin binario', lecturaBuena(MIME, { sinBinario: true }), 'NV-ADJUNTO-INTEGRIDAD'],
      ['mime distinto', lecturaBuena(MIME, { headers: { 'x-novuchat-mime': 'image/png' } }), 'NV-ADJUNTO-INTEGRIDAD'],
      ['sha distinto', lecturaBuena(MIME, { headers: { 'x-novuchat-sha256': 'cd'.repeat(32) } }), 'NV-ADJUNTO-INTEGRIDAD'],
      ['largo distinto', lecturaBuena(MIME, { headers: { 'content-length': '999' } }), 'NV-ADJUNTO-INTEGRIDAD'],
      ['largo ilegible', lecturaBuena(MIME, { headers: { 'content-length': 'abc' } }), 'NV-ADJUNTO-INTEGRIDAD'],
    ];
    for (const [nombre, lectura, codigo] of casos) {
      const { s, r } = correrAdj(adj(20, 'image', MIME, { leyenda: 'privada' }), { leer: () => lectura, subir: () => { throw new Error('no debia subir'); }, enviar: sinEnviar });
      expect(r.llamadas, nombre).toHaveLength(0);
      expect(r.traza.subidas, nombre).toHaveLength(0);
      expect(s.docs[0], nombre).toMatchObject({ estado: 'rechazado', codigo, reintentable: true });
    }
  });

  it('6. una subida fallida NO envia el mensaje', () => {
    const casos: [string, J, string][] = [
      ['400 con code', { statusCode: 400, body: { error: { code: 131053 } } }, 'NV-ADJUNTO-SUBIDA-131053'],
      ['500', { statusCode: 500, body: {} }, 'NV-ADJUNTO-SUBIDA'],
      ['red', { error: { message: 'ECONNRESET' } }, 'NV-ADJUNTO-SUBIDA'],
      ['200 sin id', { statusCode: 200, body: {} }, 'NV-ADJUNTO-SUBIDA'],
      ['id raro', { statusCode: 200, body: { id: 'a b!/..' } }, 'NV-ADJUNTO-SUBIDA'],
      ['code raro', { statusCode: 400, body: { error: { code: 'x y' } } }, 'NV-ADJUNTO-SUBIDA'],
    ];
    for (const [nombre, resp, codigo] of casos) {
      const { s, r } = correrAdj(adj(21, 'image', 'image/jpeg'), { subir: () => resp, enviar: sinEnviar });
      expect(r.llamadas, nombre).toHaveLength(0);
      expect(s.docs[0], nombre).toMatchObject({ estado: 'rechazado', codigo, reintentable: true });
    }
  });

  it('7. envio final: red o 5xx incierto; 4xx con code rechazado; 2xx sin id incierto; UNA sola llamada', () => {
    const casos: [string, J, Partial<Doc>][] = [
      ['red', { error: { message: 'timeout' } }, { estado: 'incierto' }],
      ['5xx', { statusCode: 503, body: { error: { code: 2 } } }, { estado: 'incierto' }],
      ['2xx sin id', { statusCode: 200, body: {} }, { estado: 'incierto' }],
      ['4xx', { statusCode: 400, body: { error: { code: 131047 } } }, { estado: 'rechazado', codigo: '131047' }],
    ];
    for (const [nombre, resp, esperado] of casos) {
      const { s, r } = correrAdj(adj(22, 'document', MIME_DOC), { enviar: () => resp });
      expect(r.llamadas, nombre).toHaveLength(1);
      expect(s.docs[0], nombre).toMatchObject(esperado);
    }
  });

  it('8. el texto no cambia: mismo item de siempre, sin `tipo`; un lote de textos nunca lee ni sube', () => {
    const m = { mensajeId: 'clave-de-envio-0001', conversacionId: 'wa_59170000001', claveRele: 'c'.repeat(16) + 'xx', to: '59170000001', texto: 'Hola', tipo: 'text', canal: 'graph' };
    const salida = correr(codigoDe(flujo, 'Planificar lote'), [{ mensajes: [m] }], { 'Config base': CONFIG });
    const literal = '{"json":{"mensajeId":"clave-de-envio-0001","conversacionId":"wa_59170000001","canal":"graph","claveRele":"ccccccccccccccccxx","sinEnvio":"","reintentable":false,"ruta":"graph","cuerpoEnvio":{"messaging_product":"whatsapp","to":"59170000001","type":"text","text":{"body":"Hola"}}}}';
    expect(JSON.stringify(salida[0])).toBe(literal);
    const sinTipo = correr(codigoDe(flujo, 'Planificar lote'), [{ mensajes: [{ ...m, tipo: undefined }] }], { 'Config base': CONFIG });
    expect(JSON.stringify(sinTipo[0])).toBe(literal);
    const s = servidor('graph', [doc(30), doc(31)]);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.T'), leer: () => { throw new Error('no debia leer'); }, subir: () => { throw new Error('no debia subir'); } });
    expect(r.traza.lecturas).toHaveLength(0);
    expect(r.llamadas.map((l) => l.nodo)).toEqual(['Enviar por Graph', 'Enviar por Graph']);
  });

  it('9. lote mixto (2 textos y 1 adjunto): cada mensaje se confirma una vez y hay un solo reclamo siguiente', () => {
    const [a] = adj(41, 'image', 'image/png', { leyenda: 'x' });
    const docs = [doc(40), a, doc(42)];
    const s = servidor('graph', docs);
    const r = ejecutarFlujo({ servidor: s, enviar: (_n, _l, i) => ok(`wamid.M${i}`), leer: () => lecturaBuena('image/png'), subir: () => subidaBuena() });
    expect(docs.map((d) => d.estado)).toEqual(['aceptado', 'aceptado', 'aceptado']);
    expect(s.confirmaciones).toHaveLength(3);
    expect(new Set(s.confirmaciones.map((c) => c['mensajeId'])).size).toBe(3);
    expect(s.reclamos).toEqual([3, 0]);
    expect(r.vueltas).toBe(2);
    expect(entradas(flujo, 'Verificar y seguir')).toEqual(['Confirmar']);
  });

  it('10. dos adjuntos en el lote: sale el primero; el segundo es NV-ADJUNTO-LOTE reintentable sin leerse', () => {
    const [a] = adj(50, 'image', 'image/png');
    const [b] = adj(51, 'image', 'image/png');
    const s = servidor('graph', [a, b]);
    const r = ejecutarFlujo({ servidor: s, enviar: () => ok('wamid.L'), leer: () => lecturaBuena('image/png'), subir: () => subidaBuena() });
    expect(r.traza.lecturas).toHaveLength(1);
    expect(r.llamadas).toHaveLength(1);
    expect(a.estado).toBe('aceptado');
    expect(b).toMatchObject({ estado: 'rechazado', codigo: 'NV-ADJUNTO-LOTE', reintentable: true });
  });

  it('11. adjunto con canal rele o desconocido: NV-ADJUNTO-CANAL, sin relé ni lectura', () => {
    for (const canal of ['rele', 'satelite']) {
      const { s, r } = correrAdj(adj(60, 'image', 'image/png', {}, canal), { leer: () => { throw new Error('no debia leer'); }, enviar: sinEnviar });
      expect(r.llamadas, canal).toHaveLength(0);
      expect(r.traza.lecturas, canal).toHaveLength(0);
      expect(s.docs[0], canal).toMatchObject({ estado: 'rechazado', codigo: 'NV-ADJUNTO-CANAL', reintentable: false });
    }
  });

  it('12. forma invalida: NV-ADJUNTO-FORMA sin leer; `video` es NV-TIPO', () => {
    const grande = 5 * 1024 * 1024 + 1;
    const casos: [string, string, string, J, string?][] = [
      ['webp', 'image', 'image/webp', {}], ['svg', 'image', 'image/svg+xml', {}], ['html', 'document', 'text/html', {}],
      ['mime de otro tipo', 'image', MIME_DOC, {}],
      ['tamano 0', 'image', 'image/png', { tamano: 0 }], ['tamano negativo', 'image', 'image/png', { tamano: -5 }],
      ['tamano decimal', 'image', 'image/png', { tamano: 10.5 }], ['tamano tope+1', 'image', 'image/png', { tamano: grande }],
      ['documento tope+1', 'document', MIME_DOC, { tamano: 16 * 1024 * 1024 + 1 }],
      ['sha corto', 'image', 'image/png', { sha256: 'ab'.repeat(31) }], ['sha en mayusculas', 'image', 'image/png', { sha256: 'AB'.repeat(32) }],
      ['voz en mp3', 'audio', 'audio/mpeg', { voz: true }], ['voz no booleana', 'audio', 'audio/ogg', { voz: 'si' }],
      ['leyenda en audio', 'audio', 'audio/ogg', { leyenda: 'hola' }], ['leyenda de 1001', 'image', 'image/png', { leyenda: 'a'.repeat(1001) }],
      ['leyenda vacia', 'image', 'image/png', { leyenda: '   ' }], ['leyenda no texto', 'image', 'image/png', { leyenda: 7 }],
      ['nombre en imagen', 'image', 'image/png', { nombre: 'a.png' }], ['nombre con barra', 'document', MIME_DOC, { nombre: 'a/b.pdf' }],
      ['nombre con barra invertida', 'document', MIME_DOC, { nombre: 'a\\b.pdf' }],
      ['nombre con RLO', 'document', MIME_DOC, { nombre: 'a‮fdp.exe' }], ['nombre de 241', 'document', MIME_DOC, { nombre: 'a'.repeat(241) }], ['nombre de 241 emojis', 'document', MIME_DOC, { nombre: '\u{1F600}'.repeat(241) }],
      ['nombre con marca invisible', 'document', MIME_DOC, { nombre: 'a\u2066b.pdf' }],
      ['nombre vacio', 'document', MIME_DOC, { nombre: '' }],
      ['texto no vacio', 'image', 'image/png', {}, 'hola'],
    ];
    for (const [nombre, tipo, mime, extra, texto] of casos) {
      const { s, r } = correrAdj(adj(70, tipo, mime, extra, 'graph', texto ?? ''), { leer: () => { throw new Error('no debia leer'); }, enviar: sinEnviar });
      expect(r.traza.lecturas, nombre).toHaveLength(0);
      expect(s.docs[0], nombre).toMatchObject({ estado: 'rechazado', codigo: 'NV-ADJUNTO-FORMA', reintentable: false });
    }
    const sinAdjunto = servidor('graph', [{ ...doc(71, ''), tipo: 'image' }]);
    ejecutarFlujo({ servidor: sinAdjunto, enviar: sinEnviar });
    expect(sinAdjunto.docs[0]).toMatchObject({ estado: 'rechazado', codigo: 'NV-ADJUNTO-FORMA' });
    const v = correrAdj(adj(72, 'video', 'video/mp4'), { enviar: sinEnviar });
    expect(v.s.docs[0]).toMatchObject({ estado: 'rechazado', codigo: 'NV-TIPO', reintentable: false });
    // Lo que el servidor guarda SÍ sale (revisión de código): el largo se cuenta en caracteres reales, como `sanearNombre`
    // (236 emojis + `.pdf` = 240 caracteres y 476 unidades UTF-16), y un separador de línea U+2028 no lo quita el servidor.
    for (const [i, nombre] of ['\u{1F600}'.repeat(236) + '.pdf', 'informe\u2028final.pdf'].entries()) {
      const bien = correrAdj(adj(80 + i, 'document', MIME_DOC, { nombre }));
      expect(bien.s.docs[0], String(i)).toMatchObject({ estado: 'aceptado' });
      expect((bien.r.llamadas[0]!.cuerpo['document'] as { filename: string }).filename).toBe(nombre);
    }
    // Una clave del prototipo no es un tipo (revisión de `seguridad`): `MIMES['constructor']` existe, pero no es propia.
    for (const [i, raro] of ['constructor', '__proto__', 'toString', 'hasOwnProperty'].entries()) {
      const x = correrAdj(adj(73 + i, raro, 'name'), { leer: () => { throw new Error('no debia leer'); }, enviar: sinEnviar });
      expect(x.r.traza.lecturas, raro).toHaveLength(0);
      expect(x.s.docs[0], raro).toMatchObject({ estado: 'rechazado', codigo: 'NV-TIPO', reintentable: false });
    }
  });

  it('13. estructura y orden del lienzo: 6 entradas, cabecera, x creciente y ramas por y', () => {
    const pos = (n: string) => nodo(flujo, n).position as unknown as [number, number];
    expect(nodo(flujo, 'Juntar salidas').parameters).toEqual({ numberInputs: 6 });
    const padres = ['Enviar por el relé', 'Enviar por Graph', '¿Se sube?', '¿Se envía el adjunto?', 'Enviar adjunto por Graph'];
    for (const n of padres) expect(pos('Juntar salidas')[0], n).toBeGreaterThan(pos(n)[0]);
    expect(pos('Resultado del envío')[0]).toBeGreaterThan(pos('Juntar salidas')[0]);
    expect(pos('Confirmar')[0]).toBeGreaterThan(pos('Resultado del envío')[0]);
    expect(pos('Verificar y seguir')[0]).toBeGreaterThan(pos('Confirmar')[0]);
    const hijos = [0, 1, 2].map((i) => destinos(flujo, 'Por canal', i)[0]!);
    expect(hijos).toEqual(['Enviar por el relé', 'Enviar por Graph', 'Leer adjunto']);
    const ys = hijos.map((n) => pos(n)[1]);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    const cadena = ['Leer adjunto', 'Preparar subida', '¿Se sube?', 'Subir a Meta', 'Preparar envío del adjunto', '¿Se envía el adjunto?', 'Enviar adjunto por Graph'];
    cadena.forEach((n, i) => { if (i > 0) { expect(pos(n)[0], n).toBeGreaterThan(pos(cadena[i - 1]!)[0]); expect(destinos(flujo, cadena[i - 1]!)[0], n).toBe(n); } });
    expect(destinos(flujo, '¿Se sube?', 1)).toEqual(['Juntar salidas']);
    expect(destinos(flujo, '¿Se envía el adjunto?', 1)).toEqual(['Juntar salidas']);
    const idx = (desde: string, salida = 0) => ((flujo.connections[desde]!['main'] as J[][])[salida] ?? []).map((c) => Number(c['index']));
    expect([idx('Por canal', 3), idx('Enviar adjunto por Graph'), idx('¿Se sube?', 1), idx('¿Se envía el adjunto?', 1), idx('Enviar por el relé'), idx('Enviar por Graph')]).toEqual([[2], [3], [4], [5], [0], [1]]);
    const cab = (nodo(flujo, 'Reclamar').parameters['headerParameters'] as { parameters: { name: string; value: string }[] }).parameters;
    expect(cab.find((c) => c.name === 'X-NovuChat-Adjuntos')?.value).toBe('1');
  });

  /** El host de una URL de nodo (con o sin el `=` de las expresiones de n8n); '' si no es una URL absoluta. */
  const hostDe = (url: unknown): string => {
    try { return new URL(String(url ?? '').replace(/^=/, '')).hostname; } catch { return ''; }
  };

  it('14. credenciales: whatsAppApi solo en los tres nodos de Graph; cloudfunctions solo con ingesta; sin /subscriptions', () => {
    const graph = ['Enviar por Graph', 'Subir a Meta', 'Enviar adjunto por Graph'];
    for (const n of flujo.nodes) {
      const cred = Object.keys(n.credentials ?? {});
      if (graph.includes(n.name)) expect(cred, n.name).toEqual(['whatsAppApi']);
      else expect(cred.includes('whatsAppApi'), n.name).toBe(false);
      const txt = JSON.stringify(n.parameters);
      // El host se compara PARSEADO, nunca por subcadena (`graph.facebook.com.otro.example` no es Graph).
      const host = hostDe(n.parameters['url']);
      if (graph.includes(n.name)) {
        expect(host, n.name).toBe('graph.facebook.com');
        expect(n.parameters['authentication'], n.name).toBe('predefinedCredentialType');
        expect(n.parameters['nodeCredentialType'], n.name).toBe('whatsAppApi');
      } else {
        // Fuera de esos tres, ningún nodo va a Meta ni lo nombra en sus parámetros.
        expect(host, n.name).not.toBe('graph.facebook.com');
        expect(txt, n.name).not.toMatch(/facebook/i);
      }
      if (txt.includes('cloudfunctions')) {
        expect(['Reclamar', 'Leer adjunto', 'Confirmar'], n.name).toContain(n.name);
        expect(n.credentials?.['httpHeaderAuth']?.name, n.name).toMatch(/NovuChat ingesta/);
      }
      expect(txt, n.name).not.toMatch(/subscriptions|subscribed_apps/);
    }
  });

  it('15. continueRegularOutput exactamente en los 5 HTTP de envio, lectura y subida; ninguno reintenta', () => {
    const con = ['Enviar por el relé', 'Enviar por Graph', 'Leer adjunto', 'Subir a Meta', 'Enviar adjunto por Graph'];
    for (const n of flujo.nodes) {
      if (con.includes(n.name)) expect(n.onError, n.name).toBe('continueRegularOutput');
      else expect(n.onError, n.name).toBeUndefined();
    }
    for (const n of ['Leer adjunto', 'Subir a Meta', 'Enviar adjunto por Graph']) expect(nodo(flujo, n).retryOnFail, n).toBeUndefined();
  });

  it('16. la rama del adjunto cabe en 80 s con lotes en serie de 1', () => {
    const ramas = ['Leer adjunto', 'Subir a Meta', 'Enviar adjunto por Graph'].map((n) => nodo(flujo, n).parameters['options'] as { timeout: number; batching: { batch: { batchSize: number } } });
    for (const o of ramas) expect(o.batching.batch.batchSize).toBe(1);
    expect(ramas.reduce((t, o) => t + o.timeout, 0)).toBeLessThanOrEqual(80_000);
    expect(ramas.map((o) => o.timeout)).toEqual([30000, 40000, 10000]);
  });

  it('17. privacidad: ni la leyenda ni el nombre llegan al resultado, a Confirmar ni a los items fallidos', () => {
    const { s, r, d } = correrAdj(adj(80, 'document', MIME_DOC, { leyenda: 'LEYENDA-SECRETA', nombre: 'NOMBRE-SECRETO.pdf' }), { subir: () => ({ statusCode: 400, body: { error: { code: 131053 } } }) });
    expect(JSON.stringify([r.confirmadas, s.confirmaciones])).not.toMatch(/SECRETA|SECRETO/);
    for (const j of r.traza.preparados) expect(JSON.stringify(j)).not.toMatch(/SECRETA|SECRETO/);
    const planificado = { mensajeId: d.mensajeId, conversacionId: d.conversacionId, adjunto: { mime: MIME_DOC, ext: 'pdf', tamano: TAMANO, sha256: SHA }, cuerpoAdjunto: { messaging_product: 'whatsapp', to: '59170000001', type: 'document', document: { caption: 'LEYENDA-SECRETA', filename: 'NOMBRE-SECRETO.pdf' } } };
    const clavesFalla = ['mensajeId', 'conversacionId', 'ruta', 'adjuntoSinEnvio'];
    for (const lectura of [{ json: { statusCode: 404, headers: {} } }, { json: { error: {} } }, lecturaBuena(MIME_DOC, { sinBinario: true })] as Lectura[]) {
      const o = correrConBinario(codigoDe(flujo, 'Preparar subida'), lectura, { 'Planificar lote': planificado });
      expect(Object.keys(o.json)).toEqual(clavesFalla);
      expect(o.binary).toBeUndefined();
    }
    for (const resp of [{ statusCode: 400, body: { error: { code: 1 } } }, { error: {} }, { statusCode: 200, body: {} }]) {
      const o = correrConBinario(codigoDe(flujo, 'Preparar envío del adjunto'), { json: resp }, { 'Planificar lote': planificado });
      expect(Object.keys(o.json)).toEqual(clavesFalla);
      expect(o.binary).toBeUndefined();
    }
    const bueno = correrConBinario(codigoDe(flujo, 'Preparar subida'), lecturaBuena(MIME_DOC), { 'Planificar lote': planificado });
    expect(Object.keys(bueno.json)).toEqual(['mensajeId', 'conversacionId', 'ruta', 'mime']);
    expect(bueno.json['ruta']).toBe('subir');
  });

  it('18. ningun modulo de salida-persona lleva secretos, rutas ni nombres de cliente', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const carpeta = join(aqui, '../../../Flujos/src/core/salida-persona');
    const archivos = readdirSync(carpeta).filter((f) => f.endsWith('.js'));
    expect(archivos.length).toBeGreaterThanOrEqual(6);
    for (const f of archivos) {
      const js = readFileSync(join(carpeta, f), 'utf8');
      expect(js, f).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]|\/home\/|webhook\/[0-9a-f]{8}-/);
      expect(js, f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(js, f).not.toMatch(/Bellido|Platinum|Q'?Taco|Dhermacore/i);
      // sin caracteres invisibles ni bidi literales
      expect(js, f).not.toMatch(/[​-‏‪-‮⁠-⁩﻿]/);
      for (const g of GLOBALES_FUERA_DEL_SANDBOX) expect(new RegExp(`(?<![\\w$.])${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[.(]`).test(js), `${f} usa ${g}`).toBe(false);
    }
  });
});
