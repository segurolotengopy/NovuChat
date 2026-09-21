/**
 * EL DOBLE DEL COBRADOR — el contrato para consumidores, en memoria.
 *
 * Reproduce **exactamente** `docs/10-contrato-consumidores.md` del proyecto de
 * cobros (transcripto en DISENO.md §4undecies.5), tal como lo implementa su
 * código (`packages/functions/src/api/consumidores.ts`, `enrutador.ts`,
 * `esquemas.ts`, `tipos.ts`, `auth.ts`), verificado el 20/09/2026:
 *
 *   - Se habla por HTTP: `fetch(url, init)` devuelve `{ status, text() }`.
 *     Así el cliente real (`cobrador.ts`, `crearClienteHttp`) se prueba entero,
 *     rutas, cabeceras y cuerpos incluidos; el doble solo reemplaza la red.
 *   - `Authorization: Bearer <token>`; sin token válido, `401 NO_AUTORIZADO`.
 *   - Rutas bajo `/api/v1/cobros`; el resto responde 404, también para un
 *     consumidor (un token de consumidor no abre la consola del dueño).
 *   - El id se deriva de `(consumidor, referenciaExterna)`: `cons-<sha256 hex>`.
 *     Dos `POST` con la misma referencia devuelven el mismo cobro (200 en vez
 *     de 201); con otro importe, `409 IMPORTE_DISTINTO_CON_MISMA_REFERENCIA`.
 *   - Lo ajeno responde 404, nunca 403.
 *   - Montos como texto decimal (`"150.00"`); `pago` solo con `CONFIRMADO`.
 *   - `anular`: 200 `ANULADO` (idempotente), `409 PAGADO_NO_SE_ANULA`,
 *     `409 PAGO_TARDIO_EN_REVISION`.
 *   - Cupo de 60 QR por hora por consumidor: `429 CUPO_POR_HORA_AGOTADO`.
 *   - `GET …/qr`: `{ imagenQrBase64, venceEn }` o `404 SIN_IMAGEN`.
 *   - Errores siempre `{ error: { codigo, mensaje } }`.
 *
 * Y LO QUE EL CONTRATO NO TIENE, el doble tampoco: ninguna ruta confirma un
 * pago. Las pruebas mueven el estado con `fijarEstado()`, que es «el banco» —
 * exactamente lo que el cobrador hace por su consulta autenticada y nadie más.
 *
 * El aviso del bloque 2 (`qr-core/src/avisos/aviso.ts`) se arma con `avisoDe()`
 * y se firma con `firmarAviso()`: HMAC-SHA256 del secreto sobre
 * `"<marca>." + cuerpo`, calculado acá con `node:crypto` y no importado de
 * `firma.ts`, para que la prueba verifique el esquema y no una tautología.
 *
 * Se descarta el día que el cobrador tenga URL pública.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export const ESTADOS = [
  'BORRADOR', 'QR_ACTIVO', 'PAGO_DETECTADO', 'CONFIRMADO', 'EN_REVISION', 'VENCIDO', 'ANULADO', 'RECHAZADO',
] as const;
export type Estado = (typeof ESTADOS)[number];

export interface PagoDoble {
  confirmadoEn: string; ocurridoEn: string | null; montoCentavos: number | null;
  riel: 'watcher-baneco' | 'scraper-yape' | null; confirmadoPor: 'automatico' | 'accion-manual';
}

interface CobroInterno {
  id: string; consumidorId: string; referenciaExterna: string; estado: Estado;
  montoCentavos: number; concepto: string; creadoEn: Date;
  qr: { version: number; venceEn: Date; png: Buffer | null } | null;
  pago: PagoDoble | null;
  /** Al anular: qué contesta el «banco». */
  anulacion: 'ANULADO' | 'PAGADO_NO_SE_ANULA' | 'PAGO_TARDIO_EN_REVISION';
  motivoAnulacion: string | null;
}

/** Nombres públicos del riel (`consumidores.ts:RIEL_PUBLICO`). */
const RIEL_PUBLICO = { 'watcher-baneco': 'api-baneco', 'scraper-yape': 'scraping-yape' } as const;

const REFERENCIA = /^[A-Za-z0-9:_.-]{1,120}$/;
const MONTO = /^\d+(\.\d{1,2})?$/;
const ID = /^cons-[0-9a-f]{64}$/;
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

export const idDeCobro = (consumidorId: string, referencia: string): string =>
  `cons-${createHash('sha256').update(`${consumidorId}\n${referencia}`).digest('hex')}`;

const aDecimal = (centavos: number): string => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
const desdeDecimal = (texto: string): number | null => {
  if (!MONTO.test(texto)) return null;
  const [ent, dec = ''] = texto.split('.');
  return Number(ent) * 100 + Number((dec + '00').slice(0, 2));
};

// --- Un PNG mínimo y válido (1×1, gris), sin dependencias -------------------
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function trozo(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}
/** Un PNG real de un píxel: firma, IHDR, IDAT e IEND. Alcanza para probar la decodificación. */
export function pngMinimo(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8 bits, escala de grises
  const idat = deflateSync(Buffer.from([0, 0x80]));                       // filtro 0 + un píxel
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr), trozo('IDAT', idat), trozo('IEND', Buffer.alloc(0)),
  ]);
}

export interface OpcionesDoble {
  /** `token → consumidorId`. Por defecto, un token al azar para `novuchat`. */
  tokens?: Record<string, string>;
  cupoPorHora?: number;
  vigenciaHorasPorDefecto?: number;
  ahora?: () => Date;
}

export class CobradorDoble {
  readonly cobros = new Map<string, CobroInterno>();
  readonly tokens: Map<string, string>;
  readonly cupoPorHora: number;
  readonly vigenciaHoras: number;
  readonly ahora: () => Date;
  private readonly pedidos = new Map<string, number[]>();
  /** Todo lo que pasó por la red, para las aserciones. */
  readonly llamadas: Array<{ metodo: string; ruta: string; status: number }> = [];
  /** Si está, cada `POST /api/v1/cobros` nuevo nace en `BORRADOR` (falló el banco). */
  bancoCaido = false;
  /** Si está, cada `POST /api/v1/cobros` responde `502 QR_SUELTO_EN_EL_PROVEEDOR`. */
  qrSuelto = false;
  /** Si está, todo responde `503 SERVICIO_NO_DISPONIBLE`. */
  noDisponible = false;

  constructor(op: OpcionesDoble = {}) {
    this.tokens = new Map(Object.entries(op.tokens ?? { [randomBytes(16).toString('hex')]: 'novuchat' }));
    this.cupoPorHora = op.cupoPorHora ?? 60;
    this.vigenciaHoras = op.vigenciaHorasPorDefecto ?? 72;
    this.ahora = op.ahora ?? (() => new Date());
  }

  /** El token del consumidor `novuchat` (o del que se pida). */
  tokenDe(consumidorId = 'novuchat'): string {
    for (const [token, id] of this.tokens) if (id === consumidorId) return token;
    throw new Error(`sin token para ${consumidorId}`);
  }

  /** `fetch` compatible con `crearClienteHttp`. */
  readonly fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const u = new URL(url);
    const consulta: Record<string, string> = {};
    u.searchParams.forEach((v, k) => { consulta[k] = v; });
    let cuerpo: unknown = null;
    if (init.body) { try { cuerpo = JSON.parse(init.body); } catch { cuerpo = null; } }
    const auth = Object.entries(init.headers).find(([k]) => k.toLowerCase() === 'authorization')?.[1] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const r = this.manejar({ metodo: init.method, ruta: u.pathname, consulta, cuerpo, token });
    this.llamadas.push({ metodo: init.method, ruta: u.pathname, status: r.status });
    return { status: r.status, text: async () => JSON.stringify(r.cuerpo) };
  };

  // --- El enrutador (enrutador.ts) -------------------------------------------
  manejar(p: { metodo: string; ruta: string; consulta: Record<string, string>; cuerpo: unknown; token: string | null }): { status: number; cuerpo: unknown } {
    if (p.token === null) return error(401, 'NO_AUTORIZADO', 'Falta un token válido en el header Authorization.');
    const consumidorId = this.tokens.get(p.token) ?? null;
    if (consumidorId === null) return error(401, 'NO_AUTORIZADO', 'Falta un token válido en el header Authorization.');
    if (this.noDisponible) return error(503, 'SERVICIO_NO_DISPONIBLE', 'Un servicio externo no respondió.');

    const BASE = '/api/v1/cobros';
    if (!(p.ruta === BASE || p.ruta.startsWith(`${BASE}/`))) return noEncontrado();
    if (p.ruta === BASE) {
      return p.metodo === 'GET' ? this.listar(consumidorId, p.consulta) : this.crear(consumidorId, p.cuerpo);
    }
    const [primero, segundo, sobrante] = p.ruta.slice(BASE.length + 1).split('/');
    if (!primero || sobrante !== undefined) return noEncontrado();
    if (primero === 'por-referencia') {
      if (p.metodo !== 'GET') return metodoNoPermitido();
      if (!segundo) return noEncontrado();
      let referencia: string;
      try { referencia = decodeURIComponent(segundo); } catch { return noEncontrado(); }
      if (!REFERENCIA.test(referencia)) return noEncontrado();
      return this.ver(consumidorId, idDeCobro(consumidorId, referencia));
    }
    if (segundo === undefined) return p.metodo === 'GET' ? this.ver(consumidorId, primero) : metodoNoPermitido();
    if (segundo === 'qr') return p.metodo === 'GET' ? this.verQr(consumidorId, primero) : metodoNoPermitido();
    if (segundo === 'anular') return p.metodo === 'POST' ? this.anular(consumidorId, primero, p.cuerpo) : metodoNoPermitido();
    return noEncontrado();
  }

  private suCobro(consumidorId: string, id: string): CobroInterno | null {
    if (!ID.test(id)) return null;
    const c = this.cobros.get(id);
    return c && c.consumidorId === consumidorId ? c : null;
  }

  vista(c: CobroInterno): Record<string, unknown> {
    return {
      id: c.id,
      referenciaExterna: c.referenciaExterna,
      estado: c.estado,
      monto: aDecimal(c.montoCentavos),
      moneda: 'BOB',
      concepto: c.concepto,
      creadoEn: c.creadoEn.toISOString(),
      qr: c.qr === null ? null : { version: c.qr.version, venceEn: c.qr.venceEn.toISOString(), imagenDisponible: c.qr.png !== null },
      pago: c.estado !== 'CONFIRMADO' || c.pago === null ? null : {
        confirmadoEn: c.pago.confirmadoEn,
        ocurridoEn: c.pago.ocurridoEn,
        monto: c.pago.montoCentavos === null ? null : aDecimal(c.pago.montoCentavos),
        riel: c.pago.riel === null ? null : RIEL_PUBLICO[c.pago.riel],
        confirmadoPor: c.pago.confirmadoPor === 'accion-manual' ? 'revision-manual' : 'automatico',
      },
    };
  }

  private crear(consumidorId: string, cuerpo: unknown): { status: number; cuerpo: unknown } {
    if (typeof cuerpo !== 'object' || cuerpo === null) return error(400, 'CUERPO_INVALIDO', 'cuerpo inválido');
    const c = cuerpo as Record<string, unknown>;
    const referencia = typeof c['referenciaExterna'] === 'string' ? c['referenciaExterna'].trim() : '';
    const concepto = typeof c['concepto'] === 'string' ? c['concepto'] : '';
    const monto = typeof c['monto'] === 'string' ? c['monto'] : '';
    const horas = c['horasDeVigencia'];
    if (!REFERENCIA.test(referencia) || concepto.length < 1 || concepto.length > 100 || !MONTO.test(monto)
      || (horas !== undefined && !(Number.isInteger(horas) && (horas as number) > 0 && (horas as number) <= 24 * 365))) {
      return error(400, 'CUERPO_INVALIDO', 'cuerpo inválido');
    }
    const centavos = desdeDecimal(monto);
    if (centavos === null) return error(400, 'MONTO_INVALIDO', 'El monto no es representable en centavos enteros.');

    const ahora = this.ahora();
    const desde = ahora.getTime() - HORA_MS;
    const recientes = (this.pedidos.get(consumidorId) ?? []).filter((t) => t > desde);
    if (recientes.length >= this.cupoPorHora) {
      this.pedidos.set(consumidorId, recientes);
      return error(429, 'CUPO_POR_HORA_AGOTADO', `Este consumidor ya pidió ${this.cupoPorHora} QRs en la última hora. Esperá y reintentá.`);
    }
    recientes.push(ahora.getTime()); this.pedidos.set(consumidorId, recientes);

    const id = idDeCobro(consumidorId, referencia);
    const existente = this.cobros.get(id);
    if (existente) {
      if (existente.montoCentavos !== centavos) {
        return error(409, 'IMPORTE_DISTINTO_CON_MISMA_REFERENCIA', 'La referencia ya existe con otro importe.');
      }
      if (existente.estado === 'BORRADOR' && !this.bancoCaido) {
        // Retoma el borrador: ahora sí se emite el QR.
        existente.qr = { version: 1, venceEn: new Date(ahora.getTime() + (typeof horas === 'number' ? horas : this.vigenciaHoras) * HORA_MS), png: pngMinimo() };
        existente.estado = 'QR_ACTIVO';
      }
      return { status: 200, cuerpo: { cobro: this.vista(existente), imagenQrBase64: existente.qr?.png?.toString('base64') ?? null } };
    }
    if (this.qrSuelto) return error(502, 'QR_SUELTO_EN_EL_PROVEEDOR', 'No se pudo registrar el QR y el banco tampoco lo anuló.');
    const nuevo: CobroInterno = {
      id, consumidorId, referenciaExterna: referencia, estado: this.bancoCaido ? 'BORRADOR' : 'QR_ACTIVO',
      montoCentavos: centavos, concepto, creadoEn: ahora,
      qr: this.bancoCaido ? null : { version: 1, venceEn: new Date(ahora.getTime() + (typeof horas === 'number' ? horas : this.vigenciaHoras) * HORA_MS), png: pngMinimo() },
      pago: null, anulacion: 'ANULADO', motivoAnulacion: null,
    };
    this.cobros.set(id, nuevo);
    return { status: 201, cuerpo: { cobro: this.vista(nuevo), imagenQrBase64: nuevo.qr?.png?.toString('base64') ?? null } };
  }

  private ver(consumidorId: string, id: string): { status: number; cuerpo: unknown } {
    const c = this.suCobro(consumidorId, id);
    return c ? { status: 200, cuerpo: { cobro: this.vista(c) } } : noEncontrado();
  }

  private verQr(consumidorId: string, id: string): { status: number; cuerpo: unknown } {
    const c = this.suCobro(consumidorId, id);
    if (!c) return noEncontrado();
    if (!c.qr?.png) return error(404, 'SIN_IMAGEN', 'Este cobro no tiene la imagen del QR guardada.');
    return { status: 200, cuerpo: { imagenQrBase64: c.qr.png.toString('base64'), venceEn: c.qr.venceEn.toISOString() } };
  }

  private anular(consumidorId: string, id: string, cuerpo: unknown): { status: number; cuerpo: unknown } {
    const datos = (cuerpo ?? {}) as Record<string, unknown>;
    const motivo = datos['motivo'];
    if (motivo !== undefined && (typeof motivo !== 'string' || motivo.trim().length < 1 || motivo.length > 200)) {
      return error(400, 'CUERPO_INVALIDO', 'cuerpo inválido');
    }
    const c = this.suCobro(consumidorId, id);
    if (!c) return noEncontrado();
    if (c.estado === 'ANULADO') return { status: 200, cuerpo: { resultado: 'ANULADO', cobro: this.vista(c) } };
    if (c.estado === 'CONFIRMADO') return error(409, 'PAGADO_NO_SE_ANULA', 'Este cobro ya está pagado: no se anula.');
    if (c.anulacion === 'PAGADO_NO_SE_ANULA' || c.estado === 'PAGO_DETECTADO') {
      return error(409, 'PAGADO_NO_SE_ANULA', 'El banco reporta un pago para este cobro: no se anula. Consultá su estado.');
    }
    if (c.anulacion === 'PAGO_TARDIO_EN_REVISION') {
      c.estado = 'EN_REVISION';
      return error(409, 'PAGO_TARDIO_EN_REVISION', 'Llegó un pago sobre el QR vencido: el cobro pasó a revisión manual y no se anuló.');
    }
    c.estado = 'ANULADO';
    c.motivoAnulacion = `consumidor:${consumidorId} · ${typeof motivo === 'string' ? motivo : 'sin motivo declarado'}`;
    return { status: 200, cuerpo: { resultado: 'ANULADO', cobro: this.vista(c) } };
  }

  private listar(consumidorId: string, consulta: Record<string, string>): { status: number; cuerpo: unknown } {
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
    for (const k of ['desde', 'hasta']) {
      if (consulta[k] !== undefined && !iso.test(consulta[k]!)) return error(400, 'CONSULTA_INVALIDA', 'consulta inválida');
    }
    let limite = 50;
    if (consulta['limite'] !== undefined) {
      if (!/^\d{1,3}$/.test(consulta['limite'])) return error(400, 'CONSULTA_INVALIDA', 'consulta inválida');
      limite = Number(consulta['limite']);
      if (limite < 1 || limite > 100) return error(400, 'CONSULTA_INVALIDA', 'el límite va de 1 a 100');
    }
    const ahora = this.ahora();
    const hasta = consulta['hasta'] === undefined ? new Date(ahora.getTime() + 1) : new Date(consulta['hasta']);
    const desde = consulta['desde'] === undefined ? new Date(hasta.getTime() - 7 * DIA_MS) : new Date(consulta['desde']);
    if (desde.getTime() >= hasta.getTime()) return error(400, 'RANGO_INVALIDO', '`desde` tiene que ser anterior a `hasta`.');
    if (hasta.getTime() - desde.getTime() > 92 * DIA_MS) return error(400, 'RANGO_DEMASIADO_LARGO', 'El rango máximo es de 92 días.');
    const cobros = [...this.cobros.values()]
      .filter((c) => c.consumidorId === consumidorId && c.creadoEn >= desde && c.creadoEn < hasta)
      .sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime())
      .slice(0, limite)
      .map((c) => this.vista(c));
    return { status: 200, cuerpo: { desde: desde.toISOString(), hasta: hasta.toISOString(), limite, truncado: cobros.length === limite, cobros } };
  }

  // --- Lo que hace «el banco», que ninguna ruta puede hacer ------------------

  /** Mueve el estado de un cobro, por id o por referencia (`novuchat`). */
  fijarEstado(idOReferencia: string, estado: Estado, pago?: Partial<PagoDoble>): CobroInterno {
    const id = ID.test(idOReferencia) ? idOReferencia : idDeCobro('novuchat', idOReferencia);
    const c = this.cobros.get(id);
    if (!c) throw new Error(`el doble no tiene el cobro ${idOReferencia}`);
    c.estado = estado;
    if (estado === 'CONFIRMADO') {
      const ahora = this.ahora().toISOString();
      c.pago = {
        confirmadoEn: pago?.confirmadoEn ?? ahora, ocurridoEn: pago?.ocurridoEn ?? ahora,
        montoCentavos: pago?.montoCentavos === undefined ? c.montoCentavos : pago.montoCentavos,
        riel: pago?.riel === undefined ? 'watcher-baneco' : pago.riel,
        confirmadoPor: pago?.confirmadoPor ?? 'automatico',
      };
    }
    return c;
  }

  /** Qué contesta el banco cuando el consumidor intenta anular este cobro. */
  fijarAnulacion(idOReferencia: string, respuesta: CobroInterno['anulacion']): void {
    const id = ID.test(idOReferencia) ? idOReferencia : idDeCobro('novuchat', idOReferencia);
    const c = this.cobros.get(id);
    if (!c) throw new Error(`el doble no tiene el cobro ${idOReferencia}`);
    c.anulacion = respuesta;
  }

  /** Vence el QR de un cobro (mueve `venceEn` al pasado), sin cambiar el estado: como hace el banco entre días. */
  vencerQr(idOReferencia: string, haceMs: number): void {
    const id = ID.test(idOReferencia) ? idOReferencia : idDeCobro('novuchat', idOReferencia);
    const c = this.cobros.get(id);
    if (!c?.qr) throw new Error(`el doble no tiene QR para ${idOReferencia}`);
    c.qr.venceEn = new Date(this.ahora().getTime() - haceMs);
  }

  cobroPorReferencia(referencia: string, consumidorId = 'novuchat'): CobroInterno | undefined {
    return this.cobros.get(idDeCobro(consumidorId, referencia));
  }

  // --- El aviso del bloque 2 -------------------------------------------------

  /** El cuerpo `AvisoDeConfirmacion` de `aviso.ts`, reconstruido desde el cobro. */
  avisoDe(idOReferencia: string): Record<string, unknown> {
    const id = ID.test(idOReferencia) ? idOReferencia : idDeCobro('novuchat', idOReferencia);
    const c = this.cobros.get(id);
    if (!c) throw new Error(`el doble no tiene el cobro ${idOReferencia}`);
    return {
      evento: 'cobro.confirmado',
      idEvento: c.id,
      consumidorId: c.consumidorId,
      cobroId: c.id,
      referenciaExterna: c.referenciaExterna,
      montoCentavos: c.pago?.montoCentavos ?? c.montoCentavos,
      confirmadoEn: c.pago?.confirmadoEn ?? this.ahora().toISOString(),
      ocurridoEn: c.pago?.ocurridoEn ?? null,
      riel: c.pago?.riel ?? null,
    };
  }
}

/** `X-Firma: sha256=<hex>` con `hex = HMAC-SHA256(secreto, "<marca>." + cuerpo)`. */
export function firmarAviso(secreto: string, cuerpo: string | Buffer, marcaMs: number): { 'X-Firma': string; 'X-Marca-Tiempo': string } {
  const hex = createHmac('sha256', secreto).update(`${marcaMs}.`).update(cuerpo).digest('hex');
  return { 'X-Firma': `sha256=${hex}`, 'X-Marca-Tiempo': String(marcaMs) };
}

const error = (status: number, codigo: string, mensaje: string) => ({ status, cuerpo: { error: { codigo, mensaje } } });
const noEncontrado = () => error(404, 'NO_ENCONTRADO', 'No existe ese recurso.');
const metodoNoPermitido = () => error(405, 'METODO_NO_PERMITIDO', 'Ese método no aplica a esta ruta.');
