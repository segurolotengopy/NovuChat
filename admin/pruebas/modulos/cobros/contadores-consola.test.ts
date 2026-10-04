/**
 * C4: los contadores de cobro en la consola. Se prueba negando: sin contadores
 * de la regla nueva no hay línea, y la pantalla no dice nunca que un pago está
 * acreditado ni lee imágenes ni datos personales del comprobante.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COLUMNAS, lineasDeCobros, mesLegible, ultimosMesesDeCobro } from '../../../web/src/modulos/cobros/contadoresDeCobro.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const carpeta = join(aqui, '../../../web/src/modulos/cobros');

describe('lineasDeCobros', () => {
  it('sin ningún contador de la regla nueva no hay líneas (regla vieja: sin cambios)', () => {
    expect(lineasDeCobros([])).toEqual([]);
    expect(lineasDeCobros([
      { id: '2026-09', mensajes: 40, cobrosCotejados: 3, cobrosVencidos: 1, senasEnviadas: 2 },
    ])).toEqual([]);
  });

  it('un mes con datos da una línea y suma aproximados + en revisión como por confirmar', () => {
    const l = lineasDeCobros([
      { id: '2026-09', cobrosQrEnviados: 10, cobrosValidos: 4, cobrosAproximados: 2, cobrosEnRevision: 1, cobrosInvalidos: 2, cobrosTardios: 1 },
      { id: '2026-10', cobrosQrEnviados: 3 },
      { id: '2026-08', mensajes: 9 },
    ]);
    expect(l.map((x) => x.periodo)).toEqual(['2026-10', '2026-09']);
    expect(l[1]).toMatchObject({ qrEnviados: 10, validos: 4, porConfirmar: 3, invalidos: 2, tardios: 1, cancelados: 0 });
  });

  it('valores raros no rompen: negativos, texto y NaN cuentan como 0', () => {
    const l = lineasDeCobros([{ id: '2026-10', cobrosValidos: -2, cobrosQrEnviados: 'x', cobrosTardios: Number.NaN, cobrosCancelados: 2.9 }]);
    expect(l[0]).toMatchObject({ validos: 0, qrEnviados: 0, tardios: 0, cancelados: 2 });
  });

  it('ultimosMesesDeCobro cruza el cambio de año', () => {
    expect(ultimosMesesDeCobro(3, new Date(Date.UTC(2027, 0, 15)))).toEqual(['2027-01', '2026-12', '2026-11']);
  });
});

describe('la pantalla de contadores', () => {
  const fuente = readFileSync(join(carpeta, 'ContadoresDeCobro.tsx'), 'utf8')
    + readFileSync(join(carpeta, 'contadoresDeCobro.ts'), 'utf8');
  const texto = fuente.replace(/\/\*[\s\S]*?\*\//g, '');

  it('nunca presenta un pago como acreditado, verificado o recibido (prohibición 3)', () => {
    expect(texto).not.toMatch(/acreditad|verificad|recibimos tu pago/i);
  });

  it('solo cuenta: no lee imágenes, rutas ni datos personales', () => {
    expect(texto).not.toMatch(/storage|getDownloadURL|<img|telefono|cierres|ruta|montoLeido/i);
    expect(texto).toMatch(/collection\(db, 'tenants', tenantId, 'metricas'\)/);
    expect(texto).not.toMatch(/setDoc|updateDoc|addDoc|deleteDoc/);
  });

  it('avisa que aproximado y en revisión los confirma una persona del negocio', () => {
    expect(texto).toMatch(/aproximados.*en revisión.*confirma una persona/s);
  });

  it('Cobros.tsx monta el componente', () => {
    expect(readFileSync(join(carpeta, 'Cobros.tsx'), 'utf8')).toContain('<ContadoresDeCobro tenantId={tenantId} />');
  });

  it('devuelve null cuando no hay líneas y avisa si la lectura falla', () => {
    expect(texto).toMatch(/lineas\.length === 0\) return null/);
    expect(texto).toMatch(/role="alert"/);
    expect(texto).toMatch(/overflowX: 'auto'/);
  });
});

describe('columnas y meses', () => {
  const l = lineasDeCobros([{ id: '2026-10', cobrosQrEnviados: 1, cobrosValidos: 2, cobrosAproximados: 3,
    cobrosEnRevision: 4, cobrosInvalidos: 5, cobrosCancelados: 6, cobrosVencidos: 7, cobrosTardios: 8 }])[0]!;

  it('cada cabecera lleva su dato', () => {
    const por = Object.fromEntries(COLUMNAS.map((c) => [c.titulo, c.valor(l)]));
    expect(por).toEqual({
      'QR enviados': 1, 'Datos coinciden': 2, 'Aproximados': 3, 'Pasaron a revisión': 4,
      'Comprobantes que no coinciden': 5, 'Cancelados': 6, 'Vencidos': 7, 'Tardíos': 8,
    });
  });

  it('un mes con solo en revisión, o solo cancelados, cuenta', () => {
    expect(lineasDeCobros([{ id: '2026-10', cobrosEnRevision: 1 }])[0]).toMatchObject({ enRevision: 1, porConfirmar: 1 });
    expect(lineasDeCobros([{ id: '2026-09', cobrosCancelados: 2 }])).toHaveLength(1);
  });

  it('Infinity no entra a la suma', () => {
    expect(lineasDeCobros([{ id: '2026-10', cobrosAproximados: Infinity, cobrosEnRevision: 1 }])[0]!.porConfirmar).toBe(1);
  });

  it('el mes se lee legible', () => {
    expect(mesLegible('2026-10')).toBe('octubre 2026');
    expect(mesLegible('raro')).toBe('raro');
  });
});
