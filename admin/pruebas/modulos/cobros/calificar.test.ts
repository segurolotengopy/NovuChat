/**
 * CALIFICAR UN COMPROBANTE DE VENTA (regla 2), probado negando. NO NECESITA EMULADOR.
 *
 * Decisiones de Andres (03/10/2026) que esta suite defiende: monto igual es
 * válido; leído MAYOR dentro de max(1,00 Bs, 2 %) es aproximado; pagar de
 * MENOS nunca es aproximado; fecha sin hora vale si cae en el día de La Paz del
 * QR o de la recepción; el destinatario se acepta por cuenta o por nombre
 * (invertido, truncado, o con una letra de diferencia en palabras de 5+), y un
 * dato que figura y no coincide descalifica.
 */
import { describe, expect, it } from 'vitest';
import {
  calificarComprobante, diaDeLaPaz, distanciaDeEdicion, instanteConPrecision,
  nombreCoincideConUnaLetra, type Esperado, type Leido,
} from '../../../functions/src/modulos/cobros/cotejo.ts';

// 03/10/2026 12:00 en La Paz (UTC−4) = 16:00 UTC.
const QR = Date.UTC(2026, 9, 3, 16, 0);
const RECIBIDO = QR + 5 * 60_000;
const CUENTA = '1000000890';

const esperado = (monto = 100, extra: Partial<Esperado> = {}): Esperado => ({
  monto, nombreCuenta: 'Juan Carlos Pérez Gómez', cuentas: [CUENTA],
  qrEnviadoEn: QR, comprobanteRecibidoEn: RECIBIDO, toleranciaMin: 10, ...extra,
});
const leidoOk = (extra: Partial<Leido> = {}): Leido => ({
  monto: '100,00', cuentaDestino: CUENTA, nombreCuenta: 'PEREZ GOMEZ JUAN CARLOS',
  fecha: '03/10/2026', hora: '12:03', ...extra,
});
const califica = (l: Partial<Leido>, e: Partial<Esperado> = {}, monto = 100) =>
  calificarComprobante(esperado(monto, e), leidoOk(l));

describe('el caso feliz', () => {
  it('monto igual, fecha con hora en la ventana y cuenta y nombre: válido', () => {
    expect(califica({})).toMatchObject({ estado: 'valido', motivo: 'ok', montoDistinto: false, montoLeido: 100 });
  });
  it('por cuenta sola (el banco no imprime el nombre) o por nombre solo: válido', () => {
    expect(califica({ nombreCuenta: '' }).estado).toBe('valido');
    expect(califica({ cuentaDestino: '' }).estado).toBe('valido');
  });
});

describe('monto: solo hacia arriba, y con tope', () => {
  it('pagar de menos NUNCA es aproximado, ni por un centavo', () => {
    for (const m of ['99,99', '99', '50', '98.00']) {
      expect(califica({ monto: m }), m).toMatchObject({ estado: 'invalido', motivo: 'monto_menor', montoDistinto: false });
    }
  });
  it('mayor dentro de 1,00 Bs: aproximado con montoDistinto', () => {
    // Con 100 Bs el 2 % son 2,00 Bs: lo mayor entre 1,00 y 2,00 es 2,00.
    expect(califica({ monto: '101' })).toMatchObject({ estado: 'aproximado', motivo: 'monto_distinto', montoDistinto: true });
    expect(califica({ monto: '102,00' }).estado).toBe('aproximado');
  });
  it('el borde: 2,00 Bs de más sobre 100 pasa; 2,01 no', () => {
    expect(califica({ monto: '102.00' }).estado).toBe('aproximado');
    expect(califica({ monto: '102.01' })).toMatchObject({ estado: 'invalido', motivo: 'monto_mayor' });
  });
  it('en un pedido chico manda el 1,00 Bs fijo: 20 + 1,00 pasa; 20 + 1,01 no', () => {
    expect(califica({ monto: '21,00' }, {}, 20).estado).toBe('aproximado');
    expect(califica({ monto: '21,01' }, {}, 20)).toMatchObject({ estado: 'invalido', motivo: 'monto_mayor' });
  });
  it('en un pedido grande manda el 2 %: 1000 + 20 pasa; 1000 + 20,01 no', () => {
    expect(califica({ monto: '1.020,00' }, {}, 1000).estado).toBe('aproximado');
    expect(califica({ monto: '1.020,01' }, {}, 1000).estado).toBe('invalido');
  });
});

describe('fecha', () => {
  it('con hora: la ventana va de 10 min antes del QR a 10 min después de la recepción', () => {
    expect(califica({ hora: '11:50' }).estado).toBe('valido');
    expect(califica({ hora: '11:49' })).toMatchObject({ estado: 'invalido', motivo: 'fecha_anterior' });
    expect(califica({ hora: '12:15' }).estado).toBe('valido');
    expect(califica({ hora: '12:16' })).toMatchObject({ estado: 'invalido', motivo: 'fecha_posterior' });
  });
  it('sin hora, del día del QR: aproximado (antes caía a las 00:00 y salía «anterior al pedido»)', () => {
    expect(califica({ hora: '' })).toMatchObject({ estado: 'aproximado', motivo: 'fecha_sin_hora' });
  });
  it('sin hora, del día anterior: INVÁLIDO', () => {
    expect(califica({ fecha: '02/10/2026', hora: '' })).toMatchObject({ estado: 'invalido', motivo: 'fecha_anterior' });
  });
  it('sin hora, de un día posterior: inválido', () => {
    expect(califica({ fecha: '04/10/2026', hora: '' })).toMatchObject({ estado: 'invalido', motivo: 'fecha_posterior' });
  });
  it('sin hora, pero del día de la recepción (el QR salió a las 23:58 y el comprobante llegó pasada la medianoche)', () => {
    const qr = Date.UTC(2026, 9, 4, 3, 58);        // 03/10 23:58 en La Paz
    const rec = Date.UTC(2026, 9, 4, 4, 2);        // 04/10 00:02
    const e = { qrEnviadoEn: qr, comprobanteRecibidoEn: rec };
    expect(califica({ fecha: '04/10/2026', hora: '' }, e).estado).toBe('aproximado');
    expect(califica({ fecha: '03/10/2026', hora: '' }, e).estado).toBe('aproximado');
    expect(califica({ fecha: '02/10/2026', hora: '' }, e).estado).toBe('invalido');
  });
  it('el día es el de La Paz, no el de UTC', () => {
    expect(diaDeLaPaz(Date.UTC(2026, 9, 4, 3, 59))).toBe('2026-10-03');
    expect(diaDeLaPaz(Date.UTC(2026, 9, 4, 4, 0))).toBe('2026-10-04');
    expect(instanteConPrecision({ fecha: '03/10/2026' })).toMatchObject({ conHora: false, dia: '2026-10-03' });
    expect(instanteConPrecision({ fecha: '03/10/2026', hora: '12:03' })).toMatchObject({ conHora: true });
    expect(instanteConPrecision({ fecha: 'ayer' })).toBeNull();
  });
});

describe('destinatario', () => {
  it('nombre invertido: válido', () => {
    expect(califica({ cuentaDestino: '', nombreCuenta: 'Juan Carlos Pérez Gómez' }).estado).toBe('valido');
    expect(califica({ cuentaDestino: '', nombreCuenta: 'GOMEZ PEREZ JUAN' }).estado).toBe('valido');
  });
  it('nombre truncado por el recuadro: válido', () => {
    expect(califica({ cuentaDestino: '', nombreCuenta: 'PEREZ GOMEZ JUAN CARL' }).estado).toBe('valido');
  });
  it('una letra de diferencia en una palabra de 5+: aproximado', () => {
    expect(califica({ cuentaDestino: '', nombreCuenta: 'PERES GOMEZ JUAN CARLOS' }))
      .toMatchObject({ estado: 'aproximado', motivo: 'nombre_aproximado' });
    expect(nombreCoincideConUnaLetra('Juan Pérez', 'Juan Peres')).toBe('aproximado');
  });
  it('más de una letra de diferencia: no. «Juan Pérez» frente a «Juan López» es INVÁLIDO', () => {
    expect(nombreCoincideConUnaLetra('Juan Pérez', 'Juan López')).toBe('no');
    expect(califica({ cuentaDestino: '', nombreCuenta: 'Juan López' }, { nombreCuenta: 'Juan Pérez' }))
      .toMatchObject({ estado: 'invalido', motivo: 'nombre_distinto' });
  });
  it('una letra en una palabra de menos de 5 no se perdona', () => {
    expect(nombreCoincideConUnaLetra('Ana Soto', 'Ana Sato')).toBe('no');
  });
  it('un dato que figura y no coincide descalifica aunque el otro coincida', () => {
    expect(califica({ nombreCuenta: 'MARIA LOPEZ' })).toMatchObject({ estado: 'invalido', motivo: 'nombre_distinto' });
    expect(califica({ cuentaDestino: '9000000999' })).toMatchObject({ estado: 'invalido', motivo: 'cuenta_distinta' });
  });
  it('un nombre muy distinto, sin cuenta visible, no basta (P1)', () => {
    expect(califica({ cuentaDestino: '', nombreCuenta: 'MARIA LOPEZ' }).estado).toBe('invalido');
  });
  it('cuenta enmascarada que calza con el QR', () => {
    expect(califica({ cuentaDestino: '100*****890', nombreCuenta: '' }).estado).toBe('valido');
  });
});

describe('P1b: el nombre solo vale por sí solo con DOS palabras que coincidan', () => {
  const nombre = (leido: string, esp = 'Juan Perez Gomez') =>
    califica({ cuentaDestino: '', nombreCuenta: leido }, { nombreCuenta: esp });
  it('«JUAN» solo frente a «Juan Perez» es inválido con `destino_no_coincide`', () => {
    expect(nombre('JUAN', 'Juan Perez')).toMatchObject({ estado: 'invalido', motivo: 'destino_no_coincide' });
    expect(nombre('PEREZ', 'Juan Perez')).toMatchObject({ estado: 'invalido', motivo: 'destino_no_coincide' });
  });
  it('con una sola palabra coincidente pero la CUENTA coincide: vale', () => {
    expect(califica({ nombreCuenta: 'JUAN' }, { nombreCuenta: 'Juan Perez' }).estado).toBe('valido');
  });
  it('orden invertido con dos palabras: válido', () => {
    expect(nombre('PEREZ JUAN').estado).toBe('valido');
  });
  it('truncado con dos palabras: «Juan Pér» frente a «Juan Perez Gomez» vale, como aproximado (prefijo de 3 letras)', () => {
    expect(nombre('Juan Pér').estado).toBe('aproximado');
    expect(nombre('JUAN PEREZ GOM').estado).toBe('aproximado');
    // Con 4 letras o más del principio es completo.
    expect(nombre('Juan Pere').estado).toBe('valido');
  });
  it('«PERES GOMES» frente a «Perez Gomez»: aproximado (dos palabras con una letra cada una)', () => {
    expect(nombre('PERES GOMES', 'Perez Gomez')).toMatchObject({ estado: 'aproximado', motivo: 'nombre_aproximado' });
  });
  it('una palabra buena y una distinta sigue siendo `nombre_distinto`', () => {
    expect(nombre('JUAN LOPEZ', 'Juan Perez')).toMatchObject({ estado: 'invalido', motivo: 'nombre_distinto' });
  });
  it('la función: exacto, aproximado, insuficiente y no', () => {
    expect(nombreCoincideConUnaLetra('Juan Perez', 'PEREZ JUAN')).toBe('exacto');
    expect(nombreCoincideConUnaLetra('Perez Gomez', 'PERES GOMES')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'JUAN')).toBe('insuficiente');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'Juan Lopez')).toBe('no');
  });
});

describe('P1b: el emparejamiento es uno a uno y la dirección importa (esperado, leído)', () => {
  const no = (esp: string, leido: string) => expect(nombreCoincideConUnaLetra(esp, leido), `${esp} / ${leido}`).not.toMatch(/^(exacto|aproximado)$/);
  it('NO válidos: una palabra repetida, o una palabra del esperado que no está', () => {
    no('Rosa Rosales', 'ROSA MAMANI');
    no('Ana Anaya', 'ANA LOPEZ');
    no('Juan Carlos Perez', 'PEREZ PEREZ');
  });
  it('NO válidos: el prefijo vale solo si lo TRUNCADO es lo leído (ANA no valida ANABEL)', () => {
    no('Ana Rojas', 'ANABEL ROJAS');
    no('Pedro Paz', 'PEDRO PAZOS');
    no('Eva Mendoza', 'EVANGELINA MENDOZA');
    no('Ana Paz', 'ANABEL PAZOS');
  });
  it('NO válidos: iniciales y prefijos de 3 letras, solos, no alcanzan', () => {
    expect(nombreCoincideConUnaLetra('Juan Perez', 'J P')).toBe('insuficiente');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'JUA PER')).toBe('insuficiente');
    no('Juan Carlos Perez', 'J J');
  });
  it('el mismo caso por la calificación completa: inválido con `destino_no_coincide` o `nombre_distinto`', () => {
    for (const [esp, leido] of [['Juan Perez', 'J P'], ['Juan Perez', 'JUA PER'], ['Ana Rojas', 'ANABEL ROJAS'], ['Pedro Paz', 'PEDRO PAZOS']] as const) {
      expect(califica({ cuentaDestino: '', nombreCuenta: leido }, { nombreCuenta: esp }).estado, `${esp}/${leido}`).toBe('invalido');
    }
  });
  it('una inicial o un prefijo de 3 NUNCA dan exacto, y un prefijo de 2 letras no es nada', () => {
    expect(nombreCoincideConUnaLetra('Juan Perez', 'J PEREZ')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'JUA PEREZ')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'JU PEREZ')).toBe('no');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'JUAN PEREZ')).toBe('exacto');
  });
  it('distancia 2 no vale, aunque las palabras sean largas', () => {
    expect(nombreCoincideConUnaLetra('Juan Perez', 'Juan Perso')).toBe('no');
    expect(nombreCoincideConUnaLetra('Juan Perez', 'Juan Perea')).toBe('aproximado');
  });
  it('los positivos de Andres siguen: invertido, truncado a 4+ y una letra por palabra', () => {
    expect(nombreCoincideConUnaLetra('Juan Perez Gomez', 'PEREZ JUAN')).toBe('exacto');
    expect(nombreCoincideConUnaLetra('Juan Perez Gomez', 'Juan Pér')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('Perez Gomez', 'PERES GOMES')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('Juan Carlos Perez Gomez', 'PEREZ GOMEZ JUAN CARL')).toBe('exacto');
  });
});

describe('P1b: iniciales del lado ESPERADO y tope contra la búsqueda explosiva', () => {
  it('«Juan C. Perez» frente a «JUAN CARLOS PEREZ» vale como aproximado, nunca exacto', () => {
    expect(nombreCoincideConUnaLetra('Juan C. Perez', 'JUAN CARLOS PEREZ')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('Maria J. Rodriguez', 'MARIA JOSE RODRIGUEZ')).toBe('aproximado');
    expect(nombreCoincideConUnaLetra('J. Perez', 'JUAN PEREZ')).toBe('aproximado');
    expect(califica({ cuentaDestino: '', nombreCuenta: 'JUAN CARLOS PEREZ' }, { nombreCuenta: 'Juan C. Perez' }).estado).toBe('aproximado');
  });
  it('si TODAS las coincidencias son iniciales, insuficiente; y una inicial que no es la de la palabra, no', () => {
    expect(nombreCoincideConUnaLetra('J. P.', 'JUAN PEREZ')).toBe('insuficiente');
    expect(nombreCoincideConUnaLetra('Juan K. Perez', 'JUAN CARLOS PEREZ')).toBe('no');
  });
  it('el emparejamiento prefiere el que tiene una coincidencia fuerte: «Jose Jaime» frente a «J JAI JOSE»', () => {
    expect(nombreCoincideConUnaLetra('Jose Jaime', 'J JAI JOSE')).toBe('aproximado');
  });
  it('60 iniciales «M» no cuelgan la transacción: responde en menos de 50 ms', () => {
    for (const esp of ['Maria Mercedes Mamani Mendoza Molina', 'Maria Magdalena Mamani Mendoza Mercado']) {
      const t0 = performance.now();
      expect(nombreCoincideConUnaLetra(esp, 'M '.repeat(60))).toBe('no');
      expect(performance.now() - t0).toBeLessThan(50);
    }
    // Y con el máximo permitido (8 contra 8, todas con la misma inicial) tampoco.
    const t1 = performance.now();
    nombreCoincideConUnaLetra('Mario Marta Mateo Maria Mabel Magno Mavil Maxi', 'M M M M M M M M');
    expect(performance.now() - t1).toBeLessThan(200);
  });
  it('un nombre leído de más de 8 palabras no es un nombre', () => {
    expect(nombreCoincideConUnaLetra('Juan Perez', 'JUAN PEREZ AA BB CC DD FF GG HH')).toBe('no');
  });
});

describe('el monto numérico llega como lo da el modelo, sin pasar por texto', () => {
  it('100.004 es 100 y 350.00000000000006 es 350 (con String() se leían mal)', () => {
    expect(califica({ monto: 100.004 }).estado).toBe('valido');
    expect(califica({ monto: 350.00000000000006 }, {}, 350).estado).toBe('valido');
    expect(califica({ monto: 100 }).montoLeido).toBe(100);
  });
});

describe('«no es comprobante»: falta monto, o fecha, o a la vez cuenta y nombre', () => {
  it('sin monto', () => expect(califica({ monto: '' })).toMatchObject({ estado: 'no_es_comprobante', motivo: 'falta_monto' }));
  it('sin fecha', () => expect(califica({ fecha: '', hora: '' })).toMatchObject({ estado: 'no_es_comprobante', motivo: 'falta_fecha' }));
  it('sin cuenta ni nombre', () => expect(califica({ cuentaDestino: '', nombreCuenta: '' }))
    .toMatchObject({ estado: 'no_es_comprobante', motivo: 'falta_destino' }));
  it('con uno de los dos destinatarios ya es un comprobante', () => {
    expect(califica({ nombreCuenta: '' }).estado).not.toBe('no_es_comprobante');
  });
});

describe('la prioridad de los motivos y la distancia de edición', () => {
  it('con varios problemas, el motivo es el primero: monto, fecha, destino', () => {
    const c = califica({ monto: '50', hora: '10:00', nombreCuenta: 'otro nombre' });
    expect(c.estado).toBe('invalido');
    expect(c.motivos).toEqual(['monto_menor', 'fecha_anterior', 'nombre_distinto']);
    expect(c.motivo).toBe('monto_menor');
  });
  it('Levenshtein', () => {
    expect(distanciaDeEdicion('PEREZ', 'PERES')).toBe(1);
    expect(distanciaDeEdicion('PEREZ', 'LOPEZ')).toBe(3);
    expect(distanciaDeEdicion('', 'ABC')).toBe(3);
    expect(distanciaDeEdicion('ABC', 'ABC')).toBe(0);
  });
  it('un cotejo aproximado nunca sale con montoDistinto si el monto es igual', () => {
    expect(califica({ hora: '' }).montoDistinto).toBe(false);
  });
});
