/**
 * =============================================================================
 * COTEJO DEL COMPROBANTE — comparar lo que dice la imagen con lo que se esperaba
 * =============================================================================
 *
 * QUÉ HACE Y QUÉ NO HACE, porque la diferencia es todo el asunto.
 *
 * HACE: tomar los tres datos que un OCR saca del comprobante que mandó el
 * cliente —importe, nombre de la cuenta que recibió y fecha y hora— y
 * contrastarlos con lo que el pedido esperaba. Si los tres coinciden, el
 * comprobante es CONSISTENTE.
 *
 * NO HACE: confirmar que el dinero entró. Una imagen se edita, y un comprobante
 * editado con los tres datos correctos pasa este cotejo. Por eso el resultado
 * se llama `consistente` y no `pagado`, y por eso el mensaje al cliente nunca
 * dice que el pago está acreditado. Lo que esto reemplaza no es al banco: es al
 * dueño mirando cincuenta capturas de pantalla por día para encontrar la que no
 * cuadra. Ahí ahorra casi todo el trabajo, y sin prometer nada falso.
 *
 * LAS TRES COMPARACIONES SON TOLERANTES A PROPÓSITO, cada una a lo suyo:
 *
 *  - **El importe**, a los separadores. «Bs 1.234,56», «1,234.56» y «1234.56»
 *    son el mismo número. Un OCR además lee «Bs.» pegado al número.
 *  - **El nombre**, al orden y a los nombres de más. El banco escribe «PEREZ
 *    GOMEZ JUAN CARLOS» y el comercio declara «Juan Pérez». Se exige que TODAS
 *    las palabras significativas del nombre más corto estén en el más largo:
 *    tolera el desorden y los nombres extra, pero «Juan Pérez» y «Juan López»
 *    NO coinciden.
 *  - **La fecha**, al formato y a unos minutos de reloj. El comprobante tiene
 *    que ser POSTERIOR al envío del QR —si es anterior, es un pago viejo
 *    reciclado— y ANTERIOR al momento en que llegó la imagen.
 */

/** Palabras que no distinguen a nadie y solo agregan ruido al comparar. */
const RELLENO = new Set([
  'DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'E',
  'SA', 'SRL', 'SAC', 'LTDA', 'EIRL', 'SOCIEDAD', 'ANONIMA',
]);

/** Mayúsculas, sin acentos y sin signos: la forma en la que dos nombres se pueden comparar. */
export function normalizar(texto: string): string {
  return (texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const palabras = (texto: string): string[] =>
  normalizar(texto).split(' ').filter((p) => p !== '' && !RELLENO.has(p));

/**
 * Dos palabras son la misma si son iguales, si una es la inicial de la otra
 * («J» y «JUAN», que es como abrevian los bancos), o si una es principio de la
 * otra con al menos cuatro letras («GONZAL» y «GONZALEZ», que es como trunca un
 * OCR cuando el recuadro corta el texto).
 */
function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  return corta.length >= 4 && larga.startsWith(corta);
}

/**
 * ¿Es el mismo titular? Todas las palabras significativas del nombre más corto
 * tienen que aparecer en el más largo, sin importar el orden.
 */
export function nombreCoincide(esperado: string, leido: string): boolean {
  const a = palabras(esperado);
  const b = palabras(leido);
  if (a.length === 0 || b.length === 0) return false;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  // Con una sola palabra el riesgo de coincidir por casualidad es alto
  // («TIENDA»), así que se exige que sea larga.
  if (corto.length === 1 && (corto[0] as string).length < 4) return false;
  return corto.every((p) => largo.some((q) => mismaPalabra(p, q)));
}

/**
 * Convierte a número el importe tal como lo escribió el banco.
 *
 * LA PARTE DIFÍCIL es que el punto y la coma cambian de papel según el país y
 * según el banco: «1.234,56» y «1,234.56» son el mismo importe. La regla que se
 * usa mira SOLO el último separador y cuántos dígitos lo siguen: uno o dos
 * dígitos son decimales; tres son millares. «12.500» son doce mil quinientos,
 * que es lo correcto en Bolivia y también lo más frecuente en un comprobante.
 */
export function parsearMonto(texto: string): number | null {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
  const bruto = (texto ?? '').toString();
  // Se queda con dígitos y separadores; saca «Bs», «BOB», espacios y el signo.
  const limpio = bruto.replace(/[^\d.,]/g, '');
  if (limpio === '' || !/\d/.test(limpio)) return null;

  const ultimoPunto = limpio.lastIndexOf('.');
  const ultimaComa = limpio.lastIndexOf(',');
  const corte = Math.max(ultimoPunto, ultimaComa);

  let entero: string;
  let decimales = '';
  if (corte === -1) {
    entero = limpio;
  } else {
    const cola = limpio.slice(corte + 1);
    if (/^\d{1,2}$/.test(cola)) {
      entero = limpio.slice(0, corte);
      decimales = cola;
    } else if (/^\d{3}$/.test(cola)) {
      entero = limpio;                      // separador de millares
    } else {
      return null;                          // cuatro dígitos o más: no se entiende
    }
  }
  const numero = Number(`${entero.replace(/[.,]/g, '')}.${decimales || '0'}`);
  return Number.isFinite(numero) ? numero : null;
}

/** ¿Es el mismo importe? Se comparan centavos, para no arrastrar el error del punto flotante. */
export function montoCoincide(esperado: number, leido: string | number): boolean {
  const valor = parsearMonto(leido as string);
  if (valor === null || !Number.isFinite(esperado)) return false;
  return Math.round(valor * 100) === Math.round(esperado * 100);
}

const MESES: Record<string, number> = {
  ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
  JUL: 7, AGO: 8, SEP: 9, SET: 9, OCT: 10, NOV: 11, DIC: 12,
};

/** Bolivia no cambia de hora: UTC−4 todo el año. */
export const OFFSET_LA_PAZ_HORAS = -4;

/**
 * Interpreta la fecha y hora del comprobante y devuelve el instante en
 * milisegundos. Acepta `dd/mm/aaaa`, `aaaa-mm-dd`, `dd septiembre aaaa` y
 * `dd de septiembre de aaaa` (con o sin coma, mes abreviado o completo),
 * con hora opcional de 24 h o con «a. m.»/«p. m.».
 *
 * Se interpreta SIEMPRE como hora de Bolivia, que es la que imprime el banco.
 */
export function parsearFechaHora(texto: string, offsetHoras = OFFSET_LA_PAZ_HORAS): number | null {
  // OJO: acá NO sirve `normalizar()`, que es la de los nombres y convierte en
  // espacios todo lo que no sea letra o número. Aplicada a una fecha destruye
  // las barras y los dos puntos, y entonces NINGUNA fecha se entiende — o sea,
  // ningún comprobante se aprueba nunca. Lo destaparon las pruebas.
  const t = (texto ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let anio: number | null = null; let mes: number | null = null; let dia: number | null = null;

  const iso = t.match(/\b(\d{4})[\s\-/](\d{1,2})[\s\-/](\d{1,2})\b/);
  const dmy = t.match(/\b(\d{1,2})[\s\-/](\d{1,2})[\s\-/](\d{2,4})\b/);
  // EL «DE» DEL CASTELLANO (2026-09-20). La version anterior exigia el mes
  // pegado al dia --«20 SEPTIEMBRE 2026»-- y por eso NINGUNA fecha escrita como
  // la escribe un banco boliviano se entendia: «20 de Septiembre, 2026»,
  // «20 de septiembre de 2026», «Domingo, 20 de sep. de 2026». Con la fecha
  // ilegible el cotejo dice «no cuadra», y un pago REAL que coincidia en
  // importe, cuenta, titular y banco termino en una persona (comprobante del
  // Banco Economico, prueba con telefono). Se admiten «de» y «del» opcionales
  // a los dos lados del mes; el dia de la semana y las comas ya los descarta
  // la limpieza de arriba o no molestan. El `(?!:)` impide que, sin año, la
  // hora se lea como año: «20 de septiembre 19:59» no es del año 2019.
  const conMes = t.match(/\b(\d{1,2})\s+(?:DE\s+)?([A-Z]{3,10})\s+(?:DEL?\s+)?(\d{4}|\d{2})\b(?!:)/);

  if (iso) {
    anio = Number(iso[1]); mes = Number(iso[2]); dia = Number(iso[3]);
  } else if (dmy) {
    dia = Number(dmy[1]); mes = Number(dmy[2]);
    const a = Number(dmy[3]);
    anio = a < 100 ? 2000 + a : a;
  } else if (conMes) {
    dia = Number(conMes[1]);
    mes = MESES[(conMes[2] as string).slice(0, 3)] ?? null;
    const a = Number(conMes[3]);
    anio = a < 100 ? 2000 + a : a;
  }
  if (anio === null || mes === null || dia === null) return null;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  let hora = 0; let minuto = 0; let segundo = 0;
  const h = t.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(A\s?M|P\s?M)?\b/);
  if (h) {
    hora = Number(h[1]); minuto = Number(h[2]); segundo = h[3] ? Number(h[3]) : 0;
    const sufijo = (h[4] ?? '').replace(/\s/g, '');
    if (sufijo === 'PM' && hora < 12) hora += 12;
    if (sufijo === 'AM' && hora === 12) hora = 0;
    if (hora > 23 || minuto > 59 || segundo > 59) return null;
  }
  // El instante se arma en UTC y se corrige por el huso: una hora local de
  // Bolivia (UTC−4) es cuatro horas MÁS tarde en UTC.
  return Date.UTC(anio, mes - 1, dia, hora, minuto, segundo) - offsetHoras * 3_600_000;
}

/**
 * ¿Es la misma cuenta?
 *
 * LOS BANCOS ENMASCARAN. En comprobantes reales aparece la cuenta completa
 * («201000000307»), enmascarada en el medio («201*****307») o con guiones
 * («201-51175234-3-37»). Las tres formas tienen que reconocerse como la misma
 * cuenta, y una máscara no puede convertirse en un permiso: lo que se ve tiene
 * que calzar, y lo tapado se acepta solo por su largo.
 */
export function cuentaCoincide(esperada: string, leida: string): boolean {
  const esp = (esperada ?? '').replace(/\D/g, '');
  const bruta = (leida ?? '').replace(/[\s\-.]/g, '');
  if (esp.length < 6 || bruta === '') return false;

  const mascara = /[*xX•·]/;
  if (!mascara.test(bruta)) {
    const lei = bruta.replace(/\D/g, '');
    if (lei.length < 6) return false;
    // Uno contiene al otro: el QR puede traer la cuenta con un prefijo de
    // sucursal que el comprobante no muestra, o al revés.
    return esp.includes(lei) || lei.includes(esp);
  }

  // Con máscara: tiene que calzar lo visible del principio y del final.
  //
  // NO se compara el largo total, y eso se aprendió de comprobantes reales: la
  // misma cuenta aparece con CATORCE dígitos en un banco y enmascarada a TRECE
  // caracteres en otro. Los asteriscos NO
  // reemplazan un dígito cada uno. Exigir largos iguales rechazaba pagos buenos.
  //
  // A cambio se exige que quede a la vista un mínimo de seis dígitos: con menos,
  // «2*7» daría por buena cualquier cuenta que empiece en 2 y termine en 7.
  const partes = bruta.split(new RegExp(`${mascara.source}+`, 'g'));
  const inicio = (partes[0] ?? '').replace(/\D/g, '');
  const fin = (partes[partes.length - 1] ?? '').replace(/\D/g, '');
  if (inicio.length + fin.length < 6) return false;
  if (esp.length < inicio.length + fin.length) return false;
  return esp.startsWith(inicio) && esp.endsWith(fin);
}

export interface Esperado {
  monto: number;
  /** Nombre declarado de la cuenta. Puede no figurar en el comprobante. */
  nombreCuenta: string;
  /** Cuentas del QR del comercio. Es el ancla más fiable. */
  cuentas?: string[];
  /** Cuándo se envió el QR: el comprobante no puede ser anterior. */
  qrEnviadoEn: number;
  /** Cuándo llegó la imagen: el comprobante no puede ser posterior. */
  comprobanteRecibidoEn: number;
  /** Minutos de gracia por desfase de relojes. */
  toleranciaMin?: number;
}

/**
 * Lo que el OCR sacó del comprobante.
 *
 * `fecha` y `hora` van separadas porque así vienen en varios comprobantes —el
 * del BNB tiene «Fecha de la transacción» y «Hora de la transacción» en dos
 * renglones—, y obligar a unirlas antes movería el trabajo al flujo, que es
 * donde peor se prueba.
 */
export interface Leido {
  monto?: string | number;
  /** Nombre de quien RECIBIÓ. Ojo: varios comprobantes muestran también el de quien pagó. */
  nombreCuenta?: string;
  /** Cuenta que RECIBIÓ, tal cual figura, aunque venga enmascarada. */
  cuentaDestino?: string;
  fechaHora?: string;
  fecha?: string;
  hora?: string;
}

export type ResultadoCotejo = 'cuadra' | 'no_cuadra' | 'ilegible';

export interface Cotejo {
  /** Los datos cuadran. NO significa que el dinero haya entrado. */
  consistente: boolean;
  montoOk: boolean;
  fechaOk: boolean;
  /** Se pudo confirmar el destinatario, por cuenta o por nombre. */
  destinoOk: boolean;
  /** Cómo se confirmó, para poder explicarlo en el aviso al negocio. */
  destinoPor: 'cuenta' | 'nombre' | 'ninguno';
  /** Qué no cuadró, en palabras. */
  diferencias: string[];
}

/** Une la fecha y la hora vengan como vengan. */
function instanteDel(leido: Leido): number | null {
  const junto = [leido.fechaHora, leido.fecha, leido.hora]
    .filter((v) => typeof v === 'string' && v.trim() !== '').join(' ');
  return junto === '' ? null : parsearFechaHora(junto);
}

/**
 * Cotejo completo del comprobante.
 *
 * QUÉ SE EXIGE, y por qué esta combinación y no otra:
 *
 *  - **El importe y la fecha, siempre.** Están en todos los comprobantes y son
 *    los que atrapan los dos fraudes simples: pagar de menos y reenviar la
 *    captura de un pago viejo.
 *  - **El destinatario, por cuenta O por nombre.** Basta uno porque no todos
 *    los bancos imprimen los dos: el comprobante del Banco de Crédito muestra
 *    la cuenta de destino SIN nombre. Pero al menos uno hace falta: sin eso,
 *    un pago del importe correcto a la cuenta de otra persona pasaría.
 *  - **Si un dato figura y NO coincide, se rechaza**, aunque el otro sí
 *    coincida. Un nombre que no cuadra no lo compensa una cuenta que sí.
 */
export function cotejarComprobante(esperado: Esperado, leido: Leido): Cotejo {
  const diferencias: string[] = [];
  const tolerancia = (esperado.toleranciaMin ?? 10) * 60_000;

  // --- Importe ---------------------------------------------------------
  const montoOk = montoCoincide(esperado.monto, leido.monto ?? '');
  if (!montoOk) {
    const valor = parsearMonto(String(leido.monto ?? ''));
    diferencias.push(valor === null
      ? 'No se pudo leer el importe en el comprobante.'
      : `El comprobante dice ${valor} y el pedido es de ${esperado.monto}.`);
  }

  // --- Fecha y hora ----------------------------------------------------
  const instante = instanteDel(leido);
  const fechaOk = instante !== null
    && instante >= esperado.qrEnviadoEn - tolerancia
    && instante <= esperado.comprobanteRecibidoEn + tolerancia;
  if (!fechaOk) {
    if (instante === null) {
      diferencias.push('No se pudo leer la fecha del comprobante.');
    } else if (instante < esperado.qrEnviadoEn - tolerancia) {
      diferencias.push('El comprobante es anterior al pedido: parece un pago de otra vez.');
    } else {
      diferencias.push('El comprobante tiene una fecha posterior al momento en que llegó.');
    }
  }

  // --- A quién se le pagó ----------------------------------------------
  const cuentaLeida = (leido.cuentaDestino ?? '').trim();
  const nombreLeido = (leido.nombreCuenta ?? '').trim();
  const cuentas = esperado.cuentas ?? [];

  const cuentaFigura = cuentaLeida !== '' && cuentas.length > 0;
  const cuentaOk = cuentaFigura && cuentas.some((c) => cuentaCoincide(c, cuentaLeida));
  const nombreFigura = nombreLeido !== '' && (esperado.nombreCuenta ?? '').trim() !== '';
  const nombreOk = nombreFigura && nombreCoincide(esperado.nombreCuenta, nombreLeido);

  let destinoPor: Cotejo['destinoPor'] = 'ninguno';
  if (cuentaOk) destinoPor = 'cuenta';
  else if (nombreOk) destinoPor = 'nombre';

  // Un dato que figura y no cuadra descalifica, aunque el otro salve.
  const contradice = (cuentaFigura && !cuentaOk) || (nombreFigura && !nombreOk);
  const destinoOk = destinoPor !== 'ninguno' && !contradice;

  if (cuentaFigura && !cuentaOk) {
    diferencias.push(`El depósito fue a la cuenta ${cuentaLeida}, que no es la del QR.`);
  }
  if (nombreFigura && !nombreOk) {
    diferencias.push(`El depósito figura a «${nombreLeido}» y la cuenta es de «${esperado.nombreCuenta}».`);
  }
  if (destinoPor === 'ninguno' && !contradice) {
    diferencias.push('El comprobante no muestra a qué cuenta ni a nombre de quién se '
      + 'depositó, así que no se puede verificar que el dinero haya ido al negocio.');
  }

  return {
    consistente: montoOk && fechaOk && destinoOk,
    montoOk, fechaOk, destinoOk, destinoPor, diferencias,
  };
}

/**
 * =============================================================================
 * CALIFICAR UN COMPROBANTE DE VENTA (regla 2, 03/10/2026)
 * =============================================================================
 *
 * Lo de arriba (`cotejarComprobante`) NO SE TOCA: lo usa la seña, que no
 * cambia. Lo de acá lo usa solo `cotejoVenta.ts`, y responde con CUATRO
 * estados en vez de tres porque la regla nueva distingue entre un dato que
 * coincide, uno que coincide «más o menos» y uno que no:
 *
 *  - `valido`: monto igual, fecha con hora dentro de la ventana, y destinatario
 *    por cuenta o por nombre exacto.
 *  - `aproximado`: algo no es exacto pero entra en lo que Andres aceptó
 *    (03/10): leído MAYOR por una diferencia chica (`montoDistinto`), fecha sin
 *    hora que cae en el día del QR o de la recepción, o un nombre con una letra
 *    de diferencia. Cuenta como comprobante y se avisa al comercio.
 *  - `invalido`: un dato que figura y NO coincide, o pagar de menos. Cuenta
 *    como un intento y no crea cierre.
 *  - `no_es_comprobante`: falta el monto, o la fecha, o a la vez la cuenta y el
 *    nombre. También cuenta como intento.
 *
 * PAGAR DE MENOS NUNCA ES APROXIMADO: la tolerancia es solo hacia arriba.
 * UN DATO QUE FIGURA Y NO COINCIDE DESCALIFICA (P1): la cuenta que coincide no
 * compensa un nombre distinto, y «Juan Pérez» frente a «Juan López» es inválido.
 *
 * Los motivos son CÓDIGOS FIJOS: nada de lo que se leyó de la imagen sale de
 * acá hacia el cliente.
 */

export type EstadoCalificacion = 'valido' | 'aproximado' | 'invalido' | 'no_es_comprobante';

export type MotivoCalificacion =
  | 'ok'
  // aproximado
  | 'monto_distinto' | 'fecha_sin_hora' | 'nombre_aproximado'
  // inválido
  | 'monto_menor' | 'monto_mayor' | 'fecha_anterior' | 'fecha_posterior'
  | 'cuenta_distinta' | 'nombre_distinto' | 'destino_no_verificable'
  // no es comprobante
  | 'falta_monto' | 'falta_fecha' | 'falta_destino' | 'ilegible';

export interface Calificacion {
  estado: EstadoCalificacion;
  /** El motivo principal (el primero por prioridad: monto, fecha, destino). */
  motivo: MotivoCalificacion;
  /** Todos los motivos que aplican, en el mismo orden. */
  motivos: MotivoCalificacion[];
  montoLeido: number | null;
  /** El monto leído es mayor que el esperado y se aceptó por la tolerancia. */
  montoDistinto: boolean;
}

/** Tolerancia hacia arriba del monto: lo mayor entre 1,00 Bs y el 2 % del esperado. */
export const TOLERANCIA_MONTO_FIJA = 1;
export const TOLERANCIA_MONTO_PORCENTAJE = 0.02;

/** Distancia de edición (Levenshtein) entre dos cadenas. */
export function distanciaDeEdicion(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min((actual[j - 1] as number) + 1, (previa[j] as number) + 1, (previa[j - 1] as number) + costo);
    }
    previa = actual;
  }
  return previa[b.length] as number;
}

/** El día calendario de La Paz (`aaaa-mm-dd`) de un instante. */
export function diaDeLaPaz(ms: number): string {
  return new Date(ms + OFFSET_LA_PAZ_HORAS * 3_600_000).toISOString().slice(0, 10);
}

/**
 * El instante del comprobante y si traía HORA. Sin hora, `parsearFechaHora`
 * devuelve las 00:00, y comparar eso con una ventana de minutos daba «anterior
 * al pedido» a un comprobante del mismo día: por eso se distingue.
 */
export function instanteConPrecision(leido: Leido): { ms: number; conHora: boolean; dia: string } | null {
  const junto = [leido.fechaHora, leido.fecha, leido.hora]
    .filter((v) => typeof v === 'string' && v.trim() !== '').join(' ');
  if (junto === '') return null;
  const ms = parsearFechaHora(junto);
  if (ms === null) return null;
  const limpio = junto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9\s:/-]/g, ' ');
  const conHora = /\b\d{1,2}:\d{2}/.test(limpio);
  return { ms, conHora, dia: diaDeLaPaz(ms) };
}

/**
 * ¿Es el mismo titular, con una letra de diferencia permitida? Igual que
 * `nombreCoincide` (orden invertido, nombres de más, truncado), más: dos
 * palabras de 5 letras o más que difieren en una sola letra cuentan como la
 * misma. «PEREZ» y «LOPEZ» difieren en dos y NO coinciden.
 */
export function nombreCoincideConUnaLetra(esperado: string, leido: string): 'exacto' | 'aproximado' | 'no' {
  if (nombreCoincide(esperado, leido)) return 'exacto';
  const a = palabras(esperado);
  const b = palabras(leido);
  if (a.length === 0 || b.length === 0) return 'no';
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.length === 1 && (corto[0] as string).length < 4) return 'no';
  const casi = (p: string, q: string) => mismaPalabra(p, q)
    || (p.length >= 5 && q.length >= 5 && distanciaDeEdicion(p, q) <= 1);
  return corto.every((p) => largo.some((q) => casi(p, q))) ? 'aproximado' : 'no';
}

function noEsComprobante(motivo: MotivoCalificacion, montoLeido: number | null): Calificacion {
  return { estado: 'no_es_comprobante', motivo, motivos: [motivo], montoLeido, montoDistinto: false };
}

/** Califica lo leído contra lo esperado. Pura. */
export function calificarComprobante(esperado: Esperado, leido: Leido): Calificacion {
  const tolerancia = (esperado.toleranciaMin ?? 10) * 60_000;
  const montoLeido = parsearMonto(String(leido.monto ?? ''));
  const instante = instanteConPrecision(leido);
  const cuentaLeida = (leido.cuentaDestino ?? '').trim();
  const nombreLeido = (leido.nombreCuenta ?? '').trim();

  // --- ¿Es un comprobante? Falta monto, o fecha, o cuenta y nombre a la vez.
  if (montoLeido === null || montoLeido <= 0) return noEsComprobante('falta_monto', null);
  if (instante === null) return noEsComprobante('falta_fecha', montoLeido);
  if (cuentaLeida === '' && nombreLeido === '') return noEsComprobante('falta_destino', montoLeido);

  const invalidos: MotivoCalificacion[] = [];
  const aproximados: MotivoCalificacion[] = [];
  let montoDistinto = false;

  // --- Monto: solo hacia arriba y dentro de la tolerancia.
  const esperadoCent = Math.round(esperado.monto * 100);
  const leidoCent = Math.round(montoLeido * 100);
  if (leidoCent < esperadoCent) {
    invalidos.push('monto_menor');
  } else if (leidoCent > esperadoCent) {
    const margen = Math.max(Math.round(TOLERANCIA_MONTO_FIJA * 100), Math.round(esperadoCent * TOLERANCIA_MONTO_PORCENTAJE));
    if (leidoCent - esperadoCent <= margen) { aproximados.push('monto_distinto'); montoDistinto = true; }
    else invalidos.push('monto_mayor');
  }

  // --- Fecha: con hora, la ventana; sin hora, el día del QR o de la recepción.
  if (instante.conHora) {
    if (instante.ms < esperado.qrEnviadoEn - tolerancia) invalidos.push('fecha_anterior');
    else if (instante.ms > esperado.comprobanteRecibidoEn + tolerancia) invalidos.push('fecha_posterior');
  } else if (instante.dia === diaDeLaPaz(esperado.qrEnviadoEn) || instante.dia === diaDeLaPaz(esperado.comprobanteRecibidoEn)) {
    aproximados.push('fecha_sin_hora');
  } else {
    invalidos.push(instante.dia < diaDeLaPaz(esperado.qrEnviadoEn) ? 'fecha_anterior' : 'fecha_posterior');
  }

  // --- Destinatario: un dato que figura y no coincide descalifica.
  const cuentas = esperado.cuentas ?? [];
  const cuentaFigura = cuentaLeida !== '' && cuentas.length > 0;
  const cuentaOk = cuentaFigura && cuentas.some((c) => cuentaCoincide(c, cuentaLeida));
  const nombreFigura = nombreLeido !== '' && (esperado.nombreCuenta ?? '').trim() !== '';
  const nombre = nombreFigura ? nombreCoincideConUnaLetra(esperado.nombreCuenta, nombreLeido) : 'no';
  if (cuentaFigura && !cuentaOk) invalidos.push('cuenta_distinta');
  if (nombreFigura && nombre === 'no') invalidos.push('nombre_distinto');
  if (!cuentaOk && nombre === 'no' && !cuentaFigura && !nombreFigura) invalidos.push('destino_no_verificable');
  if ((cuentaFigura ? cuentaOk : true) && nombre === 'aproximado') aproximados.push('nombre_aproximado');

  if (invalidos.length > 0) {
    return { estado: 'invalido', motivo: invalidos[0] as MotivoCalificacion, motivos: invalidos, montoLeido, montoDistinto: false };
  }
  if (aproximados.length > 0) {
    return { estado: 'aproximado', motivo: aproximados[0] as MotivoCalificacion, motivos: aproximados, montoLeido, montoDistinto };
  }
  return { estado: 'valido', motivo: 'ok', motivos: ['ok'], montoLeido, montoDistinto: false };
}
