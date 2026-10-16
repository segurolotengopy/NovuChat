/**
 * CONVERSACIONES (H1-4): LOS CAMPOS DERIVADOS QUE ESCRIBE LA INGESTA.
 *
 * `derivados.ts` decide qué campos nuevos lleva cada escritura que la ingesta
 * ya hace. Lo que se defiende acá, negando:
 *
 *  1. Un ENTRANTE sube `noLeidos` en 1 y pone `sinLeer`; abre y renueva la
 *     ventana de 24 h con el MISMO `ahoraMs` en las dos marcas.
 *  2. Un SALIENTE no mueve el leído ni la ventana: contestar no es leer, y lo
 *     que escribe el negocio no renueva la ventana de Meta.
 *  3. Teléfono y nombre se derivan con la normalización de Core (la misma que
 *     usa la búsqueda); sin palabras de nombre, el campo no se escribe.
 *  4. Un reloj roto no tira abajo la ingesta: no lanza, y omite solo la ventana.
 *  5. El mensaje lleva su `tenantId` (lo que acota la búsqueda entre comercios)
 *     y hasta 30 `palabras`; sin palabras, el campo no se escribe.
 *  6. El archivo importa solo `firebase-admin/firestore` y la normalización, y
 *     no lee ni escribe nada por su cuenta (cero lecturas extra por mensaje).
 *
 * Son puras: sin emulador y sin red. Teléfonos de prueba con seis ceros.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { camposDeConversacionPorMensaje, camposDeMensajeIndexado } from '../../functions/src/core/conversacion/derivados';
import { palabrasDe, trozosDeTelefono } from '../../functions/src/core/conversacion/normalizacion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(AQUI, '..', '..', 'functions', 'src', 'core', 'conversacion', 'derivados.ts'), 'utf8');
const CODIGO = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const AHORA = Date.UTC(2026, 9, 9, 15, 30, 0);
const HORA = 3_600_000;
const TEL = '59100000001';

describe('camposDeConversacionPorMensaje: el entrante', () => {
  const c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'entrante', nombreContacto: 'María Luisa Pérez' }, AHORA);

  it('lleva exactamente los campos del contrato, ni uno más', () => {
    expect(Object.keys(c).sort()).toEqual([
      'noLeidos', 'nombrePalabras', 'sinLeer', 'telefonoTrozos', 'ultimoEntranteEn', 'ventanaVenceEn',
    ]);
  });

  it('la ventana nace de UN mismo ahoraMs: ancla = ahora, vencimiento = ahora + 24 h', () => {
    expect(c['ultimoEntranteEn']).toBeInstanceOf(Timestamp);
    expect((c['ultimoEntranteEn'] as Timestamp).toMillis()).toBe(AHORA);
    expect((c['ventanaVenceEn'] as Timestamp).toMillis()).toBe(AHORA + 24 * HORA);
  });

  it('suma UN no leído (increment 1, no 2 ni un valor fijo) y marca sinLeer', () => {
    const inc = c['noLeidos'] as FieldValue;
    expect(inc.isEqual(FieldValue.increment(1))).toBe(true);
    expect(inc.isEqual(FieldValue.increment(2))).toBe(false);
    expect(c['sinLeer']).toBe(true);
  });

  it('teléfono y nombre se normalizan con la regla de Core', () => {
    expect(c['telefonoTrozos']).toEqual(trozosDeTelefono(TEL));
    expect(c['telefonoTrozos']).toContain('0001');
    expect(c['telefonoTrozos']).toContain(TEL);
    expect(c['nombrePalabras']).toEqual(['maria', 'luisa', 'perez']);
  });

  it('el nombre aporta hasta 6 palabras', () => {
    const largo = camposDeConversacionPorMensaje(
      { telefono: TEL, direccion: 'entrante', nombreContacto: 'uno dos tres cuatro cinco seis siete ocho' }, AHORA,
    );
    expect(largo['nombrePalabras']).toHaveLength(6);
    expect(largo['nombrePalabras']).toEqual(palabrasDe('uno dos tres cuatro cinco seis siete ocho', 6));
    expect(largo['nombrePalabras']).not.toContain('siete');
  });
});

describe('camposDeConversacionPorMensaje: el saliente NO mueve el leído ni la ventana', () => {
  it('solo trae telefonoTrozos (y el nombre, si hay)', () => {
    const c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'saliente', nombreContacto: 'Ana Gómez' }, AHORA);
    expect(Object.keys(c).sort()).toEqual(['nombrePalabras', 'telefonoTrozos']);
    for (const prohibido of ['noLeidos', 'sinLeer', 'ultimoEntranteEn', 'ventanaVenceEn']) {
      expect(Object.hasOwn(c, prohibido), prohibido).toBe(false);
    }
  });

  it('sin nombre, solo telefonoTrozos', () => {
    const c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'saliente' }, AHORA);
    expect(Object.keys(c)).toEqual(['telefonoTrozos']);
  });

  it('NEGATIVA: una dirección desconocida se trata como saliente (jamás suma no leídos)', () => {
    const c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'otra' as never }, AHORA);
    expect(Object.hasOwn(c, 'noLeidos')).toBe(false);
    expect(Object.hasOwn(c, 'sinLeer')).toBe(false);
  });
});

describe('camposDeConversacionPorMensaje: lo que no es normal', () => {
  it('sin nombre, con nombre vacío, de dos letras o que no es texto: no se escribe nombrePalabras', () => {
    for (const n of [undefined, '', '   ', 'Jo', '12', null, 42, {}]) {
      const c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'entrante', nombreContacto: n as never }, AHORA);
      expect(Object.hasOwn(c, 'nombrePalabras'), String(n)).toBe(false);
    }
  });

  it('NEGATIVA: un reloj roto no lanza; el entrante conserva el no leído y omite solo la ventana', () => {
    // 1e20 y -1e20 están fuera del rango de un Timestamp; el máximo (9999-12-31) no deja lugar al +24 h.
    for (const ahora of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20, -1e20, 253_402_300_799_999,
      undefined as never, null as never, '1' as never]) {
      let c: Record<string, unknown> = {};
      expect(() => { c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'entrante' }, ahora); }).not.toThrow();
      expect(Object.hasOwn(c, 'ultimoEntranteEn'), String(ahora)).toBe(false);
      expect(Object.hasOwn(c, 'ventanaVenceEn'), String(ahora)).toBe(false);
      expect(c['sinLeer']).toBe(true);
      expect((c['noLeidos'] as FieldValue).isEqual(FieldValue.increment(1))).toBe(true);
    }
  });

  it('el borde del rango: el último reloj que deja lugar al +24 h sí abre la ventana', () => {
    const ultimo = 253_402_300_799_999 - 24 * 3_600_000;
    const c = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'entrante' }, ultimo);
    expect((c['ventanaVenceEn'] as Timestamp).toMillis()).toBe(253_402_300_799_999);
    const primero = camposDeConversacionPorMensaje({ telefono: TEL, direccion: 'entrante' }, -62_135_596_800_000);
    expect((primero['ultimoEntranteEn'] as Timestamp).toMillis()).toBe(-62_135_596_800_000);
  });

  it('un teléfono con menos de 4 dígitos no indexa trozos, y no rompe', () => {
    const c = camposDeConversacionPorMensaje({ telefono: '123', direccion: 'saliente' }, AHORA);
    expect(c['telefonoTrozos']).toEqual([]);
  });

  it('es una función pura: dos llamadas con lo mismo dan lo mismo', () => {
    const m = { telefono: TEL, direccion: 'entrante' as const, nombreContacto: 'Ana' };
    const a = camposDeConversacionPorMensaje(m, AHORA);
    const b = camposDeConversacionPorMensaje(m, AHORA);
    expect((a['ultimoEntranteEn'] as Timestamp).isEqual(b['ultimoEntranteEn'] as Timestamp)).toBe(true);
    expect(a['telefonoTrozos']).toEqual(b['telefonoTrozos']);
  });
});

describe('camposDeMensajeIndexado', () => {
  it('lleva el tenantId y las palabras normalizadas', () => {
    const c = camposDeMensajeIndexado('Quiero 2 Alfajores de maicena, por favor', 'tienda-a');
    expect(c).toEqual({ tenantId: 'tienda-a', palabras: palabrasDe('Quiero 2 Alfajores de maicena, por favor') });
    expect(c.palabras).toContain('alfajor');
    expect(c.palabras).not.toContain('de'); // menos de 3 letras
  });

  it('con tildes y mayúsculas indexa la forma normalizada', () => {
    expect(camposDeMensajeIndexado('SALTEÑAS Calientes', 'tienda-a').palabras).toEqual(['saltena', 'calient']);
  });

  it('NEGATIVA: sin palabras (o sin texto) NO escribe `palabras`, pero sí el tenantId', () => {
    for (const t of ['', '  ', 'ok', 'a b c', '12 45', undefined, null, 42, {}]) {
      const c = camposDeMensajeIndexado(t, 'tienda-a');
      expect(c, String(t)).toEqual({ tenantId: 'tienda-a' });
      expect(Object.hasOwn(c, 'palabras')).toBe(false);
    }
  });

  it('NEGATIVA: nunca más de 30 palabras', () => {
    const muchas = Array.from({ length: 80 }, (_, i) => `palabra${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ');
    const c = camposDeMensajeIndexado(muchas, 'tienda-a');
    expect(c.palabras).toHaveLength(30);
  });

  it('el tenantId es exactamente el que se pasa, no el de otro', () => {
    expect(camposDeMensajeIndexado('alfajor', 'tienda-b').tenantId).toBe('tienda-b');
  });
});

describe('el archivo es de Core y no toca la base', () => {
  it('importa solo firebase-admin/firestore y la normalización de su carpeta', () => {
    const imports = [...CODIGO.matchAll(/^\s*import\s[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./normalizacion.js', 'firebase-admin/firestore']);
    expect(CODIGO).toMatch(/import \{ FieldValue, Timestamp \} from 'firebase-admin\/firestore'/);
  });

  it('NEGATIVA: no abre Firestore (cero lecturas ni escrituras extra por mensaje)', () => {
    expect(CODIGO).not.toMatch(/getFirestore|\.get\(|\.set\(|\.create\(|\.update\(|runTransaction|collection\(|\.doc\(/);
  });

  it('NEGATIVA: no lee el reloj; el ahoraMs lo pone quien llama', () => {
    expect(CODIGO).not.toMatch(/Date\.now|new Date|Timestamp\.now|serverTimestamp/);
  });
});
