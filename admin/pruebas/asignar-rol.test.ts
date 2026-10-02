/**
 * `scripts/plataforma/asignar-rol.mjs` — EL ACCESO DE UNA PERSONA A UN COMERCIO.
 *
 * El script escribe con el SDK Admin, que se salta las reglas de Firestore: lo
 * único que impide darle acceso a un comercio equivocado, o darle a una persona
 * el rol reservado a la identidad de servicio de la ingesta, es su propia
 * validación. Por eso se prueba ejecutándolo como proceso y **escribiendo
 * negando**: lo que se comprueba es que NO se pueda.
 *
 * Todo lo que necesita Auth (crear la cuenta, el claim, el enlace de
 * contraseña) queda fuera: acá se prueba lo que decide ANTES de tocar nada, que
 * es donde viven los errores que se pagan caro.
 *
 * LAS VALIDACIONES CORREN ANTES DE ABRIR FIREBASE, PERO NO TODAS LAS PRUEBAS
 * PARAN AHÍ. Con los argumentos bien, el script inicializa firebase-admin y lee
 * `tenants/<id>` ANTES de decidir el modo seco. Hasta el 27/09/2026 el hijo
 * heredaba el entorno de `correr.sh`, que exporta FIRESTORE_EMULATOR_PORT pero
 * no FIRESTORE_EMULATOR_HOST: firebase-admin iba al Firestore REAL con las
 * credenciales por defecto (ADC) del desarrollador. Sin red se colgaba hasta el
 * tope de 20 s; con red era tráfico a Google (revisión de seguridad del PR
 * #242). Por eso el hijo recibe el emulador explícito, y Auth apunta a un
 * puerto donde nadie escucha: si algún día una prueba llega a Auth, falla acá
 * en vez de salir de la máquina. Y aun con el emulador, la biblioteca de
 * Google resuelve la credencial por defecto (lee el ADC del disco o sondea el
 * servidor de metadatos): se le da una ruta que no existe y se apaga el sondeo,
 * para que el hijo no toque nada del desarrollador.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'plataforma', 'asignar-rol.mjs');

const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;

const correr = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: entornoDelEmulador(HOST),
    encoding: 'utf8', timeout: 20000,
  });
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
  // `functions/src/core/seguridad/claims.ts` lo rechaza para una cuenta con contraseña. Acá se
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
    // Y que la lectura del comercio la contestó el emulador: sin datos sembrados
    // dice que no existe; si otra suite dejó `bellido`, termina en seco. Un
    // cuelgue o un error de credenciales no da ninguna de las dos.
    expect(r.salida).toMatch(/no existe|No se escribió nada/);
  });

  it('la ayuda nombra los dos roles y las dos banderas', () => {
    const r = correr();
    expect(r.salida).toContain('--rol admin|oper');
    expect(r.salida).toContain('--quitar');
    expect(r.salida).toContain('--aplicar');
  });
});
