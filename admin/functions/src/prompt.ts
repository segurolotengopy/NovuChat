/**
 * =============================================================================
 * ARMADO DE LA CONFIGURACIÓN QUE VE EL AGENTE
 * =============================================================================
 *
 * El panel es la fuente de verdad y n8n consulta. Este módulo es la frontera:
 * lo que sale de acá es lo que el asistente va a afirmar ante un cliente final.
 *
 * TRES REGLAS QUE NO HAY QUE AFLOJAR
 * ----------------------------------
 *
 * 1. LOS CAMPOS DERIVADOS NO SE LEEN DE LA CONFIGURACIÓN. `estadoComercio`,
 *    `phoneNumberId` y `horarioAtencion` se calculan acá, desde la ficha del
 *    tenant y desde `horarios`. Las reglas ya impiden guardarlos en
 *    `/config/negocio`, y esta función NUNCA los toma de ahí aunque
 *    aparecieran. Es defensa en profundidad sobre el vector más serio: un
 *    comercio que se fija `estadoComercio: 'activo'` y sigue siendo atendido
 *    después de que lo suspendieron.
 *
 * 2. LOS ENUMERADOS SE TRADUCEN A FRASES FIJAS. `tratamiento` y `estiloEmojis`
 *    determinan la VOZ del agente, o sea que van dentro de sus instrucciones.
 *    Por eso son listas cerradas y por eso acá se mapean a texto escrito por
 *    nosotros: **el valor del cliente nunca se interpola en el prompt**, solo
 *    selecciona cuál de nuestras frases se usa. Es la diferencia entre elegir de
 *    un menú y escribir en el prompt.
 *
 * 3. EL TEXTO LIBRE VIAJA ROTULADO. Todo lo que el comercio escribe —dirección,
 *    política de cancelación, mensajes, instrucciones extra— sale en
 *    `datosDelNegocio`, una sección aparte que el flujo inserta delimitada y
 *    marcada como DATO. Nunca concatenada por delante de las reglas de
 *    comportamiento del agente.
 */

/** Campos de texto libre del comercio que llegan al prompt. La lista es cerrada. */
export const CAMPOS_LIBRES_AL_PROMPT = [
  'nombreNegocio', 'descripcion', 'direccion', 'politicaCancelacion',
  'datosQueNoTenemos', 'instruccionesExtra',
  'mensajeCierre', 'mensajeErrorTemporal', 'mensajeReservaNoConfirmada',
  'mensajeComercioSuspendido',
] as const;

const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
const NOMBRE_DIA: Record<string, string> = {
  lun: 'lunes', mar: 'martes', mie: 'miércoles', jue: 'jueves',
  vie: 'viernes', sab: 'sábado', dom: 'domingo',
};

/**
 * `horarioAtencion` a partir de `horarios`. DERIVADO, no almacenado.
 *
 * Guardar las dos cosas invitaría a que se separaran, y entonces el agente
 * anunciaría un horario distinto del que muestra la pantalla. Un solo dato, una
 * sola verdad.
 */
export function horarioAtencion(horarios: unknown): string {
  if (typeof horarios !== 'object' || horarios === null) return '';
  const h = horarios as Record<string, unknown>;

  // Se agrupan los días seguidos con el mismo horario. Sin esto sale
  // «lunes: 09:00-19:00; martes: 09:00-19:00; miércoles: …», que es correcto y
  // suena a máquina: el asistente se lo lee así al cliente. Un negocio dice
  // «lunes a sábado, de 09:00 a 19:00», y esa frase es la que tiene que salir.
  const tramos: { desde: string; hasta: string; valor: string }[] = [];
  for (const d of DIAS) {
    const v = h[d];
    if (typeof v !== 'string' || v.trim() === '') continue;
    const valor = v.trim().slice(0, 40);
    const ultimo = tramos[tramos.length - 1];
    // Se extiende el tramo solo si el día es CONSECUTIVO al anterior: si el
    // negocio cierra los miércoles, «lunes a viernes» sería mentira.
    if (ultimo && ultimo.valor === valor && ultimo.hasta === diaPrevio(d)) {
      ultimo.hasta = d;
    } else {
      tramos.push({ desde: d, hasta: d, valor });
    }
  }

  return tramos.map(({ desde, hasta, valor }) => {
    const dias = desde === hasta
      ? NOMBRE_DIA[desde]
      : `${NOMBRE_DIA[desde]} a ${NOMBRE_DIA[hasta]}`;
    if (valor.toLowerCase() === 'cerrado') return `${dias}: cerrado`;
    // «09:00-19:00» se lee mejor como «de 09:00 a 19:00».
    const rango = /^(\d{1,2}:\d{2})\s*[-–a]\s*(\d{1,2}:\d{2})$/.exec(valor);
    return rango ? `${dias}, de ${rango[1]} a ${rango[2]}` : `${dias}: ${valor}`;
  }).join('; ');
}

/** Día anterior en la semana, en el orden de `DIAS`. `null` para el primero. */
function diaPrevio(dia: string): string | null {
  const i = (DIAS as readonly string[]).indexOf(dia);
  return i > 0 ? (DIAS[i - 1] as string) : null;
}

const FRASE_TRATAMIENTO: Record<string, string> = {
  usted: 'Trate al cliente de USTED en todo momento, sin excepción.',
  tu: 'Trate al cliente de TÚ en todo momento, sin excepción.',
  neutro: 'Evite el trato directo: use formas impersonales en lugar de «usted» o «tú».',
};

const FRASE_EMOJIS: Record<string, string> = {
  ninguno: 'No use emojis.',
  pocos: 'Use como mucho un emoji por mensaje, y solo cuando aporte.',
  muchos: 'Puede usar emojis con soltura, sin pasar de tres por mensaje.',
};

/** Instrucciones de voz. Salen de nuestras frases, nunca del texto del cliente. */
export function instruccionesDeVoz(config: Record<string, unknown>): string[] {
  const tratamiento = String(config['tratamiento'] ?? 'usted');
  const emojis = String(config['estiloEmojis'] ?? 'pocos');
  return [
    FRASE_TRATAMIENTO[tratamiento] ?? FRASE_TRATAMIENTO['usted']!,
    FRASE_EMOJIS[emojis] ?? FRASE_EMOJIS['pocos']!,
  ];
}

/** Etiquetas legibles de los datos que el comercio no cargó. */
const ETIQUETA_FALTANTE: Record<string, string> = {
  direccion: 'la dirección del local',
  numeroRecepcion: 'el teléfono de recepción',
  calendarioId: 'la agenda de citas',
  horarios: 'los horarios de atención',
  politicaCancelacion: 'la política de cancelación',
};

/**
 * QUÉ NO SABEMOS — el campo que existe por el incidente del 28/08.
 *
 * Ante «¿dónde queda su clínica?» el agente INVENTÓ una dirección: zona y
 * avenida que no figuraban en ninguna parte. Un cliente podría presentarse en un
 * lugar que no existe.
 *
 * LA DECISIÓN DE DISEÑO: esta lista **se calcula, no se declara**. Se computa
 * desde los campos que están efectivamente vacíos, y se le suman los que el
 * comercio agregó a mano. Los computados NO se pueden quitar desde el panel.
 *
 * El porqué: si dependiera de que el comercio se acuerde de escribir «no tenemos
 * dirección cargada», el olvido más probable del mundo —no cargar la dirección y
 * tampoco declarar que falta— devuelve exactamente el incidente que se quiere
 * evitar. La ausencia de un dato es un hecho verificable; pedir que alguien la
 * declare es pedirle que se acuerde de lo que no hizo.
 */
export function datosQueNoTenemos(config: Record<string, unknown>): string[] {
  const faltantes: string[] = [];

  const vacio = (clave: string) => {
    const v = config[clave];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (typeof v === 'object') return Object.keys(v as object).length === 0;
    return false;
  };

  for (const clave of ['direccion', 'numeroRecepcion', 'calendarioId',
                       'horarios', 'politicaCancelacion']) {
    if (vacio(clave)) faltantes.push(ETIQUETA_FALTANTE[clave] ?? clave);
  }

  // Los que el comercio agregó a mano. Se recortan acá: las reglas de Firestore
  // solo pudieron comprobar que es una lista de hasta 20 elementos, no qué hay
  // adentro (ver SEGURIDAD.md, T-27).
  const declarados = config['datosQueNoTenemos'];
  if (Array.isArray(declarados)) {
    for (const d of declarados.slice(0, 20)) {
      if (typeof d === 'string' && d.trim() !== '') faltantes.push(d.trim().slice(0, 80));
    }
  }

  // Sin repetidos y sin mayúsculas de más. El comercio suele declarar a mano
  // algo que el sistema ya dedujo —«dirección del local» junto a «la dirección
  // del local»— y el asistente se lo lee al cliente dos veces, que suena a
  // error. Se compara sin acentos, sin artículos y sin distinguir mayúsculas.
  const vistos = new Set<string>();
  return faltantes.filter((f) => {
    const clave = f.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^(la|el|los|las)\s+/, '')
      .replace(/\s+/g, ' ').trim();
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}


/**
 * =============================================================================
 * FUNCIONARIOS
 * =============================================================================
 *
 * EL CASO DE UNA SOLA PERSONA TIENE QUE SER TRIVIAL. Muchas PyMEs bolivianas son
 * una persona sola: obligarlas a dar de alta «funcionarios» para poder operar
 * sería cobrarles la complejidad de un problema que no tienen.
 *
 * Por eso, si la colección está vacía o no hay ninguno activo, acá se fabrica
 * **un funcionario por defecto** con el calendario y los horarios del comercio.
 * El flujo de n8n ve SIEMPRE una lista con al menos un elemento y tiene un solo
 * camino de código. La complejidad la paga quien la necesita.
 */
export interface Funcionario {
  id: string;
  nombre: string;
  especialidad: string;
  calendarioId: string;
  horarioTrabajo: Record<string, unknown>;
  /** Ids del catálogo. Vacío = atiende TODO lo que el comercio ofrece. */
  servicios: string[];
  porDefecto: boolean;
}

export function resolverFuncionarios(
  crudos: Array<{ id: string; datos: Record<string, unknown> }>,
  negocio: Record<string, unknown>,
  idsDeCatalogo: Set<string>,
): Funcionario[] {
  const activos = crudos.filter((f) => f.datos['activo'] === true);

  if (activos.length === 0) {
    // Comercio de una sola persona: el propio comercio es el funcionario.
    return [{
      id: '_comercio',
      nombre: String(negocio['nombreNegocio'] ?? 'El negocio'),
      especialidad: '',
      calendarioId: String(negocio['calendarioId'] ?? ''),
      horarioTrabajo: (negocio['horarios'] ?? {}) as Record<string, unknown>,
      servicios: [],           // vacío = atiende todo
      porDefecto: true,
    }];
  }

  return activos.map((f) => {
    const declarados = Array.isArray(f.datos['servicios']) ? f.datos['servicios'] : [];
    return {
      id: f.id,
      nombre: String(f.datos['nombre'] ?? '').slice(0, 120),
      especialidad: String(f.datos['especialidad'] ?? '').slice(0, 80),
      calendarioId: String(f.datos['calendarioId'] ?? '')
        // Si quedó vacío, hereda el del comercio: un funcionario sin agenda
        // propia no puede quedar sin agenda ninguna.
        || String(negocio['calendarioId'] ?? ''),
      horarioTrabajo: (f.datos['horarioTrabajo'] ?? negocio['horarios'] ?? {}) as Record<string, unknown>,
      // REFERENCIAS COLGADAS. Las reglas solo pudieron comprobar que `servicios`
      // es una lista de hasta 50 elementos, no que esos identificadores existan.
      // Un servicio borrado del catálogo deja la referencia atrás. Se descartan
      // acá en vez de dejar que el agente ofrezca un servicio inexistente.
      servicios: (declarados as unknown[])
        .filter((s): s is string => typeof s === 'string' && idsDeCatalogo.has(s))
        .slice(0, 50),
      porDefecto: false,
    };
  });
}

/** Minutos de una ranura de agenda. Ver el candado en `firestore.rules`. */
export const MINUTOS_POR_RANURA = 15;

/**
 * Identificadores de las ranuras que ocupa una cita.
 *
 * La superposición parcial se resuelve acá: 11:00–12:00 y 11:30–12:30 comparten
 * ranuras, así que chocan aunque no empiecen a la misma hora. Buscar el choque
 * por hora de inicio —el reflejo natural— dejaría pasar exactamente ese caso.
 */
export function ranurasDe(funcionarioId: string, inicio: Date, fin: Date): string[] {
  const dia = `${inicio.getUTCFullYear()}${String(inicio.getUTCMonth() + 1).padStart(2, '0')}${String(inicio.getUTCDate()).padStart(2, '0')}`;
  const primera = Math.floor((inicio.getUTCHours() * 60 + inicio.getUTCMinutes()) / MINUTOS_POR_RANURA);
  const minutos = Math.max(1, Math.ceil((fin.getTime() - inicio.getTime()) / 60000));
  const cantidad = Math.ceil(minutos / MINUTOS_POR_RANURA);
  return Array.from({ length: cantidad }, (_, i) => `${funcionarioId}_${dia}_${primera + i}`);
}

/**
 * =============================================================================
 * VERTICALES
 * =============================================================================
 *
 * Qué campos son COMUNES y cuáles dependen del vertical. La tabla vive acá y la
 * consume tanto `configuracionFlujo` como la pantalla de configuración: si se
 * agrega un campo en un solo lado, se nota.
 */
export const VERTICALES_CONOCIDOS = ['agendamiento', 'venta', 'interno'] as const;
export type Vertical = (typeof VERTICALES_CONOCIDOS)[number];

/** Qué documento de configuración específico le toca a cada vertical. */
export function documentoDeVertical(vertical: string): string | null {
  return vertical === 'agendamiento' ? 'agendamiento'
    : vertical === 'venta' ? 'venta'
    : null;
}

/**
 * RÓTULOS DEL COBRO SIMULADO — la prohibición 3 de CLAUDE.md, en código.
 *
 * Estos textos NO son configurables por el comercio y ni siquiera son
 * configurables por comercio: viven en `/plataforma/cobroSimulado`, son de
 * NovuChat y son los mismos para todos. Acá están los valores de respaldo, por
 * si el documento faltara: **el sistema tiene que fallar hacia el rótulo, nunca
 * hacia el silencio**. Un QR sin rótulo es un cobro simulado presentándose como
 * real, que es exactamente lo prohibido.
 */
export const ROTULOS_POR_DEFECTO = {
  rotuloSuperior: 'DEMOSTRACION · ESTE QR NO COBRA',
  rotuloInferior: 'SIMULACRO DE PAGO',
  epigrafe: 'Cobro SIMULADO: no cobra ni mueve dinero.',
  confirmacion: 'Pago verificado (SIMULADO - demostracion, sin cobro real).',
} as const;

export interface RotulosCobro {
  rotuloSuperior: string;
  rotuloInferior: string;
  epigrafe: string;
  confirmacion: string;
}

export function rotulosCobroSimulado(
  documento: Record<string, unknown> | undefined,
): RotulosCobro {
  const leer = (clave: keyof typeof ROTULOS_POR_DEFECTO) => {
    const v = documento?.[clave];
    // Solo se acepta un texto NO VACÍO. Una cadena vacía en el documento de
    // plataforma no puede servir para borrar el rótulo.
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : ROTULOS_POR_DEFECTO[clave];
  };
  return {
    rotuloSuperior: leer('rotuloSuperior'),
    rotuloInferior: leer('rotuloInferior'),
    epigrafe: leer('epigrafe'),
    confirmacion: leer('confirmacion'),
  };
}

// ===========================================================================
// EL CATÁLOGO NO PUEDE CRECER DENTRO DE CADA MENSAJE
// ===========================================================================
//
// `configuracionFlujo` mandaba el catálogo entero —hasta 200 ítems— en cada
// consulta del flujo, y el flujo lo pega en el prompt.
//
// EL UMBRAL, que es el punto 7 del diseño de Andres
// (`Analisis/11-catalogo-web-propio.md`): por debajo, el catálogo entero al
// prompt y el asistente lo recita; por encima, solo un RESUMEN —cuántos hay,
// qué áreas, entre qué precios— y el detalle llega por dos caminos que no
// pasan por el prompt: el sitio del catálogo, que el cliente navega, y el JSON
// del checkout, que vuelve con los ítems exactos.
//
// ---------------------------------------------------------------------------
// CORRECCIÓN DEL 08/09: EL MOTIVO NO ES EL COSTO. Este comentario decía que un
// catálogo grande hace que «cada mensaje del cliente cueste un prompt gigante:
// más dinero, más latencia». `Analisis/19-catalogo-web-y-precio-por-flujo.md`
// §2 lo MIDIÓ con las tarifas de octubre y la caché de prefijo puesta:
//
//     500 ítems en el prompt = 5.000 tokens = 0,0585 Bs
//                            = 0,43 mensajes del asistente
//
// O sea que el catálogo entero de una ferretería cuesta MENOS DE MEDIO MENSAJE.
// El token dejó de ser la restricción el día que Meta empezó a cobrar por
// mensaje. Justificar el umbral por costo mandaba a optimizar en la dirección
// equivocada: quien leyera esto trataría de achicar el prompt cuando lo que hay
// que achicar es la cantidad de mensajes.
//
// EL UMBRAL SOBREVIVE, POR OTRAS DOS RAZONES, las dos del mismo análisis §4:
//
//  1. LEGIBILIDAD. Una lista de 40 ítems son ~1.200 caracteres en un globo de
//     chat: ilegible. Y la lista interactiva de WhatsApp admite 10 filas por
//     sección, que es un tope del canal y no nuestro.
//  2. CONFIABILIDAD DEL MODELO, que es la que no se puede calcular. El prompt
//     del Demo A maneja 8 servicios y funciona; nadie probó con 100. Cuanto más
//     larga la lista, más probable que el asistente cite mal un precio, y cada
//     corrección es un mensaje cobrado más un riesgo de la prohibición 3.
//
// LOS 40 SON UNA RECOMENDACIÓN, NO UNA MEDICIÓN. El número que falta —a partir
// de cuántos ítems el asistente empieza a equivocarse— se saca probando con un
// catálogo real contra las suites de aceptación, no con una hoja de cálculo.
// ---------------------------------------------------------------------------
//
// POR QUÉ SE DECIDE ACÁ Y NO EN n8n. La consola es la única que sabe cuántos
// ítems tiene el comercio. Que el flujo tuviera que contar exigiría una
// consulta más y —peor— dos lugares donde el umbral podría no coincidir.
//
// Se cambia acá, en un solo lugar.
export const UMBRAL_CATALOGO_AL_PROMPT = 40;

export interface ResumenCatalogo {
  total: number;
  areas: string[];
  precioMin: number | null;
  precioMax: number | null;
  moneda: string;
  hayACotizar: boolean;
}

/**
 * Resumen de un catálogo grande: lo justo para que el asistente sepa de qué
 * habla y no invente. NO lleva nombres de productos, y eso es deliberado: si
 * llevara veinte nombres, el modelo los trataría como «el catálogo» y diría que
 * no tiene el resto.
 */
export function resumirCatalogo(
  items: Array<Record<string, unknown>>,
): ResumenCatalogo {
  const areas = new Set<string>();
  let min: number | null = null;
  let max: number | null = null;
  let moneda = '';
  let hayACotizar = false;

  for (const item of items) {
    const area = typeof item['area'] === 'string' ? item['area'].trim() : '';
    if (area !== '') areas.add(area.slice(0, 40));
    const precio = item['precio'];
    if (typeof precio === 'number') {
      min = min === null || precio < min ? precio : min;
      max = max === null || precio > max ? precio : max;
      if (moneda === '') moneda = item['moneda'] === 'USD' ? 'USD' : 'BOB';
    } else {
      hayACotizar = true;
    }
  }

  return {
    total: items.length,
    areas: [...areas].sort().slice(0, 20),
    precioMin: min,
    precioMax: max,
    moneda,
    hayACotizar,
  };
}
