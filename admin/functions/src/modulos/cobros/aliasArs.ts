/**
 * =============================================================================
 * COBRO POR ALIAS EN PESOS ARGENTINOS (Casa Bermejo, Argentina B4b) — LO PURO
 * =============================================================================
 *
 * Lo que decide el servidor, sin tocar la base: la validez de los cuerpos, el
 * cálculo de la vigencia, la calificación de lo que el flujo leyó del
 * comprobante y la huella con la que un comprobante se reconoce a sí mismo. Los
 * endpoints (`cobroAliasArs.ts`) solo leen, llaman a esto y escriben.
 *
 * QUIÉN DECIDE QUÉ, igual que en `cotejoVenta.ts`: el flujo lee la imagen con el
 * modelo y manda lo leído; el SERVIDOR califica y decide. Lo leído es dato no
 * confiable: se recorta, se tipa y nada de eso vuelve al cliente, salvo el monto
 * leído cuando es distinto del pedido.
 *
 * PROHIBICIÓN 3 (CLAUDE.md), este cobro es REAL: ninguna frase ni código de acá
 * afirma un pago. `ok` significa que el comprobante llegó y que sus datos
 * coinciden con el pedido; que la plata entró lo confirma el banco, y el negocio.
 *
 * EL ALIAS ES UN DATO DEL TENANT (`tenants/{t}/config/cobros.aliasAr`), nunca
 * código ni texto común. Lo escribe el servidor; las reglas no abren
 * `config/cobros` al comercio.
 */
import { createHash } from 'node:crypto';
import { parsearFechaHora, parsearMonto } from './cotejo.js';

/** Vigencia de un cobro por alias, en minutos. */
export const VIGENCIA_ALIAS_MIN = 30;
/** Comprobantes inválidos que se aceptan antes de pasar a una persona. */
export const MAX_INVALIDOS_ALIAS = 3;
/** Minutos de gracia por desfase de relojes entre el banco y nosotros (solo para la FECHA del comprobante). */
export const TOLERANCIA_RELOJ_ALIAS_MIN = 5;
/** Argentina no cambia de hora: UTC−3 todo el año. */
export const OFFSET_ARGENTINA_HORAS = -3;
/** Techo del monto de un cobro, en centavos (coincide con el tope por línea de un pedido externo). */
export const MONTO_MAXIMO_CENTAVOS = 100_000_000;
/** Cuántos comprobantes se anotan por cobro (los de más no se anotan). */
export const MAX_COMPROBANTES_ALIAS = 8;
/** Días que viven los documentos de cobro por alias antes de que el TTL de Firestore los borre. */
export const DIAS_DE_VIDA_ALIAS = 90;

export const MONEDA_ALIAS = 'ARS';

/** Los códigos FIJOS de respuesta (contrato aprobado). */
export type CodigoAlias =
  | 'ok' | 'monto_distinto' | 'alias_distinto' | 'vencido' | 'repetido' | 'ilegible' | 'en_revision';

export const CODIGOS_ALIAS: readonly CodigoAlias[] = [
  'ok', 'monto_distinto', 'alias_distinto', 'vencido', 'repetido', 'ilegible', 'en_revision',
];

export type EstadoDelCobro = 'abierto' | 'coincide' | 'en_revision' | 'vencido';

const TELEFONO = /^[0-9]{8,15}$/;
const ID_PEDIDO = /^wa_[A-Za-z0-9_-]{1,60}$/;
const ID_META = /^[A-Za-z0-9._=:+-]{1,120}$/;
const ALIAS_DE_CONFIG = /^[A-Za-z0-9._-]{6,30}$/;

// ------------------------------------------------------------------ el dato del tenant

/**
 * `config/cobros = { aliasArActivo: true, aliasAr: '<alias>' }`. Interruptor apagado por defecto (ausente o
 * distinto de `true` = apagado) y un alias con la forma de un alias argentino: si algo no cuadra, cerrado.
 */
export function aliasDelTenant(config: Record<string, unknown> | undefined): string | null {
  if (!config || config['aliasArActivo'] !== true) return null;
  const alias = config['aliasAr'];
  if (typeof alias !== 'string') return null;
  const limpio = alias.trim();
  return ALIAS_DE_CONFIG.test(limpio) ? limpio : null;
}

/** Minúsculas, sin acentos, sin espacios: la forma en que dos alias se comparan. Igualdad exacta, sin tolerancia. */
export function normalizarAlias(texto: unknown): string {
  if (typeof texto !== 'string') return '';
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
}

// ------------------------------------------------------------------ los cuerpos

export type Validado<T> = { ok: true; valor: T } | { ok: false; error: string };

function sinClavesExtra(o: Record<string, unknown>, permitidas: readonly string[]): boolean {
  return Object.keys(o).every((k) => permitidas.includes(k));
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Cuerpo de `pedirAliasArs`: `{ v: 1, pedidoId, telefono }`. El `telefono` lo toma el flujo de `messages[0].from`, nunca del
 * modelo: es la llave de acceso por recurso (el pedido tiene que ser de esa conversación). Cualquier otra clave es 400.
 */
export function validarCuerpoPedir(crudo: unknown): Validado<{ pedidoId: string; telefono: string }> {
  if (!esObjeto(crudo) || !sinClavesExtra(crudo, ['v', 'pedidoId', 'telefono'])) return { ok: false, error: 'cuerpo_invalido' };
  if (crudo['v'] !== 1) return { ok: false, error: 'version_invalida' };
  const pedidoId = crudo['pedidoId'];
  if (typeof pedidoId !== 'string' || !ID_PEDIDO.test(pedidoId)) return { ok: false, error: 'pedido_invalido' };
  const telefono = crudo['telefono'];
  if (typeof telefono !== 'string' || !TELEFONO.test(telefono)) return { ok: false, error: 'telefono_invalido' };
  return { ok: true, valor: { pedidoId, telefono } };
}

export interface LeidoAlias {
  monto: number | string;
  alias: string;
  fecha: string;
  hora: string;
  operacion: string;
}

export interface CuerpoCotejoAlias {
  pedidoId: string;
  telefono: string;
  idMeta: string;
  legible: boolean;
  leido: LeidoAlias;
}

const CLAVES_LEIDO = ['monto', 'alias', 'fecha', 'hora', 'operacion'] as const;
const recortar = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Cuerpo de `cotejarAliasArs`: `{ v: 1, pedidoId, telefono, idMeta, legible, leido? }`, con `leido` limitado a
 * `monto, alias, fecha, hora, operacion`. Una clave de más en cualquiera de los dos niveles es 400.
 */
export function validarCuerpoCotejo(crudo: unknown): Validado<CuerpoCotejoAlias> {
  if (!esObjeto(crudo) || !sinClavesExtra(crudo, ['v', 'pedidoId', 'telefono', 'idMeta', 'legible', 'leido'])) {
    return { ok: false, error: 'cuerpo_invalido' };
  }
  if (crudo['v'] !== 1) return { ok: false, error: 'version_invalida' };
  const pedidoId = crudo['pedidoId'];
  if (typeof pedidoId !== 'string' || !ID_PEDIDO.test(pedidoId)) return { ok: false, error: 'pedido_invalido' };
  const telefono = crudo['telefono'];
  if (typeof telefono !== 'string' || !TELEFONO.test(telefono)) return { ok: false, error: 'telefono_invalido' };
  const idMeta = crudo['idMeta'];
  if (typeof idMeta !== 'string' || !ID_META.test(idMeta)) return { ok: false, error: 'idmeta_invalido' };
  if (typeof crudo['legible'] !== 'boolean') return { ok: false, error: 'legible_invalido' };
  const l = crudo['leido'] === undefined ? {} : crudo['leido'];
  if (!esObjeto(l) || !sinClavesExtra(l, CLAVES_LEIDO)) return { ok: false, error: 'leido_invalido' };
  const monto = typeof l['monto'] === 'number' && Number.isFinite(l['monto']) ? l['monto'] : recortar(l['monto'], 40);
  return {
    ok: true,
    valor: {
      pedidoId, telefono, idMeta, legible: crudo['legible'],
      leido: {
        monto, alias: recortar(l['alias'], 60), fecha: recortar(l['fecha'], 40),
        hora: recortar(l['hora'], 20), operacion: recortar(l['operacion'], 60),
      },
    },
  };
}

// ------------------------------------------------------------------ el pedido

/**
 * El monto de un pedido de WhatsApp en ARS, por el contrato PÚBLICO del módulo Pedidos (`pedidos/wa_<ref>`:
 * `origen`, `moneda`, `estado`, `totalServidorCentavos`). Entero positivo, múltiplo de 100 y dentro del techo.
 */
export type PedidoCobrable =
  | { ok: true; montoCentavos: number }
  | { ok: false; motivo: 'sin_pedido' | 'pedido_no_cobrable' };

/** Un pedido más viejo que esto no abre un cobro nuevo (cubre también al cobro vencido que el TTL ya borró). */
export const EDAD_MAXIMA_PEDIDO_MS = 24 * 3_600_000;

export function pedidoCobrable(pedido: Record<string, unknown> | undefined, ahoraMs: number): PedidoCobrable {
  if (!pedido) return { ok: false, motivo: 'sin_pedido' };
  const m = pedido['totalServidorCentavos'];
  const creado = pedido['creadoEn'] as { toMillis?: unknown } | undefined;
  const creadoMs = typeof creado?.toMillis === 'function' ? (creado.toMillis as () => number)() : NaN;
  if (pedido['origen'] !== 'whatsapp' || pedido['moneda'] !== MONEDA_ALIAS || pedido['estado'] !== 'recibido'
    || typeof m !== 'number' || !Number.isInteger(m) || m <= 0 || m > MONTO_MAXIMO_CENTAVOS || m % 100 !== 0
    || !Number.isFinite(creadoMs) || ahoraMs - creadoMs > EDAD_MAXIMA_PEDIDO_MS) {
    return { ok: false, motivo: 'pedido_no_cobrable' };
  }
  return { ok: true, montoCentavos: m };
}

/** Control de acceso por recurso: el pedido es de la conversación de ESE teléfono (el del mensaje, no el del modelo). */
export function pedidoEsDe(pedido: Record<string, unknown> | undefined, telefono: string): boolean {
  return !!pedido && pedido['conversacionId'] === `wa_${telefono}`;
}

/** ¿El pedido sigue siendo aquel por el que se abrió el cobro? Recibido y con el mismo total. */
export function pedidoSigueVivo(pedido: Record<string, unknown> | undefined, montoCentavos: number): boolean {
  return !!pedido && pedido['estado'] === 'recibido' && pedido['totalServidorCentavos'] === montoCentavos;
}

// ------------------------------------------------------------------ la calificación

export interface CobroParaCalificar {
  montoCentavos: number;
  alias: string;
  creadoEnMs: number;
}

export interface Calificacion {
  codigo: 'ok' | 'monto_distinto' | 'alias_distinto' | 'vencido' | 'ilegible';
  /** Solo con `monto_distinto`: es lo único leído de la imagen que vuelve al cliente. */
  montoLeidoCentavos: number | null;
}

/** El instante del comprobante (fecha y HORA, hora de Argentina) o `null` si falta alguno. */
export function instanteDelComprobante(l: LeidoAlias): number | null {
  const junto = [l.fecha, l.hora].filter((v) => v !== '').join(' ');
  if (junto === '' || !/\b\d{1,2}:\d{2}/.test(junto)) return null;
  return parsearFechaHora(junto, OFFSET_ARGENTINA_HORAS);
}

/**
 * Califica lo leído contra el cobro. Pura. Orden de los motivos (el del destinatario primero, como
 * `motivosParaElCliente` de Bolivia): ilegible, alias distinto, monto distinto, fecha fuera de la vigencia.
 *
 * - Monto EXACTO en centavos: ni uno más ni uno menos (sin la tolerancia de Bolivia).
 * - Alias: igualdad exacta tras normalizar.
 * - Fecha: desde la creación del cobro (menos la gracia de relojes) hasta ahora (más la gracia). Anterior =
 *   `vencido` (un pago viejo reciclado); posterior a ahora = `ilegible` (no es de fiar).
 */
export function calificarAlias(
  cobro: CobroParaCalificar, legible: boolean, leido: LeidoAlias, ahoraMs: number,
): Calificacion {
  const ilegible: Calificacion = { codigo: 'ilegible', montoLeidoCentavos: null };
  if (!legible) return ilegible;
  const valor = parsearMonto(leido.monto as string);
  const instante = instanteDelComprobante(leido);
  if (valor === null || valor <= 0 || instante === null || normalizarAlias(leido.alias) === '') return ilegible;
  const montoLeidoCentavos = Math.round(valor * 100);

  if (normalizarAlias(leido.alias) !== normalizarAlias(cobro.alias)) return { codigo: 'alias_distinto', montoLeidoCentavos: null };
  if (montoLeidoCentavos !== cobro.montoCentavos) return { codigo: 'monto_distinto', montoLeidoCentavos };
  const gracia = TOLERANCIA_RELOJ_ALIAS_MIN * 60_000;
  if (instante > ahoraMs + gracia) return ilegible;
  if (instante < cobro.creadoEnMs - gracia) return { codigo: 'vencido', montoLeidoCentavos: null };
  return { codigo: 'ok', montoLeidoCentavos: null };
}

// ------------------------------------------------------------------ las huellas

/**
 * Con qué se reconoce un comprobante entre dos pedidos. SIEMPRE las dos que se puedan calcular:
 *  - `hOp`: número de operación (normalizado, 4 caracteres o más) + monto + alias;
 *  - `hMf`: monto + alias + minuto del comprobante, siempre que haya instante.
 * Así la misma captura con número de operación y sin él cae en la misma `hMf`. Son hashes: en la base no queda
 * ningún dato leído de la imagen.
 */
export function huellasDeComprobante(l: LeidoAlias, montoCentavos: number): { hOp: string | null; hMf: string | null } {
  const alias = normalizarAlias(l.alias);
  const operacion = l.operacion.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hash = (t: string) => createHash('sha256').update(t).digest('hex');
  const instante = instanteDelComprobante(l);
  return {
    hOp: operacion.length >= 4 ? hash(`op:${operacion}|${montoCentavos}|${alias}`) : null,
    hMf: instante === null ? null : hash(`mf:${montoCentavos}|${alias}|${Math.floor(instante / 60_000)}`),
  };
}
