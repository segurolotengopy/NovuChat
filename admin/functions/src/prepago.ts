/**
 * =============================================================================
 * PREPAGO — cobertura del mes, gracia, saldo de conversaciones, corte y cobranza
 * =============================================================================
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO, como `planes.ts` y `atencion.ts`: no importa
 * Firebase ni lee la red. Sobre lo que decide acá se le corta el servicio a un
 * comercio que paga y se le escribe para cobrarle, así que la decisión tiene
 * que poder probarse mes por mes y hora por hora sin emulador
 * (`pruebas/prepago.test.ts`). Quien lo llama —la ingesta, `configuracionFlujo`,
 * `actualizarEstadoCuenta`, `cobranza.ts` y, en los bloques siguientes, los
 * pagos— solo aplica lo que esto decidió. Y lo importa TAMBIÉN la consola
 * (`web/src/lib/prepago.ts`), para que la pantalla y el servidor no puedan
 * calcular dos estados distintos de la misma cuenta.
 *
 * ES LA REAPLICACIÓN del módulo del 08/09 (rama
 * `integracion/prepago-sobre-flujos-vivos`) sobre el `main` del 20/09, con las
 * correcciones de `admin/DISENO.md` §4undecies.3. Lo que cambió respecto de esa
 * rama, y por qué:
 *
 *  - Los planes, la bolsa y `periodoDe` NO viven acá: se importan de
 *    `planes.ts`. La rama decía `base/crecimiento/corporativo`; `main` dice
 *    `impulso/crecimiento/pro`, y dos catálogos son un reclamo esperando.
 *  - La cobertura se decide POR INSTANTES (`ahoraMs` contra el fin del mes
 *    pagado), no por comparación de meses: la gracia es tiempo, no mes.
 *  - GRACIA DE 48 HORAS. D0 es el día 1 del mes sin cobertura, a las 00:00 de
 *    Bolivia; el corte rige desde las 00:00 del día 3. Es el único reparto en
 *    el que «vence hoy» (D0), «48 horas» y «corte a las 00:00» son verdad a la
 *    vez.
 *  - PRUEBA no recibe cobranza: su único recordatorio es el de conversión.
 *  - Calendario D-5 / D-1 / D0 / D+2 / D+4, con los nombres de plantilla de
 *    `docs/plantillas-cobranza.md` (bloque A-5).
 *  - `corte` gana `mensajesPerdidos` y `aplicado`; `perdidas` cuenta TELÉFONOS
 *    distintos que escribieron durante el corte, no mensajes: «[N] clientes te
 *    escribieron» tiene que ser clientes.
 *  - El mensaje de cortesía al cliente final es una función: suma el teléfono
 *    de recepción del comercio. Nunca dice «pago» ni «mantenimiento».
 *  - Tope de 6 meses, y la bolsa de regalo se suma AL PAGAR 6.
 *
 * EL MODELO, EN CUATRO FRASES (decidido con Silvana el 07/09 y afinado en
 * `Analisis/36` §2):
 *
 *  1. El comercio es PREPAGO. Paga el mes calendario por adelantado y recibe
 *     una cantidad de conversaciones INCLUIDAS para ese mes. Lo que no usó no
 *     se arrastra.
 *  2. Puede comprar BOLSAS de conversaciones, que NO vencen y se consumen
 *     recién cuando las incluidas del mes se acabaron.
 *  3. Si el día 3 del mes a las 00:00 no está pagado, se corta. Si se acabaron
 *     las conversaciones (incluidas + bolsas), se corta. Al cliente final le
 *     llega un mensaje FIJO y cordial que NO dice por qué.
 *  4. Un mes calendario de PRUEBA: sin mensualidad, con 20 conversaciones. Al
 *     agotarlas se corta; al terminar el mes (y su gracia), si no eligió un
 *     plan, se corta. Sin cobranza.
 *
 * LO QUE ESTO NO CAMBIA: los negocios de demostración y NovuChat mismo. Una
 * cuenta SIN `modalidad` —o con `modalidad: 'demostracion'`— no está sujeta a
 * nada de esto y el asistente atiende siempre. Es deliberado, y se prueba
 * negando: desplegar este módulo no puede apagar un demo el día de una
 * presentación. DESDE F1 (`Analisis/41` §4, 25/09/2026) LA MODALIDAD ES EL
 * ÚNICO EJE QUE DECIDE ESTO: `plan: 'demostracion'` dejó de existir como plan
 * y ya no manda sobre la modalidad. Un demo es modalidad `demostracion` con
 * cualquier plan del catálogo; `scripts/migrar-ejes.mjs` convierte los que
 * quedaron con el plan viejo.
 *
 * Y LA BANDERA DE MODO OBSERVACIÓN (§4undecies.4): aunque una cuenta con
 * modalidad deba, el corte solo SE APLICA si `plataforma/prepago.corteActivo`
 * o `cuenta/estado.corteActivo` están encendidos (`corteAplicable`). Apagados,
 * la ingesta calcula el corte, lo anota con `aplicado: false`, cuenta lo que se
 * habría perdido, y atiende igual. Encender la bandera es una decisión de
 * Andres, no un despliegue.
 */
import {
  BOLSA, INSTALACION_USD, PLANES, PLAN_POR_DEFECTO, aCentavos, esPlanVendible, limitesDeCuenta, precioMensualDe,
  type IdPlanVendible,
} from './planes.js';

// Lo que la consola y los pagos necesitan del catálogo lo reexportamos desde
// acá, para que `web/src/lib/prepago.ts` tenga un solo origen.
export { BOLSA, INSTALACION_USD, PLANES, PLANES_ASIGNABLES } from './planes.js';

// -----------------------------------------------------------------------------
// MODALIDAD, MONEDAS Y TIPO DE CAMBIO
// -----------------------------------------------------------------------------

export const MODALIDADES = ['demostracion', 'prueba', 'prepago'] as const;
export type Modalidad = (typeof MODALIDADES)[number];

export const esModalidad = (v: unknown): v is Modalidad =>
  typeof v === 'string' && (MODALIDADES as readonly string[]).includes(v);

/**
 * La prueba: sin mensualidad y con esta bolsa. Es la de LISTA; un contrato
 * fija otra con `--bolsa-prueba N` o `actualizarEstadoCuenta({ bolsaPrueba })`
 * (F1b), que escribe `cuenta/estado.bolsaPrueba` y `estadoDeServicio` la usa
 * tal cual.
 */
export const PRUEBA = { conversaciones: 20 } as const;

/**
 * El techo de la bolsa de prueba por contrato. Un seguro contra un dato
 * corrupto, no una opinión comercial: el plan más grande de lista trae 500
 * conversaciones al mes, y una prueba de 1.000 ya es regalar dos meses de Pro.
 */
export const BOLSA_PRUEBA_MAXIMA = 1000;

/** ¿Es una bolsa de prueba aceptable? Entero de 1 a `BOLSA_PRUEBA_MAXIMA`. */
export const bolsaPruebaValida = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= BOLSA_PRUEBA_MAXIMA;

/** Hasta cuántos meses se pagan por adelantado (decisión 4 del frente). */
export const MESES_MAXIMO = 6;
/** Hasta cuántas bolsas entran en un solo pago. */
export const BOLSAS_MAXIMO = 12;

/**
 * LA LISTA SE DENOMINA EN DÓLARES Y SE COBRA EN BOLIVIANOS al Tipo de Cambio
 * Oficial del BCB del día en que se emite el cobro (`CLAUDE.md`, Base
 * comercial §3). NovuChat no publica un tipo de cambio propio.
 */
export const MONEDA_LISTA = 'USD';
export const MONEDA_COBRO = 'BOB';

/**
 * EL TIPO DE CAMBIO VIGENTE, tal como se guarda en `plataforma/tipoCambio`.
 * `fecha` es el DÍA del TCO (`aaaa-mm-dd`), no el mes: desde el 20/09 rige el
 * TCO del día de emisión del cobro (§4undecies.8, fila 2), y un TCO de más de
 * `TCO_DIAS_VIGENCIA` días no sirve para emitir nada.
 */
export interface TipoCambio {
  /** Bolivianos por dólar. */
  tco: number;
  /** Día al que corresponde (`aaaa-mm-dd`). */
  fecha: string;
  /** De dónde salió (`BCB`). Se guarda para poder reconstruir una factura. */
  fuente: string;
}

/** Cota de cordura del TCO: un seguro contra un cero de más al cargarlo a
 *  mano, que multiplicaría o dividiría por diez lo que se le cobra. */
export const TCO_MINIMO = 5;
export const TCO_MAXIMO = 40;
/** Cuántos días vale un TCO publicado (cubre fines de semana y feriados del BCB). */
export const TCO_DIAS_VIGENCIA = 4;

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const esFecha = (v: unknown): v is string => typeof v === 'string' && FECHA.test(v);

export function esTipoCambio(v: unknown): v is TipoCambio {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t['tco'] === 'number' && Number.isFinite(t['tco'])
    && t['tco'] >= TCO_MINIMO && t['tco'] <= TCO_MAXIMO
    && esFecha(t['fecha']) && typeof t['fuente'] === 'string' && t['fuente'].trim() !== '';
}

/**
 * ¿Este TCO sirve HOY? Válido y de hace no más de `TCO_DIAS_VIGENCIA` días
 * CALENDARIO de Bolivia: el del viernes vale hasta el martes. Uno con fecha
 * futura no vale: es un error de carga.
 */
export function tipoCambioVigente(v: unknown, ahoraMs: number): TipoCambio | null {
  if (!esTipoCambio(v)) return null;
  const m = FECHA.exec(v.fecha)!;
  const diaTco = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoy = new Date(ahoraMs - CUATRO_HORAS);
  const diaHoy = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const edadDias = Math.round((diaHoy - diaTco) / DIA_MS);
  if (edadDias < 0 || edadDias > TCO_DIAS_VIGENCIA) return null;
  return v;
}

/**
 * Importe en bolivianos de un precio en dólares. SE REDONDEA AL BOLIVIANO: el
 * importe termina en un QR, y los centavos son diferencias que después hay
 * que conciliar a mano. NUNCA SE INVENTA UN TIPO DE CAMBIO: sin TCO válido
 * esto lanza. Cobrar con un tipo de cambio supuesto es peor que no poder
 * cobrar, porque el error se descubre cuando el cliente ya pagó.
 */
export function importeBs(usd: number, tco: number): number {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`importe invalido: ${usd}`);
  if (!Number.isFinite(tco) || tco < TCO_MINIMO || tco > TCO_MAXIMO) {
    throw new Error(`tipo de cambio invalido: ${tco}`);
  }
  return Math.round(usd * tco);
}

// -----------------------------------------------------------------------------
// EL MENSAJE AL CLIENTE FINAL
// -----------------------------------------------------------------------------

/**
 * EL MENSAJE AL CLIENTE FINAL CUANDO EL SERVICIO ESTÁ CORTADO. Fijo, cordial y
 * NEUTRO: no dice si el negocio no pagó o se quedó sin conversaciones, y no
 * inventa un «mantenimiento» que no existe. Quien escribe por WhatsApp es un
 * tercero ajeno a la relación comercial entre el negocio y NovuChat
 * (`DISENO.md` §4bis.3, T-18). Es EL MISMO texto que ya se usa para la
 * suspensión manual, a propósito: un solo mensaje, una sola cosa que revisar.
 */
export const MENSAJE_CORTESIA =
  'Gracias por escribirnos. En este momento no podemos atenderle por ' +
  'este medio. Le pedimos comunicarse directamente con el negocio.';

/** Un teléfono que se le puede decir a alguien: dígitos, con o sin `+`, espacios o guiones. */
const TELEFONO_LEGIBLE = /^\+?[0-9][0-9 ()-]{5,24}$/;

/**
 * El mensaje de cortesía, con el teléfono de recepción del comercio si lo
 * tiene (`Analisis/36` §3.2, corrección 2): ayuda al cliente final y le
 * recuerda al comercio que ahora atiende él. Sin número válido, el texto de
 * siempre. `pruebas/prepago.test.ts` exige que nunca diga «pago», «deuda» ni
 * «mantenimiento».
 */
export function mensajeCortesia(numeroRecepcion: unknown): string {
  const n = typeof numeroRecepcion === 'string' ? numeroRecepcion.trim() : '';
  return TELEFONO_LEGIBLE.test(n) ? `${MENSAJE_CORTESIA} Puede comunicarse al ${n}.` : MENSAJE_CORTESIA;
}

// -----------------------------------------------------------------------------
// PERÍODOS — meses calendario en Bolivia (UTC−4 fijo, sin horario de verano)
// -----------------------------------------------------------------------------
//
// OJO CON LAS DOS ZONAS. `periodoDe()` de `planes.ts` es el mes en UTC: es el id
// del agregado `metricas/{periodo}` y del aviso de consumo, y así lo escribió
// siempre la ingesta. Lo de acá es el mes CALENDARIO DE BOLIVIA, que es lo que
// el comercio pagó y lo que dice el contrato. Tienen NOMBRES DISTINTOS a
// propósito (`mesBolivia`, no `periodoDe`): dos funciones con el mismo nombre
// y distinta zona fue el defecto que `planes.ts` documenta. La cobertura se
// decide por instantes; lo único que usa el mes UTC es `consumidas`, y en las
// cuatro horas de desfase falla hacia el lado seguro (se cuenta de más, nunca
// de menos).
const CUATRO_HORAS = 4 * 3_600_000;
const DIA_MS = 86_400_000;
const PERIODO = /^(\d{4})-(\d{2})$/;

/** `aaaa-mm` del instante dado, en hora de Bolivia. */
export function mesBolivia(ms: number): string {
  const d = new Date(ms - CUATRO_HORAS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const esPeriodo = (v: unknown): v is string => typeof v === 'string' && PERIODO.test(v);

function partes(periodo: string): [number, number] {
  const m = PERIODO.exec(periodo);
  if (!m) throw new Error(`periodo invalido: ${periodo}`);
  return [Number(m[1]), Number(m[2])];
}

const armar = (anio: number, mes: number): string => {
  // `mes` puede venir fuera de 1..12: Date.UTC lo normaliza.
  const d = new Date(Date.UTC(anio, mes - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function sumarMeses(periodo: string, meses: number): string {
  const [a, m] = partes(periodo);
  return armar(a, m + meses);
}
export const periodoSiguiente = (p: string) => sumarMeses(p, 1);
export const periodoAnterior = (p: string) => sumarMeses(p, -1);

export function diasDelPeriodo(periodo: string): number {
  const [a, m] = partes(periodo);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Día del mes (1..31) del instante dado, en hora de Bolivia. */
export function diaDelMes(ms: number): number {
  return new Date(ms - CUATRO_HORAS).getUTCDate();
}

/** Hora del día (0..23) del instante dado, en hora de Bolivia. */
export function horaBolivia(ms: number): number {
  return new Date(ms - CUATRO_HORAS).getUTCHours();
}

/** Último instante del mes, en milisegundos (23:59:59.999 de Bolivia). */
export function finDelPeriodoMs(periodo: string): number {
  const [a, m] = partes(periodo);
  return Date.UTC(a, m, 1, 0, 0, 0) + CUATRO_HORAS - 1;
}

/** Primer instante del mes, en milisegundos (00:00 de Bolivia). */
export function inicioDelPeriodoMs(periodo: string): number {
  const [a, m] = partes(periodo);
  return Date.UTC(a, m - 1, 1, 0, 0, 0) + CUATRO_HORAS;
}

/** `dd/mm/aaaa` del último día del mes, para leerlo en un mensaje. */
export function fechaFinDelPeriodo(periodo: string): string {
  const [a, m] = partes(periodo);
  return `${String(diasDelPeriodo(periodo)).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;
}

export function fechaCorta(ms: number): string {
  const d = new Date(ms - CUATRO_HORAS);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

const MESES_ESCRITOS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** «1 de octubre de 2026», en hora de Bolivia: como piden las plantillas. */
export function fechaEscrita(ms: number): string {
  const d = new Date(ms - CUATRO_HORAS);
  return `${d.getUTCDate()} de ${MESES_ESCRITOS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// -----------------------------------------------------------------------------
// LA CUENTA — lo que vive en /tenants/{t}/cuenta/estado
// -----------------------------------------------------------------------------

/**
 * Se lee con todos los campos en `unknown`: el documento lo escribe el SDK
 * Admin, pero un documento viejo, uno sembrado a mano o uno a medio migrar
 * puede traer cualquier cosa, y sobre esto se corta un servicio.
 */
export interface CuentaCruda {
  plan?: unknown;
  limites?: unknown;
  modalidad?: unknown;
  /** Último mes calendario PAGADO (`aaaa-mm`). Cubre ese mes y los anteriores. */
  periodoPagado?: unknown;
  /**
   * El ÚLTIMO mes calendario de prueba (`aaaa-mm`). Sin mensualidad hasta ese
   * mes. Con `pruebaDesde` ausente, la prueba es solo ese mes, como siempre.
   */
  periodoPrueba?: unknown;
  /**
   * El PRIMER mes de una prueba de varios meses (`aaaa-mm`, F1b). Lo escribe
   * `pruebaNueva` al EXTENDER una prueba (`--periodo-prueba`): sin él,
   * llevar `periodoPrueba` de septiembre a octubre el día 26 dejaba sin
   * cobertura del 27 al 30 de septiembre. Ausente = la prueba empieza en
   * `periodoPrueba`.
   */
  pruebaDesde?: unknown;
  /** La mensualidad pactada, en USD (`planes.ts`, `precioPorContratoDe`). Manda sobre el plan. */
  precioPorContrato?: unknown;
  /** Conversaciones compradas en bolsas y todavía no usadas. No vencen. */
  bolsa?: unknown;
  /** Conversaciones de prueba que quedan. Solo valen durante el mes de prueba. */
  bolsaPrueba?: unknown;
  corte?: unknown;
  recordatorios?: unknown;
  pagoPendienteId?: unknown;
  /** Enciende el corte en ESTE tenant antes que en toda la plataforma. */
  corteActivo?: unknown;
  /** Teléfonos del comercio que pueden pagar y reciben la cobranza (≤ 5). */
  telefonosPago?: unknown;
  confirmacionesPendientes?: unknown;
  /** Marca de la ingesta: ya se avisó que la cuenta está incoherente. */
  incoherencia?: unknown;
}

export type MotivoCorte = 'sin_pago' | 'sin_conversaciones';

export interface Corte {
  motivo: MotivoCorte;
  /** Milisegundos desde la época. Se guarda como Timestamp; acá viaja como número. */
  desdeMs: number;
  /** TELÉFONOS DISTINTOS que consultaron durante el corte y no fueron atendidos. */
  perdidas: number;
  /** Mensajes entrantes que llegaron durante el corte. */
  mensajesPerdidos: number;
  /** `true` si el corte se aplicó (409 al flujo); `false` si solo se observó. */
  aplicado: boolean;
}

const entero = (v: unknown, defecto = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : defecto;

const aMs = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'object' && v !== null) {
    const t = v as { toMillis?: () => number; seconds?: unknown };
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
  }
  return null;
};

export const esMotivoCorte = (v: unknown): v is MotivoCorte =>
  v === 'sin_pago' || v === 'sin_conversaciones';

/** Lee el corte guardado, o `null` si no hay ninguno coherente. */
export function corteDe(cuenta: CuentaCruda | null | undefined): Corte | null {
  const c = cuenta?.corte;
  if (typeof c !== 'object' || c === null) return null;
  const o = c as Record<string, unknown>;
  const motivo = o['motivo'];
  if (!esMotivoCorte(motivo)) return null;
  return {
    motivo,
    desdeMs: aMs(o['desde']) ?? 0,
    perdidas: entero(o['perdidas']),
    mensajesPerdidos: entero(o['mensajesPerdidos']),
    aplicado: o['aplicado'] === true,
  };
}

/**
 * LA MODALIDAD QUE RIGE. Sin `modalidad` no hay prepago: es la salvaguarda de
 * los demos y de cualquier negocio cargado antes de este módulo.
 *
 * EL PLAN NO OPINA (F1, `Analisis/41` §4). Hasta el 25/09 un
 * `plan: 'demostracion'` era demostración diga lo que dijera `modalidad`
 * («doble salvaguarda»). Esa doble salvaguarda era la mezcla de los dos ejes:
 * el plan decidiendo si se cobra. Ahora la modalidad es el único dato que
 * decide, y los tenants que tenían el plan viejo reciben `modalidad:
 * 'demostracion'` por `scripts/migrar-ejes.mjs`. Lo que sí se conserva es la
 * salvaguarda de la AUSENCIA: sin modalidad, demostración.
 */
export function modalidadDe(cuenta: CuentaCruda | null | undefined): Modalidad {
  return esModalidad(cuenta?.modalidad) ? cuenta.modalidad : 'demostracion';
}

// -----------------------------------------------------------------------------
// LA BANDERA DE MODO OBSERVACIÓN
// -----------------------------------------------------------------------------

/** Lo que vive en `plataforma/prepago`. Ausente = todo apagado. */
export interface PlataformaPrepago {
  corteActivo?: unknown;
}

/**
 * ¿Un corte calculado SE APLICA a esta cuenta? Solo si tiene modalidad (una
 * demostración no se corta nunca, ni con la bandera encendida) y si la bandera
 * global o la del tenant están encendidas. Un `corteActivo: false` por tenant
 * NO exime: la exención es la modalidad. La lista de excepciones es una sola.
 */
export function corteAplicable(
  cuenta: CuentaCruda | null | undefined,
  plataforma: PlataformaPrepago | Record<string, unknown> | null | undefined,
): boolean {
  if (modalidadDe(cuenta) === 'demostracion') return false;
  const global = (plataforma as PlataformaPrepago | null | undefined)?.corteActivo === true;
  return global || cuenta?.corteActivo === true;
}

// -----------------------------------------------------------------------------
// ESTADO DEL SERVICIO — la decisión que corta o deja pasar
// -----------------------------------------------------------------------------

/** 48 horas de gracia desde las 00:00 de Bolivia del día 1 sin cobertura. */
export const GRACIA_MS = 48 * 3_600_000;

export type Fase = 'cubierto' | 'gracia' | 'cortado';

export interface EstadoServicio {
  operativo: boolean;
  motivo: MotivoCorte | null;
  /** `cubierto` (mes pagado o de prueba), `gracia` (48 h después de vencer), `cortado`. */
  fase: Fase;
  /** Hasta cuándo dura la gracia, en milisegundos; `null` fuera de la gracia. */
  graciaHasta: number | null;
  /**
   * `true` si la cuenta tiene modalidad pero su período (`periodoPagado`, o
   * `periodoPrueba` en prueba) está PRESENTE Y MAL FORMADO (`'2026-9'`, un
   * Timestamp, `null`). Es un dato corrupto o a medio migrar, no un impago:
   * se falla hacia ATENDER (operativo, sin motivo) y la ingesta lo deja en la
   * auditoría, una vez por cuenta. Revisión de seguridad de A-0, 20/09.
   */
  incoherente: boolean;
  /** Desde cuándo rige (o regiría) el corte por falta de pago; `null` si no hay. */
  corteDesdeMs: number | null;
  modalidad: Modalidad;
  plan: IdPlanVendible;
  /** Mes calendario de Bolivia del instante juzgado (`aaaa-mm`). */
  periodo: string;
  /** ¿El mes que rige es el de prueba? */
  enPrueba: boolean;
  /** ¿Este mes está pagado (o es de prueba, o es demostración)? */
  cubierto: boolean;
  /** Último mes cubierto por pago o prueba; `''` si ninguno. */
  cubiertoHasta: string;
  incluidas: number;
  consumidas: number;
  restanteDelPlan: number;
  bolsa: number;
  bolsaPrueba: number;
  /** Lo que se puede abrir todavía este mes: plan restante + bolsas vigentes. */
  disponibles: number;
  /** Precio del plan en DÓLARES. El importe en bolivianos es derivado. */
  mensualidadUsd: number;
}

/** Conversaciones consumidas en el mes, leídas del agregado de métricas. */
export function consumidasDe(metricas: Record<string, unknown> | undefined): number {
  // `atenciones` es el nombre viejo del mismo número; se tolera para no perder
  // los meses ya escritos con ese nombre.
  return entero(metricas?.['conversaciones'] ?? metricas?.['atenciones']);
}

/**
 * Los campos de período de la cuenta que están PRESENTES y mal formados:
 * `periodoPagado` en prepago o prueba, `periodoPrueba` en prueba. Ausente
 * (`undefined`) no cuenta; `null` sí. Vacía si todo está bien o no hay modalidad.
 */
export function periodosIncoherentes(
  cuenta: CuentaCruda | null | undefined,
): ('periodoPagado' | 'periodoPrueba' | 'pruebaDesde')[] {
  const c = cuenta ?? {};
  const modalidad = modalidadDe(c);
  if (modalidad === 'demostracion') return [];
  const malos: ('periodoPagado' | 'periodoPrueba' | 'pruebaDesde')[] = [];
  if (c.periodoPagado !== undefined && !esPeriodo(c.periodoPagado)) malos.push('periodoPagado');
  if (modalidad === 'prueba' && c.periodoPrueba !== undefined && !esPeriodo(c.periodoPrueba)) malos.push('periodoPrueba');
  // El inicio de una prueba extendida: presente, tiene que ser un mes y no
  // posterior al último. Si no, alguien escribió mal la cuenta: se atiende y
  // se anota, como con los otros dos (nunca se corta sobre un dato roto).
  if (modalidad === 'prueba' && c.pruebaDesde !== undefined
      && !(esPeriodo(c.pruebaDesde) && esPeriodo(c.periodoPrueba) && c.pruebaDesde <= c.periodoPrueba)) {
    malos.push('pruebaDesde');
  }
  return malos;
}

/**
 * EL PRIMER MES DE LA PRUEBA: `pruebaDesde` si la prueba se extendió, o el
 * propio `periodoPrueba` si es de un solo mes. `''` si no hay prueba. Asume
 * una cuenta coherente (`periodosIncoherentes` vacío).
 */
export function inicioDePrueba(cuenta: CuentaCruda | null | undefined): string {
  const hasta = esPeriodo(cuenta?.periodoPrueba) ? cuenta.periodoPrueba : '';
  if (hasta === '') return '';
  const desde = cuenta?.pruebaDesde;
  return esPeriodo(desde) && desde <= hasta ? desde : hasta;
}

/**
 * Decide el estado del servicio de una cuenta en un instante.
 *
 * `consumidas` son las conversaciones del mes según el agregado
 * `metricas/{periodoDe()}` (mes UTC): las lee quien llama, con la misma
 * lectura que el aviso del 80 %. `ahoraMs` es el instante a juzgar: la
 * cobertura y la gracia se deciden contra él, nunca contra un mes.
 */
export function estadoDeServicio(
  cuenta: CuentaCruda | null | undefined,
  consumidas: number,
  ahoraMs: number,
): EstadoServicio {
  const c = cuenta ?? {};
  const plan: IdPlanVendible = esPlanVendible(c.plan) ? c.plan : PLAN_POR_DEFECTO;
  const modalidad = modalidadDe(c);
  const periodo = mesBolivia(ahoraMs);
  const periodoPagado = esPeriodo(c.periodoPagado) ? c.periodoPagado : '';
  const periodoPrueba = esPeriodo(c.periodoPrueba) ? c.periodoPrueba : '';
  const desdePrueba = inicioDePrueba(c);
  const bolsa = entero(c.bolsa);
  // La bolsa de prueba TAL CUAL está escrita: la de lista (20) o la fijada
  // por contrato (`--bolsa-prueba`, F1b). No se recorta ni se completa acá.
  const bolsaPrueba = entero(c.bolsaPrueba);
  const usadas = entero(consumidas);
  // La mensualidad que rige: la del contrato si la cuenta tiene una
  // (`precioPorContrato`, F1b), si no la del plan. Que una demostración no
  // pague lo decide la modalidad (abajo: `mensualidadUsd: 0`), no un precio cero.
  const precio = precioMensualDe(c as Record<string, unknown>, plan);

  const base = {
    modalidad, plan, periodo, bolsa, bolsaPrueba, consumidas: usadas,
    graciaHasta: null as number | null, corteDesdeMs: null as number | null, incoherente: false,
  };

  if (modalidad === 'demostracion') {
    return {
      ...base, operativo: true, motivo: null, fase: 'cubierto', enPrueba: false, cubierto: true,
      cubiertoHasta: '', incluidas: 0, restanteDelPlan: 0, disponibles: Number.POSITIVE_INFINITY,
      mensualidadUsd: 0,
    };
  }

  // UN PERÍODO PRESENTE Y MAL FORMADO NO ES UN IMPAGO. Ausente significa «nunca
  // pagó» y se juzga como tal; presente con basura significa que alguien
  // escribió mal la cuenta, y sobre eso no se corta a nadie: se atiende, y
  // quien llama lo anota para que NovuChat lo corrija.
  if (periodosIncoherentes(c).length > 0) {
    return {
      ...base, operativo: true, motivo: null, fase: 'cubierto', enPrueba: false, cubierto: true,
      cubiertoHasta: '', incluidas: 0, restanteDelPlan: 0, disponibles: Number.POSITIVE_INFINITY,
      mensualidadUsd: precio, incoherente: true,
    };
  }

  // COBERTURA POR INSTANTES. Un pago cubre hasta el último instante del mes
  // pagado; la prueba cubre de su primer mes (`pruebaDesde`, o el mismo
  // `periodoPrueba`) al último, y solo en modalidad prueba.
  const pagado = periodoPagado !== '' && ahoraMs <= finDelPeriodoMs(periodoPagado);
  const pruebaVigente = modalidad === 'prueba' && periodoPrueba !== ''
    && ahoraMs >= inicioDelPeriodoMs(desdePrueba) && ahoraMs <= finDelPeriodoMs(periodoPrueba);
  const cubierto = pagado || pruebaVigente;
  const cubiertoHasta = [periodoPagado, modalidad === 'prueba' ? periodoPrueba : '']
    .filter(Boolean).sort().pop() ?? '';

  // LA GRACIA: 48 horas desde las 00:00 de Bolivia del día 1 del primer mes
  // sin cobertura. Solo existe si ALGÚN mes estuvo cubierto: una cuenta que
  // nunca pagó no tiene de qué vencer.
  const mesSinCobertura = cubiertoHasta === '' ? '' : periodoSiguiente(cubiertoHasta);
  const finGraciaMs = mesSinCobertura === '' ? null : inicioDelPeriodoMs(mesSinCobertura) + GRACIA_MS;
  const enGracia = !cubierto && finGraciaMs !== null && ahoraMs < finGraciaMs
    && ahoraMs >= inicioDelPeriodoMs(mesSinCobertura);

  if (!cubierto && !enGracia) {
    // No pagó y la gracia pasó (o nunca pagó): se corta. Las bolsas se
    // conservan para cuando pague, pero no sostienen el servicio solas: la
    // regla es «sin mensualidad no hay servicio», y una bolsa es un extra
    // sobre un plan, no un plan.
    return {
      ...base, operativo: false, motivo: 'sin_pago', fase: 'cortado', enPrueba: false,
      cubierto: false, cubiertoHasta, incluidas: 0, restanteDelPlan: 0, disponibles: 0,
      corteDesdeMs: finGraciaMs,
      mensualidadUsd: precio,
    };
  }

  // El mes que rige: el actual si está cubierto; el que venció, si estamos en
  // su gracia (la gracia extiende ESA cobertura dos días).
  const mesQueRige = cubierto ? periodo : cubiertoHasta;
  const enPrueba = modalidad === 'prueba' && periodoPrueba !== ''
    && mesQueRige >= desdePrueba && mesQueRige <= periodoPrueba;
  const incluidas = enPrueba ? 0 : limitesDeCuenta(c as Record<string, unknown>).conversaciones;
  const restanteDelPlan = Math.max(0, incluidas - usadas);
  // Las bolsas compradas valen siempre; la de prueba, solo en el mes de prueba.
  const disponibles = restanteDelPlan + bolsa + (enPrueba ? bolsaPrueba : 0);
  const operativo = disponibles > 0;

  return {
    ...base, enPrueba, cubierto, cubiertoHasta, incluidas, restanteDelPlan, disponibles,
    operativo,
    motivo: operativo ? null : 'sin_conversaciones',
    fase: !operativo ? 'cortado' : enGracia ? 'gracia' : 'cubierto',
    graciaHasta: enGracia ? finGraciaMs : null,
    mensualidadUsd: enPrueba ? 0 : precio,
  };
}

/**
 * Qué rechaza el prepago ante UN mensaje. `sin_pago` rechaza todo;
 * `sin_conversaciones` rechaza solo lo que ABRIRÍA una conversación: una
 * ventana ya abierta se atiende hasta el final, porque ya se pagó.
 */
export function rechazoPorPrepago(
  motivo: MotivoCorte | null, abreConversacion: boolean,
): MotivoCorte | null {
  if (motivo === 'sin_pago') return 'sin_pago';
  if (motivo === 'sin_conversaciones' && abreConversacion) return 'sin_conversaciones';
  return null;
}

/**
 * Qué descuenta ABRIR una conversación nueva, y si con ella se acaba el saldo.
 *
 * El orden es: primero las incluidas del mes (no se descuentan de ningún lado,
 * las cuenta el agregado de métricas), después la bolsa de prueba si es el mes
 * de prueba, después las bolsas compradas. Lo comprado se gasta al final para
 * que una bolsa no se consuma mientras el plan todavía tiene conversaciones.
 */
export function consumoDeConversacion(estado: EstadoServicio): {
  campoBolsa: 'bolsa' | 'bolsaPrueba' | null;
  cortaDespues: boolean;
} {
  if (estado.modalidad === 'demostracion' || estado.incoherente || !estado.operativo) {
    return { campoBolsa: null, cortaDespues: false };
  }
  const campoBolsa = estado.restanteDelPlan > 0 ? null
    : estado.enPrueba && estado.bolsaPrueba > 0 ? 'bolsaPrueba'
    : estado.bolsa > 0 ? 'bolsa'
    : null;
  return { campoBolsa, cortaDespues: estado.disponibles - 1 <= 0 };
}

// -----------------------------------------------------------------------------
// CAMPOS DERIVADOS — lo de `cuenta/estado` que NO se escribe a mano
// -----------------------------------------------------------------------------

export type EstadoPago = 'al_dia' | 'pendiente' | 'vencido' | 'sin_cargo';

export interface CamposDerivados {
  /** `sin_cargo` (demostración), `vencido` (sin pago), `pendiente` (gracia o cobro pendiente), `al_dia`. */
  estadoPago: EstadoPago;
  /** Fin del último mes cubierto, en milisegundos; `null` si no hay (se borra). */
  proximoVencimientoMs: number | null;
  /** Precio del plan en dólares. */
  montoMensual: number;
  moneda: typeof MONEDA_LISTA;
}

/**
 * Los campos de situación de pago de `cuenta/estado`, calculados y nunca
 * escritos a mano (§4undecies.2). Los escriben, junto con cada cambio de la
 * cuenta, la ingesta, `actualizarEstadoCuenta` y —en A-1— `aplicarPago`.
 *
 * `estadoPago` habla del PAGO, no del servicio: una cuenta que debe está
 * `vencido` aunque el corte esté en modo observación y el asistente siga
 * atendiendo. El corte guardado no se decide acá (no se borra por recalcular
 * derivados): lo borra la ingesta cuando ya no hay rechazo, y `aplicarPago`
 * al reactivar.
 */
export function camposDerivados(estado: EstadoServicio, cuenta: CuentaCruda | null | undefined): CamposDerivados {
  const pendiente = typeof cuenta?.pagoPendienteId === 'string' && cuenta.pagoPendienteId !== '';
  const estadoPago: EstadoPago = estado.modalidad === 'demostracion' ? 'sin_cargo'
    : estado.motivo === 'sin_pago' ? 'vencido'
    : estado.fase === 'gracia' || pendiente ? 'pendiente'
    : 'al_dia';
  return {
    estadoPago,
    proximoVencimientoMs: estado.modalidad === 'demostracion' || estado.cubiertoHasta === ''
      ? null : finDelPeriodoMs(estado.cubiertoHasta),
    montoMensual: estado.modalidad === 'demostracion' ? 0 : estado.mensualidadUsd,
    moneda: MONEDA_LISTA,
  };
}

// -----------------------------------------------------------------------------
// PAGOS — lo que cambia en la cuenta cuando entra plata
// -----------------------------------------------------------------------------

export type Pago =
  | { tipo: 'mensualidad'; plan: IdPlanVendible; meses: number }
  | { tipo: 'bolsa'; cantidad: number }
  | { tipo: 'instalacion' };

const enteroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** ¿Es un pago bien formado? Meses 1..6, bolsas 1..12, plan del catálogo vendible. */
export function esPago(v: unknown): v is Pago {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p['tipo'] === 'instalacion') return true;
  if (p['tipo'] === 'bolsa') return enteroEntre(p['cantidad'], 1, BOLSAS_MAXIMO);
  if (p['tipo'] === 'mensualidad') {
    return esPlanVendible(p['plan']) && enteroEntre(p['meses'], 1, MESES_MAXIMO);
  }
  return false;
}

function exigirPago(pago: Pago): void {
  if (!esPago(pago)) throw new Error('pago invalido');
}

/**
 * Lo que cuesta un pago, EN DÓLARES. El importe en bolivianos es derivado.
 *
 * LA MENSUALIDAD SE COBRA AL PRECIO DE LA CUENTA (F1b): con `cuenta`, es
 * `precioMensualDe(cuenta, plan)` por los meses —el del contrato si la cuenta
 * tiene `precioPorContrato`, si no el del plan pedido—. Sin `cuenta` es el de
 * lista, que es lo que dice el catálogo y nada más: TODO QUIEN COBRA le pasa
 * la cuenta (`crearCobroInterno`, `registrarPagoManual`, las vistas previas
 * de Pagar y de Negocios). La bolsa y la instalación son siempre de lista: el
 * contrato pacta la mensualidad, no el excedente.
 */
export function montoUsdDe(pago: Pago, cuenta?: CuentaCruda | Record<string, unknown> | null): number {
  exigirPago(pago);
  if (pago.tipo === 'instalacion') return INSTALACION_USD;
  if (pago.tipo === 'bolsa') return BOLSA.precioUsd * pago.cantidad;
  const precio = cuenta === undefined ? PLANES[pago.plan].precioUsd : precioMensualDe(cuenta as Record<string, unknown> | null, pago.plan);
  return aCentavos(precio * pago.meses);
}

/**
 * ¿UN PAGO DE MENSUALIDAD QUEDÓ FUERA DE CONTRATO? Verdadero si su importe en
 * dólares (`montoUsd`, el que se fijó al emitirlo) no es el que la cuenta
 * cobraría HOY por ese mismo pedido (`montoUsdDe(pedido, cuenta)`). Es la
 * definición de «un precio fuera de contrato se rechaza» (F1b):
 *
 *  - un QR de mensualidad emitido a USD 50 cuando la cuenta ya tiene un
 *    contrato de USD 120 (o al revés) NO se acredita solo al confirmarlo el
 *    banco: queda en revisión (`precio_distinto`) para el propietario, como un
 *    plan distinto (`cobroPrepago.ts`);
 *  - y un precio por contrato no se cambia mientras haya una mensualidad
 *    pendiente que quedaría así (`actualizarEstadoCuenta`, `asignar-plan.mjs`).
 *
 * Una bolsa o una instalación nunca lo están: son de lista. Un pago sin
 * `montoUsd` numérico (anterior al campo) no se juzga: no hay con qué.
 * Tolera medio centavo de redondeo.
 */
export function montoFueraDeContrato(
  pago: Record<string, unknown> | null | undefined, cuenta: CuentaCruda | Record<string, unknown> | null | undefined,
): boolean {
  if (!pago || pago['tipo'] !== 'mensualidad') return false;
  const pedido = { tipo: 'mensualidad', plan: pago['plan'], meses: pago['meses'] };
  if (!esPago(pedido)) return false;
  const guardado = pago['montoUsd'];
  if (typeof guardado !== 'number' || !Number.isFinite(guardado)) return false;
  return Math.abs(guardado - montoUsdDe(pedido, cuenta ?? {})) > 0.005;
}

export function descripcionDe(pago: Pago): string {
  exigirPago(pago);
  if (pago.tipo === 'instalacion') return 'Instalación';
  if (pago.tipo === 'bolsa') {
    return pago.cantidad === 1
      ? `Bolsa de ${BOLSA.conversaciones} conversaciones`
      : `${pago.cantidad} bolsas de ${BOLSA.conversaciones} conversaciones`;
  }
  return `${PLANES[pago.plan].nombre} · ${pago.meses === 1 ? '1 mes' : `${pago.meses} meses`}`;
}

export interface CuentaTrasPago {
  plan: IdPlanVendible;
  modalidad: Modalidad;
  periodoPagado: string;
  bolsa: number;
  /** Último mes que queda cubierto después de este pago. */
  cubiertoHasta: string;
}

/**
 * Aplica un pago a la cuenta. PURA: devuelve los campos nuevos, no escribe.
 *
 * LA REGLA DEL MES QUE CUBRE UNA MENSUALIDAD: cubre el mes en curso si no
 * estaba cubierto (también si está en gracia o cortado); si ya lo estaba
 * (pagado o de prueba), cubre el siguiente. Así un cliente cortado el 5 de
 * octubre que paga queda cubierto para octubre; y uno que paga el 25 de
 * septiembre con septiembre ya pagado, queda cubierto para octubre. Nunca se
 * le cobra un mes que ya pasó ni se le regala uno.
 *
 * UN PAGO SOLO REGISTRA EL DINERO: NO CAMBIA LA MODALIDAD (decisión de
 * Andres del 26/09/2026, opción B, en la revisión del PR #212). Hasta ese día
 * una mensualidad o una bolsa convertían la cuenta en prepago «sea cual fuera
 * su modalidad anterior», y el pago era el acto que terminaba la prueba; con
 * eso, una bolsa comprada en demostración dejaba la cuenta en producción y
 * vencida. Ahora la modalidad la cambia SOLO el propietario (Negocios,
 * `actualizarEstadoCuenta`): una cuenta en prueba que paga sigue en prueba
 * —con los meses pagados sumando cobertura en `estadoDeServicio`, que ya los
 * cuenta en esa modalidad— hasta que NovuChat la pase a producción. Una
 * cuenta en demostración no emite cobros (`crearCobroInterno`).
 *
 * La mensualidad fija el plan (`plan: pago.plan`), pero QUIÉN puede pedir
 * otro plan lo decide el servidor antes de cobrar (`planQuePuedePedir`) y al
 * aplicar (`aplicarEstadoDelCobrador`). La bolsa y la instalación devuelven el
 * plan que rige para calcular, y NO lo fijan: `aplicacionDe` (`pagos.ts`)
 * solo escribe el plan de una mensualidad. AL PAGAR 6 MESES (el tope) se suma
 * una bolsa de regalo (`Analisis/36` §2.2). Más de 6 no se aplica: lanza.
 * La instalación no cambia nada de la cuenta.
 */
export function aplicarPago(cuenta: CuentaCruda | null | undefined, pago: Pago, ahoraMs: number): CuentaTrasPago {
  exigirPago(pago);
  const estado = estadoDeServicio(cuenta, 0, ahoraMs);
  const periodoPagado = esPeriodo(cuenta?.periodoPagado) ? cuenta.periodoPagado : '';

  if (pago.tipo === 'instalacion') {
    return {
      plan: estado.plan, modalidad: estado.modalidad, periodoPagado, bolsa: estado.bolsa,
      cubiertoHasta: estado.cubiertoHasta,
    };
  }

  if (pago.tipo === 'bolsa') {
    return {
      plan: estado.plan,
      modalidad: estado.modalidad,
      periodoPagado,
      bolsa: estado.bolsa + BOLSA.conversaciones * pago.cantidad,
      cubiertoHasta: estado.cubiertoHasta,
    };
  }

  const cubiertoAhora = estado.cubierto && estado.modalidad !== 'demostracion';
  const ultimoCubierto = cubiertoAhora
    ? (estado.cubiertoHasta >= estado.periodo ? estado.cubiertoHasta : estado.periodo)
    : periodoAnterior(estado.periodo);
  const nuevo = sumarMeses(ultimoCubierto, pago.meses);
  return {
    plan: pago.plan,
    modalidad: estado.modalidad,
    periodoPagado: nuevo,
    bolsa: estado.bolsa + (pago.meses === MESES_MAXIMO ? BOLSA.conversaciones : 0),
    cubiertoHasta: nuevo,
  };
}

// -----------------------------------------------------------------------------
// LA PRUEBA POR CONTRATO — su último mes y su bolsa, fijados por NovuChat
// -----------------------------------------------------------------------------

/** Lo que se pide sobre la prueba de una cuenta. Ausente = no se toca. */
export interface PedidoDePrueba {
  /** La modalidad pedida EN LA MISMA operación, si viene: decide si la cuenta queda en prueba. */
  modalidad?: Modalidad;
  /**
   * El ÚLTIMO mes de la prueba (`aaaa-mm`): la fija o la extiende. `null` la
   * borra, y solo si la cuenta NO queda en prueba.
   */
  periodoPrueba?: string | null;
  /** Las conversaciones de prueba que quedan, 1 a `BOLSA_PRUEBA_MAXIMA`. */
  bolsaPrueba?: number;
}

export type CampoDePrueba = 'periodoPrueba' | 'pruebaDesde' | 'bolsaPrueba';
/** Lo que cambia: el valor nuevo, o `null` = borrar el campo. Solo las claves que cambian. */
export type PruebaNueva = Partial<Record<CampoDePrueba, string | number | null>>;

/** Un pedido sobre la prueba que no se acepta. El mensaje se muestra tal cual. */
export class PruebaInvalida extends Error {}

/**
 * LA PRUEBA QUE QUEDA DESPUÉS DE UN PEDIDO. PURA: la usan
 * `actualizarEstadoCuenta` (Negocios) y `asignar-plan.mjs`
 * (`--modalidad prueba`, `--periodo-prueba`, `--bolsa-prueba`), para que las
 * dos puertas decidan igual. Lanza `PruebaInvalida` con el motivo.
 *
 * LAS REGLAS (F1b, Andres, 26/09/2026):
 *
 *  1. `periodoPrueba` y `bolsaPrueba` SOLO VALEN CON MODALIDAD PRUEBA (la que
 *     queda después de la operación): en producción o en demostración no
 *     significan nada, y escribirlos dejaría un dato que alguien leería como
 *     vigente.
 *  2. `periodoPrueba` NO PUEDE SER UN MES PASADO: una prueba que ya terminó
 *     no se «fija», se cortaría en el acto.
 *  3. FIJAR O EXTENDER CUBRE SIN HUECOS. `periodoPrueba` es el ÚLTIMO mes; el
 *     primero es el de la prueba vigente si la cuenta ya estaba en prueba y
 *     empezó antes, o el mes en curso. Hasta F1b la prueba era un solo mes:
 *     llevarla de septiembre a octubre el 26/09 dejaba sin cobertura del 27
 *     al 30. Cuando el primero y el último difieren se escribe `pruebaDesde`;
 *     si coinciden, se borra (la prueba de un mes queda como siempre).
 *  4. LA BOLSA NO SE REINICIA SOLA al extender: sigue la que quedaba, salvo
 *     que se pida (`bolsaPrueba`). Si la cuenta no tenía una, nace con la de
 *     lista (`PRUEBA.conversaciones`) o con la pedida.
 *  5. Pasar a prueba SIN período (lo de siempre): el mes en curso con la bolsa
 *     de lista (o la pedida). Si ya tenía un período, no se toca.
 *  6. Borrar el período (`null`) de una cuenta que queda en prueba se rechaza:
 *     quedaría incoherente y `estadoDeServicio` la atendería sin límite.
 */
export function pruebaNueva(
  cuenta: CuentaCruda | Record<string, unknown> | null | undefined, pedido: PedidoDePrueba, ahoraMs: number,
): PruebaNueva {
  const c = (cuenta ?? {}) as CuentaCruda & Record<string, unknown>;
  const modalidad = pedido.modalidad ?? modalidadDe(c);
  const mes = mesBolivia(ahoraMs);
  const salida: PruebaNueva = {};
  const poner = (k: CampoDePrueba, v: string | number) => { if (c[k] !== v) salida[k] = v; };
  const borrar = (k: CampoDePrueba) => { if (c[k] !== undefined) salida[k] = null; };

  if (pedido.bolsaPrueba !== undefined) {
    if (!bolsaPruebaValida(pedido.bolsaPrueba)) {
      throw new PruebaInvalida(`bolsaPrueba tiene que ser un entero de 1 a ${BOLSA_PRUEBA_MAXIMA}.`);
    }
    if (modalidad !== 'prueba') {
      throw new PruebaInvalida('La bolsa de prueba solo vale con modalidad prueba: pase la cuenta a prueba en la misma operación.');
    }
  }

  if (pedido.periodoPrueba === null) {
    if (modalidad === 'prueba') throw new PruebaInvalida('Una cuenta en prueba necesita su periodoPrueba.');
    borrar('periodoPrueba');
    borrar('pruebaDesde');
  } else if (pedido.periodoPrueba !== undefined) {
    const hasta = pedido.periodoPrueba;
    if (!esPeriodo(hasta)) throw new PruebaInvalida('periodoPrueba inválido: aaaa-mm.');
    if (modalidad !== 'prueba') {
      throw new PruebaInvalida('El período de prueba solo vale con modalidad prueba: pase la cuenta a prueba en la misma operación.');
    }
    if (hasta < mes) {
      throw new PruebaInvalida(`periodoPrueba no puede ser un mes pasado (${hasta}): el mes en curso es ${mes}.`);
    }
    // El primer mes: el de la prueba vigente, si la cuenta YA estaba en
    // prueba y empezó antes; si no, el mes en curso. Nunca un mes futuro:
    // entre hoy y el primer mes la cuenta quedaría sin cobertura.
    const inicioVigente = modalidadDe(c) === 'prueba' && periodosIncoherentes(c).length === 0 ? inicioDePrueba(c) : '';
    const desde = inicioVigente !== '' && inicioVigente <= mes ? inicioVigente : mes;
    poner('periodoPrueba', hasta);
    if (desde < hasta) poner('pruebaDesde', desde); else borrar('pruebaDesde');
    if (pedido.bolsaPrueba === undefined && typeof c.bolsaPrueba !== 'number') poner('bolsaPrueba', PRUEBA.conversaciones);
  } else if (pedido.modalidad === 'prueba' && !esPeriodo(c.periodoPrueba)) {
    poner('periodoPrueba', mes);
    borrar('pruebaDesde');
    poner('bolsaPrueba', pedido.bolsaPrueba ?? PRUEBA.conversaciones);
  }

  if (pedido.bolsaPrueba !== undefined) poner('bolsaPrueba', pedido.bolsaPrueba);
  return salida;
}

/** Los tres campos de la prueba como están, para la auditoría («antes»). */
export function pruebaActual(cuenta: CuentaCruda | Record<string, unknown> | null | undefined): Record<CampoDePrueba, unknown> {
  const c = (cuenta ?? {}) as Record<string, unknown>;
  return {
    periodoPrueba: c['periodoPrueba'] ?? null, pruebaDesde: c['pruebaDesde'] ?? null, bolsaPrueba: c['bolsaPrueba'] ?? null,
  };
}

// -----------------------------------------------------------------------------
// RECORDATORIOS — cuándo hay que escribirle al comercio, y con qué plantilla
// -----------------------------------------------------------------------------

/**
 * Los recordatorios salen por PLANTILLA de WhatsApp desde el número de
 * NovuChat: es el único camino para escribirle a alguien fuera de la ventana
 * de 24 horas. Los nombres, las variables y los cuerpos son los de
 * `docs/plantillas-cobranza.md` (bloque A-5), que es lo que se presenta a
 * Meta; acá se repiten para que `pruebas/prepago.test.ts` vigile el voseo y
 * la cantidad de variables sin leer un documento. Si cambian allá, cambian acá.
 *
 * TODOS SON EL ESTADO DE UNA CUENTA QUE YA EXISTE (categoría de utilidad): sin
 * invitación, sin promoción, sin urgencia comercial. Y todos empujan con lo
 * mismo, que es lo que decidió Silvana: los clientes del negocio están
 * escribiendo y no reciben atención. Es el argumento que mueve a pagar, no
 * la deuda.
 */
export const PLANTILLAS = {
  vencePronto: {
    nombre: 'mensualidad_vence_pronto',
    variables: ['fechaVencimiento', 'importeBs', 'plan', 'periodo'] as const,
    cuerpo:
      'Tu mensualidad de NovuChat vence el {{1}}. El QR de este mensaje la renueva: Bs {{2}}, ' +
      'plan {{3}}, por {{4}}. Al confirmarse el pago en el banco, tu cuenta queda cubierta y no ' +
      'hace falta que avises.',
  },
  venceManana: {
    nombre: 'mensualidad_vence_manana',
    variables: ['fechaManana', 'importeBs', 'plan', 'periodo'] as const,
    cuerpo:
      'Mañana, {{1}}, vence tu mensualidad de NovuChat. Con el QR de este mensaje tu asistente ' +
      'sigue atendiendo sin cortes: Bs {{2}}, plan {{3}}, por {{4}}.',
  },
  vencida: {
    nombre: 'mensualidad_vencida_gracia',
    variables: ['fechaHoy', 'importeBs', 'plan', 'periodo'] as const,
    cuerpo:
      'Tu mensualidad de NovuChat venció hoy, {{1}}. El asistente sigue atendiendo durante 48 ' +
      'horas más; pasado ese plazo deja de responder a tus clientes hasta que el banco confirme ' +
      'el pago. El QR de este mensaje la cubre: Bs {{2}}, plan {{3}}, por {{4}}.',
  },
  cortePago: {
    nombre: 'asistente_sin_atender',
    variables: ['fechaVencimiento', 'telefonoRecepcion', 'importeBs', 'plan', 'periodo'] as const,
    cuerpo:
      'Estado de tu cuenta de NovuChat: sin pago desde el {{1}}. Tu asistente dejó de atender a ' +
      'tus clientes; a quien escribe se le indica comunicarse con tu negocio al {{2}}. Al ' +
      'confirmarse el pago en el banco se reactiva solo, en menos de dos minutos. El QR de este ' +
      'mensaje la cubre: Bs {{3}}, plan {{4}}, por {{5}}.',
  },
  cortePago2: {
    nombre: 'asistente_sin_atender_perdidas',
    variables: ['perdidas', 'fechaVencimiento', 'importeBs', 'plan', 'periodo'] as const,
    cuerpo:
      'Desde el corte de tu cuenta de NovuChat, {{1}} clientes te escribieron y no fueron ' +
      'atendidos por el asistente. La cuenta sigue sin pago desde el {{2}}. El QR de este ' +
      'mensaje la reactiva en menos de dos minutos: Bs {{3}}, plan {{4}}, por {{5}}.',
  },
  sinConversaciones: {
    nombre: 'conversaciones_agotadas',
    variables: ['incluidas', 'plan', 'importeBolsaBs'] as const,
    cuerpo:
      'Tu cuenta de NovuChat usó las {{1}} conversaciones incluidas en tu plan {{2}} este mes. ' +
      'El asistente deja de responder a clientes nuevos hasta que se sume una bolsa o cambie el ' +
      'plan. El QR de este mensaje suma una bolsa de 30 conversaciones, que no vencen: Bs {{3}}, ' +
      'que son USD 10 al cambio oficial del día. Para cambiar de plan, toca el botón.',
  },
  conversion: {
    nombre: 'prueba_termina',
    variables: ['ultimoDiaPrueba'] as const,
    cuerpo:
      'Tu prueba de NovuChat termina el {{1}}. Hasta esa fecha el asistente atiende con ' +
      'normalidad; desde el día siguiente deja de responder a tus clientes salvo que tu cuenta ' +
      'tenga un plan activo. El plan se elige desde tu consola o respondiendo este mensaje.',
  },
  confirmacion: {
    nombre: 'pago_confirmado',
    variables: ['importeBs', 'plan', 'ultimoDiaCubierto'] as const,
    cuerpo:
      'Pago confirmado por el banco: Bs {{1}}, plan {{2}}. Tu cuenta de NovuChat queda cubierta ' +
      'hasta el {{3}}. No hace falta que hagas nada más.',
  },
} as const;

export type TipoRecordatorio = keyof typeof PLANTILLAS;

export interface Recordatorio {
  /** Identificador idempotente: si ya está en `cuenta.recordatorios`, no se repite. */
  clave: string;
  tipo: TipoRecordatorio;
  plantilla: string;
  parametros: string[];
  /** `true` si el mensaje lleva un importe y por lo tanto necesitó un TCO. */
  conImporte: boolean;
}

/** Cuántos días antes de D0 salen los dos avisos de renovación (D-5 y D-1). */
export const DIAS_AVISO_RENOVACION = { primero: 5, ultimo: 1 } as const;
/** Cuántos días después de D0 salen los dos avisos de corte (D+2 y D+4). */
export const DIAS_AVISO_CORTE = { primero: 2, segundo: 4 } as const;
/** Cuántos días antes del fin de la prueba sale el aviso de conversión. */
export const DIAS_AVISO_CONVERSION = 5;

/** El QR de un recordatorio cobra UN mes: es lo que dice la variable «período». */
export const PERIODO_RECORDATORIO = '1 mes';

export interface ContextoRecordatorio {
  /** TCO del BCB vigente, o `null` si no hay uno: sin él no salen los que llevan importe. */
  tco: number | null;
  /** Teléfono de recepción del comercio (`config/negocio.numeroRecepcion`). */
  numeroRecepcion: string;
}

/**
 * Decide qué recordatorios corresponden HOY a una cuenta. Devuelve solo los
 * que no figuran ya en `cuenta.recordatorios`: la función se puede llamar
 * cada hora sin mandar nada dos veces, y `recordatorioPrepagoEnviado` marca
 * ANTES de enviar.
 *
 * El calendario, con D0 = día 1 del mes sin cobertura (00:00 de Bolivia):
 *
 *  - PREPAGO cubierto y el mes que viene sin pagar: D-5 (`vencePronto`) y
 *    D-1 (`venceManana`). Si el barrido no corrió a tiempo y ya es D-1, sale
 *    solo el de D-1: dos avisos el mismo día son ruido.
 *  - PREPAGO en gracia: D0 (`vencida`), una vez.
 *  - PREPAGO cortado por falta de pago, durante el primer mes sin cobertura:
 *    D+2 (`cortePago`) y D+4 (`cortePago2`, con `perdidas`). Igual que arriba,
 *    en D+4 sale solo el segundo. Después del primer mes no sale nada más por
 *    WhatsApp: el D+30 es una baja comercial y va por correo (`Analisis/36` §3.1).
 *  - Sin conversaciones (con corte guardado por ese motivo): `sinConversaciones`,
 *    una vez por mes. No en prueba.
 *  - PRUEBA: SOLO el aviso de conversión, 5 días antes del fin de la prueba
 *    (decisión 5 del frente). Nada de lo anterior.
 *  - DEMOSTRACIÓN: nada, nunca.
 *
 * Los que llevan importe necesitan un TCO; sin él no se devuelven (quien
 * llama lo informa como `sinTipoCambio`), porque un recordatorio con un
 * importe inventado es peor que uno tarde.
 */
export function recordatoriosDebidos(
  cuenta: CuentaCruda | null | undefined,
  estado: EstadoServicio,
  ahoraMs: number,
  contexto: ContextoRecordatorio,
): Recordatorio[] {
  // Una cuenta incoherente no recibe cobranza: primero se corrige el dato.
  if (estado.modalidad === 'demostracion' || estado.incoherente) return [];
  const enviados = (typeof cuenta?.recordatorios === 'object' && cuenta.recordatorios !== null)
    ? cuenta.recordatorios as Record<string, unknown> : {};
  const debidos: Recordatorio[] = [];
  const mesActual = estado.periodo;
  const hoy = diaDelMes(ahoraMs);
  const diasHastaD0 = diasDelPeriodo(mesActual) - hoy + 1;
  const planNombre = PLANES[estado.plan].nombre;
  const tco = contexto.tco;
  // El importe de UN mes a la mensualidad que rige: la del contrato si la
  // cuenta tiene una (F1b), si no la del plan. No `estado.mensualidadUsd`: en
  // prueba vale 0 y el aviso tiene que decir lo que costará renovar.
  const precioBs = tco === null ? null : String(importeBs(precioMensualDe(cuenta as Record<string, unknown> | null, estado.plan), tco));
  const agregar = (tipo: TipoRecordatorio, clave: string, parametros: string[], conImporte: boolean) => {
    if (conImporte && precioBs === null) return;
    debidos.push({ clave, tipo, plantilla: PLANTILLAS[tipo].nombre, parametros, conImporte });
  };

  // --- PRUEBA: solo conversión --------------------------------------------
  if (estado.modalidad === 'prueba') {
    const periodoPrueba = esPeriodo(cuenta?.periodoPrueba) ? cuenta.periodoPrueba : '';
    // SOLO EN EL ÚLTIMO MES DE LA PRUEBA (F1b): `diasHastaD0` cuenta los días
    // que faltan para terminar el mes EN CURSO. Con una prueba extendida de
    // septiembre a octubre, sin esta condición el aviso «tu prueba termina el
    // 31 de octubre» salía el 26 de septiembre: una plantilla pagada que dice
    // la verdad en el momento equivocado.
    if (estado.enPrueba && estado.cubierto && periodoPrueba !== '' && periodoPrueba === mesActual
        && diasHastaD0 <= DIAS_AVISO_CONVERSION) {
      agregar('conversion', `conversion_${periodoPrueba}`, [fechaEscrita(finDelPeriodoMs(periodoPrueba))], false);
    }
    return debidos.filter((r) => !(r.clave in enviados));
  }

  // --- RENOVACIÓN (cubierto, el mes que viene sin pagar) --------------------
  if (estado.fase !== 'cortado' && estado.cubierto) {
    const siguiente = periodoSiguiente(mesActual);
    if (estado.cubiertoHasta < siguiente) {
      const d0 = inicioDelPeriodoMs(siguiente);
      const parametros = [fechaEscrita(d0), precioBs ?? '', planNombre, PERIODO_RECORDATORIO];
      if (diasHastaD0 <= DIAS_AVISO_RENOVACION.ultimo) {
        agregar('venceManana', `vence_manana_${siguiente}`, parametros, true);
      } else if (diasHastaD0 <= DIAS_AVISO_RENOVACION.primero) {
        agregar('vencePronto', `vence_pronto_${siguiente}`, parametros, true);
      }
    }
  }

  // --- D0: en gracia ---------------------------------------------------------
  if (estado.fase === 'gracia') {
    agregar('vencida', `vencida_${mesActual}`,
      [fechaEscrita(inicioDelPeriodoMs(mesActual)), precioBs ?? '', planNombre, PERIODO_RECORDATORIO], true);
  }

  // --- D+2 y D+4: cortado por falta de pago, solo el primer mes -------------
  const corte = corteDe(cuenta);
  if (estado.motivo === 'sin_pago' && estado.cubiertoHasta !== ''
      && periodoSiguiente(estado.cubiertoHasta) === mesActual) {
    const d0 = inicioDelPeriodoMs(mesActual);
    const diasDesdeD0 = hoy - 1;
    if (diasDesdeD0 >= DIAS_AVISO_CORTE.segundo) {
      agregar('cortePago2', `corte2_${mesActual}`,
        [String(corte?.motivo === 'sin_pago' ? corte.perdidas : 0), fechaEscrita(d0), precioBs ?? '',
          planNombre, PERIODO_RECORDATORIO], true);
    } else if (diasDesdeD0 >= DIAS_AVISO_CORTE.primero) {
      agregar('cortePago', `corte_${mesActual}`,
        [fechaEscrita(d0), contexto.numeroRecepcion.trim() || 'no indicado', precioBs ?? '',
          planNombre, PERIODO_RECORDATORIO], true);
    }
  }

  // --- Sin conversaciones ---------------------------------------------------
  if (estado.motivo === 'sin_conversaciones' && corte?.motivo === 'sin_conversaciones' && tco !== null) {
    agregar('sinConversaciones', `agotadas_${mesActual}`,
      [String(estado.incluidas), planNombre, String(importeBs(BOLSA.precioUsd, tco))], true);
  }

  // Lo más urgente primero: un corte antes que una renovación. Y nunca dos veces.
  const orden: Record<TipoRecordatorio, number> = {
    cortePago2: 0, cortePago: 0, sinConversaciones: 0, vencida: 1, venceManana: 2, vencePronto: 2,
    conversion: 3, confirmacion: 4,
  };
  return debidos
    .filter((r) => !(r.clave in enviados))
    .sort((a, b) => orden[a.tipo] - orden[b.tipo]);
}

// -----------------------------------------------------------------------------
// TEXTOS — lo que el comercio lee sobre su cuenta
// -----------------------------------------------------------------------------

/** Resumen de la cuenta en una o dos frases, para la consola y el WhatsApp interno. */
export function resumenDeCuenta(estado: EstadoServicio, nombreNegocio: string): string {
  const negocio = nombreNegocio.trim() || 'tu negocio';
  if (estado.modalidad === 'demostracion') {
    return `${negocio} está en modo demostración: sin mensualidad ni límite de conversaciones.`;
  }
  const planNombre = PLANES[estado.plan].nombre;
  const saldo = ` Quedan ${estado.disponibles} conversaciones este mes` +
    (estado.bolsa > 0 ? ` (${estado.bolsa} de bolsa)` : '') + '.';
  if (estado.motivo === 'sin_pago') {
    return `${negocio}: el asistente está detenido porque este mes no está pagado.` +
      (estado.cubiertoHasta ? ` Estuvo cubierto hasta el ${fechaFinDelPeriodo(estado.cubiertoHasta)}.` : '') +
      ' Al confirmarse el pago se reactiva solo.';
  }
  if (estado.motivo === 'sin_conversaciones') {
    return `${negocio}: el asistente está detenido porque se agotaron las conversaciones ` +
      `${estado.enPrueba ? 'de la prueba' : `del plan ${planNombre}`}. ` +
      `Una bolsa de ${BOLSA.conversaciones} lo reactiva al instante.`;
  }
  const hasta = estado.cubiertoHasta ? fechaFinDelPeriodo(estado.cubiertoHasta) : '';
  if (estado.fase === 'gracia') {
    return `${negocio}: la mensualidad venció el ${fechaFinDelPeriodo(estado.cubiertoHasta)} y el ` +
      `asistente sigue atendiendo hasta el ${fechaCorta(estado.graciaHasta ?? 0)}.${saldo}`;
  }
  return estado.enPrueba
    ? `${negocio} está en su mes de prueba hasta el ${hasta}.${saldo}`
    : `${negocio}: plan ${planNombre}, pagado hasta el ${hasta}.${saldo}`;
}

/**
 * VOSEO: español boliviano sin voseo (CLAUDE.md). Misma expresión que en
 * `scripts/cargar-plataforma.mjs`; se repite acá para poder probar los cuerpos
 * de las plantillas sin importar un script.
 */
export const VOSEO = new RegExp(
  '\\b(?:' +
    '(?:envi|mand|avis|confirm|mir|pas|dej|prob|escane|agend|reserv|llam|habl|cancel|eleg|pag|toc)á' +
    '|(?:respond|ten|hac|corr|volv|pon|le)é' +
    '|(?:ten|quer|pod|sab)és' +
  ')(?![a-záéíóúüñ])',
  'i',
);
