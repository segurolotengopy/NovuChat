/**
 * «COMPORTAMIENTO DEL ASISTENTE»: la pantalla dibuja lo propuesto y NO escribe
 * lo que es del servidor.
 *
 * Hasta el 17/09/2026 `config/negocio.instruccionesExtra` existía en las
 * reglas, la pantalla lo leía y lo guardaba, y no lo dibujaba: a Clínica
 * Platinum se le cargó por script un texto con su campaña y la clínica no lo
 * veía en su consola. Regla de Andres: lo que NovuChat configura por script
 * TIENE que verse en la consola.
 *
 * El contrato de datos tiene tres campos y un escritor por campo:
 *  - `instruccionesExtra`, lo propuesto: lo escribe la pantalla.
 *  - `instruccionesVigentes` y `instruccionesRevision`: solo el servidor.
 *
 * Si la pantalla intentara escribir los dos del servidor, la regla rechazaría
 * el `updateDoc` ENTERO y el comercio no podría guardar ni su dirección. Por
 * eso esta prueba lee la fuente, como `bitacora-tipos.test.ts` y
 * `contrasena-minimo.test.ts`: no necesita emulador.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
// Base armada con join(aqui, …): la mudanza de suites la recalcula (un join con un argumento no literal, no).
const RAIZ_ADMIN = join(aqui, '..', '..');
const leer = (ruta: string) => readFileSync(join(RAIZ_ADMIN, ruta), 'utf8');

/** El cuerpo del archivo sin sus comentarios: lo que de verdad corre. */
const sinComentarios = (fuente: string) => fuente
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const pantalla = sinComentarios(leer('web/src/central/paginas/Configuracion.tsx'));

// El documento que la pantalla guarda se arma en `payloadNegocio` (la prueba del guardado completo usa la misma función).
const payload = sinComentarios(leer('web/src/central/lib/payloadNegocio.ts'));

/**
 * Lo que la pantalla manda en `updateDoc(... 'config', 'negocio' ...)`: la llamada en la pantalla (sus argumentos)
 * MÁS el cuerpo de `payloadNegocio`, que arma el objeto. Las dos mitades se vigilan juntas.
 */
function loQueGuarda(): string {
  const desde = pantalla.indexOf("updateDoc(doc(db, 'tenants', tenantId, 'config', 'negocio')");
  if (desde < 0) throw new Error('la pantalla ya no guarda con updateDoc sobre config/negocio');
  const hasta = pantalla.indexOf('}));', desde);
  const llamada = pantalla.slice(desde, hasta);
  // La pantalla arma el documento SOLO con `payloadNegocio`, no con un objeto propio.
  if (!llamada.includes('payloadNegocio({')) throw new Error('la pantalla ya no guarda con payloadNegocio');
  const cuerpo = payload.indexOf('export function payloadNegocio');
  if (cuerpo < 0) throw new Error('payloadNegocio.ts ya no exporta payloadNegocio');
  return llamada + payload.slice(cuerpo, payload.indexOf('export function datosDeNegocio'));
}

/** El objeto con el que la pantalla arma `datos` al leer el documento (`datosDeNegocio`, en `payloadNegocio.ts`). */
function loQueEntraEnDatos(): string {
  if (!pantalla.includes('setDatos(datosDeNegocio(v))')) throw new Error('la pantalla ya no arma `datos` con datosDeNegocio');
  const desde = payload.indexOf('export function datosDeNegocio');
  if (desde < 0) throw new Error('payloadNegocio.ts ya no exporta datosDeNegocio');
  const hasta = payload.indexOf('};', desde);
  return payload.slice(desde, hasta);
}

describe('Comportamiento del asistente en la consola', () => {
  it('la pantalla dibuja un textarea para instruccionesExtra, con su tope y su contador', () => {
    expect(pantalla).toContain('<h3>Comportamiento del asistente</h3>');
    expect(pantalla).toMatch(/instruccionesExtra: e\.target\.value/);
    expect(pantalla).toContain('maxLength={TOPE_INSTRUCCIONES}');
    expect(pantalla).toMatch(/TOPE_INSTRUCCIONES\} caracteres/);
    // El tope es el de las reglas (≤ 1.500) y sale de la misma tabla que los demás.
    expect(pantalla).toMatch(/instruccionesExtra: 1500/);
    expect(pantalla).toContain("TOPES['instruccionesExtra']");
  });

  it('lo propuesto viaja al servidor con el resto de `datos`', () => {
    expect(loQueEntraEnDatos()).toContain("instruccionesExtra: String(v['instruccionesExtra'] ?? '')");
    expect(loQueGuarda()).toContain('...datos');
  });

  it('la pantalla LEE lo vigente y la revisión, y los muestra', () => {
    expect(pantalla).toContain("v['instruccionesVigentes']");
    expect(pantalla).toContain("v['instruccionesRevision']");
    expect(pantalla).toContain('Lo que el asistente usa hoy');
    expect(pantalla).toContain('Pendiente de revisión');
    expect(pantalla).toContain('Aprobado y en uso');
    expect(pantalla).toContain('El asistente sigue usando la versión anterior');
  });

  it('la pantalla NUNCA escribe instruccionesVigentes ni instruccionesRevision', () => {
    // Los dos nombres aparecen solo al LEER el documento (`v['...']`): ni en
    // `datos`, ni en el objeto que se guarda, ni en ninguna otra parte.
    for (const campo of ['instruccionesVigentes', 'instruccionesRevision']) {
      const apariciones = pantalla.split(campo).length - 1;
      const lecturas = pantalla.split(`v['${campo}']`).length - 1;
      expect(lecturas).toBeGreaterThan(0);
      expect(apariciones).toBe(lecturas);
      expect(loQueEntraEnDatos()).not.toContain(campo);
      expect(loQueGuarda()).not.toContain(campo);
    }
    // Y los estados en los que viven tampoco entran en lo que se guarda.
    for (const estado of ['vigentes', 'revision', 'hashGuardadas', 'instruccionesGuardadas']) {
      expect(loQueGuarda()).not.toMatch(new RegExp(`\\b${estado}\\b`));
    }
  });

  it('lo vigente se muestra con TextoSeguro, nunca como HTML', () => {
    // Se resuelve el import desde la carpeta de la pantalla y se compara con el componente
    // canónico: vale tras cada mudanza y rechaza una copia sin escapar en otro lado.
    const m = pantalla.match(/import \{ TextoSeguro \} from '([^']+)'/);
    expect(m, 'la pantalla importa TextoSeguro').not.toBeNull();
    expect(`${resolve(dirname(join(aqui, '..', '..', 'web', 'src', 'central', 'paginas', 'Configuracion.tsx')), m![1])}.tsx`)
      .toBe(join(aqui, '..', '..', 'web', 'src', 'central', 'componentes', 'TextoSeguro.tsx'));
    expect(pantalla).toMatch(/<TextoSeguro valor=\{vigentes\}/);
    expect(pantalla).not.toContain('dangerouslySetInnerHTML');
  });
});
