/**
 * =============================================================================
 * `scripts/cargar-fotos-catalogo.mjs` — LAS FOTOS Y EL LOGO, DESDE ARCHIVOS
 * =============================================================================
 *
 * QUÉ DEFIENDE. Este script escribe 154 documentos de imagen en producción con
 * el SDK Admin, que SE SALTA `firestore.rules`. O sea: si escribiera algo que
 * las reglas no aceptan —una clave de más, un `data:` que no casa con la
 * expresión, una medida fuera de rango—, Firestore lo guardaría igual y el
 * defecto aparecería después, cuando el comercio intentara cambiar esa foto
 * desde la consola y las reglas se lo negaran sin decir por qué. Por eso lo que
 * se prueba acá no es «se escribió», es «se escribió EXACTAMENTE lo que la
 * consola habría escrito».
 *
 * LAS IMÁGENES DE LA PRUEBA SE FABRICAN ACÁ, en PNG, y no se leen de ninguna
 * carpeta: las fotos de verdad son material de un tercero y viven fuera del
 * control de versiones (`CLIENTES/`, ignorado por git). Una prueba que
 * dependiera de ellas pasaría en la máquina de quien las tiene y fallaría en
 * CI, que es la peor clase de prueba.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'cargar-fotos-catalogo.mjs');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'fotos-catalogo')
  ?? initializeApp({ projectId: PROYECTO }, 'fotos-catalogo');
const db = getFirestore(app);

const T = 'fc-venta';
const SIN_VENTA = 'fc-sin-venta';

/**
 * Un PNG con la cabecera de verdad y el cuerpo mínimo.
 *
 * SE ARMA BYTE A BYTE Y NO SE PEGA EN BASE64 por dos razones. La primera es
 * `verificar-saneo.sh`: una cadena larga de base64 en un archivo versionado
 * casa con el patrón «token de Meta / Facebook» del modo B —el que corre en
 * CI— y deja el repositorio en rojo por una imagen de prueba. La segunda es que
 * así se ve qué está probando: el script solo LEE la firma y el bloque IHDR
 * (ancho y alto, en 32 bits, en los desplazamientos 16 y 20) y después codifica
 * los bytes tal cual; no decodifica la imagen. Un PNG con la cabecera correcta
 * es exactamente lo que hace falta para ejercitarlo.
 */
function png(ancho: number, alto: number) {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);            // largo del bloque
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(ancho, 8);
  ihdr.writeUInt32BE(alto, 12);
  ihdr[16] = 8;                         // bits por canal
  ihdr[17] = 6;                         // RGBA
  return Buffer.concat([firma, ihdr, Buffer.from('IEND', 'ascii')]);
}

const tmp = mkdtempSync(join(tmpdir(), 'fotos-catalogo-'));
const dir = (nombre: string) => {
  const d = join(tmp, nombre);
  mkdirSync(d, { recursive: true });
  return d;
};
function correr(...extra: string[]) {
  const r = spawnSync(process.execPath,
    [SCRIPT, '--proyecto', PROYECTO, ...extra],
    { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

/** Una carpeta con dos fotos que SÍ corresponden a ítems del catálogo. */
const BUENAS = dir('buenas');
writeFileSync(join(BUENAS, 'chuspa.png'), png(600, 400));
writeFileSync(join(BUENAS, 'cuello.png'), png(300, 900));
const LOGO = join(tmp, 'logo.png');
writeFileSync(LOGO, png(320, 320));

beforeAll(async () => {
  for (const t of [T, SIN_VENTA]) {
    for (const col of ['catalogo', 'fotosCatalogo', 'auditoria']) {
      for (const d of (await db.collection(`tenants/${t}/${col}`).get()).docs) await d.ref.delete();
    }
    await db.doc(`tenants/${t}/config/marca`).delete();
  }
  await db.doc(`tenants/${T}`).set({
    nombre: 'Demo de fotos', estado: 'activo', vertical: 'venta', flujos: ['venta'],
  });
  await db.doc(`tenants/${SIN_VENTA}`).set({
    nombre: 'Consultorio', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'],
  });
  for (const id of ['chuspa', 'cuello']) {
    await db.doc(`tenants/${T}/catalogo/${id}`).set({ nombre: id, precio: 10, activo: true });
  }
}, 60_000);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('cargar-fotos-catalogo.mjs', () => {
  it('en seco cuenta lo que haría y NO escribe nada', async () => {
    const r = correr('--tenant', T, '--fotos', BUENAS, '--logo', LOGO);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/2 lista\(s\) · 0 con problema · 0 ítem\(s\) del catálogo sin foto/);
    expect(r.salida).toMatch(/Logo\s+:.*320×320/);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect((await db.collection(`tenants/${T}/fotosCatalogo`).get()).size).toBe(0);
    expect((await db.doc(`tenants/${T}/config/marca`).get()).exists).toBe(false);
  }, 60_000);

  /**
   * ESTA ES LA PRUEBA QUE IMPORTA. Las siete claves, ni una más —la regla usa
   * `hasOnly`—, el `data:` con la forma exacta de la expresión de
   * `fotoValida()`, y `ancho`/`alto` que son los de la imagen y no están
   * cruzados entre sí. Con el SDK Admin nada de esto lo comprueba el servidor.
   */
  it('con --aplicar escribe exactamente lo que aceptarían las reglas', async () => {
    const r = correr('--tenant', T, '--fotos', BUENAS, '--logo', LOGO, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    // Entre el ✓ y el texto va un código ANSI de color.
    expect(r.salida).toMatch(/Verificación: 2 foto\(s\)/);

    const d = await db.doc(`tenants/${T}/fotosCatalogo/chuspa`).get();
    expect(Object.keys(d.data() ?? {}).sort()).toEqual(
      ['actualizadoEn', 'actualizadoPor', 'alto', 'ancho', 'bytes', 'datos', 'tipo']);
    expect(d.get('ancho')).toBe(600);
    expect(d.get('alto')).toBe(400);
    expect(d.get('tipo')).toBe('image/png');
    expect(String(d.get('datos')))
      .toMatch(/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/);
    expect(d.get('bytes')).toBeLessThanOrEqual(210_000);
    expect(String(d.get('datos')).length).toBeLessThanOrEqual(210_000);

    // Ancho y alto NO se confunden: la otra es 300×900, no 900×300.
    const otra = await db.doc(`tenants/${T}/fotosCatalogo/cuello`).get();
    expect(otra.get('ancho')).toBe(300);
    expect(otra.get('alto')).toBe(900);

    const marca = await db.doc(`tenants/${T}/config/marca`).get();
    expect(Object.keys(marca.data() ?? {}).sort())
      .toEqual(['actualizadoEn', 'actualizadoPor', 'logo']);
    expect(String(marca.get('logo')))
      .toMatch(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
    expect(String(marca.get('logo')).length).toBeLessThanOrEqual(200_000);
  }, 60_000);

  /**
   * UNA FOTO SIN SU ÍTEM ES PESO MUERTO. `fotosCatalogo/{itemId}` cuelga de un
   * ítem: si el ítem no existe, nadie la va a ver y nadie la va a limpiar. Y es
   * el síntoma real de cargar las fotos ANTES que el catálogo, que es el orden
   * en que a uno le sale hacerlo.
   */
  it('NO escribe la foto de un ítem que no existe, y sigue con las demás', async () => {
    const d = dir('huerfana');
    writeFileSync(join(d, 'chuspa.png'), png(100, 100));
    writeFileSync(join(d, 'no-existe.png'), png(100, 100));
    const r = correr('--tenant', T, '--fotos', d, '--aplicar');
    // Código 1: hubo problemas, pero lo bueno se escribió.
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/no-existe\s+no hay ningún ítem con ese identificador/);
    expect((await db.doc(`tenants/${T}/fotosCatalogo/no-existe`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${T}/fotosCatalogo/chuspa`).get()).get('ancho')).toBe(100);
  }, 60_000);

  it('NO acepta una imagen por encima del tope de las reglas', () => {
    const d = dir('gorda');
    // 300 KB de PNG: entra en un documento de Firestore, pero NO en la regla.
    const gorda = Buffer.concat([png(10, 10), Buffer.alloc(300 * 1024, 7)]);
    writeFileSync(join(d, 'chuspa.png'), gorda);
    const r = correr('--tenant', T, '--fotos', d, '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/en base64, y el tope es/);
  }, 60_000);

  it('NO acepta un formato fuera de los tres que admiten las reglas', () => {
    const d = dir('gif');
    writeFileSync(join(d, 'chuspa.gif'), png(50, 50));
    writeFileSync(join(d, 'cuello.png'), png(50, 50));
    const r = correr('--tenant', T, '--fotos', d);
    // El `.gif` ni se mira —no está entre las extensiones que se listan—, así
    // que su ítem aparece como «sin foto» y no como un problema: es lo que hay
    // que ver, porque un formato ignorado en silencio sería una foto que falta
    // sin que nadie lo diga.
    expect(r.salida).toMatch(/1 lista\(s\) · 0 con problema · 1 ítem\(s\) del catálogo sin foto/);
    expect(r.salida).toMatch(/sin foto: chuspa/);
    expect(r.salida).not.toMatch(/✗/);
  }, 60_000);

  it('NO acepta un archivo cuyo nombre no es un identificador de ítem', () => {
    const d = dir('mal-nombre');
    writeFileSync(join(d, 'Chuspa Andina.png'), png(50, 50));
    const r = correr('--tenant', T, '--fotos', d);
    expect(r.salida).toMatch(/el nombre del archivo no es un identificador válido/);
  }, 60_000);

  /**
   * EL LOGO ES CAPACIDAD DE VENTA. `/config/marca` solo se acepta con
   * `tieneCobro` (firestore.rules). Escribirlo en un comercio de agendamiento
   * dejaría un documento que la consola no podría editar nunca.
   */
  it('NO escribe el logo en un comercio sin el flujo venta', async () => {
    const r = correr('--tenant', SIN_VENTA, '--logo', LOGO, '--aplicar');
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo venta: \/config\/marca no le corresponde/);
    expect((await db.doc(`tenants/${SIN_VENTA}/config/marca`).get()).exists).toBe(false);
  }, 60_000);

  it('--limpiar borra las fotos y vacía el logo, que es como se vuelve al otro demo', async () => {
    expect((await db.collection(`tenants/${T}/fotosCatalogo`).get()).size).toBeGreaterThan(0);
    const seco = correr('--tenant', T, '--limpiar');
    expect(seco.codigo, seco.salida).toBe(0);
    expect(seco.salida).toMatch(/Seco: no se borró nada/);
    expect((await db.collection(`tenants/${T}/fotosCatalogo`).get()).size).toBeGreaterThan(0);

    const r = correr('--tenant', T, '--limpiar', '--logo', '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect((await db.collection(`tenants/${T}/fotosCatalogo`).get()).size).toBe(0);
    // El documento NO se borra: se vacía. Es como lo quita la consola, y es lo
    // único que `firestore.rules` permite (el borrado está cerrado).
    const marca = await db.doc(`tenants/${T}/config/marca`).get();
    expect(marca.exists).toBe(true);
    expect(marca.get('logo')).toBe('');
  }, 60_000);

  it('exige un comercio que exista y no acepta --limpiar junto con --fotos', () => {
    expect(correr('--tenant', 'no-existe-jamas', '--fotos', BUENAS).codigo).toBe(1);
    expect(correr('--tenant', T, '--limpiar', '--fotos', BUENAS).salida)
      .toMatch(/excluyentes/);
  }, 60_000);
});
