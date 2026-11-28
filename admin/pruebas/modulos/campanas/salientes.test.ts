/**
 * La lógica pura de la campaña saliente (PR-C): a quién se le escribe y cómo se parte. Sin Firestore ni red.
 * Cada exclusión se prueba NEGANDO: el teléfono excluido no está en la lista y su motivo suma uno.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Fila = { telefono: string; fecha: string; etapa: string };
type Conv = { ultimoEntranteEn?: number | null; bloqueada?: boolean; noContactar?: boolean; riesgoEn?: unknown; phoneNumberId?: string };
const L = await import('../../../scripts/modulos/campanas/salientes-logica.mjs') as unknown as {
  MOTIVOS: string[];
  claveDeContacto: (t: string) => string;
  telefonoValido: (v: unknown) => string | null;
  etapaCerrada: (v: unknown) => boolean;
  armarLista: (p: Record<string, unknown>) => { destinatarios: Array<{ telefono: string }>; conteos: Record<string, number> };
  partirEnTandas: (n: number, porTanda: number) => number[];
  superaNo: (p: { no: number; enviados: number; pausaNoPct: number }) => boolean;
};

const AHORA = Date.UTC(2026, 10, 27, 16, 0); // 27/11/2026 12:00 en La Paz
const HACE = (h: number) => AHORA - h * 3_600_000;
const NUMERO = 'linea-de-prueba';
const TEL = (n: number) => `5917000${String(n).padStart(4, '0')}`;
const fila = (n: number, o: Partial<Fila> = {}): Fila => ({ telefono: TEL(n), fecha: '2026-11-10', etapa: 'Nuevo', ...o });
const conv = (o: Conv = {}): Conv => ({ ultimoEntranteEn: HACE(72), phoneNumberId: NUMERO, ...o });

function lista(filas: Fila[], opts: { convs?: Array<[number, Conv]>; bajas?: number[]; prueba?: number[]; ventanaDias?: number | undefined } = {}) {
  const conversaciones = new Map<string, Conv>(opts.convs
    ? opts.convs.map(([n, c]) => [L.claveDeContacto(TEL(n)), c] as [string, Conv])
    : filas.map((f) => [L.claveDeContacto(f.telefono), conv()] as [string, Conv]));
  const bajas = new Set((opts.bajas ?? []).map((n) => L.claveDeContacto(TEL(n))));
  const telefonosDePrueba = new Set((opts.prueba ?? []).map(TEL));
  return L.armarLista({ filas, conversaciones, bajas, telefonosDePrueba, ahoraMs: AHORA, ventanaDias: 'ventanaDias' in opts ? opts.ventanaDias : 60, numero: NUMERO });
}
const aptos = (r: ReturnType<typeof lista>) => r.destinatarios.map((d) => d.telefono);

describe('claveDeContacto y teléfono válido (M2)', () => {
  it('la clave es wa_<dígitos>, la misma para la conversación y para la baja', () => {
    expect(L.claveDeContacto('59170000001')).toBe('wa_59170000001');
  });
  it('NEGATIVA: sin 591, con espacios, con guiones o con otro largo es inválido (y se cuenta, no se envía)', () => {
    for (const malo of ['70000001', '591 7000 0001', '591-70000001', '5915000000', '591700000012', '+', '']) expect(L.telefonoValido(malo)).toBeNull();
    const r = lista([fila(1, { telefono: '70000001' }), fila(2, { telefono: '591 70000002' }), fila(3)], { convs: [[3, conv()]] });
    expect(r.conteos['invalido']).toBe(2);
    expect(aptos(r)).toEqual([TEL(3)]);
  });
  it('un + inicial se tolera y se normaliza', () => {
    expect(L.telefonoValido('+59170000001')).toBe('59170000001');
  });
});

describe('armarLista: la lista y sus exclusiones', () => {
  it('el camino feliz: sale UNA vez por teléfono aunque tenga varias filas, con la fecha máxima', () => {
    const r = lista([fila(1, { fecha: '2026-10-20' }), fila(1, { fecha: '2026-11-10' })], { convs: [[1, conv()]] });
    expect(aptos(r)).toEqual([TEL(1)]);
    expect(r.conteos).toMatchObject({ filas: 2, telefonos: 1, filasRepetidas: 1, destinatarios: 1 });
  });

  it('NEGATIVA: Ganado o Perdido en la columna G de CUALQUIER fila excluye al teléfono; otra etapa no', () => {
    const r = lista([fila(1, { etapa: '5. Ganado' }), fila(2, { etapa: 'perdido' }), fila(3, { etapa: 'Nuevo' }), fila(4, { etapa: 'Nuevo' }), fila(4, { etapa: 'Perdido' })]);
    expect(r.conteos['cerrada']).toBe(3);
    expect(aptos(r)).toEqual([TEL(3)]);
  });
  it('NEGATIVA: el estado comercial (otra columna) NO decide: la fila ni lo trae', () => {
    const r = lista([{ ...fila(1), estado: 'Ganado' } as Fila]);
    expect(aptos(r)).toEqual([TEL(1)]);
    expect(L.etapaCerrada('Nuevo')).toBe(false);
    expect(L.etapaCerrada(undefined)).toBe(false);
  });
  it('NEGATIVA: fecha ilegible en alguna fila (o futura) excluye', () => {
    const r = lista([fila(1, { fecha: 'ayer' }), fila(2, { fecha: '30/02/2026' }), fila(3, { fecha: '2027-01-01' }), fila(4, { fecha: '' }), fila(5)]);
    expect(r.conteos['fechaIlegible']).toBe(4);
    expect(aptos(r)).toEqual([TEL(5)]);
  });
  it('NEGATIVA: un teléfono de prueba no recibe la campaña (motivo prueba)', () => {
    const r = lista([fila(1), fila(2)], { prueba: [1] });
    expect(r.conteos['prueba']).toBe(1);
    expect(aptos(r)).toEqual([TEL(2)]);
  });
  it('NEGATIVA: con baja en bajas/wa_<dígitos> no recibe (la misma clave que la conversación)', () => {
    const r = lista([fila(1), fila(2)], { bajas: [1] });
    expect(r.conteos['baja']).toBe(1);
    expect(aptos(r)).toEqual([TEL(2)]);
  });
  it('NEGATIVA: una baja guardada con otra forma de la clave NO coincide (por eso hay una sola: claveDeContacto)', () => {
    const conversaciones = new Map([[L.claveDeContacto(TEL(1)), conv()]]);
    const r = L.armarLista({ filas: [fila(1)], conversaciones, bajas: new Set([`wa_+${TEL(1)}`, TEL(1)]), telefonosDePrueba: new Set(), ahoraMs: AHORA, ventanaDias: 60, numero: NUMERO });
    expect(r.conteos['baja']).toBe(0);
    expect(r.destinatarios).toHaveLength(1);
  });
  it('NEGATIVA: bloqueada y noContactar con CUALQUIER valor distinto de ausente o false excluyen, igual que el servidor (marcado)', () => {
    const r = lista([fila(1), fila(2), fila(3), fila(4), fila(5), fila(6)], {
      convs: [[1, conv({ bloqueada: 'si' as unknown as boolean })], [2, conv({ noContactar: 1 as unknown as boolean })], [3, conv({ bloqueada: null as unknown as boolean })], [4, conv({ noContactar: 'false' as unknown as boolean })], [5, conv({ bloqueada: false, noContactar: false })], [6, conv({ bloqueada: undefined })]],
    });
    expect(r.conteos).toMatchObject({ bloqueada: 2, noContactar: 2 });
    expect(aptos(r).sort()).toEqual([TEL(5), TEL(6)]);
  });
  it('NEGATIVA: bloqueada, noContactar y riesgoEn con valor (no undefined ni false) excluyen', () => {
    const r = lista([fila(1), fila(2), fila(3), fila(4), fila(5), fila(6), fila(7)], {
      convs: [[1, conv({ bloqueada: true })], [2, conv({ noContactar: true })], [3, conv({ riesgoEn: 123 })], [4, conv({ riesgoEn: 'x' })], [5, conv({ riesgoEn: false })], [6, conv({ riesgoEn: undefined })], [7, conv({ bloqueada: false, noContactar: false })]],
    });
    expect(r.conteos).toMatchObject({ bloqueada: 1, noContactar: 1, riesgo: 2 });
    expect(aptos(r).sort()).toEqual([TEL(5), TEL(6), TEL(7)]);
  });
  it('NEGATIVA: fuera de la ventana (por la fecha MÁXIMA y por ventanaDias de la config) no recibe; justo en el límite sí', () => {
    // 27/11 menos 60 días = 28/09: ese día entra, el anterior no.
    const r = lista([fila(1, { fecha: '2026-09-28' }), fila(2, { fecha: '2026-09-27' }), fila(3, { fecha: '2026-01-01' })]);
    expect(r.conteos['fueraDeVentana']).toBe(2);
    expect(aptos(r)).toEqual([TEL(1)]);
    const corta = lista([fila(1, { fecha: '2026-11-10' })], { ventanaDias: 10 });
    expect(corta.conteos['fueraDeVentana']).toBe(1);
  });
  it('NEGATIVA: sin ventanaDias NO hay lista (es obligatorio, no hay valor por omisión)', () => {
    for (const malo of [undefined, 0, -1, 1.5, '60' as unknown as number]) expect(() => lista([fila(1)], { ventanaDias: malo })).toThrow(/ventanaDias/);
  });
  it('NEGATIVA: sin conversación, o sin ultimoEntranteEn legible, no recibe (motivo sinConversacion)', () => {
    const r = lista([fila(1), fila(2), fila(3)], { convs: [[2, conv({ ultimoEntranteEn: null })], [3, conv()]] });
    expect(r.conteos['sinConversacion']).toBe(2);
    expect(aptos(r)).toEqual([TEL(3)]);
  });
  it('NEGATIVA: una conversación de OTRA línea no recibe por esta (motivo otraLinea)', () => {
    const r = lista([fila(1), fila(2)], { convs: [[1, conv({ phoneNumberId: 'otra-linea' })], [2, conv()]] });
    expect(r.conteos['otraLinea']).toBe(1);
    expect(aptos(r)).toEqual([TEL(2)]);
  });
  it('VISIBILIDAD: una conversación SIN phoneNumberId sigue contando como de esta línea (recibe) y se cuenta aparte en `sinPhoneNumberId`; no cambia a quién se le escribe', () => {
    const sinLinea = { ultimoEntranteEn: HACE(72) } as Conv;
    const r = lista([fila(1), fila(2), fila(3)], { convs: [[1, sinLinea], [2, conv()], [3, conv({ phoneNumberId: 'otra-linea' })]] });
    expect(aptos(r)).toEqual([TEL(1), TEL(2)]);
    expect(r.conteos['sinPhoneNumberId']).toBe(1);
    expect(r.conteos['otraLinea']).toBe(1);
    expect(lista([fila(1)]).conteos['sinPhoneNumberId']).toBe(0);
  });
  it('NEGATIVA: quien escribió hace menos de 24 h no recibe (motivo reciente); a las 24 h exactas sí', () => {
    const r = lista([fila(1), fila(2), fila(3)], { convs: [[1, conv({ ultimoEntranteEn: HACE(1) })], [2, conv({ ultimoEntranteEn: HACE(23.9) })], [3, conv({ ultimoEntranteEn: HACE(24) })]] });
    expect(r.conteos['reciente']).toBe(2);
    expect(aptos(r)).toEqual([TEL(3)]);
  });

  it('la suma de los motivos más los destinatarios da el total de teléfonos distintos, y cada uno cae en UN solo motivo', () => {
    const filas = [fila(1, { telefono: 'x' }), fila(2, { etapa: 'Ganado' }), fila(3, { fecha: 'x' }), fila(4), fila(5), fila(6), fila(7), fila(8), fila(9, { fecha: '2025-01-01' }), fila(10), fila(11), fila(12), fila(12)];
    const r = lista(filas, {
      prueba: [4], bajas: [5], convs: [[6, conv({ bloqueada: true })], [7, conv({ noContactar: true })], [8, conv({ riesgoEn: 1 })], [10, conv({ phoneNumberId: 'otra' })], [11, conv({ ultimoEntranteEn: HACE(2) })], [12, conv()]],
    });
    const suma = L.MOTIVOS.reduce((a, m) => a + (r.conteos[m] ?? 0), 0) + r.conteos['destinatarios'];
    expect(suma).toBe(r.conteos['telefonos']);
    expect(r.conteos['telefonos']).toBe(12);
    expect(r.conteos['destinatarios']).toBe(1);
    expect(L.MOTIVOS).toEqual(['invalido', 'cerrada', 'fechaIlegible', 'prueba', 'baja', 'bloqueada', 'noContactar', 'riesgo', 'fueraDeVentana', 'sinConversacion', 'otraLinea', 'reciente']);
  });
  it('los conteos nunca traen un teléfono', () => {
    const r = lista([fila(1), fila(2, { etapa: 'Ganado' })]);
    expect(JSON.stringify(r.conteos)).not.toMatch(/\d{7,}/);
  });
});

describe('armarLista con la excepción de la prueba: levanta SOLO 24 h, sin conversación, ventana y teléfono de prueba', () => {
  const conExcepcion = (filas: Fila[], opts: { convs?: Array<[number, Conv]>; bajas?: number[]; prueba?: number[]; excepcion?: boolean } = {}) => {
    const conversaciones = new Map<string, Conv>((opts.convs ?? []).map(([n, c]) => [L.claveDeContacto(TEL(n)), c] as [string, Conv]));
    return L.armarLista({
      filas, conversaciones, bajas: new Set((opts.bajas ?? []).map((n) => L.claveDeContacto(TEL(n)))), telefonosDePrueba: new Set((opts.prueba ?? []).map(TEL)),
      ahoraMs: AHORA, ventanaDias: 60, numero: NUMERO, excepcionPrueba: opts.excepcion ?? true,
    });
  };
  it('con la excepción: escribió hace 1 h, sin conversación, fecha fuera de la ventana y en la lista de prueba, SALE', () => {
    const r = conExcepcion([fila(1, { fecha: '2025-01-01' })], { convs: [[1, conv({ ultimoEntranteEn: HACE(1) })]], prueba: [1] });
    expect(aptos(r)).toEqual([TEL(1)]);
    expect(aptos(conExcepcion([fila(2)], { prueba: [2] }))).toEqual([TEL(2)]); // sin conversación
  });
  it('NIEGA: la misma lista SIN la excepción (campaña real) sigue excluyendo por 24 h, sin conversación, ventana y teléfono de prueba', () => {
    const r = conExcepcion([fila(1), fila(2), fila(3, { fecha: '2025-01-01' }), fila(4)], {
      excepcion: false, prueba: [4], convs: [[1, conv({ ultimoEntranteEn: HACE(1) })], [3, conv()], [4, conv()]],
    });
    expect(aptos(r)).toEqual([]);
    expect(r.conteos).toMatchObject({ reciente: 1, sinConversacion: 1, fueraDeVentana: 1, prueba: 1 });
  });
  it('NIEGA: con la excepción siguen rigiendo baja, bloqueada, noContactar, riesgo, otra línea, cerrada, fecha ilegible y teléfono inválido', () => {
    const r = conExcepcion([fila(1), fila(2), fila(3), fila(4), fila(5), fila(6, { etapa: 'Ganado' }), fila(7, { fecha: 'x' }), { telefono: '123', fecha: '2026-11-10', etapa: '' }], {
      bajas: [1], convs: [[2, conv({ bloqueada: true })], [3, conv({ noContactar: true })], [4, conv({ riesgoEn: 'x' })], [5, conv({ phoneNumberId: 'otra' })], [6, conv()], [7, conv()]],
    });
    expect(aptos(r)).toEqual([]);
    expect(r.conteos).toMatchObject({ baja: 1, bloqueada: 1, noContactar: 1, riesgo: 1, otraLinea: 1, cerrada: 1, fechaIlegible: 1, invalido: 1 });
  });
});

describe('partirEnTandas y superaNo', () => {
  it('parte en tandas de porTanda (el de la config), la última con lo que sobra', () => {
    expect(L.partirEnTandas(169, 45)).toEqual([45, 45, 45, 34]);
    expect(L.partirEnTandas(45, 45)).toEqual([45]);
    expect(L.partirEnTandas(0, 45)).toEqual([]);
    expect(L.partirEnTandas(10, 3)).toEqual([3, 3, 3, 1]);
  });
  it('NEGATIVA: un porTanda ilegible o un n negativo no se parten', () => {
    for (const malo of [0, -5, 4.5, Number.NaN]) expect(() => L.partirEnTandas(10, malo)).toThrow();
    expect(() => L.partirEnTandas(-1, 45)).toThrow();
    expect(() => L.partirEnTandas(10, undefined as unknown as number)).toThrow();
  });
  it('superaNo: ESTRICTAMENTE por encima del porcentaje; exactamente el 25 % no supera', () => {
    expect(L.superaNo({ no: 25, enviados: 100, pausaNoPct: 25 })).toBe(false);
    expect(L.superaNo({ no: 26, enviados: 100, pausaNoPct: 25 })).toBe(true);
    expect(L.superaNo({ no: 1, enviados: 4, pausaNoPct: 25 })).toBe(false);
    expect(L.superaNo({ no: 2, enviados: 7, pausaNoPct: 25 })).toBe(true);
    expect(L.superaNo({ no: 0, enviados: 0, pausaNoPct: 25 })).toBe(false);
    expect(L.superaNo({ no: 10, enviados: 100, pausaNoPct: 10 })).toBe(false);
  });
  it('NEGATIVA: datos ilegibles cuentan como «supera» (ante la duda no se autoriza)', () => {
    for (const p of [{ no: -1, enviados: 10, pausaNoPct: 25 }, { no: 1.5, enviados: 10, pausaNoPct: 25 }, { no: 11, enviados: 10, pausaNoPct: 25 }, { no: 1, enviados: 10, pausaNoPct: 0 }, { no: 1, enviados: 10, pausaNoPct: 101 }]) {
      expect(L.superaNo(p)).toBe(true);
    }
  });
});

describe('sin cifras de topes en el código', () => {
  it('NEGATIVA: salientes-logica.mjs no exporta TOPE_DIARIO, TANDA_*, VENTANA_DIAS, TAMANO_DE_SUBLOTE ni MINIMO_PARA_JUZGAR_ERRORES', () => {
    for (const k of ['TOPE_DIARIO', 'TANDA_MINIMA', 'TANDA_MAXIMA', 'VENTANA_DIAS', 'TAMANO_DE_SUBLOTE', 'MINIMO_PARA_JUZGAR_ERRORES', 'evaluarPausa']) expect(k in L).toBe(false);
  });
});

// Paridad con Core leyendo su FUENTE (sin importar lo compilado): si Core cambia un patrón y la copia del script no, falla.
const FUENTE = (r: string) => fileURLToPath(new URL(`../../../functions/src/core/conversacion/${r}`, import.meta.url));
const patron = (archivo: string, nombre: string) => new RegExp(`export const ${nombre} = /(.+)/;`).exec(readFileSync(FUENTE(archivo), 'utf8'))?.[1];
describe.skipIf(!existsSync(FUENTE('salidaCampana.ts')))('paridad con Core (fuente de functions/src)', () => {
  it('CAMPANA_ID (bajas.ts) y TANDA_ID (salidaCampana.ts) de las copias del script coinciden con los de Core', async () => {
    const s = await import('../../../scripts/modulos/campanas/campana-saliente.mjs') as unknown as { CAMPANA_ID: RegExp; TANDA_ID: RegExp };
    expect(patron('bajas.ts', 'CAMPANA_ID')).toBeDefined();
    expect(s.CAMPANA_ID.source).toBe(patron('bajas.ts', 'CAMPANA_ID'));
    expect(patron('salidaCampana.ts', 'TANDA_ID')).toBeDefined();
    expect(s.TANDA_ID.source).toBe(patron('salidaCampana.ts', 'TANDA_ID'));
  });
});

describe('paridad de la lista de teléfonos de prueba con Core (números ficticios)', () => {
  it('el script y el servidor leen la misma lista de la misma manera', async () => {
    const SERVIDOR = await import('../../../functions/src/core/conversacion/salidaCampana.ts') as unknown as { leerTelefonosDePrueba: (d: unknown) => string[]; MAXIMO_TELEFONOS_DE_PRUEBA: number };
    const S = L as unknown as { leerTelefonosDePrueba: (d: unknown) => string[]; MAXIMO_TELEFONOS_DE_PRUEBA: number };
    const [T1, T2] = ['59170000001', '59170000002'];
    expect(S.MAXIMO_TELEFONOS_DE_PRUEBA).toBe(SERVIDOR.MAXIMO_TELEFONOS_DE_PRUEBA);
    const casos = [null, undefined, [], 'x', {}, { telefonosDePrueba: [] }, { telefonosDePrueba: [T1] }, { telefonosDePrueba: [T1, T2] }, { telefonosDePrueba: [T1, T1] },
      { telefonosDePrueba: ['+59170000001'] }, { telefonosDePrueba: [T1, T2, '59170000003', '59170000004', '59170000005'] },
      { telefonosDePrueba: [T1, T2, '59170000003', '59170000004', '59170000005', '59170000006'] }, { telefonosDePrueba: [59170000001] }, { telefonosDePrueba: ['1234567'] },
      { telefonosDePrueba: T1 }];
    for (const d of casos) expect(S.leerTelefonosDePrueba(d), JSON.stringify(d)).toEqual(SERVIDOR.leerTelefonosDePrueba(d));
    expect(S.leerTelefonosDePrueba({ telefonosDePrueba: [T1] })).toEqual([T1]); // control: no es «todo vacío»
  });
});
