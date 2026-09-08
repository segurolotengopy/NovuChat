/**
 * =============================================================================
 * PREPAGO — planes, saldo de conversaciones, corte del servicio y recordatorios
 * =============================================================================
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO: no importa Firebase ni lee la red. Sobre lo
 * que decide acá se corta el servicio de un cliente y se le cobra, así que la
 * decisión tiene que poder probarse mes por mes sin emulador. Quien lo llama
 * —la ingesta, `configuracionFlujo`, las funciones de cobro— solo aplica lo que
 * esto decidió. Y lo importa TAMBIÉN la consola (`web/src/lib/prepago.ts`),
 * para que la pantalla y el servidor no puedan calcular dos saldos distintos.
 *
 * EL MODELO, EN CUATRO FRASES (decidido con Silvana el 2026-09-07):
 *
 *  1. El cliente es PREPAGO. Paga el mes calendario por adelantado y recibe una
 *     cantidad de conversaciones INCLUIDAS para ese mes. Lo que no usó, no se
 *     arrastra: el mes siguiente vuelve a empezar.
 *  2. Puede comprar BOLSAS de 150 conversaciones. Las bolsas NO vencen y se
 *     consumen recién cuando las incluidas del mes se acabaron.
 *  3. Si el 1 del mes no está pagado, se corta. Si se acabaron las
 *     conversaciones (incluidas + bolsas), se corta. Al cliente final le llega
 *     un mensaje FIJO y cordial que NO dice por qué.
 *  4. Un mes calendario de PRUEBA: sin mensualidad, con 20 conversaciones de
 *     prueba. Al agotarlas se corta; al terminar el mes, si no eligió un plan,
 *     se corta.
 *
 * LO QUE ESTO NO CAMBIA: los dos negocios de demostración. Una cuenta SIN
 * `modalidad` —o con `modalidad: 'demostracion'`— no está sujeta a nada de
 * esto y el asistente atiende siempre. Es deliberado: desplegar este módulo no
 * puede cortar un demo el día de la presentación. El prepago se enciende
 * negocio por negocio, al darlo de alta con su modalidad.
 *
 * LA UNIDAD ES LA CONVERSACIÓN, con la definición que ya tiene la facturación:
 * ventana fija de 24 horas por teléfono desde la primera consulta no cortés
 * (`ingesta.ts`, `HORAS_VENTANA_ATENCION`). Es el mismo número que el cliente
 * ve en «Consumo» y el mismo que usa `novuchat.site/precios`. No se inventa
 * otro acá.
 */

// -----------------------------------------------------------------------------
// LOS PLANES — los tres de la presentación comercial, ni uno más
// -----------------------------------------------------------------------------
// Son los de `Presentación NovuChat4.html`, diapositiva «Planes que escalan
// contigo». Son VALORES COMERCIALES: se cambian con Andres y Silvana, no en una
// revisión de código. Y se cambian ACÁ, en un solo lugar: la consola los lee de
// este módulo y no tiene su propia copia.
export const PLANES = {
  base: { nombre: 'Plan Base', mensualidad: 250, conversaciones: 300 },
  crecimiento: { nombre: 'Plan Crecimiento', mensualidad: 450, conversaciones: 1000 },
  corporativo: { nombre: 'Plan Corporativo', mensualidad: 850, conversaciones: 2500 },
} as const;
export type PlanId = keyof typeof PLANES;
export const PLAN_POR_DEFECTO: PlanId = 'base';

/** Paquete extra: 150 conversaciones por 50 Bs. No vence. */
export const BOLSA = { conversaciones: 150, precio: 50 } as const;

/** El mes de prueba: sin mensualidad y con esta bolsa. */
export const PRUEBA = { conversaciones: 20 } as const;

export const MONEDA = 'BOB';

export const MODALIDADES = ['demostracion', 'prueba', 'prepago'] as const;
export type Modalidad = (typeof MODALIDADES)[number];

export const esPlan = (v: unknown): v is PlanId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLANES, v);
export const esModalidad = (v: unknown): v is Modalidad =>
  typeof v === 'string' && (MODALIDADES as readonly string[]).includes(v);

/**
 * EL MENSAJE AL CLIENTE FINAL CUANDO EL SERVICIO ESTÁ CORTADO. Fijo, cordial y
 * NEUTRO: no dice si el negocio no pagó o se quedó sin conversaciones. Quien
 * escribe por WhatsApp es un tercero que no tiene nada que ver con la relación
 * comercial entre el negocio y NovuChat (prohibición de `DISENO.md` §4bis.3 y
 * amenaza T-18). Es el mismo texto que ya se usa para la suspensión manual, a
 * propósito: un solo mensaje, una sola cosa que revisar.
 */
export const MENSAJE_CORTESIA =
  'Gracias por escribirnos. En este momento no podemos atenderle por ' +
  'este medio. Le pedimos comunicarse directamente con el negocio.';

// -----------------------------------------------------------------------------
// PERÍODOS — meses calendario en Bolivia (UTC−4 fijo, sin horario de verano)
// -----------------------------------------------------------------------------
const CUATRO_HORAS = 4 * 3_600_000;
const PERIODO = /^(\d{4})-(\d{2})$/;

/** `aaaa-mm` del instante dado, en hora de Bolivia. */
export function periodoDe(ms: number): string {
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

/** Último instante del mes, en milisegundos (23:59:59 de Bolivia). */
export function finDelPeriodoMs(periodo: string): number {
  const [a, m] = partes(periodo);
  return Date.UTC(a, m, 0, 23, 59, 59) + CUATRO_HORAS;
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
  modalidad?: unknown;
  /** Último mes calendario PAGADO (`aaaa-mm`). Cubre ese mes y los anteriores. */
  periodoPagado?: unknown;
  /** El mes calendario de prueba (`aaaa-mm`). Sin mensualidad ese mes. */
  periodoPrueba?: unknown;
  /** Conversaciones compradas en bolsas y todavía no usadas. No vencen. */
  bolsa?: unknown;
  /** Conversaciones de prueba que quedan. Solo valen durante el mes de prueba. */
  bolsaPrueba?: unknown;
  corte?: unknown;
  recordatorios?: unknown;
  pagoPendienteId?: unknown;
}

export interface Corte {
  motivo: MotivoCorte;
  /** Milisegundos desde la época. Se guarda como Timestamp; acá viaja como número. */
  desdeMs: number;
  /** Mensajes de clientes finales que llegaron durante el corte y no se atendieron. */
  perdidas: number;
}

export type MotivoCorte = 'sin_pago' | 'sin_conversaciones';

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

/** Lee el corte guardado, o `null` si no hay ninguno coherente. */
export function corteDe(cuenta: CuentaCruda): Corte | null {
  const c = cuenta.corte;
  if (typeof c !== 'object' || c === null) return null;
  const o = c as Record<string, unknown>;
  const motivo = o['motivo'];
  if (motivo !== 'sin_pago' && motivo !== 'sin_conversaciones') return null;
  return { motivo, desdeMs: aMs(o['desde']) ?? 0, perdidas: entero(o['perdidas']) };
}

// -----------------------------------------------------------------------------
// ESTADO DEL SERVICIO — la decisión que corta o deja pasar
// -----------------------------------------------------------------------------
export interface EstadoServicio {
  operativo: boolean;
  motivo: MotivoCorte | null;
  modalidad: Modalidad;
  plan: PlanId;
  periodo: string;
  /** ¿Este mes es el de prueba? */
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
  mensualidad: number;
}

/** Conversaciones consumidas en el mes, leídas del agregado de métricas. */
export function consumidasDe(metricas: Record<string, unknown> | undefined): number {
  // `atenciones` es el nombre viejo del mismo número; se tolera para no perder
  // los meses ya escritos con ese nombre.
  return entero(metricas?.['conversaciones'] ?? metricas?.['atenciones']);
}

export function estadoDeServicio(
  cuenta: CuentaCruda,
  consumidas: number,
  periodo: string,
): EstadoServicio {
  const plan: PlanId = esPlan(cuenta.plan) ? cuenta.plan : PLAN_POR_DEFECTO;
  // SIN MODALIDAD NO HAY PREPAGO. Es la salvaguarda de los demos y de cualquier
  // negocio cargado antes de este módulo: se atiende siempre.
  const modalidad: Modalidad = esModalidad(cuenta.modalidad) ? cuenta.modalidad : 'demostracion';
  const periodoPagado = esPeriodo(cuenta.periodoPagado) ? cuenta.periodoPagado : '';
  const periodoPrueba = esPeriodo(cuenta.periodoPrueba) ? cuenta.periodoPrueba : '';
  const bolsa = entero(cuenta.bolsa);
  const bolsaPrueba = entero(cuenta.bolsaPrueba);
  const usadas = entero(consumidas);

  const base = {
    modalidad, plan, periodo, bolsa, bolsaPrueba, consumidas: usadas,
    mensualidad: PLANES[plan].mensualidad,
  };

  if (modalidad === 'demostracion') {
    return {
      ...base, operativo: true, motivo: null, enPrueba: false, cubierto: true,
      cubiertoHasta: '', incluidas: 0, restanteDelPlan: 0, disponibles: Number.POSITIVE_INFINITY,
      mensualidad: 0,
    };
  }

  // El mes de prueba cubre SOLO ese mes. Un pago cubre hasta el mes pagado
  // inclusive: comparar `aaaa-mm` como texto es comparar fechas.
  const enPrueba = modalidad === 'prueba' && periodoPrueba === periodo;
  const pagado = periodoPagado !== '' && periodoPagado >= periodo;
  const cubierto = enPrueba || pagado;
  const cubiertoHasta = [periodoPagado, periodoPrueba].filter(Boolean).sort().pop() ?? '';

  if (!cubierto) {
    // No pagó el 1: se corta. Las bolsas se conservan para cuando pague, pero
    // no sostienen el servicio solas: la regla es «sin mensualidad no hay
    // servicio», y una bolsa es un extra sobre un plan, no un plan.
    return {
      ...base, operativo: false, motivo: 'sin_pago', enPrueba: false, cubierto: false,
      cubiertoHasta, incluidas: 0, restanteDelPlan: 0, disponibles: 0,
      mensualidad: modalidad === 'prueba' ? 0 : PLANES[plan].mensualidad,
    };
  }

  const incluidas = enPrueba ? 0 : PLANES[plan].conversaciones;
  const restanteDelPlan = Math.max(0, incluidas - usadas);
  // Las bolsas compradas valen siempre; la de prueba, solo en el mes de prueba.
  const disponibles = restanteDelPlan + bolsa + (enPrueba ? bolsaPrueba : 0);

  return {
    ...base, enPrueba, cubierto: true, cubiertoHasta, incluidas, restanteDelPlan, disponibles,
    operativo: disponibles > 0,
    motivo: disponibles > 0 ? null : 'sin_conversaciones',
    mensualidad: enPrueba ? 0 : PLANES[plan].mensualidad,
  };
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
  if (estado.modalidad === 'demostracion') return { campoBolsa: null, cortaDespues: false };
  const campoBolsa = estado.restanteDelPlan > 0 ? null
    : estado.enPrueba && estado.bolsaPrueba > 0 ? 'bolsaPrueba'
    : estado.bolsa > 0 ? 'bolsa'
    : null;
  return { campoBolsa, cortaDespues: estado.disponibles - 1 <= 0 };
}

// -----------------------------------------------------------------------------
// PAGOS — lo que cambia en la cuenta cuando entra plata
// -----------------------------------------------------------------------------
export type Pago =
  | { tipo: 'mensualidad'; plan: PlanId; meses: number }
  | { tipo: 'bolsa'; cantidad: number };

export function montoDe(pago: Pago): number {
  return pago.tipo === 'mensualidad'
    ? PLANES[pago.plan].mensualidad * Math.max(1, pago.meses)
    : BOLSA.precio * Math.max(1, pago.cantidad);
}

export function descripcionDe(pago: Pago): string {
  if (pago.tipo === 'bolsa') {
    const n = Math.max(1, pago.cantidad);
    return n === 1
      ? `Bolsa de ${BOLSA.conversaciones} conversaciones`
      : `${n} bolsas de ${BOLSA.conversaciones} conversaciones`;
  }
  const m = Math.max(1, pago.meses);
  return `${PLANES[pago.plan].nombre} · ${m === 1 ? '1 mes' : `${m} meses`}`;
}

export interface CuentaTrasPago {
  plan: PlanId;
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
 * estaba cubierto; si ya lo estaba (pagado o de prueba), cubre el siguiente.
 * Así un cliente cortado el 3 de octubre que paga, queda cubierto para octubre;
 * y uno que paga el 25 de septiembre con septiembre ya pagado, queda cubierto
 * para octubre. Nunca se le cobra un mes que ya pasó ni se le regala uno.
 *
 * Pagar una mensualidad convierte la cuenta en PREPAGO, sea cual fuera su
 * modalidad anterior: es el acto que termina la prueba. Y fija el plan: cambiar
 * de plan ES pagar el plan nuevo.
 */
export function aplicarPago(cuenta: CuentaCruda, pago: Pago, periodo: string): CuentaTrasPago {
  const estado = estadoDeServicio(cuenta, 0, periodo);
  const periodoPagado = esPeriodo(cuenta.periodoPagado) ? cuenta.periodoPagado : '';

  if (pago.tipo === 'bolsa') {
    return {
      plan: estado.plan,
      modalidad: estado.modalidad === 'demostracion' ? 'prepago' : estado.modalidad,
      periodoPagado,
      bolsa: estado.bolsa + BOLSA.conversaciones * Math.max(1, pago.cantidad),
      cubiertoHasta: estado.cubiertoHasta,
    };
  }

  const cubiertoAhora = estado.cubierto && estado.modalidad !== 'demostracion';
  const ultimoCubierto = cubiertoAhora
    ? (estado.cubiertoHasta >= periodo ? estado.cubiertoHasta : periodo)
    : periodoAnterior(periodo);
  const nuevo = sumarMeses(ultimoCubierto, Math.max(1, pago.meses));
  return {
    plan: pago.plan,
    modalidad: 'prepago',
    periodoPagado: nuevo,
    bolsa: estado.bolsa,
    cubiertoHasta: nuevo,
  };
}

// -----------------------------------------------------------------------------
// RECORDATORIOS — cuándo hay que escribirle al negocio, y con qué plantilla
// -----------------------------------------------------------------------------
/**
 * Los recordatorios salen por PLANTILLA de WhatsApp desde el número de NovuChat:
 * es el único camino para escribirle a alguien fuera de la ventana de 24 horas.
 * Los cuerpos de acá son los que hay que registrar en Meta con estos nombres y
 * con las variables en este orden; la aprobación de Meta tarda de horas a días
 * y es un paso manual (ver `Analisis/11-prepago-y-alta-de-clientes.md`).
 *
 * TODOS DICEN LO MISMO EN EL FONDO, porque es lo que decidió Silvana: los
 * clientes del negocio están escribiendo y no reciben atención. Es el argumento
 * que mueve a pagar, no la deuda.
 */
export const PLANTILLAS = {
  renovacion: {
    nombre: 'nc_renovacion_pendiente',
    variables: ['negocio', 'plan', 'fecha', 'monto'] as const,
    cuerpo:
      'Hola, te escribe NovuChat 👋 El servicio de {{1}} ({{2}}) vence el {{3}}. ' +
      'Si no renuevas antes del día 1, tu asistente deja de responder y tus clientes ' +
      'van a escribir sin recibir atención. Renovar cuesta Bs {{4}}: responde *pagar* ' +
      'y te mando el QR.',
  },
  cortePago: {
    nombre: 'nc_servicio_cortado',
    variables: ['negocio', 'fecha', 'perdidas'] as const,
    cuerpo:
      'Hola, te escribe NovuChat. El asistente de {{1}} está detenido desde el {{2}} ' +
      'porque el mes no está pagado. Desde entonces {{3}} mensajes de tus clientes ' +
      'quedaron sin atención. Responde *pagar* y lo reactivamos hoy mismo.',
  },
  corteConversaciones: {
    nombre: 'nc_sin_conversaciones',
    variables: ['negocio', 'plan', 'perdidas', 'precioBolsa'] as const,
    cuerpo:
      'Hola, te escribe NovuChat. {{1}} agotó las conversaciones de su {{2}} y el ' +
      'asistente dejó de responder: {{3}} mensajes de tus clientes quedaron sin ' +
      'atención. Responde *bolsa* para sumar 150 conversaciones por Bs {{4}} y ' +
      'seguir atendiendo.',
  },
} as const;

export type TipoRecordatorio = keyof typeof PLANTILLAS;

export interface Recordatorio {
  /** Identificador idempotente: si ya está en `cuenta.recordatorios`, no se repite. */
  clave: string;
  tipo: TipoRecordatorio;
  plantilla: string;
  parametros: string[];
}

/** Cuántos días antes del fin de mes salen los dos avisos de renovación. */
export const DIAS_AVISO_RENOVACION = [7, 2] as const;
/** Cuántos días después del corte por conversaciones sale el segundo aviso. */
export const DIAS_SEGUNDO_AVISO_CORTE = 2;

const DIA_MS = 86_400_000;

/**
 * Decide qué recordatorios corresponden HOY a una cuenta. Devuelve solo los que
 * no figuran ya en `cuenta.recordatorios`: la función se puede llamar dos veces
 * por día —el flujo corre a las 09:00 y a las 17:00— sin mandar nada dos veces.
 *
 *  - Renovación: dos avisos antes de fin de mes (a 7 y a 2 días), si el mes que
 *    viene no está pagado. Vale también para el mes de prueba: es el aviso de
 *    que hay que elegir un plan.
 *  - Corte por falta de pago: UN aviso, el día del corte.
 *  - Corte por conversaciones: uno al cortar y otro dos días después.
 */
export function recordatoriosDebidos(
  cuenta: CuentaCruda,
  estado: EstadoServicio,
  nombreNegocio: string,
  ahoraMs: number,
): Recordatorio[] {
  if (estado.modalidad === 'demostracion') return [];
  const enviados = (typeof cuenta.recordatorios === 'object' && cuenta.recordatorios !== null)
    ? cuenta.recordatorios as Record<string, unknown> : {};
  const debidos: Recordatorio[] = [];
  const negocio = nombreNegocio.trim() || 'tu negocio';
  const planNombre = estado.enPrueba ? 'mes de prueba' : PLANES[estado.plan].nombre;

  // --- Renovación ----------------------------------------------------------
  if (estado.cubierto) {
    const siguiente = periodoSiguiente(estado.periodo);
    const yaPagoElSiguiente = estado.cubiertoHasta >= siguiente;
    if (!yaPagoElSiguiente) {
      const restan = diasDelPeriodo(estado.periodo) - diaDelMes(ahoraMs);
      DIAS_AVISO_RENOVACION.forEach((dias, i) => {
        if (restan <= dias) {
          debidos.push({
            clave: `renovacion_${siguiente}_${i + 1}`,
            tipo: 'renovacion',
            plantilla: PLANTILLAS.renovacion.nombre,
            parametros: [
              negocio, planNombre, fechaFinDelPeriodo(estado.periodo),
              String(PLANES[estado.plan].mensualidad),
            ],
          });
        }
      });
    }
  }

  // --- Cortes ----------------------------------------------------------------
  const corte = corteDe(cuenta);
  if (estado.motivo === 'sin_pago') {
    debidos.push({
      clave: `corte_pago_${estado.periodo}`,
      tipo: 'cortePago',
      plantilla: PLANTILLAS.cortePago.nombre,
      parametros: [
        negocio, fechaCorta(corte?.desdeMs || inicioDelPeriodoMs(estado.periodo)),
        String(corte?.perdidas ?? 0),
      ],
    });
  }
  if (estado.motivo === 'sin_conversaciones' && corte && corte.motivo === 'sin_conversaciones') {
    const base = `corte_conversaciones_${corte.desdeMs}`;
    const parametros = [negocio, planNombre, String(corte.perdidas), String(BOLSA.precio)];
    debidos.push({ clave: `${base}_1`, tipo: 'corteConversaciones',
      plantilla: PLANTILLAS.corteConversaciones.nombre, parametros });
    if (ahoraMs - corte.desdeMs >= DIAS_SEGUNDO_AVISO_CORTE * DIA_MS) {
      debidos.push({ clave: `${base}_2`, tipo: 'corteConversaciones',
        plantilla: PLANTILLAS.corteConversaciones.nombre, parametros });
    }
  }

  // Lo más urgente primero: un corte antes que una renovación. Y nunca dos veces.
  const orden: Record<TipoRecordatorio, number> = { cortePago: 0, corteConversaciones: 0, renovacion: 1 };
  return debidos
    .filter((r) => !(r.clave in enviados))
    .sort((a, b) => orden[a.tipo] - orden[b.tipo]);
}

// -----------------------------------------------------------------------------
// TEXTOS DEL FLUJO DE COBRO — lo que el negocio lee cuando le escribe a NovuChat
// -----------------------------------------------------------------------------
/** Resumen de la cuenta en una o dos frases, para el cuerpo del menú. */
export function resumenDeCuenta(estado: EstadoServicio, nombreNegocio: string): string {
  const negocio = nombreNegocio.trim() || 'tu negocio';
  if (estado.modalidad === 'demostracion') {
    return `${negocio} está en modo demostración: sin mensualidad ni límite de conversaciones.`;
  }
  const saldo = estado.disponibles === Number.POSITIVE_INFINITY ? '' :
    ` Te quedan ${estado.disponibles} conversaciones este mes` +
    (estado.bolsa > 0 ? ` (${estado.bolsa} de bolsa)` : '') + '.';
  if (estado.motivo === 'sin_pago') {
    return `${negocio}: el asistente está DETENIDO porque este mes no está pagado.` +
      (estado.cubiertoHasta ? ` Estuvo cubierto hasta ${fechaFinDelPeriodo(estado.cubiertoHasta)}.` : '') +
      ' Elige una opción para reactivarlo.';
  }
  if (estado.motivo === 'sin_conversaciones') {
    return `${negocio}: el asistente está DETENIDO porque se agotaron las conversaciones ` +
      `del ${estado.enPrueba ? 'mes de prueba' : PLANES[estado.plan].nombre}. ` +
      `Una bolsa de ${BOLSA.conversaciones} por Bs ${BOLSA.precio} lo reactiva al instante.`;
  }
  const hasta = estado.cubiertoHasta ? fechaFinDelPeriodo(estado.cubiertoHasta) : '';
  return estado.enPrueba
    ? `${negocio} está en su mes de prueba hasta el ${hasta}.${saldo}`
    : `${negocio}: ${PLANES[estado.plan].nombre}, pagado hasta el ${hasta}.${saldo}`;
}

/**
 * VOSEO: español boliviano sin voseo (CLAUDE.md). Misma expresión que en
 * `scripts/cargar-plataforma.mjs`; se repite acá para poder probar los cuerpos
 * de las plantillas sin importar un script.
 */
export const VOSEO = new RegExp(
  '\\b(?:' +
    '(?:envi|mand|avis|confirm|mir|pas|dej|prob|escane|agend|reserv|llam|habl|cancel|eleg|pag)á' +
    '|(?:respond|ten|hac|corr|volv|pon|le)é' +
    '|(?:ten|quer|pod|sab)és' +
  ')(?![a-záéíóúüñ])',
  'i',
);
