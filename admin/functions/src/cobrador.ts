/**
 * =============================================================================
 * EL CLIENTE DEL COBRADOR — NovuChat le pide un QR al proyecto de cobros
 * =============================================================================
 *
 * QUÉ ES ESTO Y QUÉ NO. NovuChat no habla con ningún banco, no guarda ninguna
 * credencial bancaria y no reimplementa la máquina de estados de un cobro
 * (decisión 1 de `Prompts/prepago-estricto.md`). Lo que hay acá es un cliente
 * HTTP del **contrato para proyectos consumidores** del proyecto de cobros
 * (`docs/10-contrato-consumidores.md` de ese proyecto, verificado el
 * 20/09/2026 y transcripto en DISENO.md §4undecies.5): cuatro operaciones más
 * la imagen del QR, y **ninguna que confirme un pago**. Esa ausencia es el
 * contrato: lo que NovuChat afirme sobre un pago vale lo mismo que el
 * comprobante que manda un pagador. Solo la consulta autenticada
 * (`estadoCobro`) dice `CONFIRMADO`, y solo eso suma meses (`cobroPrepago.ts`).
 *
 * LAS FORMAS DEL CONTRATO, que este archivo reproduce al pie de la letra:
 *
 *   - Rutas bajo `/api/v1/…`, con `Authorization: Bearer <token>`.
 *   - Montos como **texto decimal con punto** (`"150.00"`), nunca número:
 *     `montoATexto` convierte el entero en bolivianos que NovuChat guarda.
 *   - El identificador del cobro es `cons-<64 hex>`; la referencia externa es
 *     nuestro `pagoId` (letras, números y `: _ . -`, hasta 120).
 *   - `201` si el cobro es nuevo, `200` si ya existía (mismo cobro, mismo QR).
 *   - Errores siempre `{ error: { codigo, mensaje } }`: se mira `codigo`, que
 *     es estable. Lo ajeno o inexistente responde 404, nunca 403.
 *
 * DOS SECRETOS, DISTINTOS A PROPÓSITO. `COBRADOR_TOKEN` es el token de salida
 * (lo configura el cobrador como `CONSUMIDOR_TOKEN_NOVUCHAT`);
 * `COBRADOR_AVISO_SECRETO` firma el aviso de confirmación que el cobrador nos
 * manda (`CONSUMIDOR_AVISO_SECRETO_NOVUCHAT` allá). Comprometer uno no permite
 * fabricar lo otro. Los dos viven en Secret Manager y se leen con `.value()`
 * solo en ejecución; la base URL del cobrador no es secreta y vive en
 * `plataforma/prepago.cobrador.baseUrl`.
 *
 * INYECTABLE. Las Functions reciben el cliente por parámetro o lo resuelven
 * con `resolverCobrador()`, que en producción arma el cliente HTTP y en las
 * pruebas —solo con `COBRADOR_DOBLE` en el entorno— devuelve el doble que la
 * suite registró. El doble (`pruebas/dobles/cobrador.ts`) implementa el
 * contrato exacto y se descarta el día que el cobrador tenga URL pública.
 */
import { createHmac } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { firmaValida, VENTANA_MS } from './firma.js';

export const COBRADOR_TOKEN = defineSecret('COBRADOR_TOKEN');
export const COBRADOR_AVISO_SECRETO = defineSecret('COBRADOR_AVISO_SECRETO');

/** Identidad de NovuChat ante el cobrador. Sale del nombre de la variable allá. */
export const CONSUMIDOR_ID = 'novuchat';

// ---------------------------------------------------------------------------
// TIPOS DEL CONTRATO
// ---------------------------------------------------------------------------

/** Los estados que puede ver un consumidor (docs/10 §5). `ENVIADO` y
 *  `COMPROBANTE_RECIBIDO` no existen para nosotros. */
export const ESTADOS_COBRADOR = [
  'BORRADOR', 'QR_ACTIVO', 'PAGO_DETECTADO', 'CONFIRMADO',
  'EN_REVISION', 'VENCIDO', 'ANULADO', 'RECHAZADO',
] as const;
export type EstadoCobrador = (typeof ESTADOS_COBRADOR)[number];
export const esEstadoCobrador = (v: unknown): v is EstadoCobrador =>
  typeof v === 'string' && (ESTADOS_COBRADOR as readonly string[]).includes(v);

/** Códigos de error estables del contrato (docs/10 §4 y §7). */
export type CodigoErrorCobrador =
  | 'CUERPO_INVALIDO' | 'MONTO_INVALIDO' | 'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA'
  | 'CUPO_POR_HORA_AGOTADO' | 'PROVEEDOR_RECHAZO' | 'QR_SUELTO_EN_EL_PROVEEDOR'
  | 'SERVICIO_NO_DISPONIBLE' | 'NO_AUTORIZADO' | 'NO_ENCONTRADO' | 'METODO_NO_PERMITIDO'
  | 'PAGADO_NO_SE_ANULA' | 'PAGO_TARDIO_EN_REVISION' | 'SIN_IMAGEN'
  | 'CONSULTA_INVALIDA' | 'RANGO_INVALIDO' | 'RANGO_DEMASIADO_LARGO'
  // Solo en la prueba controlada en producción del cobrador; no son del contrato.
  | 'MONTO_SOBRE_LIMITE_DE_PRUEBA' | 'LIMITE_DE_PRUEBA';

export interface PagoDelCobrador {
  confirmadoEn: string;
  ocurridoEn: string | null;
  monto: string | null;
  riel: 'api-baneco' | 'scraping-yape' | null;
  confirmadoPor: 'automatico' | 'revision-manual';
}

export interface CobroDelCobrador {
  id: string;
  referenciaExterna: string | null;
  estado: EstadoCobrador;
  /** Texto decimal: `"150.00"`. */
  monto: string;
  moneda: 'BOB';
  concepto: string;
  creadoEn: string;
  qr: { version: number; venceEn: string; imagenDisponible: boolean } | null;
  /** Solo con `CONFIRMADO`; `null` en cualquier otro estado. */
  pago: PagoDelCobrador | null;
}

export interface RespuestaCrear {
  /** `true` con 201 (nuevo); `false` con 200 (ya existía: mismo cobro, mismo QR). */
  creado: boolean;
  cobro: CobroDelCobrador;
  imagenQrBase64: string | null;
}

export interface Listado {
  desde: string; hasta: string; limite: number; truncado: boolean;
  cobros: CobroDelCobrador[];
}

/** Un error que el cobrador contestó con forma: HTTP y `codigo` estables. */
export class ErrorCobrador extends Error {
  constructor(readonly status: number, readonly codigo: CodigoErrorCobrador | string, mensaje: string) {
    super(`cobrador ${status} ${codigo}: ${mensaje}`);
    this.name = 'ErrorCobrador';
  }
}

/** El cobrador no respondió (red, timeout, respuesta sin forma). Reintentable. */
export class CobradorNoResponde extends Error {
  constructor(motivo: string) { super(`el cobrador no respondió: ${motivo}`); this.name = 'CobradorNoResponde'; }
}

export interface Cobrador {
  crearCobro(p: { referenciaExterna: string; concepto: string; montoBs: number; horasDeVigencia?: number }): Promise<RespuestaCrear>;
  estadoCobro(id: string): Promise<CobroDelCobrador>;
  estadoPorReferencia(referencia: string): Promise<CobroDelCobrador>;
  anularCobro(id: string, motivo?: string): Promise<{ resultado: 'ANULADO'; cobro: CobroDelCobrador | null }>;
  listarCobros(p?: { desde?: string; hasta?: string; limite?: number }): Promise<Listado>;
  imagenQr(id: string): Promise<{ imagenQrBase64: string; venceEn: string | null }>;
}

// ---------------------------------------------------------------------------
// FORMAS: la referencia, el id y el monto
// ---------------------------------------------------------------------------

/** Referencia externa admitida por el cobrador (`esquemas.ts:referenciaExterna`). */
export const REFERENCIA_EXTERNA = /^[A-Za-z0-9:_.-]{1,120}$/;
/** Id de un cobro de consumidor (`consumidores.ts:ID_DE_CONSUMIDOR`). */
export const ID_COBRO = /^cons-[0-9a-f]{64}$/;

/**
 * El entero en bolivianos de NovuChat, como lo pide el contrato: texto decimal
 * con punto y dos decimales. Nunca un `number` de JSON, que ya perdió cuántos
 * decimales traía. Lanza ante lo que no sea un entero no negativo: un importe
 * con centavos no existe en NovuChat (`importeBs` redondea al boliviano).
 */
export function montoATexto(montoBs: number): string {
  if (!Number.isInteger(montoBs) || montoBs < 0) throw new Error(`monto invalido: ${montoBs}`);
  return `${montoBs}.00`;
}

/** Lo inverso, para lo que el cobrador informa (`pago.monto`). `null` si no es decimal. */
export function montoDesdeTexto(texto: unknown): number | null {
  if (typeof texto !== 'string' || !/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// EL CLIENTE HTTP
// ---------------------------------------------------------------------------

export type FetchCompatible = (url: string, init: {
  method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal;
}) => Promise<{ status: number; text(): Promise<string> }>;

export interface OpcionesCliente {
  /** Sin barra final. Viene de `plataforma/prepago.cobrador.baseUrl`. */
  baseUrl: string;
  token: string;
  fetchImpl?: FetchCompatible;
  timeoutMs?: number;
}

export const TIMEOUT_MS = 10_000;

function esCobro(v: unknown): v is CobroDelCobrador {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c['id'] === 'string' && esEstadoCobrador(c['estado'])
    && typeof c['monto'] === 'string' && typeof c['concepto'] === 'string';
}

/**
 * Arma el cliente. Cada llamada es una petición con timeout; una respuesta
 * que no sea JSON con la forma del contrato se trata como «no respondió»
 * (reintentable), no como un estado: nunca se decide nada sobre un pago a
 * partir de una respuesta rota.
 */
export function crearClienteHttp(op: OpcionesCliente): Cobrador {
  const base = op.baseUrl.replace(/\/+$/, '');
  const fetchImpl: FetchCompatible = op.fetchImpl ?? ((url, init) => fetch(url, init));
  const timeoutMs = op.timeoutMs ?? TIMEOUT_MS;

  async function pedir(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<{ status: number; datos: Record<string, unknown> }> {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs);
    let status: number; let texto: string;
    try {
      const r = await fetchImpl(`${base}${ruta}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${op.token}`,
          Accept: 'application/json',
          ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
        signal: control.signal,
      });
      status = r.status; texto = await r.text();
    } catch (e) {
      throw new CobradorNoResponde(e instanceof Error ? e.name : 'red');
    } finally {
      clearTimeout(reloj);
    }
    let datos: unknown;
    try { datos = texto ? JSON.parse(texto) : {}; } catch { throw new CobradorNoResponde(`respuesta no JSON (${status})`); }
    if (typeof datos !== 'object' || datos === null) throw new CobradorNoResponde(`respuesta sin forma (${status})`);
    const d = datos as Record<string, unknown>;
    if (status >= 400) {
      const err = d['error'] as { codigo?: unknown; mensaje?: unknown } | undefined;
      const codigo = typeof err?.codigo === 'string' ? err.codigo : '';
      if (!codigo) throw new CobradorNoResponde(`error sin codigo (${status})`);
      throw new ErrorCobrador(status, codigo, typeof err?.mensaje === 'string' ? err.mensaje : '');
    }
    return { status, datos: d };
  }

  const cobroDe = (d: Record<string, unknown>): CobroDelCobrador => {
    if (!esCobro(d['cobro'])) throw new CobradorNoResponde('cobro sin forma');
    return d['cobro'];
  };

  return {
    async crearCobro(p) {
      if (!REFERENCIA_EXTERNA.test(p.referenciaExterna)) throw new Error('referencia externa invalida');
      const { status, datos } = await pedir('POST', '/api/v1/cobros', {
        referenciaExterna: p.referenciaExterna,
        concepto: p.concepto.slice(0, 100),
        monto: montoATexto(p.montoBs),
        ...(p.horasDeVigencia === undefined ? {} : { horasDeVigencia: p.horasDeVigencia }),
      });
      return {
        creado: status === 201,
        cobro: cobroDe(datos),
        imagenQrBase64: typeof datos['imagenQrBase64'] === 'string' ? datos['imagenQrBase64'] : null,
      };
    },
    async estadoCobro(id) {
      if (!ID_COBRO.test(id)) throw new ErrorCobrador(404, 'NO_ENCONTRADO', 'id con forma invalida');
      return cobroDe((await pedir('GET', `/api/v1/cobros/${id}`)).datos);
    },
    async estadoPorReferencia(referencia) {
      if (!REFERENCIA_EXTERNA.test(referencia)) throw new ErrorCobrador(404, 'NO_ENCONTRADO', 'referencia con forma invalida');
      return cobroDe((await pedir('GET', `/api/v1/cobros/por-referencia/${encodeURIComponent(referencia)}`)).datos);
    },
    async anularCobro(id, motivo) {
      if (!ID_COBRO.test(id)) throw new ErrorCobrador(404, 'NO_ENCONTRADO', 'id con forma invalida');
      const { datos } = await pedir('POST', `/api/v1/cobros/${id}/anular`,
        motivo ? { motivo: motivo.slice(0, 200) } : {});
      if (datos['resultado'] !== 'ANULADO') throw new CobradorNoResponde('anulacion sin resultado');
      return { resultado: 'ANULADO', cobro: esCobro(datos['cobro']) ? datos['cobro'] : null };
    },
    async listarCobros(p = {}) {
      const q = new URLSearchParams();
      if (p.desde) q.set('desde', p.desde);
      if (p.hasta) q.set('hasta', p.hasta);
      if (p.limite !== undefined) q.set('limite', String(p.limite));
      const consulta = q.toString();
      const { datos } = await pedir('GET', `/api/v1/cobros${consulta ? `?${consulta}` : ''}`);
      const cobros = Array.isArray(datos['cobros']) ? datos['cobros'].filter(esCobro) : [];
      return {
        desde: String(datos['desde'] ?? ''), hasta: String(datos['hasta'] ?? ''),
        limite: Number(datos['limite'] ?? 0), truncado: datos['truncado'] === true, cobros,
      };
    },
    async imagenQr(id) {
      if (!ID_COBRO.test(id)) throw new ErrorCobrador(404, 'NO_ENCONTRADO', 'id con forma invalida');
      const { datos } = await pedir('GET', `/api/v1/cobros/${id}/qr`);
      if (typeof datos['imagenQrBase64'] !== 'string') throw new CobradorNoResponde('imagen sin forma');
      return { imagenQrBase64: datos['imagenQrBase64'], venceEn: typeof datos['venceEn'] === 'string' ? datos['venceEn'] : null };
    },
  };
}

// ---------------------------------------------------------------------------
// RESOLUCIÓN: producción o el doble
// ---------------------------------------------------------------------------

let dobleRegistrado: Cobrador | null = null;

/**
 * Registra el doble de las pruebas. Solo surte efecto con `COBRADOR_DOBLE` en
 * el entorno: en producción esa variable no existe, así que registrar un doble
 * por error no cambia nada. Es la misma idea que `FIRESTORE_EMULATOR_HOST`.
 */
export function registrarCobradorDoble(doble: Cobrador | null): void {
  if (!process.env['COBRADOR_DOBLE']) throw new Error('registrarCobradorDoble exige COBRADOR_DOBLE en el entorno');
  dobleRegistrado = doble;
}

/** Configuración pública del cobrador, en `plataforma/prepago.cobrador`. */
export interface ConfigCobrador { baseUrl: string; consumidor: string; vigenciaHoras: number }

export const VIGENCIA_HORAS_POR_DEFECTO = 72;

export function configCobradorDe(datos: Record<string, unknown> | undefined): ConfigCobrador | null {
  const c = datos?.['cobrador'];
  if (typeof c !== 'object' || c === null) return null;
  const r = c as Record<string, unknown>;
  const baseUrl = typeof r['baseUrl'] === 'string' ? r['baseUrl'].trim() : '';
  if (!/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(baseUrl)) return null;
  const vig = r['vigenciaHoras'];
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    consumidor: typeof r['consumidor'] === 'string' ? r['consumidor'] : CONSUMIDOR_ID,
    vigenciaHoras: typeof vig === 'number' && Number.isInteger(vig) && vig >= 1 && vig <= 24 * 30 ? vig : VIGENCIA_HORAS_POR_DEFECTO,
  };
}

/**
 * El cliente que corresponde: el inyectado, el doble (solo en pruebas) o el
 * de producción. El de producción lee la base URL de `plataforma/prepago` en
 * cada resolución —no se cachea— y el token del secreto.
 */
export async function resolverCobrador(inyectado?: Cobrador): Promise<Cobrador> {
  if (inyectado) return inyectado;
  if (process.env['COBRADOR_DOBLE'] && dobleRegistrado) return dobleRegistrado;
  const doc = await getFirestore().doc('plataforma/prepago').get();
  const config = configCobradorDe(doc.data());
  if (!config) throw new Error('plataforma/prepago.cobrador.baseUrl no está configurada');
  const token = COBRADOR_TOKEN.value();
  if (!token || token.length < 32) throw new Error('COBRADOR_TOKEN ausente o demasiado corto');
  return crearClienteHttp({ baseUrl: config.baseUrl, token });
}

// ---------------------------------------------------------------------------
// EL AVISO DE CONFIRMACIÓN — verificar, nunca creer
// ---------------------------------------------------------------------------

/**
 * El cuerpo que manda el bloque 2 del cobrador (`qr-core/src/avisos/aviso.ts`,
 * `AvisoDeConfirmacion`). `montoCentavos` es un entero en centavos —en el
 * aviso, no en la API—; `riel` trae los nombres del dominio del cobrador
 * (`watcher-baneco`, `scraper-yape`), distintos de los públicos de
 * `estadoCobro`. Ninguno de los dos se usa para decidir: lo que decide es la
 * consulta autenticada que sigue.
 */
export interface AvisoDeConfirmacion {
  evento: 'cobro.confirmado';
  idEvento: string;
  consumidorId: string;
  cobroId: string;
  referenciaExterna: string;
  montoCentavos: number;
  confirmadoEn: string;
  ocurridoEn: string | null;
  riel: string | null;
}

export const MAX_CUERPO_AVISO = 64 * 1024;

/**
 * `HMAC-SHA256(secreto, "<marca>." + cuerpo crudo)` en hexa: byte a byte el
 * esquema de `rutaAutenticada` (`firma.ts`). Es lo que NovuChat le propone al
 * cobrador; si C elige otro, cambia esto y `verificarAviso`, y nada más.
 */
export function firmaDeAviso(secreto: string, marcaMs: number | string, cuerpoCrudo: Buffer | string): string {
  return createHmac('sha256', secreto).update(`${marcaMs}.`).update(cuerpoCrudo).digest('hex');
}

export type ResultadoVerificacion =
  | { estado: 'no_firmado' }
  | { estado: 'mal_formado' }
  | { estado: 'ok'; aviso: AvisoDeConfirmacion; crudo: Buffer };

/**
 * Verifica la firma del aviso y, solo entonces, lee su cuerpo. Cabeceras
 * `X-Firma: sha256=<hex>` y `X-Marca-Tiempo` (milisegundos desde la época),
 * tolerancia `VENTANA_MS`, cuerpo ≤ 64 KiB, comparación en tiempo constante.
 * A quien no pasa no se le explica qué le faltó: `no_firmado` y nada más.
 */
export function verificarAviso(
  peticion: { get(nombre: string): string | undefined; rawBody?: Buffer },
  secreto: string,
  ahoraMs: number = Date.now(),
): ResultadoVerificacion {
  if (!secreto) return { estado: 'no_firmado' };
  const crudo = peticion.rawBody ?? Buffer.from('');
  if (crudo.length === 0 || crudo.length > MAX_CUERPO_AVISO) return { estado: 'no_firmado' };
  const marca = String(peticion.get('X-Marca-Tiempo') ?? '').trim();
  const firma = String(peticion.get('X-Firma') ?? '').trim().replace(/^sha256=/, '');
  if (!/^[0-9]{10,16}$/.test(marca) || !/^[0-9a-f]{64}$/.test(firma)) return { estado: 'no_firmado' };
  const marcaMs = Number(marca);
  if (!Number.isFinite(marcaMs) || Math.abs(ahoraMs - marcaMs) > VENTANA_MS) return { estado: 'no_firmado' };
  if (!firmaValida(firmaDeAviso(secreto, marca, crudo), firma)) return { estado: 'no_firmado' };

  let datos: unknown;
  try { datos = JSON.parse(crudo.toString('utf8')); } catch { return { estado: 'mal_formado' }; }
  if (typeof datos !== 'object' || datos === null) return { estado: 'mal_formado' };
  const d = datos as Record<string, unknown>;
  if (d['evento'] !== 'cobro.confirmado') return { estado: 'mal_formado' };
  const cobroId = d['cobroId']; const referencia = d['referenciaExterna'];
  if (typeof cobroId !== 'string' || !ID_COBRO.test(cobroId)) return { estado: 'mal_formado' };
  if (typeof referencia !== 'string' || !REFERENCIA_EXTERNA.test(referencia)) return { estado: 'mal_formado' };
  const idEvento = typeof d['idEvento'] === 'string' ? d['idEvento'].slice(0, 120) : cobroId;
  return {
    estado: 'ok',
    crudo,
    aviso: {
      evento: 'cobro.confirmado',
      idEvento,
      consumidorId: typeof d['consumidorId'] === 'string' ? d['consumidorId'].slice(0, 40) : '',
      cobroId,
      referenciaExterna: referencia,
      montoCentavos: typeof d['montoCentavos'] === 'number' && Number.isInteger(d['montoCentavos']) ? d['montoCentavos'] : 0,
      confirmadoEn: typeof d['confirmadoEn'] === 'string' ? d['confirmadoEn'] : '',
      ocurridoEn: typeof d['ocurridoEn'] === 'string' ? d['ocurridoEn'] : null,
      riel: typeof d['riel'] === 'string' ? d['riel'] : null,
    },
  };
}
