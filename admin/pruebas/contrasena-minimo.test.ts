/**
 * EL MÍNIMO DE LA CONTRASEÑA: un número, dos pantallas.
 *
 * El 16/09/2026 el mínimo estaba escrito dos veces —`minLength={12}` en
 * `Ingresar.tsx` y `const MINIMO = 12` en `MiCuenta.tsx`— y un tercer actor, la
 * pantalla de restablecimiento que sirve Firebase, usaba el suyo (6). El
 * administrador de un cliente nuevo puso 11 caracteres donde se los aceptaron y
 * quedó afuera donde no. Ahora el número vive en `web/src/lib/contrasena.ts` y
 * esta prueba exige que siga viviendo ahí: que las pantallas lo IMPORTEN en vez
 * de volver a escribirlo, que es la forma en que estas cosas se desincronizan.
 *
 * Y verifica lo que el valor tiene que cumplir por estándar (NIST SP 800-63B):
 * al menos 8 caracteres, y ningún tope de largo en los campos de contraseña.
 *
 * No necesita emulador: lee las fuentes, como `bitacora-tipos.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINIMO_CONTRASENA } from '../web/src/lib/contrasena.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (ruta: string) => readFileSync(join(aqui, '..', ruta), 'utf8');

/** El cuerpo del archivo sin sus comentarios: lo que de verdad corre. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ingresar = leer('web/src/paginas/Ingresar.tsx');
const miCuenta = leer('web/src/paginas/MiCuenta.tsx');

describe('El mínimo de la contraseña', () => {
  it('cumple el piso de NIST SP 800-63B: al menos 8 caracteres', () => {
    expect(MINIMO_CONTRASENA).toBeGreaterThanOrEqual(8);
  });

  it('las dos pantallas importan la constante, no su número', () => {
    for (const fuente of [ingresar, miCuenta]) {
      expect(fuente).toContain("MINIMO_CONTRASENA } from '../lib/contrasena'");
    }
    // Ningún `minLength` ni `length <` con un número escrito a mano: si el
    // valor vuelve a estar en dos lados, se desincroniza como en el alta del
    // 16/09.
    for (const fuente of [ingresar, miCuenta]) {
      const cuerpo = sinComentarios(fuente);
      expect(cuerpo).not.toMatch(/minLength=\{\s*\d/);
      expect(cuerpo).not.toMatch(/length\s*<\s*\d/);
    }
  });

  it('«Mi cuenta» exige el mínimo, porque ahí se ELIGE la contraseña', () => {
    const cuerpo = sinComentarios(miCuenta);
    expect(cuerpo).toContain('minLength={MINIMO_CONTRASENA}');
    expect(cuerpo).toMatch(/nueva\.length\s*<\s*MINIMO_CONTRASENA/);
  });

  it('el ingreso NO exige largo mínimo, porque ahí la contraseña ya existe', () => {
    const campo = sinComentarios(ingresar)
      .split('\n')
      .filter((l) => l.includes('current-password') || l.includes('type="password"'))
      .join('\n');
    expect(campo).not.toContain('minLength');
  });

  it('ningún campo de contraseña topea el largo: las frases largas son mejores', () => {
    for (const fuente of [ingresar, miCuenta]) {
      for (const linea of sinComentarios(fuente).split('\n')) {
        if (linea.includes("type=\"password\"")) expect(linea).not.toContain('maxLength');
      }
    }
  });
});
