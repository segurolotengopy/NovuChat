/**
 * LA LÓGICA PURA DE LA COLA DE LA CAMPAÑA SALIENTE (PR-C, 27/11/2026): `salidaCampana.ts` sin emulador ni red.
 * Cada prueba falla si se quita lo que prueba. La materialización con Firestore está en `salida-campana.test.ts`.
 */
import { describe, expect, it } from 'vitest';

const M = await import('../../functions/src/core/conversacion/salidaCampana.ts');

const CFG = { porTanda: 45, porDia: 200, porReclamo: 3, ventanaDias: 60, pausaErroresPct: 10, pausaMinimoEnviados: 10, pausaNoPct: 25 };

describe('leerConfigCampana: todo entero ≥ 1, o la campaña queda cerrada', () => {
  it('las cifras de DP2 se leen tal cual', () => {
    expect(M.leerConfigCampana(CFG)).toEqual(CFG);
  });
  it.each([
    ['nulo', null], ['ausente', undefined], ['lista', [1, 2]], ['texto', '45'], ['vacío', {}],
  ])('NIEGA: %s', (_n, valor) => {
    expect(M.leerConfigCampana(valor)).toBeNull();
  });
  it.each([
    ['«45» como texto', { ...CFG, porTanda: '45' }], ['0', { ...CFG, porDia: 0 }], ['negativo', { ...CFG, porDia: -1 }],
    ['decimal', { ...CFG, porTanda: 45.5 }], ['NaN', { ...CFG, porTanda: Number.NaN }], ['Infinity', { ...CFG, porTanda: Number.POSITIVE_INFINITY }],
    ['porReclamo 11', { ...CFG, porReclamo: 11 }], ['pausaErroresPct 101', { ...CFG, pausaErroresPct: 101 }],
    ['pausaNoPct 101', { ...CFG, pausaNoPct: 101 }], ['null en un campo', { ...CFG, ventanaDias: null }],
  ])('NIEGA: %s', (_n, d) => {
    expect(M.leerConfigCampana(d)).toBeNull();
  });
  it('NIEGA: falta cada uno de los siete campos', () => {
    for (const k of Object.keys(CFG)) {
      const { [k]: _quitado, ...resto } = CFG as Record<string, number>;
      expect(M.leerConfigCampana(resto), k).toBeNull();
    }
  });
  it('control: porReclamo 10 y los porcentajes 100 valen (los límites exactos)', () => {
    expect(M.leerConfigCampana({ ...CFG, porReclamo: 10, pausaErroresPct: 100, pausaNoPct: 100 })).not.toBeNull();
  });
  it('un campo heredado del prototipo no cuenta', () => {
    expect(M.leerConfigCampana(Object.create(CFG))).toBeNull();
  });
});

describe('patrones y claves: uno por contacto, por estructura', () => {
  it('la clave del mensaje es determinista: camp_<campana>_<dígitos>', () => {
    expect(M.claveDeMensajeCampana('camp-prueba', 'wa_59171234567')).toBe('camp_camp-prueba_59171234567');
    expect(M.claveDeMensajeCampana('camp-prueba', 'wa_59171234567')).toBe(M.claveDeMensajeCampana('camp-prueba', 'wa_59171234567'));
  });
  it('la clave del mensaje cumple el patrón de claves de envío del servidor con el menor id y el menor teléfono', async () => {
    const { CLAVE_DE_ENVIO } = await import('../../functions/src/core/conversacion/salidaPersona.ts');
    expect(CLAVE_DE_ENVIO.test(M.claveDeMensajeCampana('abc', 'wa_12345678'))).toBe(true);
    expect(CLAVE_DE_ENVIO.test(M.claveDeMensajeCampana('a'.repeat(40), 'wa_' + '9'.repeat(15)))).toBe(true);
  });
  it('DESTINATARIO_ID: wa_ + 8 a 15 dígitos; NIEGA +591…, 591… sin wa_, espacios, letras y largos', () => {
    for (const bueno of ['wa_59171234567', 'wa_12345678', 'wa_' + '1'.repeat(15)]) expect(M.DESTINATARIO_ID.test(bueno), bueno).toBe(true);
    for (const malo of ['wa_+59171234567', '59171234567', 'wa_591 71234567', 'wa_5917123456a', 'wa_1234567', 'wa_' + '1'.repeat(16), 'WA_59171234567', 'wa_59171234567\n', '']) {
      expect(M.DESTINATARIO_ID.test(malo), JSON.stringify(malo)).toBe(false);
    }
  });
  it('TANDA_ID: minúsculas, dígitos y guiones, 1 a 20', () => {
    for (const bueno of ['t1', 'tanda-01', 'a'.repeat(20)]) expect(M.TANDA_ID.test(bueno), bueno).toBe(true);
    for (const malo of ['', 'T1', 'a'.repeat(21), 'tanda 1', 'tanda_1', 'a/b']) expect(M.TANDA_ID.test(malo), malo).toBe(false);
  });
  it('el día es el de La Paz (UTC-4): a las 03:30 UTC todavía es el día anterior', () => {
    expect(M.diaDeLaPaz(Date.UTC(2026, 10, 27, 3, 30))).toBe('2026-11-26');
    expect(M.diaDeLaPaz(Date.UTC(2026, 10, 27, 4, 0))).toBe('2026-11-27');
  });
});

describe('cupoDeLaVuelta', () => {
  const base = { libres: 10, config: CFG as never, tanda: { cupo: 45, usados: 0 }, nDia: 0, enVuelo: 0 };
  it('es el mínimo de libres, porReclamo, lo que resta de la tanda y lo que resta del día', () => {
    expect(M.cupoDeLaVuelta(base)).toBe(3);
    expect(M.cupoDeLaVuelta({ ...base, libres: 2 })).toBe(2);
    expect(M.cupoDeLaVuelta({ ...base, tanda: { cupo: 5, usados: 4 } })).toBe(1);
    expect(M.cupoDeLaVuelta({ ...base, nDia: 199 })).toBe(1);
  });
  it.each([
    ['con algo en vuelo', { enVuelo: 1 }], ['cupo mayor que porTanda', { tanda: { cupo: 46, usados: 0 } }],
    ['tanda agotada', { tanda: { cupo: 5, usados: 5 } }], ['día completo', { nDia: 200 }], ['día excedido', { nDia: 500 }],
    ['sin lugares libres', { libres: 0 }], ['tanda con usados de más', { tanda: { cupo: 5, usados: 9 } }],
    ['un número roto (NaN)', { nDia: Number.NaN }],
  ])('NIEGA: %s da 0', (_n, cambio) => {
    expect(M.cupoDeLaVuelta({ ...base, ...cambio })).toBe(0);
  });
  it('cupo igual a porTanda sí sale (el límite exacto)', () => {
    expect(M.cupoDeLaVuelta({ ...base, tanda: { cupo: 45, usados: 0 } })).toBe(3);
  });
});

describe('cuentaDeTransicion: solo las transiciones válidas, y el repetido no cuenta dos veces', () => {
  it.each([
    ['enviando', 'aceptado', { aceptados: 1, rechazados: 0, inciertos: 0 }],
    ['enviando', 'rechazado', { aceptados: 0, rechazados: 1, inciertos: 0 }],
    ['enviando', 'incierto', { aceptados: 0, rechazados: 0, inciertos: 1 }],
    ['incierto', 'aceptado', { aceptados: 1, rechazados: 0, inciertos: -1 }],
    ['incierto', 'rechazado', { aceptados: 0, rechazados: 1, inciertos: -1 }],
  ])('%s -> %s', (de, a, esperado) => {
    expect(M.cuentaDeTransicion(de, a)).toEqual(esperado);
  });
  it.each([
    ['aceptado', 'aceptado'], ['rechazado', 'rechazado'], ['enviando', 'enviando'], ['incierto', 'incierto'], ['aceptado', 'rechazado'],
    ['rechazado', 'aceptado'], ['pendiente', 'aceptado'], ['enviando', 'pendiente'], [undefined, 'aceptado'], ['enviando', undefined],
  ])('NIEGA: %s -> %s no cuenta', (de, a) => {
    expect(M.cuentaDeTransicion(de, a)).toBeNull();
  });
});

describe('debePausar: por encima del porcentaje y con el mínimo de resueltos', () => {
  it('exactamente el 10 % NO pausa; por encima sí', () => {
    expect(M.debePausar({ aceptados: 9, rechazados: 1 }, CFG)).toBe(false);
    expect(M.debePausar({ aceptados: 8, rechazados: 2 }, CFG)).toBe(true);
  });
  it('por debajo del mínimo (9 resueltos) no pausa ni con todo rechazado; con 10 sí', () => {
    expect(M.debePausar({ aceptados: 0, rechazados: 9 }, CFG)).toBe(false);
    expect(M.debePausar({ aceptados: 0, rechazados: 10 }, CFG)).toBe(true);
  });
  it('5 rechazos de 10 pausan', () => {
    expect(M.debePausar({ aceptados: 5, rechazados: 5 }, CFG)).toBe(true);
  });
  it('los INCIERTOS cuentan como no confirmados: 8 aceptados y 2 inciertos pausan; 9 y 1 (exactamente 10 %) no; sin inciertos nada cambia', () => {
    expect(M.debePausar({ aceptados: 8, rechazados: 0, inciertos: 2 }, CFG)).toBe(true);
    expect(M.debePausar({ aceptados: 9, rechazados: 0, inciertos: 1 }, CFG)).toBe(false);
    expect(M.debePausar({ aceptados: 7, rechazados: 1, inciertos: 2 }, CFG)).toBe(true);
    expect(M.debePausar({ aceptados: 0, rechazados: 0, inciertos: 10 }, CFG)).toBe(true);
    expect(M.debePausar({ aceptados: 0, rechazados: 0, inciertos: 9 }, CFG)).toBe(false);
  });
  it('NIEGA: inciertos rotos (negativos, decimales) no pausan', () => {
    expect(M.debePausar({ aceptados: 1, rechazados: 0, inciertos: -3 }, CFG)).toBe(false);
    expect(M.debePausar({ aceptados: 0, rechazados: 0, inciertos: 10.5 }, CFG)).toBe(false);
  });
  it('cambiosDeCampana: una transición a incierto que pasa el porcentaje pausa la campaña', () => {
    const d = { estado: 'enCurso', aceptados: 8, rechazados: 0, inciertos: 1 };
    expect(M.cambiosDeCampana(d, { aceptados: 0, rechazados: 0, inciertos: 1 }, CFG)).toEqual({ aceptados: 8, rechazados: 0, inciertos: 2, estado: 'pausada', motivoPausa: 'errores' });
  });
  it('NIEGA: contadores rotos (negativos, decimales) no pausan', () => {
    expect(M.debePausar({ aceptados: -5, rechazados: 20 }, CFG)).toBe(false);
    expect(M.debePausar({ aceptados: 10, rechazados: 1.5 }, CFG)).toBe(false);
  });
});

describe('leerCampanaEnCurso y cambiosDeCampana', () => {
  const buena = {
    estado: 'enCurso', phoneNumberId: '1000', tanda: { id: 't1', cupo: 5, usados: 1 }, materializados: 3, aceptados: 1, rechazados: 0, inciertos: 0,
  };
  it('lee una campaña válida y calcula lo que está en vuelo', () => {
    expect(M.leerCampanaEnCurso('camp-prueba', buena, '1000')).toEqual({ id: 'camp-prueba', tanda: { id: 't1', cupo: 5, usados: 1 }, enVuelo: 2, materializados: 3 });
  });
  it.each([
    ['sin documento', undefined], ['creada', { ...buena, estado: 'creada' }], ['pausada', { ...buena, estado: 'pausada' }],
    ['terminada', { ...buena, estado: 'terminada' }], ['otra línea', { ...buena, phoneNumberId: '2000' }],
    ['sin tanda', { ...buena, tanda: null }], ['tanda con id inválido', { ...buena, tanda: { id: 'T 1', cupo: 5, usados: 1 } }],
    ['cupo 0', { ...buena, tanda: { id: 't1', cupo: 0, usados: 0 } }], ['usados negativos', { ...buena, tanda: { id: 't1', cupo: 5, usados: -1 } }],
    ['contador en texto', { ...buena, aceptados: '1' }], ['contadores incoherentes (más resueltos que enviados)', { ...buena, aceptados: 4 }],
  ])('NIEGA: %s', (_n, d) => {
    expect(M.leerCampanaEnCurso('camp-prueba', d as never, '1000')).toBeNull();
  });
  it('cambiosDeCampana: suma la transición y pausa solo si se pasa del porcentaje con el mínimo', () => {
    const d = { estado: 'enCurso', aceptados: 7, rechazados: 2, inciertos: 0 };
    expect(M.cambiosDeCampana(d, { aceptados: 0, rechazados: 1, inciertos: 0 }, CFG)).toEqual({ aceptados: 7, rechazados: 3, inciertos: 0, estado: 'pausada', motivoPausa: 'errores' });
    expect(M.cambiosDeCampana(d, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG)).toEqual({ aceptados: 8, rechazados: 2, inciertos: 0, estado: 'pausada', motivoPausa: 'errores' });
    const sano = { estado: 'enCurso', aceptados: 18, rechazados: 2, inciertos: 0 };
    expect(M.cambiosDeCampana(sano, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG)).toEqual({ aceptados: 19, rechazados: 2, inciertos: 0 });
  });
  it('cambiosDeCampana con `baseDePausa` (tras reanudar): solo cuenta lo ocurrido DESPUÉS de la base; sin base, o con una base ilegible, cuenta lo acumulado', () => {
    const viejo = { estado: 'enCurso', aceptados: 5, rechazados: 5, inciertos: 0 }; // 50 % de fallas: hoy pausaría en la primera confirmación
    const sinBase = M.cambiosDeCampana(viejo, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG);
    expect(sinBase).toMatchObject({ estado: 'pausada', motivoPausa: 'errores' });
    const base = { aceptados: 5, rechazados: 5, inciertos: 0, no: 0 };
    // Con base: 1 aceptado desde la base -> 1 desenlace, bajo el mínimo (10): no pausa.
    expect(M.cambiosDeCampana({ ...viejo, baseDePausa: base }, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG)).toEqual({ aceptados: 6, rechazados: 5, inciertos: 0 });
    // Con base y 10 desenlaces nuevos de los cuales 2 de 10 (20 %) fallan: SÍ pausa (mismo mínimo, mismo porcentaje).
    const despues = { estado: 'enCurso', aceptados: 13, rechazados: 6, inciertos: 1, baseDePausa: base };
    expect(M.cambiosDeCampana(despues, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG)).toMatchObject({ estado: 'pausada', motivoPausa: 'errores' });
    // Con base y exactamente el 10 % desde la base: no pausa (borde).
    const borde = { estado: 'enCurso', aceptados: 14, rechazados: 6, inciertos: 0, baseDePausa: base };
    expect(M.cambiosDeCampana(borde, { aceptados: 0, rechazados: 0, inciertos: 0 }, CFG)).toEqual({ aceptados: 14, rechazados: 6, inciertos: 0 });
    // Una base ilegible no relaja nada: se evalúa lo acumulado.
    for (const mala of [null, 'x', [1], { aceptados: -1, rechazados: 0, inciertos: 0 }, { aceptados: 5, rechazados: 5 }, { aceptados: '5', rechazados: 5, inciertos: 0 }]) {
      expect(M.cambiosDeCampana({ ...viejo, baseDePausa: mala }, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG), JSON.stringify(mala)).toMatchObject({ estado: 'pausada' });
    }
    // Un incierto anterior a la base que se resuelve después no resta: la diferencia negativa cuenta 0.
    expect(M.contadoresDesdeLaBase({ aceptados: 6, rechazados: 5, inciertos: 0 }, { aceptados: 5, rechazados: 5, inciertos: 1, no: 0 })).toEqual({ aceptados: 1, rechazados: 0, inciertos: 0 });
  });
  it('cambiosDeCampana: sin config legible cuenta pero no pausa; con contadores rotos no escribe nada; una pausada no se vuelve a pausar', () => {
    const d = { estado: 'enCurso', aceptados: 0, rechazados: 10, inciertos: 0 };
    expect(M.cambiosDeCampana(d, { aceptados: 0, rechazados: 1, inciertos: 0 }, null)).toEqual({ aceptados: 0, rechazados: 11, inciertos: 0 });
    expect(M.cambiosDeCampana({ ...d, aceptados: 'x' }, { aceptados: 0, rechazados: 1, inciertos: 0 }, CFG)).toBeNull();
    expect(M.cambiosDeCampana({ ...d, estado: 'pausada' }, { aceptados: 0, rechazados: 1, inciertos: 0 }, CFG)).toEqual({ aceptados: 0, rechazados: 11, inciertos: 0 });
    expect(M.cambiosDeCampana({ ...d, inciertos: 0 }, { aceptados: 1, rechazados: 0, inciertos: -1 }, CFG)).toBeNull();
    expect(M.cambiosDeCampana(undefined, { aceptados: 1, rechazados: 0, inciertos: 0 }, CFG)).toBeNull();
  });
});

describe('plantillaDeCampanaValida (el contrato de la plantilla de campaña)', () => {
  const ok = { nombre: 'campana_chat', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 0, cabecera: 'ninguna', botones: 2 };
  it('acepta UTILITY y MARKETING', () => {
    expect(M.plantillaDeCampanaValida(ok)).toBe(true);
    expect(M.plantillaDeCampanaValida({ ...ok, categoria: 'MARKETING' })).toBe(true);
  });
  it.each([
    ['PENDING', { ...ok, estado: 'PENDING' }], ['con variables', { ...ok, variables: 1 }], ['variables como texto', { ...ok, variables: '0' }],
    ['con cabecera', { ...ok, cabecera: 'imagen' }], ['un solo botón', { ...ok, botones: 1 }], ['categoría AUTHENTICATION', { ...ok, categoria: 'AUTHENTICATION' }],
    ['nombre con mayúsculas', { ...ok, nombre: 'Campana' }], ['idioma raro', { ...ok, idioma: 'espanol' }], ['nulo', null], ['texto', 'x'],
  ])('NIEGA: %s', (_n, p) => {
    expect(M.plantillaDeCampanaValida(p)).toBe(false);
  });
});

describe('la excepción de la prueba: leerTelefonosDePrueba y motivoDePruebaRechazada (números ficticios)', () => {
  const T1 = '59170000001';
  const T2 = '59170000002';
  it('lee una lista válida de 1 a 5 y no la confunde con las cifras (leerConfigCampana no la devuelve)', () => {
    expect(M.leerTelefonosDePrueba({ ...CFG, telefonosDePrueba: [T1, T2] })).toEqual([T1, T2]);
    expect(M.leerTelefonosDePrueba({ telefonosDePrueba: [T1, T2, '59170000003', '59170000004', '59170000005'] })).toHaveLength(5);
    expect(M.leerConfigCampana({ ...CFG, telefonosDePrueba: [T1] })).toEqual(CFG);
  });
  it.each([
    ['nulo', null], ['sin el campo', CFG], ['vacía', { telefonosDePrueba: [] }], ['no es lista', { telefonosDePrueba: T1 }],
    ['6 números', { telefonosDePrueba: [T1, T2, '59170000003', '59170000004', '59170000005', '59170000006'] }],
    ['con +', { telefonosDePrueba: ['+59170000001'] }], ['corto', { telefonosDePrueba: ['1234567'] }], ['numérico', { telefonosDePrueba: [59170000001] }],
    ['con espacio', { telefonosDePrueba: ['59170000001 '] }], ['repetidos', { telefonosDePrueba: [T1, T1] }],
  ])('NIEGA: %s da [] (falla cerrada)', (_n, d) => {
    expect(M.leerTelefonosDePrueba(d)).toEqual([]);
  });
  it('motivoDePruebaRechazada: uno y en la lista pasa; varios, sin lista o fuera de la lista se rechazan; sin destinatarios no hay nada que decidir', () => {
    expect(M.motivoDePruebaRechazada([`wa_${T1}`], [T1, T2])).toBeNull();
    expect(M.motivoDePruebaRechazada([`wa_${T1}`, `wa_${T2}`], [T1, T2])).toBe('pruebaVariosDestinatarios');
    expect(M.motivoDePruebaRechazada([`wa_${T1}`], [])).toBe('pruebaSinLista');
    expect(M.motivoDePruebaRechazada([`wa_${T1}`], [T2])).toBe('pruebaFueraDeLista');
    expect(M.motivoDePruebaRechazada([], [T1])).toBeNull();
  });
});
