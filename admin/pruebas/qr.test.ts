/**
 * Pruebas del QR de cobro y del cotejo del comprobante. NO NECESITAN EMULADOR:
 * son funciones puras.
 *
 * POR QUÉ ESTA SUITE IMPORTA MÁS QUE OTRAS. Acá se decide si una imagen es un
 * instrumento de cobro y si un comprobante cuadra con un pedido. Un falso
 * positivo le cuesta plata a un comercio; un falso negativo le hace perder una
 * venta y lo obliga a revisar a mano, que es justo lo que el producto promete
 * evitar.
 *
 * LOS CÓDIGOS DE PRUEBA NO ESTÁN ESCRITOS A MANO. Se generaron con una
 * implementación INDEPENDIENTE del CRC en Python, y esa implementación se
 * validó contra el valor de control publicado del CRC-16/CCITT-FALSE
 * («123456789» → 29B1), que también se comprueba acá abajo. Sin ese contraste,
 * las pruebas solo dirían que el código coincide consigo mismo.
 */
import { describe, expect, it } from 'vitest';
import {
  crc16, cuentasDelQr, pareceCifrado, separarCampos, validarQrSimple,
} from '../functions/src/qrSimple.ts';
import { dibujarQr, pngDeMatriz } from '../functions/src/dibujoQr.ts';
import { datosQueNoTenemos, horarioAtencion } from '../functions/src/prompt.ts';
import {
  cotejarComprobante, cuentaCoincide, montoCoincide, nombreCoincide, normalizar,
  parsearFechaHora, parsearMonto,
} from '../functions/src/cotejo.ts';

// QR reutilizable, de monto abierto, en bolivianos, a nombre de PEREZ GOMEZ JUAN CARLOS.
const BUENO = '00020101021126340016com.bcb.qrsimple011010000008905204581253030685802BO5923PEREZ GOMEZ JUAN CARLOS6006LA PAZ63048176';
const UN_USO = '00020101021226340016com.bcb.qrsimple0110100000089053030685802BO5923PEREZ GOMEZ JUAN CARLOS6304CF6A';
const MONTO_CERRADO = '00020101021126340016com.bcb.qrsimple0110100000089053030685406150.005802BO5923PEREZ GOMEZ JUAN CARLOS63047F6B';
const SIN_CUENTA = '00020101021153030685802BO5923PEREZ GOMEZ JUAN CARLOS6012ZONA 000000063047783';
const EXTRANJERO = '00020101021126340016com.bcb.qrsimple0110100000089053038405802AR5923PEREZ GOMEZ JUAN CARLOS6304746D';
const ACENTOS = '00020101021126340016com.bcb.qrsimple0110100000089053030685802BO5915PEÑA MUÑOZ JOSÉ63048D24';

const TITULAR = 'Juan Carlos Pérez Gómez';

/**
 * QR bancario CIFRADO, la familia que se usa de verdad en Bolivia.
 *
 * Es SINTÉTICO, con la misma forma que el real: 256 bytes al azar en base64,
 * barra vertical, y 24 hexadecimales. El código real que se usó para descubrir
 * este formato NO se versiona: es el QR de cobro de una cuenta bancaria de
 * verdad y este repositorio es público.
 */
const CIFRADO = 'pU3KGCUwux1tEyze1iN7LtkeP3IfyxlxF0SU1kk8nVw0YL4xIB5p/tqg7ui5mX9cfCmZ/a/lkyU81lSvTfrXFCegrrP+6SMvivIhH57kkcWxC+y1Vjv8Hm+TQn7LyP4pVeXNjkbcjtS3wnZNKlpNdncG+F2GkAJK1r2jQBvpyMvMyTX2zR9hImrhUziuGjQATTO6DSRqwEyBsbryPjv57vX3nytJNK+H9VILablLDZguhbtVtnKocmN6zXRm/LYODo/xhGOw5LK6KXA0dPBkrGj3APWwKz3GZvRb3qosyu3NK1FXQQ5N7krys09DCgc0R95jbA6AbJV7poTWQx+16g==|D440E50454F31AF3176813E0';

const DECLARADO = {
  nombreDeclarado: TITULAR,
  cuentaDeclarada: '170000221',
  confirmaReutilizable: true,
  confirmaMontoAbierto: true,
};

describe('CRC-16/CCITT-FALSE', () => {
  it('reproduce el valor de control publicado del algoritmo', () => {
    // Si esta falla, todo lo demás de esta suite es humo.
    expect(crc16('123456789')).toBe('29B1');
  });

  it('cuenta BYTES y no caracteres: una eñe ocupa dos', () => {
    // Calcularlo sobre caracteres da otro resultado, y sería un rechazo
    // silencioso de todos los comercios con acento en el nombre.
    expect(crc16('Ñ')).not.toBe(crc16('N'));
  });
});

describe('Lectura de la estructura del QR', () => {
  it('separa los campos de un código real', () => {
    const campos = separarCampos(BUENO);
    expect(campos).not.toBeNull();
    expect(campos?.find((c) => c.id === '59')?.valor).toBe('PEREZ GOMEZ JUAN CARLOS');
    expect(campos?.find((c) => c.id === '60')?.valor).toBe('LA PAZ');
  });

  it('rechaza un largo que se pasa del final en vez de recuperarse', () => {
    // Recuperarse acá sería adivinar, y lo que se decide es si algo cobra dinero.
    expect(separarCampos('0002010100000099')).toBeNull();
  });

  it('rechaza texto que no tiene forma de campos', () => {
    expect(separarCampos('hola que tal')).toBeNull();
    expect(separarCampos('')).toBeNull();
  });
});

describe('El QR que el comercio sube', () => {
  it('acepta un QR Simple reutilizable y de monto abierto', () => {
    const r = validarQrSimple(BUENO, { nombreDeclarado: TITULAR });
    expect(r.problemas).toEqual([]);
    expect(r.valido).toBe(true);
    expect(r.datos?.reutilizable).toBe(true);
    expect(r.datos?.montoFijo).toBeNull();
    expect(r.datos?.moneda).toBe('BOB');
  });

  it('RECHAZA un QR de un solo uso', () => {
    // Es el peor de los casos silenciosos: el asistente se lo manda a todos y
    // solo el primero puede pagar.
    const r = validarQrSimple(UN_USO, { nombreDeclarado: TITULAR });
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/UN SOLO USO/);
  });

  it('RECHAZA un QR con el monto cerrado, salvo que el comercio lo confirme', () => {
    const r = validarQrSimple(MONTO_CERRADO, { nombreDeclarado: TITULAR });
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/importe fijo/);

    const conAviso = validarQrSimple(MONTO_CERRADO, { nombreDeclarado: TITULAR, aceptaMontoFijo: true });
    expect(conAviso.valido).toBe(true);
    expect(conAviso.advertencias.join(' ')).toMatch(/siempre 150/);
    expect(conAviso.datos?.montoFijo).toBe(150);
  });

  it('RECHAZA una imagen que no es un QR de cobro', () => {
    for (const basura of ['una foto cualquiera', 'WIFI:S:MiRed;T:WPA;P:clave;;', '']) {
      expect(validarQrSimple(basura).valido).toBe(false);
    }
  });

  it('RECHAZA el QR de un enlace y lo dice con esas palabras', () => {
    const r = validarQrSimple('https://www.bancox.com.bo/pagar/123');
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/página web/);
  });

  it('RECHAZA un código al que le cambiaron un dígito: el CRC no cierra', () => {
    // Esto es lo que separa «QR de cobro» de «cadena con la forma correcta».
    const alterado = BUENO.replace('01101000000890', '01101000000891');
    const r = validarQrSimple(alterado);
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/verificación/);
  });

  it('RECHAZA un código sin cuenta asociada: no cobraría a nadie', () => {
    const r = validarQrSimple(SIN_CUENTA, { nombreDeclarado: TITULAR });
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/ninguna cuenta/);
  });

  it('RECHAZA cuando el nombre declarado no es el del QR', () => {
    const r = validarQrSimple(BUENO, { nombreDeclarado: 'María López' });
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/PEREZ GOMEZ JUAN CARLOS/);
  });

  it('acepta el nombre desordenado y con acentos, que es como lo escribe la gente', () => {
    expect(validarQrSimple(BUENO, { nombreDeclarado: 'Juan Pérez' }).valido).toBe(true);
    expect(validarQrSimple(ACENTOS, { nombreDeclarado: 'José Peña' }).valido).toBe(true);
  });

  it('avisa —sin rechazar— si la cuenta no es boliviana', () => {
    const r = validarQrSimple(EXTRANJERO, { nombreDeclarado: TITULAR });
    expect(r.valido).toBe(true);
    expect(r.advertencias.join(' ')).toMatch(/AR/);
  });
});

describe('Nombre del titular', () => {
  it('quita los acentos DE VERDAD, no los convierte en espacios', () => {
    // Sin esta prueba, «José Peña» contra «PENA MUNOZ JOSE» pasaba igual
    // partiendo las palabras en pedazos («JOS», «PE», «A») que coincidían por
    // casualidad. La prueba de acentos habría quedado en verde sin probar nada.
    expect(normalizar('José Peña Muñoz')).toBe('JOSE PENA MUNOZ');
    expect(nombreCoincide('José Peña', 'PENA MUNOZ JOSE')).toBe(true);
  });

  it('tolera el desorden y los nombres de más', () => {
    expect(nombreCoincide('Juan Pérez', 'PEREZ GOMEZ JUAN CARLOS')).toBe(true);
    expect(nombreCoincide('COMERCIAL LA PAZ SRL', 'Comercial Paz')).toBe(true);
  });

  it('tolera la inicial y el truncado del OCR', () => {
    expect(nombreCoincide('Juan Pérez', 'J PEREZ')).toBe(true);
    expect(nombreCoincide('Juan Gonzalez', 'JUAN GONZAL')).toBe(true);
  });

  it('NO acepta un apellido distinto', () => {
    expect(nombreCoincide('Juan Pérez', 'Juan López')).toBe(false);
    expect(nombreCoincide('Juan Pérez', 'María López')).toBe(false);
  });

  it('NO acepta una sola palabra corta, que coincidiría por casualidad', () => {
    expect(nombreCoincide('Ana', 'ANA MARIA TORRES')).toBe(false);
    expect(nombreCoincide('', 'JUAN PEREZ')).toBe(false);
  });
});

describe('Importe del comprobante', () => {
  it('entiende las dos convenciones de punto y coma', () => {
    expect(parsearMonto('Bs 1.234,56')).toBe(1234.56);
    expect(parsearMonto('1,234.56')).toBe(1234.56);
    expect(parsearMonto('150.00')).toBe(150);
    expect(parsearMonto('150,00')).toBe(150);
  });

  it('lee tres dígitos finales como millares, que es lo correcto acá', () => {
    expect(parsearMonto('12.500')).toBe(12500);
    expect(parsearMonto('1.234.567,89')).toBe(1234567.89);
  });

  it('descarta lo que no es un importe', () => {
    expect(parsearMonto('sin monto')).toBeNull();
    expect(parsearMonto('')).toBeNull();
  });

  it('compara centavos, no flotantes', () => {
    expect(montoCoincide(35.7, 'Bs 35,70')).toBe(true);
    expect(montoCoincide(35.7, '35.07')).toBe(false);
  });
});

describe('Fecha y hora del comprobante', () => {
  const laPaz = (t: string) => parsearFechaHora(t);

  it('entiende los formatos que imprimen los bancos', () => {
    const esperado = Date.UTC(2026, 8, 6, 18, 32); // 14:32 en La Paz = 18:32 UTC
    expect(laPaz('06/09/2026 14:32')).toBe(esperado);
    expect(laPaz('2026-09-06 14:32:00')).toBe(esperado);
    expect(laPaz('06 SEP 2026 02:32 PM')).toBe(esperado);
  });

  it('interpreta la hora como boliviana y no como UTC', () => {
    // Si esto se rompe, todo comprobante de la tarde parecería del futuro.
    expect(laPaz('06/09/2026 14:32')).toBe(Date.UTC(2026, 8, 6, 14, 32) + 4 * 3_600_000);
  });

  it('descarta fechas imposibles', () => {
    expect(laPaz('35/13/2026')).toBeNull();
    expect(laPaz('sin fecha')).toBeNull();
  });
});

describe('Cotejo completo del comprobante', () => {
  const qrEnviadoEn = Date.UTC(2026, 8, 6, 18, 0);          // 14:00 La Paz
  const comprobanteRecibidoEn = Date.UTC(2026, 8, 6, 18, 40); // 14:40 La Paz
  const esperado = {
    monto: 118, nombreCuenta: 'Juan Carlos Pérez Gómez',
    qrEnviadoEn, comprobanteRecibidoEn,
  };

  it('da CONSISTENTE cuando los tres datos cuadran', () => {
    const r = cotejarComprobante(esperado, {
      monto: 'Bs 118,00', nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', fechaHora: '06/09/2026 14:32',
    });
    expect(r.consistente).toBe(true);
    expect(r.diferencias).toEqual([]);
  });

  it('detecta el importe que no cuadra y lo dice con los dos números', () => {
    const r = cotejarComprobante(esperado, {
      monto: '18.00', nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', fechaHora: '06/09/2026 14:32',
    });
    expect(r.consistente).toBe(false);
    expect(r.montoOk).toBe(false);
    expect(r.diferencias.join(' ')).toMatch(/18.*118|118.*18/);
  });

  it('detecta el depósito a nombre de otra persona', () => {
    const r = cotejarComprobante(esperado, {
      monto: '118', nombreCuenta: 'MARIA LOPEZ', fechaHora: '06/09/2026 14:32',
    });
    expect(r.destinoOk).toBe(false);
    expect(r.consistente).toBe(false);
  });

  it('RECHAZA un comprobante viejo reciclado', () => {
    // El fraude más simple y el más frecuente: mandar la captura del pago de
    // ayer. Sin este control, el cotejo no sirve para nada.
    const r = cotejarComprobante(esperado, {
      monto: '118', nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', fechaHora: '05/09/2026 14:32',
    });
    expect(r.fechaOk).toBe(false);
    expect(r.diferencias.join(' ')).toMatch(/anterior al pedido/);
  });

  it('RECHAZA una fecha posterior a la llegada de la imagen', () => {
    const r = cotejarComprobante(esperado, {
      monto: '118', nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', fechaHora: '06/09/2026 23:00',
    });
    expect(r.fechaOk).toBe(false);
  });

  it('tolera unos minutos de desfase de reloj', () => {
    // El reloj del banco no es el nuestro. Sin tolerancia, un pago legítimo
    // hecho en el mismo minuto del envío se rechazaría.
    const r = cotejarComprobante(esperado, {
      monto: '118', nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS', fechaHora: '06/09/2026 13:55',
    });
    expect(r.fechaOk).toBe(true);
  });

  it('cuando el OCR no lee nada, NO da por bueno el comprobante', () => {
    // El modo de fallo que importa: ante la duda, no se confirma.
    const r = cotejarComprobante(esperado, {});
    expect(r.consistente).toBe(false);
    expect(r.diferencias.length).toBe(3);
  });
});

describe('El PNG del QR que se le manda al cliente', () => {
  // VERIFICADO APARTE, y esto hay que decirlo porque una prueba no puede
  // hacerlo sola: el 2026-09-06 se generó este mismo PNG y se leyó con
  // zxing-cpp, un decodificador independiente, que devolvió EXACTAMENTE la
  // cadena de entrada —también la que lleva eñes y tildes—. Sin esa
  // comprobación, todo lo de acá abajo solo diría que el archivo tiene la forma
  // de un PNG, no que alguien pueda escanearlo con el teléfono.
  const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it('produce un PNG con firma, cabecera y cierre', () => {
    const png = dibujarQr(BUENO);
    expect(png.subarray(0, 8).equals(FIRMA)).toBe(true);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('deja el margen en blanco que el estándar exige para poder escanearlo', () => {
    // Sin los cuatro módulos de margen, muchos lectores no encuentran el
    // código. Es el defecto clásico de un QR pegado contra el borde.
    const modulos = 21;
    const escala = 4; const margen = 4;
    const png = pngDeMatriz(() => true, modulos, escala, margen);
    const lado = (modulos + margen * 2) * escala;
    expect(png.readUInt32BE(16)).toBe(lado);
    expect(png.readUInt32BE(20)).toBe(lado);
  });

  it('el mismo código da siempre la misma imagen', () => {
    expect(dibujarQr(BUENO).equals(dibujarQr(BUENO))).toBe(true);
    expect(dibujarQr(BUENO).equals(dibujarQr(ACENTOS))).toBe(false);
  });
});

describe('QR bancario CIFRADO — la familia que se usa de verdad en Bolivia', () => {
  // ESTE BLOQUE EXISTE PORQUE SE PROBÓ CON UN QR REAL. El 2026-09-06 se
  // decodificó uno del BNB y resultó NO ser EMVCo: son 256 bytes cifrados más
  // una etiqueta. Sin este camino, el sistema habría rechazado todos los QR
  // bolivianos diciendo «esa imagen no contiene un QR de cobro».

  it('lo reconoce como QR de cobro aunque no pueda leer nada de adentro', () => {
    const r = validarQrSimple(CIFRADO, DECLARADO);
    expect(r.familia).toBe('cifrado');
    expect(r.problemas).toEqual([]);
    expect(r.valido).toBe(true);
    expect(r.datos?.cuentas).toEqual(['170000221']);
  });

  it('avisa que lo declarado no se puede comprobar solo', () => {
    const r = validarQrSimple(CIFRADO, DECLARADO);
    expect(r.advertencias.join(' ')).toMatch(/cifrado/);
  });

  it('EXIGE el número de cuenta: sin él no hay con qué verificar un pago', () => {
    const r = validarQrSimple(CIFRADO, { ...DECLARADO, cuentaDeclarada: '' });
    expect(r.valido).toBe(false);
    expect(r.problemas.join(' ')).toMatch(/número de la cuenta/);
  });

  it('EXIGE las dos confirmaciones que no se pueden leer del código', () => {
    expect(validarQrSimple(CIFRADO, { ...DECLARADO, confirmaReutilizable: false }).valido).toBe(false);
    expect(validarQrSimple(CIFRADO, { ...DECLARADO, confirmaMontoAbierto: false }).valido).toBe(false);
  });

  it('NO confunde con un cifrado cualquier base64 que sea texto legible', () => {
    // Una nota larga codificada en base64 tiene la forma pero no el contenido.
    const texto = Buffer.from('a'.repeat(300)).toString('base64');
    expect(pareceCifrado(texto)).toBe(false);
  });

  it('sigue rechazando lo que no es un QR de cobro', () => {
    for (const otro of ['WIFI:S:MiRed;T:WPA;P:clave;;', 'BEGIN:VCARD\nFN:Juan\nEND:VCARD',
                        'https://banco.bo/pagar', 'hola']) {
      expect(validarQrSimple(otro, DECLARADO).valido).toBe(false);
    }
  });
});

describe('El importe en cero significa monto ABIERTO', () => {
  it('no lo trata como importe fijo', () => {
    // La aplicación del BNB muestra «Monto: Bs. 0.00» en los QR de monto
    // abierto. Tomarlo como monto cerrado rechazaría códigos buenos.
    const cuenta = '0016com.bcb.qrsimple01101000000890';
    const cuerpo = `${'0002'}${'0101'}${'0211'}26${String(cuenta.length).padStart(2, '0')}${cuenta}`
      + `${'5303'}068${'5406'}000.00${'5802'}BO5923PEREZ GOMEZ JUAN CARLOS`;
    const conCrc = `${cuerpo}6304${crc16(`${cuerpo}6304`)}`;
    const r = validarQrSimple(conCrc, { nombreDeclarado: TITULAR });
    expect(r.valido).toBe(true);
    expect(r.datos?.montoFijo).toBeNull();
  });
});

describe('La cuenta de destino, que es el ancla real', () => {
  it('saca las cuentas que lleva un código EMVCo adentro', () => {
    expect(cuentasDelQr(BUENO)).toContain('1000000890');
  });

  it('reconoce la misma cuenta escrita como la escribe cada banco', () => {
    // Formas reales, con los dígitos cambiados: completa, con guiones y
    // enmascarada. Las tres tienen que ser la misma cuenta.
    expect(cuentaCoincide('201000000307', '201000000307')).toBe(true);
    expect(cuentaCoincide('201000000307', '201-000000-307')).toBe(true);
    expect(cuentaCoincide('201000000307', '201*******307')).toBe(true);
  });

  it('NO acepta una cuenta distinta', () => {
    expect(cuentaCoincide('201000000307', '201000000999')).toBe(false);
    expect(cuentaCoincide('201000000307', '188*******999')).toBe(false);
  });

  it('NO acepta una máscara que deja demasiado poco a la vista', () => {
    // «2*7» calzaría con casi cualquier cuenta.
    expect(cuentaCoincide('201000000307', '2*7')).toBe(false);
  });
});

describe('Cotejo contra comprobantes REALES de tres bancos bolivianos', () => {
  // Los rótulos y el formato de cada campo son los de comprobantes de verdad,
  // vistos el 2026-09-06. Los números y los nombres están cambiados: el
  // repositorio es público.
  const qrEnviadoEn = Date.UTC(2026, 8, 6, 15, 0);           // 11:00 La Paz
  const comprobanteRecibidoEn = Date.UTC(2026, 8, 6, 16, 30); // 12:30 La Paz
  const base = {
    nombreCuenta: 'Ventas Demomarket', cuentas: ['201000000307'],
    qrEnviadoEn, comprobanteRecibidoEn,
  };

  it('Mercantil Santa Cruz: importe «Bs 92.50», cuenta completa y nombre', () => {
    const r = cotejarComprobante({ ...base, monto: 92.5 }, {
      monto: 'Bs 92.50',
      cuentaDestino: '201000000307',
      nombreCuenta: 'VENTAS DEMOMARKET',
      fechaHora: '06/09/2026 11:08:32',
    });
    expect(r.consistente).toBe(true);
    expect(r.destinoPor).toBe('cuenta');
  });

  it('BNB: fecha y hora en renglones separados, cuenta enmascarada, un decimal', () => {
    const r = cotejarComprobante({ ...base, monto: 6.5 }, {
      monto: '6.5',
      cuentaDestino: '201*******307',
      nombreCuenta: 'VENTAS DEMOMARKET',
      fecha: '06/09/2026',
      hora: '11:47:57',
    });
    expect(r.consistente).toBe(true);
  });

  it('Banco de Crédito: SIN nombre de destinatario, solo la cuenta', () => {
    // El caso que rompía el diseño anterior. Ese comprobante muestra la cuenta
    // de destino sin nombre, y su rótulo «A nombre de» es el de la cuenta de
    // ORIGEN. Exigir el nombre lo habría rechazado siempre.
    const r = cotejarComprobante(
      { ...base, monto: 5, cuentas: ['170000221'] },
      { monto: 'Bs 5.00', cuentaDestino: '170000221', fechaHora: '06/09/2026 11:41:01' },
    );
    expect(r.consistente).toBe(true);
    expect(r.destinoPor).toBe('cuenta');
  });

  it('el nombre abreviado del titular sigue coincidiendo', () => {
    // Un banco imprime «ALBERTI B.JAVIER A.» donde otro pone el nombre entero.
    expect(nombreCoincide('Alberti Baptista Javier Andres', 'ALBERTI B.JAVIER A.')).toBe(true);
  });

  it('RECHAZA un pago del importe correcto a OTRA cuenta', () => {
    // El fraude que el cotejo tiene que atrapar y el que más plata cuesta.
    const r = cotejarComprobante({ ...base, monto: 92.5 }, {
      monto: 'Bs 92.50', cuentaDestino: '999000000655',
      fechaHora: '06/09/2026 11:08:32',
    });
    expect(r.consistente).toBe(false);
    expect(r.diferencias.join(' ')).toMatch(/no es la del QR/);
  });

  it('RECHAZA cuando el comprobante no dice a quién se le pagó', () => {
    const r = cotejarComprobante({ ...base, monto: 92.5 }, {
      monto: 'Bs 92.50', fechaHora: '06/09/2026 11:08:32',
    });
    expect(r.consistente).toBe(false);
    expect(r.destinoPor).toBe('ninguno');
  });

  it('un nombre que NO cuadra descalifica aunque la cuenta sí', () => {
    const r = cotejarComprobante({ ...base, monto: 92.5 }, {
      monto: 'Bs 92.50', cuentaDestino: '201000000307',
      nombreCuenta: 'OTRA EMPRESA SRL', fechaHora: '06/09/2026 11:08:32',
    });
    expect(r.consistente).toBe(false);
  });
});

describe('Cómo se le lee el horario al cliente', () => {
  // El asistente dice esta frase en voz alta. «lunes: 09:00-19:00; martes:
  // 09:00-19:00; …» es correcto y suena a máquina; un negocio dice «lunes a
  // sábado, de 09:00 a 19:00». Se descubrió comparando lo que serviría el panel
  // contra lo que el flujo decía escrito a mano.
  it('agrupa los días seguidos con el mismo horario', () => {
    expect(horarioAtencion({
      lun: '09:00-19:00', mar: '09:00-19:00', mie: '09:00-19:00',
      jue: '09:00-19:00', vie: '09:00-19:00', sab: '09:00-19:00', dom: 'cerrado',
    })).toBe('lunes a sábado, de 09:00 a 19:00; domingo: cerrado');
  });

  it('NO agrupa días que no son consecutivos', () => {
    // Si el negocio cierra los miércoles, «lunes a viernes» sería mentira y el
    // cliente vendría un día que está cerrado.
    expect(horarioAtencion({
      lun: '09:00-19:00', mar: '09:00-19:00', mie: 'cerrado',
      jue: '09:00-19:00', vie: '09:00-19:00',
    })).toBe('lunes a martes, de 09:00 a 19:00; miércoles: cerrado; jueves a viernes, de 09:00 a 19:00');
  });

  it('respeta los horarios distintos por día', () => {
    expect(horarioAtencion({ lun: '09:00-19:00', mar: '10:00-14:00' }))
      .toBe('lunes, de 09:00 a 19:00; martes, de 10:00 a 14:00');
  });

  it('deja pasar un texto que no es un rango, sin romperlo', () => {
    expect(horarioAtencion({ sab: 'solo con cita previa' }))
      .toBe('sábado: solo con cita previa');
  });

  it('sin horarios devuelve vacío, y no una frase inventada', () => {
    expect(horarioAtencion(null)).toBe('');
    expect(horarioAtencion({})).toBe('');
  });
});

describe('Datos que el negocio NO tiene', () => {
  // La lista se le lee al cliente. Si trae repetidos suena a error, y el
  // comercio suele declarar a mano algo que el sistema ya dedujo.
  it('no repite lo que el comercio declaró y el sistema ya había deducido', () => {
    const r = datosQueNoTenemos({
      direccion: '',
      datosQueNoTenemos: ['dirección del local', 'La Dirección del Local', 'promociones'],
    });
    expect(r.filter((x) => /direcci/i.test(x))).toHaveLength(1);
    expect(r).toContain('promociones');
  });

  it('deduce lo que falta sin que nadie lo declare', () => {
    // Es el control que evita el incidente del 28 de agosto: el comercio no
    // carga la dirección Y tampoco declara que falta.
    expect(datosQueNoTenemos({}).some((x) => /direcci/i.test(x))).toBe(true);
  });

  it('con todo cargado no inventa faltantes', () => {
    const r = datosQueNoTenemos({
      direccion: 'Calle Falsa 100', numeroRecepcion: '59170000000',
      calendarioId: 'x@group.calendar.google.com', horarios: { lun: '09:00-19:00' },
      politicaCancelacion: 'Con 2 horas de aviso.',
    });
    expect(r).toEqual([]);
  });
});
