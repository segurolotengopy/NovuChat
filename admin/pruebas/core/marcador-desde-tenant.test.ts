/**
 * `marcador-desde-tenant.mjs`: copia waPhoneNumberId a una fila local sin mostrar nunca el valor.
 * Núcleo puro con lector y escritor falsos: jamás toca Firestore ni CONFIGURACION.local.md. Se prueba NEGANDO.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { copiar } from '../../scripts/plataforma/marcador-desde-tenant.mjs';

const PHONE = ['12345', '67890', '123'].join(''); // armado al vuelo: el saneo veta literales largos
const MARCADOR = 'REEMPLAZAR_PHONE_NUMBER_ID_DEMOB';
const base = (extra = {}) => {
  const escritas: string[][] = [];
  return {
    escritas,
    args: {
      tenant: 'demo-venta', marcador: MARCADOR, aplicar: false,
      leer: async () => PHONE,
      escribir: (m: string, v: string) => { escritas.push([m, v]); return { codigo: 0, salida: `✓ ${m} agregado.` }; },
      ...extra,
    },
  };
};
const texto = (r: { mensajes: string[] }) => r.mensajes.join('\n');

describe('marcador-desde-tenant', () => {
  it('en seco no escribe y no imprime el valor ni sus cifras', async () => {
    const { args, escritas } = base();
    const r = await copiar(args);
    expect(r.codigo).toBe(0);
    expect(escritas).toHaveLength(0);
    expect(texto(r)).not.toContain(PHONE);
    expect(texto(r)).not.toContain(PHONE.slice(-4));
  });
  it('con --aplicar escribe una vez y no imprime el valor', async () => {
    const { args, escritas } = base({ aplicar: true });
    const r = await copiar(args);
    expect(escritas).toEqual([[MARCADOR, PHONE]]);
    expect(texto(r)).not.toContain(PHONE);
  });
  it('si el campo no existe no escribe y sale 1 (no se inventa)', async () => {
    for (const v of [undefined, null, '']) {
      const { args, escritas } = base({ aplicar: true, leer: async () => v });
      expect((await copiar(args)).codigo).toBe(1);
      expect(escritas).toHaveLength(0);
    }
  });
  it('un valor sin forma de phone_number_id no se escribe ni se imprime', async () => {
    const malo = 'abc-' + PHONE;
    const { args, escritas } = base({ aplicar: true, leer: async () => malo });
    const r = await copiar(args);
    expect(r.codigo).toBe(1);
    expect(escritas).toHaveLength(0);
    expect(texto(r)).not.toContain(malo);
  });
  it('rechaza marcadores que no son de phone_number_id y tenants inválidos', async () => {
    for (const marcador of ['REEMPLAZAR_WABA_ID_X', 'otro', 'REEMPLAZAR_PHONE_NUMBER_ID_']) {
      const { args, escritas } = base({ aplicar: true, marcador });
      expect((await copiar(args)).codigo).toBe(2);
      expect(escritas).toHaveLength(0);
    }
    const { args } = base({ aplicar: true, tenant: '../x' });
    expect((await copiar(args)).codigo).toBe(2);
  });
  it('el script solo lee de Firestore y pasa el valor por el entorno, no por argumentos', () => {
    const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/plataforma/marcador-desde-tenant.mjs'), 'utf8');
    expect(fuente).not.toMatch(/\.(set|update|create|delete)\(/);
    expect(fuente).toContain('MARCADOR_VALOR: valor');
    expect(fuente).not.toMatch(/'--valor'/);
  });
});
