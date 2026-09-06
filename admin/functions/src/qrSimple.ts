/**
 * =============================================================================
 * QR SIMPLE — validación del código de cobro que sube el comercio
 * =============================================================================
 *
 * QUÉ ES. El «QR Simple» boliviano (BCB/ASFI) sigue la especificación **EMVCo
 * QR Code for Payment Systems, modo MPM** (Merchant Presented Mode): el mismo
 * estándar que usan casi todos los QR de pago del mundo. Es una cadena de
 * tripletes `TT LL VVVV…`:
 *
 *     ID (2 dígitos) · LARGO (2 dígitos) · VALOR (tantos caracteres como diga
 *     el largo), uno detrás del otro, sin separadores.
 *
 * y termina SIEMPRE con `6304` seguido de cuatro hexadecimales: el CRC de todo
 * lo anterior. Ejemplo mínimo, leído de corrido:
 *
 *     00 02 01      → identificador de formato, valor «01»
 *     01 02 11      → método de inicio: 11 = REUTILIZABLE
 *     53 03 068     → moneda 068 = bolivianos
 *     58 02 BO      → país
 *     59 08 MI TIENDA
 *     63 04 A1B2    → CRC
 *
 * POR QUÉ ESTO RESUELVE LO QUE PIDIÓ ANDRES. Cada exigencia de la política de
 * cobro cae exactamente sobre un campo del estándar, así que no hay que
 * adivinar nada mirando la imagen:
 *
 * | Exigencia | Cómo se comprueba |
 * |---|---|
 * | «que sea un QR de cobro, no una foto ni otro QR» | parsea como TLV, el `00` vale `01` y el CRC cierra |
 * | «que no sea de un solo uso» | campo `01` = `11` (estático). `12` es de un solo uso |
 * | «que no esté cerrado en monto» | campo `54` AUSENTE. Si está, el QR cobra siempre ese importe |
 * | «que la cuenta esté a nombre de quien se declara» | campo `59` contra lo que escribió el administrador |
 *
 * EL CRC ES LA PIEZA CLAVE y conviene entender por qué. Sin él, cualquier texto
 * con la forma correcta pasaría. Con él, la probabilidad de que un QR de otra
 * cosa —una tarjeta de contacto, un enlace, la wifi del local— produzca por
 * casualidad una estructura válida Y un CRC correcto es de 1 en 65.536, y en la
 * práctica cero porque además tendría que empezar con `000201`.
 *
 * ⚠️ PERO HAY UNA SEGUNDA FAMILIA, Y ES LA QUE USAN LOS BANCOS DE ACÁ.
 *
 * El 2026-09-06 se decodificó un QR Simple REAL del BNB y NO es EMVCo: su
 * contenido son 256 bytes cifrados en base64, más una etiqueta de 12 bytes en
 * hexadecimal detrás de una barra vertical. O sea, **el contenido está cifrado
 * y solo la red bancaria puede leerlo**. Nada de lo de arriba se puede aplicar:
 * no hay cuenta, ni nombre, ni monto, ni método de inicio que leer.
 *
 * Si esto no se hubiera probado contra un QR de verdad, el sistema habría
 * rechazado TODOS los QR bolivianos con el mensaje «esa imagen no contiene un
 * QR de cobro», que además es exactamente el mensaje que más confianza destruye.
 *
 * ENTONCES SE RECONOCEN DOS FAMILIAS:
 *
 *  - `emvco`   → se puede leer todo, y las cuatro exigencias se comprueban solas.
 *  - `cifrado` → solo se puede comprobar la FORMA (que sea un QR de cobro
 *                bancario y no un enlace, una red wifi o una tarjeta de
 *                contacto). Lo demás lo DECLARA el comercio, y la pantalla le
 *                pide que lo mire en la aplicación de su banco.
 *
 * Cualquier otra cosa se rechaza.
 *
 * LO QUE NO SE PUEDE COMPROBAR EN NINGÚN CASO, y hay que decirlo: que la cuenta
 * exista, que esté activa, o que el titular declarado sea el real ante el
 * banco. Para eso haría falta un convenio con el banco, que es otro proyecto.
 */
import { nombreCoincide } from './cotejo.js';

/** Un campo del QR, ya separado. Los `26`–`51` traen adentro otros campos. */
export interface CampoQr { id: string; valor: string }

export const ID_FORMATO = '00';
export const ID_METODO_INICIO = '01';
export const ID_MONEDA = '53';
export const ID_MONTO = '54';
export const ID_PAIS = '58';
export const ID_NOMBRE_COMERCIO = '59';
export const ID_CIUDAD = '60';
export const ID_CRC = '63';

/** Monedas que el sistema admite hoy. ISO 4217 numérico. */
export const MONEDAS: Record<string, string> = { '068': 'BOB', '840': 'USD' };

/**
 * CRC-16/CCITT-FALSE, que es el que fija EMVCo: polinomio 0x1021, valor inicial
 * 0xFFFF, sin reflejar la entrada ni la salida y sin XOR final. Se calcula
 * sobre los BYTES en UTF-8, no sobre los caracteres: un nombre con eñe o acento
 * ocupa más de un byte y calcularlo sobre caracteres daría otro resultado.
 */
export function crc16(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Separa una cadena EMVCo en sus campos.
 *
 * Devuelve `null` ante cualquier irregularidad —un largo que se pasa del final,
 * un largo que no son dos dígitos, una cadena vacía— en vez de intentar
 * recuperarse. Acá recuperarse sería adivinar, y lo que se está decidiendo es
 * si una imagen es un instrumento de cobro.
 */
export function separarCampos(cadena: string): CampoQr[] | null {
  const campos: CampoQr[] = [];
  let i = 0;
  while (i < cadena.length) {
    // Hacen falta al menos 4 caracteres para el identificador y el largo.
    if (i + 4 > cadena.length) return null;
    const id = cadena.slice(i, i + 2);
    const largoTexto = cadena.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(largoTexto)) return null;
    const largo = Number(largoTexto);
    const fin = i + 4 + largo;
    if (fin > cadena.length) return null;
    campos.push({ id, valor: cadena.slice(i + 4, fin) });
    i = fin;
  }
  return campos.length > 0 ? campos : null;
}

const buscar = (campos: CampoQr[], id: string): string | null =>
  campos.find((c) => c.id === id)?.valor ?? null;

/** Los campos `26`–`51` identifican la cuenta. Sin ninguno, el QR no cobra a nadie. */
const tieneCuenta = (campos: CampoQr[]): boolean =>
  campos.some((c) => Number(c.id) >= 26 && Number(c.id) <= 51);

/**
 * Números de cuenta que el QR lleva adentro.
 *
 * PARA QUÉ SIRVEN, que no es obvio: son el ancla para verificar el comprobante.
 * Se descubrió mirando comprobantes reales de tres bancos bolivianos —el
 * 2026-09-06— que el NOMBRE del destinatario no siempre aparece: el del Banco
 * de Crédito muestra la cuenta de destino sin nombre, y su rótulo «A nombre de»
 * corresponde a la cuenta de ORIGEN. Comparar por nombre habría rechazado ese
 * comprobante siempre. La CUENTA de destino, en cambio, está en los tres.
 *
 * Los campos 26 a 51 llevan dentro sus propios subcampos, cuyo significado
 * depende de cada esquema de pago. En vez de suponer cuál es cuál, se recogen
 * TODOS los que tienen forma de número de cuenta y después se comprueba si
 * ALGUNO coincide: la comparación decide, no la suposición.
 */
export function cuentasDelQr(cadena: string): string[] {
  const campos = separarCampos(cadena);
  if (!campos) return [];
  const cuentas = new Set<string>();
  for (const campo of campos) {
    const n = Number(campo.id);
    if (n < 26 || n > 51) continue;
    const dentro = separarCampos(campo.valor);
    for (const sub of dentro ?? []) {
      const soloDigitos = sub.valor.replace(/\D/g, '');
      // Seis dígitos es el mínimo de una cuenta boliviana; por debajo son
      // códigos de esquema y darían coincidencias por casualidad.
      if (soloDigitos.length >= 6 && soloDigitos.length <= 25) cuentas.add(soloDigitos);
    }
  }
  return [...cuentas];
}

export interface DatosQr {
  /** `true` si el mismo QR se puede cobrar muchas veces. */
  reutilizable: boolean;
  /** Importe fijo impreso en el QR, o `null` si el cliente escribe el monto. */
  montoFijo: number | null;
  moneda: string;
  pais: string;
  /** Nombre del comercio tal como lo grabó el banco. */
  nombreEnElQr: string;
  ciudad: string;
  /** Cuentas que lleva el código. Con esto se verifica el comprobante. */
  cuentas: string[];
}

export interface ResultadoQr {
  valido: boolean;
  familia: FamiliaQr | null;
  /** Motivos por los que NO se acepta. Si hay alguno, `valido` es falso. */
  problemas: string[];
  /** Cosas que conviene que el comercio sepa, pero no impiden guardarlo. */
  advertencias: string[];
  datos: DatosQr | null;
}

export interface OpcionesQr {
  /** Nombre de la cuenta que declaró el administrador, para contrastarlo. */
  nombreDeclarado?: string;
  /**
   * Número de cuenta que declaró el administrador. En los QR cifrados es
   * OBLIGATORIO: es el único dato con el que después se puede verificar que el
   * comprobante del cliente corresponde a un depósito a ESTE negocio.
   */
  cuentaDeclarada?: string;
  /** El comercio confirmó, mirando su banco, que el QR se puede usar muchas veces. */
  confirmaReutilizable?: boolean;
  /** El comercio confirmó que el QR no tiene el importe grabado. */
  confirmaMontoAbierto?: boolean;
  /**
   * El comercio confirmó que TODOS sus cobros son del mismo importe. Es la
   * única situación en la que un QR de monto cerrado sirve, y la decide una
   * persona: el sistema no puede saberlo.
   */
  aceptaMontoFijo?: boolean;
}

/** De qué familia es el código. Ver la nota de arriba. */
export type FamiliaQr = 'emvco' | 'cifrado';

/**
 * ¿Tiene forma de QR de cobro bancario cifrado?
 *
 * La muestra real del BNB: 344 caracteres en base64 que decodifican a 256 bytes
 * ilegibles, una barra vertical, y 24 hexadecimales. Se comprueba esa forma sin
 * atarse a los largos exactos —otro banco usará otros— pero sí a lo que
 * distingue un cobro cifrado de cualquier otro QR: mucho volumen, base64
 * válido, y contenido que NO es texto legible.
 *
 * Lo que esto deja afuera, que es lo que importa: enlaces, redes wifi
 * («WIFI:S:…»), tarjetas de contacto («BEGIN:VCARD»), textos sueltos y fotos
 * sin ningún código.
 */
export function pareceCifrado(cadena: string): boolean {
  const cuerpo = (cadena.split('|')[0] ?? '').trim();
  const cola = cadena.includes('|') ? (cadena.split('|')[1] ?? '').trim() : '';
  if (cola !== '' && !/^[0-9A-Fa-f]{8,64}$/.test(cola)) return false;
  // Base64 y con volumen: un QR de cobro cifrado nunca es corto.
  if (!/^[A-Za-z0-9+/]{80,4000}={0,2}$/.test(cuerpo)) return false;
  // El largo múltiplo de cuatro se mide CON el relleno «=», no sin él: una
  // cadena que termina en «==» tiene 2 de resto si se le quita, y este control
  // rechazaba justamente los base64 bien formados.
  if (cuerpo.length % 4 !== 0) return false;

  let bytes: Buffer;
  try {
    bytes = Buffer.from(cuerpo, 'base64');
  } catch { return false; }
  if (bytes.length < 48) return false;
  // Si al decodificar sale texto legible, no es material cifrado: es otra cosa
  // codificada en base64, y no se acepta a ciegas.
  let legibles = 0;
  for (const b of bytes) if (b >= 32 && b < 127) legibles += 1;
  return legibles / bytes.length < 0.75;
}

/**
 * Valida un QR de cobro cifrado. Como no se puede leer nada de adentro, lo que
 * se comprueba es la forma, y todo lo demás pasa a ser DECLARADO por el
 * comercio, con la pantalla pidiéndole que lo verifique en su banco.
 *
 * La cuenta declarada es OBLIGATORIA. Sin ella no habría con qué contrastar el
 * comprobante del cliente y el cotejo quedaría reducido a importe y fecha, o
 * sea: un pago del monto correcto a la cuenta de otro pasaría por bueno.
 */
function validarCifrado(cadena: string, opciones: OpcionesQr): ResultadoQr {
  const problemas: string[] = [];
  const advertencias: string[] = [];
  const cuenta = (opciones.cuentaDeclarada ?? '').replace(/\D/g, '');

  if (cuenta.length < 6 || cuenta.length > 25) {
    problemas.push('Falta el número de la cuenta que recibe el dinero, o no es válido. '
      + 'Lo dice la aplicación de tu banco junto al QR, como «Cuenta destino». '
      + 'Sin ese número no podemos verificar los pagos de tus clientes.');
  }
  if (opciones.confirmaReutilizable !== true) {
    problemas.push('Tienes que confirmar que tu QR se puede usar muchas veces. '
      + 'Este tipo de código viene cifrado y no podemos comprobarlo por dentro: '
      + 'míralo en tu banco antes de marcarlo.');
  }
  if (opciones.confirmaMontoAbierto !== true && opciones.aceptaMontoFijo !== true) {
    problemas.push('Tienes que confirmar que tu QR NO tiene un importe fijo grabado. '
      + 'En la aplicación de tu banco suele figurar como «Monto: Bs. 0.00» o '
      + '«Sin especificar». Míralo antes de marcarlo.');
  }

  advertencias.push('Este código viene cifrado por tu banco, así que lo que declaraste '
    + '—titular, cuenta y vencimiento— no se puede comprobar automáticamente. Si algo '
    + 'está mal escrito, los pagos de tus clientes no se van a poder verificar.');

  return {
    valido: problemas.length === 0,
    familia: 'cifrado',
    problemas,
    advertencias,
    datos: {
      reutilizable: opciones.confirmaReutilizable === true,
      montoFijo: null,
      moneda: 'BOB',
      pais: 'BO',
      nombreEnElQr: '',
      ciudad: '',
      cuentas: cuenta === '' ? [] : [cuenta],
    },
  };
}

/**
 * Decide si una cadena leída de un QR sirve para cobrar por WhatsApp.
 *
 * Los mensajes están escritos para el dueño de una PyME, no para un
 * programador: dicen qué pasa y qué hacer, porque quien los va a leer está
 * intentando cobrar y no le sirve un código de error.
 */
export function validarQrSimple(cadena: string, opciones: OpcionesQr = {}): ResultadoQr {
  const problemas: string[] = [];
  const advertencias: string[] = [];
  const limpia = (cadena ?? '').trim();

  if (limpia === '') {
    return {
      valido: false, familia: null,
      problemas: ['No se pudo leer ningún código en la imagen.'], advertencias, datos: null,
    };
  }

  // Antes que nada: ¿tiene forma de QR de cobro? El caso frecuente es que
  // alguien suba el QR de un enlace, y conviene nombrarlo.
  if (/^https?:\/\//i.test(limpia)) {
    return {
      valido: false, familia: null,
      problemas: ['Ese QR lleva a una página web, no es un QR de cobro. '
        + 'Descarga el QR desde la aplicación de tu banco.'],
      advertencias, datos: null,
    };
  }

  const campos = separarCampos(limpia);
  if (!campos || buscar(campos, ID_FORMATO) !== '01') {
    // No es EMVCo. Puede ser un QR bancario cifrado, que es lo normal acá.
    if (pareceCifrado(limpia)) return validarCifrado(limpia, opciones);
    return {
      valido: false, familia: null,
      problemas: ['Esa imagen no contiene un QR de cobro. Puede ser una foto, '
        + 'una captura borrosa o el QR de otra cosa. Descarga el QR desde '
        + 'la aplicación de tu banco y súbelo sin recortar.'],
      advertencias, datos: null,
    };
  }

  // --- CRC -------------------------------------------------------------
  // El CRC se calcula sobre TODO lo anterior INCLUYENDO su propio «6304», que
  // es la parte que se suele implementar mal. Y tiene que ser el último campo:
  // si viniera en el medio, algo se agregó después de que el banco lo firmó.
  const ultimo = campos[campos.length - 1];
  const crcDeclarado = buscar(campos, ID_CRC);
  if (crcDeclarado === null || ultimo?.id !== ID_CRC) {
    problemas.push('Al código le falta su verificación final. Está incompleto o recortado.');
  } else {
    const hasta = limpia.length - 4;
    const esperado = crc16(limpia.slice(0, hasta));
    if (esperado.toUpperCase() !== crcDeclarado.toUpperCase()) {
      problemas.push('El código no pasa su propia verificación: está dañado o '
        + 'la imagen se leyó mal. Vuelve a descargarlo del banco.');
    }
  }

  // --- La cuenta --------------------------------------------------------
  if (!tieneCuenta(campos)) {
    problemas.push('El código no lleva ninguna cuenta asociada, así que no cobraría a nadie.');
  }

  // --- Un solo uso ------------------------------------------------------
  // Campo 01: «11» reutilizable, «12» de un solo uso. Si no está, el estándar
  // dice que es reutilizable.
  const metodo = buscar(campos, ID_METODO_INICIO) ?? '11';
  const reutilizable = metodo !== '12';
  if (!reutilizable) {
    problemas.push('Ese QR es de UN SOLO USO: sirve para un cobro y después queda '
      + 'muerto. El asistente lo enviaría a todos tus clientes y solo el primero '
      + 'podría pagar. Genera uno reutilizable en tu banco.');
  }

  // --- Monto cerrado ----------------------------------------------------
  const montoTexto = buscar(campos, ID_MONTO);
  // Un importe en cero NO es un importe fijo: es la forma de decir «monto
  // abierto». La aplicación del BNB lo muestra literalmente como «Bs. 0.00».
  // Tratarlo como monto cerrado rechazaría QR perfectamente buenos.
  const montoBruto = montoTexto !== null && montoTexto.trim() !== '' ? Number(montoTexto) : null;
  const montoFijo = montoBruto === 0 ? null : montoBruto;
  if (montoFijo !== null && !Number.isFinite(montoFijo)) {
    problemas.push('El importe grabado en el código no se entiende.');
  } else if (montoFijo !== null) {
    if (opciones.aceptaMontoFijo) {
      advertencias.push(`Este QR cobra siempre ${montoFijo}. Confirmaste que todos tus `
        + 'cobros son de ese importe: si algún día cobras otro monto, hay que cambiarlo.');
    } else {
      problemas.push(`Ese QR tiene el importe fijo en ${montoFijo}: cobraría eso a `
        + 'todos, sin importar el pedido. Genera uno de monto abierto, salvo que '
        + 'todos tus cobros sean exactamente de ese importe.');
    }
  }

  // --- Moneda y país ----------------------------------------------------
  const codigoMoneda = buscar(campos, ID_MONEDA) ?? '';
  const moneda = MONEDAS[codigoMoneda] ?? '';
  if (moneda === '') {
    advertencias.push('No se reconoce la moneda del código. Verifica que sea el QR de una cuenta en bolivianos.');
  }
  const pais = buscar(campos, ID_PAIS) ?? '';
  if (pais !== '' && pais.toUpperCase() !== 'BO') {
    advertencias.push(`El código dice que la cuenta es de «${pais}», no de Bolivia.`);
  }

  // --- El nombre de la cuenta -------------------------------------------
  const nombreEnElQr = (buscar(campos, ID_NOMBRE_COMERCIO) ?? '').trim();
  const declarado = (opciones.nombreDeclarado ?? '').trim();
  if (declarado !== '' && nombreEnElQr !== '' && !nombreCoincide(declarado, nombreEnElQr)) {
    problemas.push(`El QR está a nombre de «${nombreEnElQr}» y escribiste `
      + `«${declarado}». Tienen que ser la misma cuenta: el comprobante que mande `
      + 'tu cliente va a decir el nombre del QR, y si no coincide no se puede verificar.');
  }
  if (nombreEnElQr === '') {
    advertencias.push('El código no trae el nombre de la cuenta, así que no se '
      + 'podrá contrastar con el comprobante que mande el cliente.');
  }

  return {
    valido: problemas.length === 0,
    familia: 'emvco',
    problemas,
    advertencias,
    datos: {
      reutilizable,
      montoFijo: Number.isFinite(montoFijo as number) ? montoFijo : null,
      moneda,
      pais: pais.toUpperCase(),
      nombreEnElQr,
      ciudad: (buscar(campos, ID_CIUDAD) ?? '').trim(),
      cuentas: [...new Set([
        ...cuentasDelQr(limpia),
        ...((opciones.cuentaDeclarada ?? '').replace(/\D/g, '').length >= 6
          ? [(opciones.cuentaDeclarada ?? '').replace(/\D/g, '')] : []),
      ])],
    },
  };
}
