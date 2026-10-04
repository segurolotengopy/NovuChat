/**
 * «VOLVER AL CHAT»: EL NÚMERO PÚBLICO DE LA LÍNEA, contra el emulador
 * (Andres, 04/10/2026, Q'Taco).
 *
 * El catálogo web manda al cliente de vuelta a la conversación del negocio con
 * `https://wa.me/<número>`. La fuente es `rutasWhatsApp/<phoneNumberId>.numeroPublico`
 * (la línea por la que entró la conversación de la ficha) y la escribe
 * `scripts/modulos/catalogo-web/fijar-numero-publico.mjs`. Esta suite fija,
 * NEGANDO, lo que ninguna de las dos piezas puede hacer:
 *
 *   SERVIDOR (`catalogoPublico`)
 *   - el número viaja si es una cadena de 8 a 15 dígitos válida, y solo
 *     entonces; ausente o inválido, la respuesta no trae la clave;
 *   - nunca viaja el de otro comercio (número reasignado dentro de las 72 h);
 *   - del documento de la ruta no sale ningún otro campo, y el bloque `negocio`
 *     es una lista cerrada de claves: ni recepción, ni avisos, ni ids de Meta;
 *   SCRIPT
 *   - seco por omisión; con `--aplicar` escribe SOLO `numeroPublico` y el sello;
 *   - niega comercio inexistente o inactivo, sin número asignado, sin ruta,
 *     con ruta de otro comercio, y todo número que no sea dígitos con prefijo;
 *   - no imprime ningún otro dato de la ruta ni del comercio.
 *
 * Emulador, con puerto propio:
 *   FIRESTORE_EMULATOR_PORT=8762 FIRESTORE_EMULATOR_WS_PORT=9762 \
 *     bash pruebas/correr.sh --project emulador pruebas/modulos/catalogo-web/numero-publico.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;
process.env['GCLOUD_PROJECT'] = PROYECTO;
process.env['SITIO_PUBLICO'] = 'https://catalogo.ejemplo.test';

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
const db = getFirestore();
const { catalogoPublico, emitirFicha, numeroPublicoValido } =
  await import('../../../functions/src/modulos/catalogo-web/catalogoWeb.ts');

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', '..', 'scripts', 'modulos', 'catalogo-web', 'fijar-numero-publico.mjs');

// Comercios, líneas y números de ESTA suite. Los números de teléfono son
// ficticios; los identificadores de línea tienen la forma de los de Meta.
const T = 'np-venta';
const T_OTRO = 'np-otro';
const T_SUSP = 'np-suspendido';
const T_SIN_NUMERO = 'np-sin-numero';
const T_SIN_RUTA = 'np-sin-ruta';
const T_RUTA_AJENA = 'np-ruta-ajena';
const LINEA = '1000000301';
const LINEA_OTRO = '1000000302';
const LINEA_SUSP = '1000000303';
const LINEA_SIN_RUTA = '1000000305';
const LINEA_AJENA = '1000000306';
const PUBLICO = '59100000041';
const PUBLICO_OTRO = '59100000042';
const RECEPCION = '59100000043';
const ALIAS = 'alias-secreto-de-la-suite';
const WABA = '2000000301';
const WEBHOOK = 'https://n8n.ejemplo.test/webhook/ruta-secreta-de-la-suite';
const TELEFONO_CLIENTE = '70010099';

const tenants = [T, T_OTRO, T_SUSP, T_SIN_NUMERO, T_SIN_RUTA, T_RUTA_AJENA];
const lineas = [LINEA, LINEA_OTRO, LINEA_SUSP, LINEA_SIN_RUTA, LINEA_AJENA];

async function sembrarComercio(
  id: string, o: { linea: string | null; estado?: string; ruta?: Record<string, unknown> | null },
) {
  await db.doc(`tenants/${id}`).set({
    nombre: id, estado: o.estado ?? 'activo', plan: 'crecimiento', flujos: ['venta'],
    waPhoneNumberId: o.linea,
  });
  await db.doc(`tenants/${id}/config/negocio`).set({
    nombreNegocio: `Negocio ${id}`, numeroRecepcion: RECEPCION, catalogoWebActivo: true,
  });
  await db.doc(`tenants/${id}/catalogo/i001`).set({
    nombre: 'Item', area: 'a', precio: 10, moneda: 'BOB', activo: true,
  });
  if (o.linea !== null && o.ruta !== null) {
    await db.doc(`rutasWhatsApp/${o.linea}`).set({
      tenantId: id, flujo: 'venta', wabaId: WABA, aliasSecreto: ALIAS, titularidad: 'novuchat',
      estado: 'activo', webhookCarrito: WEBHOOK, ...(o.ruta ?? {}),
    });
  }
}

async function limpiar() {
  for (const t of tenants) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const l of lineas) await db.doc(`rutasWhatsApp/${l}`).delete();
  for (const t of tenants) {
    for (const f of (await db.collection('fichasCatalogo').where('tenantId', '==', t).get()).docs) {
      await f.ref.delete();
    }
  }
}

beforeAll(async () => {
  await limpiar();
  await sembrarComercio(T, { linea: LINEA, ruta: { numeroPublico: PUBLICO } });
  await sembrarComercio(T_OTRO, { linea: LINEA_OTRO, ruta: { numeroPublico: PUBLICO_OTRO } });
  await sembrarComercio(T_SUSP, { linea: LINEA_SUSP, estado: 'suspendido' });
  await sembrarComercio(T_SIN_NUMERO, { linea: null });
  await sembrarComercio(T_SIN_RUTA, { linea: LINEA_SIN_RUTA, ruta: null });
  // Su comercio apunta a una línea cuya ruta es de OTRO comercio.
  await sembrarComercio(T_RUTA_AJENA, { linea: LINEA_AJENA, ruta: { tenantId: T_OTRO } });
}, 60_000);

afterAll(limpiar, 60_000);

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function pedirCatalogo(ficha: string): Promise<Respuesta> {
  const ruta = `/api/catalogo/${ficha}`;
  const peticion = { method: 'GET', headers: {}, get: () => undefined, path: ruta, url: ruta, originalUrl: ruta };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, type() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (catalogoPublico as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

/** Una ficha de venta para `tenant`, por la línea `linea`, y la respuesta pública que abre. */
async function abrir(tenant: string, linea: string): Promise<Respuesta> {
  const f = await emitirFicha({
    tenantId: tenant, phoneNumberId: linea, flujo: 'venta', telefono: TELEFONO_CLIENTE, reutilizar: false,
  });
  return pedirCatalogo(f.id);
}
const negocioDe = (r: Respuesta) => r.cuerpo['negocio'] as Record<string, unknown>;

describe('numeroPublicoValido (la misma forma que el navegador)', () => {
  it('acepta de 8 a 15 dígitos sin cero inicial; todo lo demás es vacío', () => {
    expect(numeroPublicoValido(PUBLICO)).toBe(PUBLICO);
    expect(numeroPublicoValido('12345678')).toBe('12345678');
    for (const malo of [
      '', ' ', '+59100000041', '591 0000 0041', '059100000041', '1234567', '1234567890123456',
      '59100000041\n', '59100000041?text=hola', 'javascript:alert(1)', '５９１００００００４１',
      null, undefined, 59100000041, {}, [PUBLICO], true,
    ]) expect(numeroPublicoValido(malo), JSON.stringify(malo)).toBe('');
  });
});

describe('catalogoPublico: el número viaja solo si es válido y es de ESTE comercio', () => {
  it('con un número público válido en la ruta de la línea: viaja como `negocio.whatsapp`', async () => {
    const r = await abrir(T, LINEA);
    expect(r.codigo).toBe(200);
    expect(negocioDe(r)['whatsapp']).toBe(PUBLICO);
  });

  it('cada línea manda a su propio número: la ficha de OTRO comercio trae el suyo, no este', async () => {
    const r = await abrir(T_OTRO, LINEA_OTRO);
    expect(negocioDe(r)['whatsapp']).toBe(PUBLICO_OTRO);
  });

  it('NEGANDO: sin el campo en la ruta, la respuesta no trae la clave', async () => {
    await db.doc(`rutasWhatsApp/${LINEA}`).update({ numeroPublico: FieldValue.delete() });
    try {
      const r = await abrir(T, LINEA);
      expect(r.codigo).toBe(200);
      expect(negocioDe(r)).not.toHaveProperty('whatsapp');
    } finally {
      await db.doc(`rutasWhatsApp/${LINEA}`).update({ numeroPublico: PUBLICO });
    }
  });

  it('NEGANDO: un valor inválido guardado tampoco viaja (ni un texto, ni un número, ni algo con forma de enlace)', async () => {
    try {
      for (const malo of [
        '+59100000041', '591 0000 0041', '059100000041', '1234567', '1234567890123456',
        '59100000041/../x', '59100000041?text=hola', 'javascript:alert(1)', 'https://malo.test',
        '', 59100000041, ['59100000041'], { n: PUBLICO }, true, null,
      ]) {
        await db.doc(`rutasWhatsApp/${LINEA}`).update({ numeroPublico: malo });
        const r = await abrir(T, LINEA);
        expect(r.codigo, JSON.stringify(malo)).toBe(200);
        expect(negocioDe(r), JSON.stringify(malo)).not.toHaveProperty('whatsapp');
        expect(JSON.stringify(r.cuerpo), JSON.stringify(malo)).not.toContain('malo.test');
      }
    } finally {
      await db.doc(`rutasWhatsApp/${LINEA}`).update({ numeroPublico: PUBLICO });
    }
  });

  it('NEGANDO: una línea cuya ruta es de OTRO comercio (número reasignado) no manda su número', async () => {
    // `np-ruta-ajena` tiene ficha por LINEA_AJENA, pero esa ruta es de `np-otro`
    // y trae el número de `np-otro`: mostrárselo sería el WhatsApp de otro negocio.
    await db.doc(`rutasWhatsApp/${LINEA_AJENA}`).update({ numeroPublico: PUBLICO_OTRO });
    const r = await abrir(T_RUTA_AJENA, LINEA_AJENA);
    expect(r.codigo).toBe(200);
    expect(negocioDe(r)).not.toHaveProperty('whatsapp');
    expect(JSON.stringify(r.cuerpo)).not.toContain(PUBLICO_OTRO);
  });

  it('NEGANDO: sin ruta o con un phoneNumberId de ficha vacío o raro, no hay número y no hay error', async () => {
    for (const [tenant, linea] of [[T_SIN_RUTA, LINEA_SIN_RUTA], [T, ''], [T, '../x'], [T, 'x'.repeat(30)]] as const) {
      const r = await abrir(tenant, linea);
      expect(r.codigo, `${tenant}/${linea}`).toBe(200);
      expect(negocioDe(r), `${tenant}/${linea}`).not.toHaveProperty('whatsapp');
    }
  });
});

describe('catalogoPublico: nada sensible viaja con el número', () => {
  it('el bloque `negocio` es una lista cerrada de claves', async () => {
    const r = await abrir(T, LINEA);
    expect(Object.keys(negocioDe(r)).sort()).toEqual(
      ['descripcion', 'direccion', 'logo', 'moneda', 'nombre', 'paleta', 'whatsapp']);
  });

  it('NEGANDO: ningún otro dato de la ruta, de la configuración ni de la ficha aparece en la respuesta', async () => {
    const r = await abrir(T, LINEA);
    const texto = JSON.stringify(r.cuerpo);
    for (const secreto of [
      RECEPCION, ALIAS, WABA, WEBHOOK, LINEA, TELEFONO_CLIENTE, 'aliasSecreto', 'webhookCarrito',
      'wabaId', 'titularidad', 'numeroRecepcion', 'phoneNumberId', 'tenantId', 'rutasWhatsApp',
    ]) expect(texto, secreto).not.toContain(secreto);
    // Y el número de OTRO comercio, por supuesto, tampoco.
    expect(texto).not.toContain(PUBLICO_OTRO);
  });
});

// ===========================================================================
// EL SCRIPT
// ===========================================================================

const correr = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: entornoDelEmulador(HOST), encoding: 'utf8', timeout: 30_000,
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
};
const base = (tenant: string, numero: string) => ['--proyecto', PROYECTO, '--tenant', tenant, '--numero', numero];
const ruta = async (linea: string) => (await db.doc(`rutasWhatsApp/${linea}`).get()).data() ?? {};
const auditorias = async (tenant: string) =>
  (await db.collection(`tenants/${tenant}/auditoria`).get()).docs.map((d) => d.data());

describe('fijar-numero-publico.mjs: lo que no se puede pedir', () => {
  it('sin argumentos dice todo lo que falta, de una vez (salida 2)', () => {
    const r = correr();
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('falta --proyecto');
    expect(r.salida).toContain('--tenant no es un identificador válido');
    expect(r.salida).toContain('--numero tiene que ser solo dígitos');
  });

  it.each([
    ['con +', '+59100000041'], ['con espacios', '591 0000 0041'], ['con guiones', '591-0000-0041'],
    ['con cero inicial', '059100000041'], ['de 7 dígitos', '1234567'], ['de 16 dígitos', '1234567890123456'],
    ['con texto', '59100000041abc'], ['con una consulta', '59100000041?text=hola'],
    ['con un enlace', 'https://wa.me/59100000041'], ['vacío', ''],
  ])('NEGANDO: un número %s se rechaza antes de abrir Firebase, y no escribe', async (_n, numero) => {
    const antes = await ruta(LINEA);
    const r = correr(...base(T, numero), '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('--numero');
    expect(await ruta(LINEA)).toEqual(antes);
  });

  it('NEGANDO: un número local boliviano sin prefijo (8 dígitos que empiezan en 6 o 7) se rechaza', async () => {
    const antes = await ruta(LINEA);
    for (const local of ['76000001', '60000001']) {
      const r = correr(...base(T, local), '--aplicar');
      expect(r.codigo, local).toBe(2);
      expect(r.salida).toContain('falta el código del país');
    }
    expect(await ruta(LINEA)).toEqual(antes);
  });
});

describe('fijar-numero-publico.mjs: lo que niega con el comercio y la ruta', () => {
  const NUEVO = '59100000051';

  it.each([
    ['un comercio que no existe', 'np-no-existe', 'No existe el comercio'],
    ['un comercio suspendido', T_SUSP, 'no está activo'],
    ['un comercio sin número de WhatsApp asignado', T_SIN_NUMERO, 'no tiene un número de WhatsApp asignado'],
    ['un número sin ruta', T_SIN_RUTA, 'no tiene ruta'],
    ['una ruta que es de otro comercio', T_RUTA_AJENA, 'es de otro comercio'],
  ])('NEGANDO: %s (salida 1, sin escribir nada, ni siquiera con --aplicar)', async (_n, tenant, mensaje) => {
    const antes = await Promise.all(lineas.map(ruta));
    const r = correr(...base(tenant, NUEVO), '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(mensaje);
    expect(await Promise.all(lineas.map(ruta))).toEqual(antes);
    expect(await auditorias(tenant)).toEqual([]);
    // Y se niega por el motivo, sin imprimir datos de la ruta.
    for (const secreto of [ALIAS, WABA, WEBHOOK, RECEPCION]) expect(r.salida).not.toContain(secreto);
  });

  it('NEGANDO: tampoco crea una ruta que no existe', async () => {
    correr(...base(T_SIN_RUTA, NUEVO), '--aplicar');
    expect((await db.doc(`rutasWhatsApp/${LINEA_SIN_RUTA}`).get()).exists).toBe(false);
  });
});

describe('fijar-numero-publico.mjs: el caso bueno', () => {
  const NUEVO = '59100000052';

  it('es SECO por omisión: muestra antes y después y no escribe nada', async () => {
    const antes = await ruta(LINEA);
    const r = correr(...base(T, NUEVO));
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(PUBLICO);
    expect(r.salida).toContain(NUEVO);
    expect(r.salida).toContain('Seco');
    expect(await ruta(LINEA)).toEqual(antes);
    expect(await auditorias(T)).toEqual([]);
  });

  it('con --aplicar escribe SOLO `numeroPublico` y el sello, y deja una entrada de auditoría', async () => {
    const antes = await ruta(LINEA);
    const r = correr(...base(T, NUEVO), '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('fijado');

    const despues = await ruta(LINEA);
    const cambiaron = Object.keys({ ...antes, ...despues })
      .filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(despues[k])).sort();
    expect(cambiaron).toEqual(['actualizadoEn', 'actualizadoPor', 'numeroPublico']);
    expect(despues['numeroPublico']).toBe(NUEVO);
    expect(despues['actualizadoPor']).toBe('script:fijar-numero-publico');
    // Lo demás de la ruta, intacto: el alias, la WABA, el webhook, la titularidad.
    for (const k of ['tenantId', 'flujo', 'wabaId', 'aliasSecreto', 'titularidad', 'estado', 'webhookCarrito']) {
      expect(despues[k], k).toEqual(antes[k]);
    }

    const auditoria = await auditorias(T);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      accion: 'fijar_numero_publico', origen: 'script', antes: PUBLICO, despues: NUEVO,
      phoneNumberId: `…${LINEA.slice(-4)}`,
    });
    expect(auditoria[0]!['en']).toBeInstanceOf(Timestamp);
    // La auditoría no guarda el identificador completo de la línea.
    expect(JSON.stringify(auditoria)).not.toContain(LINEA);
  });

  it('NEGANDO: no imprime nada de la ruta ni del comercio salvo lo mostrado (últimos cuatro de la línea)', async () => {
    const r = correr(...base(T, '59100000053'), '--aplicar');
    expect(r.codigo).toBe(0);
    for (const secreto of [ALIAS, WABA, WEBHOOK, RECEPCION, LINEA, 'aliasSecreto', 'webhookCarrito']) {
      expect(r.salida, secreto).not.toContain(secreto);
    }
    expect(r.salida).toContain(`…${LINEA.slice(-4)}`);
  });

  it('el mismo número otra vez: «ya estaba así», sin segunda auditoría', async () => {
    const antes = (await auditorias(T)).length;
    const r = correr(...base(T, '59100000053'), '--aplicar');
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('Ya estaba así');
    expect((await auditorias(T)).length).toBe(antes);
  });

  it('y el servidor ya lo sirve: lo que fijó el script es lo que viaja en la página', async () => {
    const r = await abrir(T, LINEA);
    expect(negocioDe(r)['whatsapp']).toBe('59100000053');
  });
});
