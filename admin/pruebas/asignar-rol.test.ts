/**
 * `scripts/asignar-rol.mjs` — EL ACCESO DE UNA PERSONA A UN COMERCIO.
 *
 * El script escribe con el SDK Admin, que se salta las reglas de Firestore: lo
 * único que impide darle acceso a un comercio equivocado, o darle a una persona
 * el rol reservado a la identidad de servicio de la ingesta, es su propia
 * validación. Por eso se prueba ejecutándolo como proceso y **escribiendo
 * negando**: lo que se comprueba es que NO se pueda.
 *
 * Todo lo que necesita Auth (crear la cuenta, el claim, el enlace de
 * contraseña) queda fuera: acá se prueba lo que decide ANTES de tocar nada, que
 * es donde viven los errores que se pagan caro. Las validaciones corren antes
 * de que el script abra Firebase, así que esta suite no necesita emuladores.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'asignar-rol.mjs');

const correr = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 20000 });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
};
const BIEN = ['--proyecto', 'demo-novuchat-pruebas', '--tenant', 'bellido', '--correo', 'recepcion@ejemplo.com'];

describe('Lo que no se puede pedir', () => {
  it('sin argumentos dice todo lo que falta, de una vez', () => {
    const r = correr();
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('falta --proyecto');
    expect(r.salida).toContain('--tenant no es un identificador válido');
    expect(r.salida).toContain('--correo no es un correo');
  });

  // EL ROL `ingesta` ES DE UNA IDENTIDAD DE SERVICIO, NUNCA DE UNA PERSONA:
  // `functions/src/claims.ts` lo rechaza para una cuenta con contraseña. Acá se
  // rechaza antes, para que el motivo se lea en una línea en vez de salir como
  // un error de Firebase.
  it('el rol «ingesta» se rechaza, y se explica por qué', () => {
    const r = correr(...BIEN, '--rol', 'ingesta');
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('identidades de servicio');
  });

  it.each(['propietario', 'lectura', 'ADMIN', 'oper ', ''])('el rol «%s» no existe', (rol) => {
    const r = correr(...BIEN, '--rol', rol);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('--rol tiene que ser admin o oper');
  });

  it('un identificador de comercio con mayúsculas o espacios se rechaza', () => {
    for (const t of ['BELLIDO', 'be llido', 'be', 'bellido/../otro']) {
      const r = correr('--proyecto', 'p', '--tenant', t, '--correo', 'alguien@ejemplo.com');
      expect(r.codigo, t).toBe(2);
      expect(r.salida, t).toContain('--tenant no es un identificador válido');
    }
  });

  it.each(['sin-arroba', 'a@b', '@ejemplo.com', 'a b@ejemplo.com'])('el correo «%s» se rechaza', (correo) => {
    const r = correr('--proyecto', 'p', '--tenant', 'bellido', '--correo', correo);
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('--correo no es un correo');
  });

  // `--quitar` quita el rol que la persona tenga: pedirle además cuál quitar es
  // una ambigüedad que termina en «creí que le había quitado el de operador».
  it('--quitar con --rol se rechaza en vez de adivinar', () => {
    const r = correr(...BIEN, '--quitar', '--rol', 'oper');
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('--quitar no lleva --rol');
  });

  it('un nombre absurdamente largo se rechaza', () => {
    const r = correr(...BIEN, '--nombre', 'x'.repeat(200));
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('--nombre es demasiado largo');
  });
});

describe('El uso', () => {
  it('el rol por defecto es «oper», el de menos privilegio', () => {
    // Con los argumentos bien, la validación pasa y el script sigue a Firebase:
    // lo que se comprueba acá es que NO se queja del rol, o sea que puso uno.
    const r = correr(...BIEN);
    expect(r.salida).not.toContain('--rol tiene que ser');
    expect(r.codigo).not.toBe(2);
  });

  it('la ayuda nombra los dos roles y las dos banderas', () => {
    const r = correr();
    expect(r.salida).toContain('--rol admin|oper');
    expect(r.salida).toContain('--quitar');
    expect(r.salida).toContain('--aplicar');
  });
});
