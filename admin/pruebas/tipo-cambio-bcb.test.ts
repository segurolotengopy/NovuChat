/**
 * El tipo de cambio leído del BCB cada día (`tipoCambioBcb.ts`).
 *
 *   1. La lectura, contra un recorte REAL de la tabla del BCB del 25/09/2026
 *      (12.22 Bs/USD), y contra sus formas rotas: fechas que no coinciden, dos
 *      filas USD, un valor que no es número, una página que no es la tabla.
 *   2. La decisión: nunca hacia atrás, nunca un TCO que el servidor no acepte,
 *      nunca un salto de más del 5 % sin una persona.
 *   3. La corrida entera contra el emulador, en una ruta propia para no pisar
 *      el `plataforma/tipoCambio` que usan otras suites en paralelo.
 */
import { describe, expect, it } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const db = getFirestore();
const {
  POR_AUTOMATICO, SALTO_MAXIMO, URL_TABLA_BCB, actualizarTipoCambio, decidirTipoCambio, leerTablaBcb,
} = await import('../functions/src/tipoCambioBcb.ts');

/** El 25/09/2026 a las 10:00 de La Paz. */
const AHORA = Date.parse('2026-09-25T14:00:00Z');

/** Recorte de la página tal como la sirve el BCB (entidades y espacios incluidos). */
const tabla = (opciones: { rotulo?: string; titulo?: string; filas?: string; tco?: string } = {}) => `
<table width="760" border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td><span align="left" class="bcbs-subtitulo">FECHA DE LA COTIZACI&Oacute;N:&nbsp; </span><strong>${opciones.rotulo ?? '25 de Septiembre 2026'}</strong></td>
    <td align="right"><a href="otras_imprimir.php?qdd=25&qmm=09&qaa=2026">Imprimir reporte</a></td>
  </tr>
</table>
<div class="encabezado">
    <span class="bcbs-subtitulo"><div align="center">TABLA No. 179-26</div></span><br />
    <span class="bcbs-subtitulo"><div align="center">TABLA DE COTIZACIONES DEL ${opciones.titulo ?? '25 DE SEPTIEMBRE DE 2026'}&nbsp;</div></span>
</div>
<div class="bloque-titulo">Cotizaci&oacute;n Oficial del Boliviano respecto al D&oacute;lar (BCB)</div>
<table class="tabla-cotizacion" border="0" cellspacing="0" cellpadding="0">
    <tr>
        <th width="210">Pa&iacute;s / Concepto</th>
        <th width="150">Moneda</th>
        <th width="90">C&oacute;digo</th>
        <th width="220">Tipo de Cambio Oficial (TCO)<br />(Bs/USD)</th>
    </tr>
    ${opciones.filas ?? `<tr class="fila1">
        <td>ESTADOS UNIDOS</td>
        <td>D&Oacute;LAR</td>
        <td class="centro">USD</td>
        <td class="numero">${opciones.tco ?? '12.22'}</td>
    </tr>`}
</table>
<div class="bloque-titulo">COTIZACI&Oacute;N DE MONEDAS*</div>
<table class="tabla-cotizacion"><tr><td>ESTADOS UNIDOS</td><td>D&Oacute;LAR</td><td>USD</td><td>12.20</td><td>12.24</td></tr></table>`;

const FILA_USD = (v: string) => `<tr><td>ESTADOS UNIDOS</td><td>D&Oacute;LAR</td><td>USD</td><td>${v}</td></tr>`;

// ===========================================================================
describe('1. La lectura de la tabla del BCB', () => {
  it('la página real del 25/09/2026: 12.22 Bs/USD, con la fecha del rótulo y la del título iguales', () => {
    expect(leerTablaBcb(tabla())).toEqual({ ok: true, tco: 12.22, fecha: '2026-09-25' });
  });

  it('solo lee la tabla del TCO: la de monedas, que también trae USD, no cuenta', () => {
    // Si leyera la segunda tabla, habría dos filas USD o un 12.24.
    expect(leerTablaBcb(tabla({ tco: '12.19' }))).toMatchObject({ ok: true, tco: 12.19 });
  });

  it('acepta coma decimal y un día de un dígito', () => {
    expect(leerTablaBcb(tabla({ tco: '12,3', rotulo: '1 de Octubre 2026', titulo: '1 DE OCTUBRE DE 2026' })))
      .toEqual({ ok: true, tco: 12.3, fecha: '2026-10-01' });
  });

  it('NO lee nada si las dos fechas de la página no coinciden', () => {
    expect(leerTablaBcb(tabla({ titulo: '24 DE SEPTIEMBRE DE 2026' })))
      .toEqual({ ok: false, motivo: 'las dos fechas de la página no coinciden' });
  });

  it('NO lee nada con dos filas USD, sin fila USD, o con un valor que no es un número', () => {
    expect(leerTablaBcb(tabla({ filas: FILA_USD('12.22') + FILA_USD('12.30') }))).toMatchObject({ ok: false });
    expect(leerTablaBcb(tabla({ filas: '' }))).toMatchObject({ ok: false });
    for (const v of ['', 'N/D', '12.22 Bs', '1222', '-12.22']) {
      expect(leerTablaBcb(tabla({ tco: v })), v).toMatchObject({ ok: false });
    }
  });

  it('NO lee nada de una página que no es la tabla (mantenimiento, error, otra cosa)', () => {
    for (const html of ['', '<html><body>Sitio en mantenimiento</body></html>', tabla().replace(/Tipo de Cambio Oficial/, 'Otra cosa')]) {
      expect(leerTablaBcb(html)).toMatchObject({ ok: false });
    }
    expect(leerTablaBcb(tabla({ rotulo: '25 de Brumario 2026', titulo: '25 DE BRUMARIO DE 2026' }))).toMatchObject({ ok: false });
  });

  it('la dirección es una constante del BCB, por https', () => {
    expect(URL_TABLA_BCB).toBe('https://www.bcb.gob.bo/librerias/indicadores/otras/ultimo.php');
  });
});

// ===========================================================================
describe('2. La decisión: cuándo se escribe', () => {
  const leido = { tco: 12.22, fecha: '2026-09-25' };

  it('sin nada guardado, escribe', () => {
    expect(decidirTipoCambio(null, leido, AHORA)).toEqual({ accion: 'escribir', nuevo: { ...leido, fuente: 'BCB' } });
  });

  it('el mismo día y el mismo valor: no escribe', () => {
    expect(decidirTipoCambio({ tco: 12.22, fecha: '2026-09-25', fuente: 'BCB' }, leido, AHORA).accion).toBe('igual');
  });

  it('una carga más nueva (a mano) no se pisa', () => {
    expect(decidirTipoCambio({ tco: 12.25, fecha: '2026-09-26' }, leido, AHORA + 86_400_000).accion).toBe('anterior');
  });

  it('un día nuevo con un cambio chico: escribe; y el mismo día con otro valor (corrección del BCB), también', () => {
    expect(decidirTipoCambio({ tco: 12.30, fecha: '2026-09-24' }, leido, AHORA).accion).toBe('escribir');
    expect(decidirTipoCambio({ tco: 12.21, fecha: '2026-09-25' }, leido, AHORA).accion).toBe('escribir');
  });

  it(`un salto de más del ${SALTO_MAXIMO * 100} % NO se escribe solo: lo carga una persona`, () => {
    expect(decidirTipoCambio({ tco: 11.5, fecha: '2026-09-24' }, leido, AHORA).accion).toBe('rechazar');
    expect(decidirTipoCambio({ tco: 12.22, fecha: '2026-09-24' }, { tco: 13, fecha: '2026-09-25' }, AHORA).accion).toBe('rechazar');
  });

  it('nunca un TCO que el servidor no aceptaría para cobrar: fuera de rango, futuro o vencido', () => {
    expect(decidirTipoCambio(null, { tco: 1.2, fecha: '2026-09-25' }, AHORA).accion).toBe('rechazar');
    expect(decidirTipoCambio(null, { tco: 12.22, fecha: '2026-09-27' }, AHORA).accion).toBe('rechazar');
    expect(decidirTipoCambio(null, { tco: 12.22, fecha: '2026-09-10' }, AHORA).accion).toBe('rechazar');
  });
});

// ===========================================================================
describe('3. La corrida entera, contra el emulador', () => {
  const RUTA = 'plataforma/tipoCambioPruebaBcb';
  const ref = db.doc(RUTA);
  const historial = async () => (await ref.collection('historial').get()).docs.map((d) => d.data());
  const limpiar = async () => {
    for (const d of (await ref.collection('historial').get()).docs) await d.ref.delete();
    await ref.delete();
  };

  it('escribe el TCO y una entrada del historial firmada por la carga automática; la segunda corrida no escribe', async () => {
    await limpiar();
    const r = await actualizarTipoCambio({ bajar: async () => tabla(), ahoraMs: AHORA, ruta: RUTA });
    expect(r.resultado).toBe('escrito');
    expect((await ref.get()).data()).toMatchObject({ tco: 12.22, fecha: '2026-09-25', fuente: 'BCB' });
    expect((await ref.get()).data()).not.toHaveProperty('actualizadoPor');
    expect(await historial()).toEqual([expect.objectContaining({ tco: 12.22, fecha: '2026-09-25', por: POR_AUTOMATICO, antes: null })]);

    expect((await actualizarTipoCambio({ bajar: async () => tabla(), ahoraMs: AHORA, ruta: RUTA })).resultado).toBe('igual');
    expect(await historial()).toHaveLength(1);
  });

  it('si el BCB no responde o la página no es la tabla, NO toca lo guardado', async () => {
    await limpiar();
    await ref.set({ tco: 12.2, fecha: '2026-09-24', fuente: 'BCB' });
    const caido = await actualizarTipoCambio({ bajar: async () => { throw new Error('el BCB respondió 503'); }, ahoraMs: AHORA, ruta: RUTA });
    expect(caido).toEqual({ resultado: 'sin_lectura', detalle: 'el BCB respondió 503' });
    const roto = await actualizarTipoCambio({ bajar: async () => '<html>mantenimiento</html>', ahoraMs: AHORA, ruta: RUTA });
    expect(roto.resultado).toBe('ilegible');
    expect((await ref.get()).data()).toEqual({ tco: 12.2, fecha: '2026-09-24', fuente: 'BCB' });
    expect(await historial()).toHaveLength(0);
  });

  it('un salto grande no se escribe, y lo guardado queda como estaba', async () => {
    await limpiar();
    await ref.set({ tco: 10, fecha: '2026-09-24', fuente: 'BCB' });
    expect((await actualizarTipoCambio({ bajar: async () => tabla(), ahoraMs: AHORA, ruta: RUTA })).resultado).toBe('rechazar');
    expect((await ref.get()).data()).toMatchObject({ tco: 10 });
    await limpiar();
  });
});
