/**
 * Comprobantes recibidos en la consola de Cobros. Se prueba negando: ninguna palabra de la pantalla sugiere que el
 * dinero entró (prohibición 3), «Comprobado» no aparece en la lista, y la foto solo se ofrece con una ruta y un id
 * de conversación que la callable acepte.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AVISO_COMPROBANTES, ESTADO_POR_DEFECTO, TEXTO_SIN_COMPROBANTES, aplanarComprobantes, estadoEnPalabras, fechaDeLaPaz,
  telefonoEnmascarado, type ConversacionConComprobantes,
} from '../../../web/src/modulos/cobros/comprobantesRecibidos.ts';
import { COLUMNAS } from '../../../web/src/modulos/cobros/contadoresDeCobro.ts';

const carpeta = join(dirname(fileURLToPath(import.meta.url)), '../../../web/src/modulos/cobros');
// Teléfonos sintéticos armados en ejecución: el saneo del repo público no admite 10+ dígitos seguidos en el texto.
const WA_A = ['wa_5917', '1234567'].join('');
const WA_B = ['wa_5917', '1111111'].join('');
const WA_C = ['wa_5917', '2222222'].join('');
const T0 = Date.UTC(2026, 9, 20, 15, 30); // 11:30 en La Paz

const conv = (id: string, comprobantes: unknown, extra: Record<string, unknown> = {}, sol: Record<string, unknown> = {}): ConversacionConComprobantes => ({
  id, telefono: id.replace('wa_', ''), solicitud: { reglaCobro: 2, monto: 100, comprobantes, ...sol }, ...extra,
});

describe('estadoEnPalabras (tabla cerrada)', () => {
  it.each([
    ['valido', 'ok', 'Datos coinciden'],
    ['aproximado', 'monto_distinto', 'Coinciden en parte'],
    ['invalido', 'ilegible', 'Ilegible'],
    ['invalido', 'no_es_comprobante', 'Ilegible'],
    ['invalido', 'falta_monto', 'Ilegible'],
    ['invalido', 'falta_fecha', 'Ilegible'],
    ['invalido', 'falta_destino', 'Ilegible'],
    ['no_es_comprobante', 'ilegible', 'Ilegible'],
    ['invalido', 'monto_menor', 'No coincide el monto'],
    ['invalido', 'monto_mayor', 'No coincide el monto'],
    ['invalido', 'cuenta_distinta', 'No coinciden los datos'],
    ['invalido', 'nombre_distinto', 'No coinciden los datos'],
    ['invalido', 'fecha_anterior', 'No coinciden los datos'],
    ['invalido', 'fecha_posterior', 'No coinciden los datos'],
    ['invalido', 'destino_no_coincide', 'No coinciden los datos'],
    ['invalido', 'destino_no_verificable', 'No coinciden los datos'],
    ['invalido', undefined, 'No coinciden los datos'],
    ['en_revision', 'monto_menor', 'En revisión'],
    ['tardio', 'tardio', 'Llegó fuera de plazo'],
    ['algo_nuevo', 'x', ESTADO_POR_DEFECTO],
    [undefined, undefined, 'En revisión'],
    [42, null, 'En revisión'],
  ])('%s / %s -> %s', (estado, motivo, esperado) => {
    expect(estadoEnPalabras(estado, motivo)).toBe(esperado);
  });
});

describe('aplanarComprobantes', () => {
  it('una fila por comprobante, con todos los campos normalizados', () => {
    const filas = aplanarComprobantes([conv(WA_A, [
      { idMeta: 'm1', estado: 'invalido', motivo: 'monto_menor', en: new Date(T0), ruta: 'x/y.jpg', importe: 55, montoLeido: 50, intentos: 1 },
    ], { nombreContacto: 'Ana Rojas' })]);
    expect(filas).toEqual([{
      idMeta: 'm1', conversacionId: WA_A, fechaMs: T0, fecha: '20/10/2026 11:30', cliente: 'Ana Rojas',
      montoPedido: 55, montoLeido: 50, estadoPalabras: 'No coincide el monto', tieneFoto: true,
    }]);
  });

  it('sin nombre, el teléfono va enmascarado: ****+últimos 3, nunca entero', () => {
    const [f] = aplanarComprobantes([conv(WA_A, [{ idMeta: 'm1', estado: 'valido', en: new Date(T0) }])]);
    expect(f?.cliente).toBe('****567');
    expect(JSON.stringify(f)).not.toContain('5917123');
    expect(telefonoEnmascarado(undefined, WA_A)).toBe('****567');
    expect(telefonoEnmascarado('12', 'wa_x')).toBe('****');
    const [g] = aplanarComprobantes([conv(WA_A, [{ idMeta: 'm1' }], { nombreContacto: '   ' })]);
    expect(g?.cliente).toBe('****567');
  });

  it('sin ruta no hay foto; con ruta pero con un id de conversación que la callable rechazaría, tampoco', () => {
    const lista = [{ idMeta: 'a', ruta: 'r' }, { idMeta: 'b' }, { idMeta: 'c', ruta: '' }, { idMeta: 'd', ruta: null }];
    expect(aplanarComprobantes([conv(WA_A, lista)]).map((f) => f.tieneFoto)).toEqual([true, false, false, false]);
    expect(aplanarComprobantes([conv('c1', [{ idMeta: 'a', ruta: 'r' }])])[0]?.tieneFoto).toBe(false);
    expect(aplanarComprobantes([conv('wa_123', [{ idMeta: 'a', ruta: 'r' }])])[0]?.tieneFoto).toBe(false);
  });

  it('monto nulo o ausente se queda en null (la pantalla pinta «—»); el pedido cae al monto de la solicitud', () => {
    const [f] = aplanarComprobantes([conv(WA_A, [{ idMeta: 'a', montoLeido: null, importe: null }])]);
    expect(f).toMatchObject({ montoLeido: null, montoPedido: 100 });
    const [g] = aplanarComprobantes([conv(WA_A, [{ idMeta: 'a', montoLeido: 'x' }], {}, { monto: undefined })]);
    expect(g).toMatchObject({ montoLeido: null, montoPedido: null });
    const [h] = aplanarComprobantes([conv(WA_A, [{ idMeta: 'a', importe: 0, montoLeido: 0 }])]);
    expect(h).toMatchObject({ montoLeido: 0, montoPedido: 0 });
  });

  it('arreglo vacío, ausente o con forma rara no rompe ni inventa filas', () => {
    expect(aplanarComprobantes([])).toEqual([]);
    expect(aplanarComprobantes([conv(WA_A, [])])).toEqual([]);
    expect(aplanarComprobantes([{ id: WA_A }])).toEqual([]);
    expect(aplanarComprobantes([{ id: WA_A, solicitud: 'x' }])).toEqual([]);
    expect(aplanarComprobantes([{ id: WA_A, solicitud: { comprobantes: 'x' } }])).toEqual([]);
    expect(aplanarComprobantes([conv(WA_A, [null, 3, 'x', [], {}, { idMeta: '' }, { idMeta: 7 }])])).toEqual([]);
  });

  it('más de 6 comprobantes y varias conversaciones: todos, del más nuevo al más viejo', () => {
    const a = conv(WA_B, Array.from({ length: 7 }, (_, i) => ({ idMeta: `a${i}`, en: new Date(T0 + i * 60_000) })));
    const b = conv(WA_C, [{ idMeta: 'b0', en: { toMillis: () => T0 + 3.5 * 60_000 } }, { idMeta: 'b1', en: { seconds: (T0 + 99 * 60_000) / 1000 } }]);
    const filas = aplanarComprobantes([a, b]);
    expect(filas).toHaveLength(9);
    expect(filas.map((f) => f.idMeta)).toEqual(['b1', 'a6', 'a5', 'a4', 'b0', 'a3', 'a2', 'a1', 'a0']);
  });

  it('sin fecha va al final, en el orden de llegada; con timestamp de Firestore (toDate)', () => {
    const filas = aplanarComprobantes([conv(WA_B, [
      { idMeta: 'sin1' }, { idMeta: 'con', en: { toDate: () => new Date(T0) } }, { idMeta: 'sin2', en: 'ayer' },
    ])]);
    expect(filas.map((f) => f.idMeta)).toEqual(['con', 'sin1', 'sin2']);
    expect(filas[1]).toMatchObject({ fechaMs: null, fecha: '—' });
  });

  it('el mismo idMeta en dos conversaciones son dos filas', () => {
    const filas = aplanarComprobantes([conv(WA_B, [{ idMeta: 'm' }]), conv(WA_C, [{ idMeta: 'm' }])]);
    expect(filas.map((f) => f.conversacionId)).toEqual([WA_B, WA_C]);
  });
});

describe('fechaDeLaPaz', () => {
  it('UTC−4 fijo y cruza la medianoche', () => {
    expect(fechaDeLaPaz(Date.UTC(2026, 0, 1, 2, 5))).toBe('31/12/2025 22:05');
    expect(fechaDeLaPaz(null)).toBe('—');
  });
});

describe('textos de la pantalla (prohibición 3)', () => {
  const quitarComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fuente = quitarComentarios(
    readFileSync(join(carpeta, 'comprobantesRecibidos.ts'), 'utf8') + readFileSync(join(carpeta, 'ComprobantesRecibidos.tsx'), 'utf8'),
  );
  const PROHIBIDAS = /acreditad|pagad|verificad|aprobad|recibimos tu pago|dinero entr[óo]\b(?!:)/i;

  it('ni el código de la lista ni sus textos dicen acreditado, pagado, verificado ni aprobado', () => {
    // El aviso fijo es la única frase con «dinero entró», y es la que NIEGA.
    expect(fuente.replace(AVISO_COMPROBANTES, '')).not.toMatch(PROHIBIDAS);
  });

  it('ningún estado posible, ni el texto fijo ni los títulos de columnas, trae una palabra prohibida', () => {
    const estados = ['valido', 'aproximado', 'invalido', 'en_revision', 'tardio', 'no_es_comprobante', 'otro'];
    const motivos = ['ok', 'ilegible', 'no_es_comprobante', 'falta_monto', 'monto_menor', 'monto_mayor', 'cuenta_distinta', undefined];
    const todos = estados.flatMap((e) => motivos.map((m) => estadoEnPalabras(e, m)));
    const textos = [...todos, TEXTO_SIN_COMPROBANTES, ...COLUMNAS.map((c) => c.titulo)];
    for (const t of textos) expect(t).not.toMatch(PROHIBIDAS);
    expect(AVISO_COMPROBANTES).toBe('NovuChat nunca confirma que el dinero entró: eso lo ve usted en su banco.');
  });

  it('«Comprobado» no está en la lista: es la marca de una persona y solo existe en los cierres', () => {
    expect(fuente).not.toMatch(/comprobado/i);
  });

  it('la lista pide la foto con la forma nueva y no implementa su propia lectura de imágenes', () => {
    const tsx = readFileSync(join(carpeta, 'ComprobantesRecibidos.tsx'), 'utf8');
    expect(tsx).toMatch(/\{f\.tieneFoto && \(/);
    expect(tsx).toMatch(/conversacionId: f\.conversacionId, idMeta: f\.idMeta/);
    expect(tsx).toMatch(/Todavía|TEXTO_SIN_COMPROBANTES/);
    expect(tsx).not.toMatch(/storage|getDownloadURL|<img|ruta/i);
    const visor = readFileSync(join(carpeta, 'VisorComprobante.tsx'), 'utf8');
    expect(visor).toMatch(/\.\.\.origen/);
  });

  it('Cobros lee las conversaciones con el filtro simple, en vivo y sin orderBy', () => {
    const c = quitarComentarios(readFileSync(join(carpeta, 'Cobros.tsx'), 'utf8'));
    expect(c).toMatch(/collection\(db, 'tenants', tenantId, 'conversaciones'\), where\('solicitud\.reglaCobro', '==', 2\), limit\(100\)/);
    expect(c).not.toMatch(/conversaciones'\)[^)]*orderBy/);
  });

  it('los títulos de columnas del contador no usan jerga', () => {
    const titulos = COLUMNAS.map((c) => c.titulo);
    expect(titulos).toContain('Coinciden en parte');
    expect(titulos).toContain('En revisión');
    expect(titulos).toContain('Llegaron fuera de plazo');
    for (const viejo of ['Aproximados', 'Pasaron a revisión', 'Tardíos']) expect(titulos).not.toContain(viejo);
  });
});
