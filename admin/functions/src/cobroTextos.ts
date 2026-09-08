/**
 * =============================================================================
 * FLUJO INTERNO DE COBRO — la decisión de qué contestarle al negocio
 * =============================================================================
 *
 * PURO A PROPÓSITO, como `prepago.ts`: acá se decide qué se le cobra a un
 * cliente y qué se le dice, y eso se prueba sin red. El endpoint
 * `cobroPrepago` (en `cobroPrepago.ts`) lee la base, llama a `decidirRespuesta`
 * y aplica los efectos que ésta devuelve. El flujo de n8n es transporte: manda
 * lo que llegó y despacha lo que sale. La lógica no vive en el lienzo.
 *
 * POR QUÉ NO HAY UN AGENTE DE IA EN ESTE FLUJO, a diferencia del Demo B en el
 * que se inspira: son cuatro opciones fijas con precio fijo, y hay dinero de
 * por medio. Un menú interactivo no se equivoca de monto ni inventa un
 * descuento; un modelo puede. Si más adelante hace falta contestar preguntas
 * libres sobre el servicio, se agrega un agente SOLO para el texto libre, sin
 * tocar el camino del pago.
 *
 * PROHIBICIÓN 3, EN SU MITAD DE COBRO REAL: el QR es el de NovuChat y el
 * dinero va a la cuenta de NovuChat. Por eso este módulo NUNCA dice «pago
 * acreditado», «pago verificado» ni «recibimos tu pago». Dice que llegó el
 * comprobante y que lo revisa el equipo; la acreditación la confirma el banco,
 * y el servicio se habilita cuando NovuChat confirma en la consola.
 */
import {
  BOLSA, PLANES, esPlan, descripcionDe, importeBs, montoUsdDe, resumenDeCuenta,
  type EstadoServicio, type Pago, type PlanId,
} from './prepago.js';

export interface Entrada {
  tipo: string;
  texto: string;
  seleccionId: string;
  nombrePerfil: string;
}

export interface PagoEnCurso {
  id: string;
  descripcion: string;
  monto: number;
}

export interface Contexto {
  /** `null` si el teléfono no está registrado como contacto de cobro de nadie. */
  negocio: { tenantId: string; nombre: string } | null;
  estado: EstadoServicio | null;
  pagoEnCurso: PagoEnCurso | null;
  /** ¿NovuChat tiene su QR de cobro registrado y encendido? */
  qrDisponible: boolean;
  /**
   * Tipo de Cambio Oficial del BCB con el que se cotiza en este turno.
   *
   * VIAJA EN EL CONTEXTO, no en una constante: la lista está en dólares y se
   * cobra en bolivianos, y el importe que se le dice a un negocio tiene que
   * ser el mismo que después queda registrado en su pago. Con un valor
   * escondido en el módulo, un cambio de tipo de cambio dejaría textos y
   * registros discrepando sin que nadie lo note.
   */
  tco: number;
}

export interface Fila { id: string; titulo: string; descripcion: string }
export interface Lista {
  header: string;
  body: string;
  footer: string;
  boton: string;
  secciones: { titulo: string; filas: Fila[] }[];
}

export interface Decision {
  respuesta: string;
  lista: Lista | null;
  /** Efecto: crear este pago y dejarlo esperando el comprobante. */
  crearPago: Pago | null;
  /** Efecto: marcar el pago en curso como «comprobante recibido». */
  marcarComprobante: boolean;
  enviarQr: boolean;
  /** Aviso al equipo de NovuChat (texto), o `null`. */
  avisoAdmin: string | null;
}

export const TEXTOS = {
  saludo: (nombre: string) =>
    `Hola${nombre ? ` ${nombre}` : ''} 👋 Soy el asistente de cuentas de NovuChat.`,
  desconocido:
    'Hola 👋 Soy el asistente de cuentas de NovuChat. Este número no está asociado a ' +
    'ningún negocio cliente. Si eres cliente, pide a NovuChat que registre este número ' +
    'como contacto de cobro de tu negocio. Si quieres conocer el servicio, entra a ' +
    'novuchat.site y escríbenos desde ahí.',
  elegir: 'Elige una opción del menú para pagar o ver tu saldo.',
  pagoElegido: (descripcion: string, monto: number) =>
    `Perfecto: *${descripcion}* por *Bs ${monto}*. Te envío el QR de NovuChat para que ` +
    'pagues desde la aplicación de tu banco. Cuando termines, *guarda o comparte el ' +
    'comprobante antes de salir de la aplicación del banco* y mándamelo por acá como ' +
    'imagen o PDF.',
  pagoElegidoSinQr: (descripcion: string, monto: number) =>
    `Perfecto: *${descripcion}* por *Bs ${monto}*. En este momento no tengo el QR a mano: ` +
    'una persona de NovuChat te escribe en breve para coordinar el pago. Cuando pagues, ' +
    'mándame el comprobante por acá como imagen o PDF.',
  epigrafeQr: (descripcion: string, monto: number) =>
    `QR de NovuChat · ${descripcion} · Bs ${monto}. Al terminar, envía el comprobante por este chat.`,
  comprobanteRecibido: (descripcion: string, monto: number) =>
    `Recibí tu comprobante por *${descripcion}* (Bs ${monto}). Lo revisa el equipo de ` +
    'NovuChat: en cuanto lo confirmemos, tu asistente queda habilitado y te aviso por acá. ' +
    'La acreditación del pago la confirma el banco.',
  comprobanteSinPago: (negocio: string) =>
    `Recibí una imagen, pero no tengo ningún pago en curso para ${negocio}. Elige primero ` +
    'qué quieres pagar:',
  pagoEnCurso: (descripcion: string, monto: number) =>
    `Tienes un pago en curso: ${descripcion} por Bs ${monto}. Cuando lo hagas, mándame el ` +
    'comprobante por acá. Si prefieres otra opción, elígela del menú y reemplaza a la anterior.',
  noEntendi: 'No pude leer ese mensaje. Elige una opción del menú:',
  avisoComprobante: (negocio: string, tenantId: string, descripcion: string, monto: number) =>
    `💰 Comprobante recibido · ${negocio} (${tenantId}) · ${descripcion} · Bs ${monto}. ` +
    'Confirmar en la consola: Negocios → ese negocio → Cuenta.',
  avisoSinQr: (negocio: string, tenantId: string, descripcion: string, monto: number) =>
    `⚠️ ${negocio} (${tenantId}) eligió ${descripcion} (Bs ${monto}) y NovuChat no tiene ` +
    'QR de cobro cargado. Coordinar el pago a mano.',
} as const;

/** Sin tildes, en minúsculas, solo letras: para reconocer «pagar», «bolsa», «saldo». */
export function normalizarComando(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const COMANDOS: Record<string, string> = {
  pagar: 'renovar', renovar: 'renovar', pago: 'renovar',
  bolsa: 'bolsa', recarga: 'bolsa', recargar: 'bolsa',
  saldo: 'saldo', estado: 'saldo', cuenta: 'saldo',
  base: 'plan_base', crecimiento: 'plan_crecimiento', corporativo: 'plan_corporativo',
};

/** Qué opción eligió el negocio: por la fila tocada o por una palabra suelta. */
export function opcionDe(entrada: Entrada): string | null {
  const id = entrada.seleccionId.trim();
  if (id) return id;
  const palabras = normalizarComando(entrada.texto).split(' ');
  // Solo mensajes cortos: «pagar» es un comando; «quiero pagar el mes que viene
  // con otro plan» es una frase, y ante una frase se muestra el menú.
  if (palabras.length > 3) return null;
  for (const p of palabras) {
    const opcion = COMANDOS[p];
    if (opcion) return opcion;
  }
  return null;
}

/** Recorta al tope de WhatsApp sin partir la última palabra si se puede. */
const acotar = (texto: string, max: number): string =>
  texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`;

/**
 * El menú. WhatsApp impone: 10 filas como máximo, título de fila ≤ 24, descripción
 * ≤ 72, encabezado ≤ 60, cuerpo ≤ 1024, pie ≤ 60, botón ≤ 20, título de sección ≤ 24.
 * Se recorta ACÁ: si algo llega largo, Meta rechaza el mensaje entero.
 */
export function armarLista(
  estado: EstadoServicio, nombreNegocio: string, cuerpo: string, tco: number,
): Lista {
  const filas: Fila[] = [];
  const actual = estado.plan;
  const enPrueba = estado.enPrueba || estado.modalidad === 'prueba';

  filas.push({
    id: 'renovar',
    titulo: acotar(enPrueba ? `Contratar ${PLANES[actual].nombre}` : `Renovar ${PLANES[actual].nombre}`, 24),
    descripcion: acotar(`Bs ${importeBs(PLANES[actual].precioUsd, tco)} · 1 mes · ${PLANES[actual].conversaciones} conversaciones`, 72),
  });
  for (const id of Object.keys(PLANES) as PlanId[]) {
    if (id === actual) continue;
    const p = PLANES[id];
    filas.push({
      id: `plan_${id}`,
      titulo: acotar(`${p.nombre.replace(/^Plan /, '')} · Bs ${importeBs(p.precioUsd, tco)}`, 24),
      descripcion: acotar(`Cambiar a ${p.nombre}: ${p.conversaciones} conversaciones por mes`, 72),
    });
  }
  filas.push({
    id: 'bolsa',
    titulo: acotar(`Bolsa ${BOLSA.conversaciones} conv · Bs ${importeBs(BOLSA.precioUsd, tco)}`, 24),
    descripcion: acotar(`${BOLSA.conversaciones} conversaciones extra que no vencen`, 72),
  });
  filas.push({ id: 'saldo', titulo: 'Ver mi saldo', descripcion: 'Plan, vencimiento y conversaciones disponibles' });

  return {
    header: acotar(nombreNegocio || 'NovuChat', 60),
    body: acotar(cuerpo, 1024),
    footer: 'NovuChat · pagos por QR',
    boton: 'Ver opciones',
    secciones: [{ titulo: 'Elige una opción', filas: filas.slice(0, 10) }],
  };
}

/** Traduce la opción elegida a un pago. `null` si la opción no es un pago. */
export function pagoDeOpcion(opcion: string, estado: EstadoServicio): Pago | null {
  if (opcion === 'renovar') return { tipo: 'mensualidad', plan: estado.plan, meses: 1 };
  if (opcion === 'bolsa') return { tipo: 'bolsa', cantidad: 1 };
  const m = /^plan_([a-z]+)$/.exec(opcion);
  if (m && esPlan(m[1])) return { tipo: 'mensualidad', plan: m[1], meses: 1 };
  return null;
}

const ES_COMPROBANTE = new Set(['image', 'document']);

export function decidirRespuesta(entrada: Entrada, contexto: Contexto): Decision {
  const nada: Decision = {
    respuesta: '', lista: null, crearPago: null, marcarComprobante: false,
    enviarQr: false, avisoAdmin: null,
  };

  if (!contexto.negocio || !contexto.estado) {
    return { ...nada, respuesta: TEXTOS.desconocido };
  }
  const { negocio, estado } = contexto;
  const resumen = resumenDeCuenta(estado, negocio.nombre, contexto.tco);
  const menu = (cuerpo: string) => armarLista(estado, negocio.nombre, cuerpo, contexto.tco);

  // --- Llegó una imagen o un PDF: es el comprobante, o no hay nada que cobrar ---
  if (ES_COMPROBANTE.has(entrada.tipo)) {
    if (contexto.pagoEnCurso) {
      const { descripcion, monto } = contexto.pagoEnCurso;
      return {
        ...nada,
        respuesta: TEXTOS.comprobanteRecibido(descripcion, monto),
        marcarComprobante: true,
        avisoAdmin: TEXTOS.avisoComprobante(negocio.nombre, negocio.tenantId, descripcion, monto),
      };
    }
    return { ...nada, respuesta: TEXTOS.comprobanteSinPago(negocio.nombre), lista: menu(resumen) };
  }

  const opcion = opcionDe(entrada);

  if (opcion === 'saldo') {
    const enCurso = contexto.pagoEnCurso
      ? `\n\n${TEXTOS.pagoEnCurso(contexto.pagoEnCurso.descripcion, contexto.pagoEnCurso.monto)}` : '';
    return { ...nada, respuesta: `${resumen}${enCurso}`, lista: menu(TEXTOS.elegir) };
  }

  const pago = opcion ? pagoDeOpcion(opcion, estado) : null;
  if (pago) {
    const descripcion = descripcionDe(pago);
    // Lo que se le DICE al negocio es el importe en bolivianos, que es lo que va
    // a transferir. El pago se registra además en dólares y con el TCO aplicado,
    // que es lo que permite reconstruir la factura después (ver `cuentas.ts`).
    const monto = importeBs(montoUsdDe(pago), contexto.tco);
    if (!contexto.qrDisponible) {
      return {
        ...nada, crearPago: pago,
        respuesta: TEXTOS.pagoElegidoSinQr(descripcion, monto),
        avisoAdmin: TEXTOS.avisoSinQr(negocio.nombre, negocio.tenantId, descripcion, monto),
      };
    }
    return { ...nada, crearPago: pago, enviarQr: true, respuesta: TEXTOS.pagoElegido(descripcion, monto) };
  }

  // Texto libre, saludo, audio, sticker: el menú, con el resumen como cuerpo.
  const legible = entrada.tipo === 'text' || entrada.tipo === 'interactive';
  const cabecera = legible ? TEXTOS.saludo(entrada.nombrePerfil.trim()) : TEXTOS.noEntendi;
  const enCurso = contexto.pagoEnCurso
    ? ` ${TEXTOS.pagoEnCurso(contexto.pagoEnCurso.descripcion, contexto.pagoEnCurso.monto)}` : '';
  return { ...nada, respuesta: `${cabecera} ${resumen}${enCurso}`, lista: menu(TEXTOS.elegir) };
}
