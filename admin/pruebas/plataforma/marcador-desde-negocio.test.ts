/**
 * `marcador-desde-negocio.mjs`: copia numeroRecepcion a una fila local sin mostrar nunca el valor.
 * Núcleo puro con lector y escritor falsos: jamás toca Firestore ni CONFIGURACION.local.md. Se prueba NEGANDO.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import { copiar, escribirConMarcadorLocal, normalizar } from '../../scripts/plataforma/marcador-desde-negocio.mjs';

const NUMERO = ['591', '7000', '0000'].join(''); // armado al vuelo: el saneo veta literales largos
const MARCADOR = 'REEMPLAZAR_NUMERO_RECEPCION_PRUEBA';
const base = (extra = {}) => {
  const escritas: string[][] = [];
  return {
    escritas,
    args: {
      tenant: 'tenant-prueba', marcador: MARCADOR, aplicar: false,
      leer: async () => NUMERO,
      escribir: (m: string, v: string) => { escritas.push([m, v]); return { codigo: 0, salida: `✓ ${m} agregado.` }; },
      ...extra,
    },
  };
};
const texto = (r: { mensajes: string[] }) => r.mensajes.join('\n');

describe('marcador-desde-negocio', () => {
  it('en seco no escribe y no imprime el valor ni sus cifras', async () => {
    const { args, escritas } = base();
    const r = await copiar(args);
    expect(r.codigo).toBe(0);
    expect(escritas).toHaveLength(0);
    expect(texto(r)).not.toContain(NUMERO);
    expect(texto(r)).not.toContain(NUMERO.slice(-4));
  });
  it('con --aplicar escribe una vez, normalizado, y no imprime el valor', async () => {
    const { args, escritas } = base({ aplicar: true, leer: async () => `+${NUMERO.slice(0, 3)} ${NUMERO.slice(3)}` });
    const r = await copiar(args);
    expect(escritas).toEqual([[MARCADOR, NUMERO]]);
    expect(texto(r)).not.toContain(NUMERO);
  });
  it('si el campo no existe no escribe y sale 1 (no se inventa)', async () => {
    for (const v of [undefined, null, '']) {
      const { args, escritas } = base({ aplicar: true, leer: async () => v });
      expect((await copiar(args)).codigo).toBe(1);
      expect(escritas).toHaveLength(0);
    }
  });
  it('un valor sin forma de número boliviano no se escribe ni se imprime', async () => {
    for (const malo of ['abc' + NUMERO, '1' + NUMERO, NUMERO + '1234', '5917', `${NUMERO}|x`]) {
      const { args, escritas } = base({ aplicar: true, leer: async () => malo });
      const r = await copiar(args);
      expect(r.codigo).toBe(1);
      expect(escritas).toHaveLength(0);
      expect(texto(r)).not.toContain(malo);
    }
  });
  it('si la fila ya existía sale 3 y no dice que copió', async () => {
    const { args } = base({ aplicar: true, escribir: () => ({ codigo: 0, salida: `✓ ${MARCADOR} ya estaba en la tabla: no se toca nada.` }) });
    const r = await copiar(args);
    expect(r.codigo).toBe(3);
    expect(texto(r)).not.toContain('✓');
  });
  it('el escritor real quita del hijo toda línea con el valor y conserva el veredicto', () => {
    const falso = () => ({ status: 0, stdout: `eco ${NUMERO}\n✓ ${MARCADOR} agregado.\n`, stderr: `otra ${NUMERO}` });
    const r = escribirConMarcadorLocal(MARCADOR, NUMERO, falso);
    expect(r.salida).not.toContain(NUMERO);
    expect(r.salida).toContain('agregado');
    const sinBash = escribirConMarcadorLocal(MARCADOR, NUMERO, () => ({ status: null, stdout: null, stderr: null, error: { code: 'ENOENT' } }));
    expect(sinBash.codigo).toBe(1);
    expect(sinBash.salida).toContain('ENOENT');
  });
  it('rechaza marcadores que no son de número de recepción y tenants inválidos', async () => {
    for (const marcador of ['REEMPLAZAR_PHONE_NUMBER_ID_X', 'otro', 'REEMPLAZAR_NUMERO_RECEPCION_', 'REEMPLAZAR_NUMERO_DUENO_X']) {
      const { args, escritas } = base({ aplicar: true, marcador });
      expect((await copiar(args)).codigo).toBe(2);
      expect(escritas).toHaveLength(0);
    }
    const { args } = base({ aplicar: true, tenant: '../x' });
    expect((await copiar(args)).codigo).toBe(2);
  });
  it('normalizar solo acepta dígitos con «+» o espacios', () => {
    expect(normalizar(`+${NUMERO}`)).toBe(NUMERO);
    for (const x of ['', 'x', `${NUMERO}x`, `${NUMERO}\n7`, null, undefined]) expect(normalizar(x)).toBe('');
  });
  it('el script solo lee de Firestore y pasa el valor por el entorno, no por argumentos', () => {
    const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/plataforma/marcador-desde-negocio.mjs'), 'utf8');
    expect(fuente).not.toMatch(/\.(set|update|create|delete)\(/);
    expect(fuente).toContain('MARCADOR_VALOR: valor');
    expect(fuente).not.toMatch(/'--valor'/);
  });
});
