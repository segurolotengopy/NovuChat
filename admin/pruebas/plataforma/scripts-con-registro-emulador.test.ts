/**
 * H2b-4e — LOS SCRIPTS OPERATIVOS QUE LEEN LA FICHA DE UN COMERCIO, CONTRA EL EMULADOR.
 *
 * Complementa `scripts-con-registro.test.ts` (que no necesita emulador). Acá se
 * ejecutan de verdad, como proceso y SOLO EN SECO (ninguno escribe: sin
 * `--aplicar` o solo lectura), los scripts que decidían por una lista de
 * flujos y ahora lo deciden por el registro, con una ficha por forma:
 *
 *   - las tres de hoy (`agendamiento`, `venta`, `onboarding`): lo que cada
 *     script permite o rechaza es lo de antes;
 *   - dos flujos a la vez (`agendamiento` + `venta`);
 *   - NEGATIVAS: un flujo desconocido no habilita nada.
 *
 * Los resultados esperados son los de los scripts ANTES del cambio (la tabla de
 * equivalencia está en `scripts-con-registro.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const script = (ruta: string) => join(aqui, '..', '..', 'scripts', ruta);
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'scripts-registro') ?? initializeApp({ projectId: PROYECTO }, 'scripts-registro');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const AGENDA = 'reg-agenda';
const VENTA = 'reg-venta';
const CAPTACION = 'reg-captacion';
const DOS = 'reg-dos-flujos';
const RARO = 'reg-flujo-raro';
const SOLO_VERTICAL = 'reg-solo-vertical';
const TENANTS = [AGENDA, VENTA, CAPTACION, DOS, RARO, SOLO_VERTICAL];

const tmp = mkdtempSync(join(tmpdir(), 'scripts-registro-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function correr(ruta: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [script(ruta), '--proyecto', PROYECTO, ...args], {
    env: entornoDelEmulador(HOST), encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

beforeAll(async () => {
  for (const t of TENANTS) await db.recursiveDelete(db.doc(`tenants/${t}`));
  const ficha = (nombre: string, flujos: string[] | undefined, vertical: string) =>
    db.doc(`tenants/${nombre}`).set({ nombre, estado: 'activo', vertical, ...(flujos ? { flujos } : {}) });
  await ficha(AGENDA, ['agendamiento'], 'agendamiento');
  await ficha(VENTA, ['venta'], 'venta');
  await ficha(CAPTACION, ['onboarding'], 'onboarding');
  await ficha(DOS, ['agendamiento', 'venta'], 'agendamiento');
  await ficha(RARO, ['recordatorios'], 'recordatorios');
  await ficha(SOLO_VERTICAL, undefined, 'venta');
}, 60_000);

// ======================================================================= activar-cobro-real
describe('activar-cobro-real.mjs: el documento que cobra lo decide el registro', () => {
  const qr = { cobroReal: { activo: false, nombreCuenta: 'Cuenta de prueba', banco: 'Banco', venceEl: '2099-12-31' } };
  beforeAll(async () => {
    // Cada comercio con un QR registrado en el documento que le toca, y el importe de la seña donde hace falta.
    await db.doc(`tenants/${AGENDA}/config/agendamiento`).set({ ...qr, senaImporte: 50 });
    await db.doc(`tenants/${VENTA}/config/venta`).set(qr);
    await db.doc(`tenants/${DOS}/config/venta`).set(qr);
    await db.doc(`tenants/${DOS}/config/agendamiento`).set({ ...qr, senaImporte: 50 });
    await db.doc(`tenants/${SOLO_VERTICAL}/config/venta`).set(qr);
  }, 60_000);

  const seco = (t: string) => correr('plataforma/activar-cobro-real.mjs', '--tenant', t);

  it.each([
    ['agendamiento', AGENDA, 'config/agendamiento'],
    ['venta', VENTA, 'config/venta'],
    ['agendamiento y venta (gana venta, como el servidor)', DOS, 'config/venta'],
  ])('un comercio de %s cobra por %s, y en seco no escribe', async (_n, tenant, documento) => {
    const r = seco(tenant);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain(`Documento : ${documento}`);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect((await db.doc(`tenants/${tenant}/${documento}`).get()).get('cobroReal')).toMatchObject({ activo: false });
  });

  it('NEGATIVA: un comercio de captación no tiene un flujo que cobre', () => {
    const r = seco(CAPTACION);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene un flujo que cobre.*Flujos: \["onboarding"\]/);
  });

  it('NEGATIVA: un flujo desconocido no cobra, y no aparece entre los flujos', () => {
    const r = seco(RARO);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene un flujo que cobre.*Flujos: \[\]/);
  });

  it('DIFERENCIA DECLARADA: una ficha sin `flujos` cobra por su `vertical`, como el servidor (antes: ningún flujo)', () => {
    const r = seco(SOLO_VERTICAL);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toContain('Documento : config/venta');
  });
});

// ======================================================================= fijar-webhook-carrito
describe('fijar-webhook-carrito.mjs: solo un comercio con catálogo web (venta) acepta el webhook', () => {
  const NUMEROS: Record<string, string> = {
    [AGENDA]: '1000000071', [VENTA]: '1000000072', [CAPTACION]: '1000000073', [DOS]: '1000000074',
    [RARO]: '1000000075', [SOLO_VERTICAL]: '1000000076',
  };
  beforeAll(async () => {
    for (const [tenant, numero] of Object.entries(NUMEROS)) {
      await db.doc(`rutasWhatsApp/${numero}`).set({ tenantId: tenant, estado: 'activo', flujo: 'venta' });
    }
  }, 60_000);
  afterAll(async () => { for (const n of Object.values(NUMEROS)) await db.doc(`rutasWhatsApp/${n}`).delete(); });

  const seco = (t: string) => correr('plataforma/fijar-webhook-carrito.mjs', '--numero', NUMEROS[t]!,
    '--url', 'https://n8n.ejemplo.com/webhook/prueba');

  it.each([['venta', VENTA], ['agendamiento y venta', DOS], ['solo `vertical` venta', SOLO_VERTICAL]])(
    'un comercio de %s lo acepta, y en seco no escribe', async (_n, tenant) => {
      const r = seco(tenant);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/Seco: no se escribió nada/);
      expect((await db.doc(`rutasWhatsApp/${NUMEROS[tenant]}`).get()).get('webhookCarrito')).toBeUndefined();
    });

  it.each([['agendamiento', AGENDA, 'agendamiento'], ['captación', CAPTACION, 'onboarding'], ['un flujo desconocido', RARO, '']])(
    'NEGATIVA: un comercio de %s lo rechaza', (_n, tenant, flujos) => {
      const r = seco(tenant);
      expect(r.codigo).toBe(1);
      expect(r.salida).toMatch(/no tiene el flujo «venta»/);
      expect(r.salida).toContain(`(${flujos})`);
      expect(r.salida).not.toMatch(/Seco: no se escribió nada/);
    });
});

// ======================================================================= pase-a-produccion
describe('pase-a-produccion.mjs: los flujos de la ficha y su documento salen del registro', () => {
  const repo = mkdtempSync(join(tmp, 'repo-'));
  const MARCADOR = { texto: 'REEMPLAZAR_ALGO_PRUEBA' };
  beforeAll(async () => {
    for (const t of TENANTS) await db.doc(`tenants/${t}/config/negocio`).set({ nombreNegocio: t });
    // Un marcador sin resolver en el documento de CADA flujo: el informe tiene que leerlo.
    await db.doc(`tenants/${AGENDA}/config/agendamiento`).set(MARCADOR);
    await db.doc(`tenants/${VENTA}/config/venta`).set(MARCADOR);
    await db.doc(`tenants/${CAPTACION}/config/onboarding`).set(MARCADOR);
    await db.doc(`tenants/${RARO}/config/recordatorios`).set(MARCADOR);
  }, 60_000);

  const informe = (t: string) => correr('plataforma/pase-a-produccion.mjs', '--tenant', t, '--repo', repo);

  it.each([['agendamiento', AGENDA], ['venta', VENTA], ['onboarding', CAPTACION]])(
    'un comercio de %s: el informe lista su flujo y lee SU documento de configuración', (flujo, tenant) => {
      const r = informe(tenant);
      expect(r.salida).toContain(`flujos: ${flujo}`);
      expect(r.salida).toMatch(/1 texto\(s\) con un marcador REEMPLAZAR_ sin resolver/);
    });

  it('dos flujos: los lista en el orden de la ficha', () => {
    expect(informe(DOS).salida).toContain('flujos: agendamiento, venta');
  });

  it('una ficha sin `flujos` cae a su `vertical`', () => {
    expect(informe(SOLO_VERTICAL).salida).toContain('flujos: venta');
  });

  it('NEGATIVA: un flujo desconocido no es un flujo (y su documento no se lee)', () => {
    const r = informe(RARO);
    expect(r.salida).toMatch(/sin flujos en la ficha/);
    expect(r.salida).not.toMatch(/1 texto\(s\) con un marcador/);
    expect(r.codigo).toBe(1);
  });
});

// ======================================================================= cargar-negocio
describe('cargar-negocio.mjs: las secciones por flujo las decide el registro', () => {
  const archivo = (nombre: string, datos: unknown) => {
    const ruta = join(tmp, `${nombre}.json`);
    writeFileSync(ruta, JSON.stringify(datos));
    return ruta;
  };
  const CON_AGENDA = archivo('agenda', { agendamiento: { duracionPorDefectoMin: 30 } });
  const CON_CATALOGO_WEB = archivo('catalogo-web', { negocio: { catalogoWebActivo: true } });
  const seco = (t: string, a: string) => correr('datos/cargar-negocio.mjs', '--tenant', t, '--archivo', a);

  it.each([[AGENDA], [DOS]])('la sección agendamiento entra en %s (en seco)', (tenant) => {
    const r = seco(tenant, CON_AGENDA);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
  });

  it.each([[VENTA], [CAPTACION], [RARO]])('NEGATIVA: la sección agendamiento NO entra en %s', (tenant) => {
    const r = seco(tenant, CON_AGENDA);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo agendamiento/);
  });

  it.each([[VENTA], [DOS]])('catalogoWebActivo entra en %s (en seco)', (tenant) => {
    const r = seco(tenant, CON_CATALOGO_WEB);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
  });

  it.each([[AGENDA], [CAPTACION], [RARO]])('NEGATIVA: catalogoWebActivo NO entra en %s', (tenant) => {
    const r = seco(tenant, CON_CATALOGO_WEB);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo venta: catalogoWebActivo no puede ser true/);
  });
});

// ======================================================================= cargar-captacion
describe('cargar-captacion.mjs: la captación la tiene el comercio con el flujo onboarding', () => {
  const NOVUCHAT = script('datos/captacion-novuchat.json');
  const seco = (t: string) => correr('datos/cargar-captacion.mjs', '--tenant', t, '--archivo', NOVUCHAT);

  it('un comercio de captación la acepta (en seco)', () => {
    const r = seco(CAPTACION);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
  });

  it.each([[AGENDA, '["agendamiento"]'], [VENTA, '["venta"]'], [RARO, '[]']])(
    'NEGATIVA: %s no tiene el flujo onboarding', (tenant, flujos) => {
      const r = seco(tenant);
      expect(r.codigo).toBe(1);
      expect(r.salida).toContain(`no tiene el flujo onboarding (flujos: ${flujos})`);
    });
});

// ======================================================================= cargar-fotos-catalogo
describe('cargar-fotos-catalogo.mjs: el logo es de un comercio con catálogo web (venta)', () => {
  // Un PNG con la cabecera de verdad (armado byte a byte, ver `cargar-fotos-catalogo.test.ts`).
  const png = (() => {
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4, 'ascii');
    ihdr.writeUInt32BE(320, 8);
    ihdr.writeUInt32BE(320, 12);
    ihdr[16] = 8;
    ihdr[17] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.from('IEND', 'ascii')]);
  })();
  const LOGO = join(tmp, 'logo.png');
  writeFileSync(LOGO, png);
  const seco = (t: string) => correr('datos/cargar-fotos-catalogo.mjs', '--tenant', t, '--logo', LOGO);

  it.each([[VENTA], [DOS]])('%s acepta el logo (en seco)', async (tenant) => {
    const r = seco(tenant);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect((await db.doc(`tenants/${tenant}/config/marca`).get()).exists).toBe(false);
  });

  it.each([[AGENDA], [CAPTACION], [RARO]])('NEGATIVA: %s no acepta el logo', async (tenant) => {
    const r = seco(tenant);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo venta: \/config\/marca no le corresponde/);
    expect((await db.doc(`tenants/${tenant}/config/marca`).get()).exists).toBe(false);
  });
});

// ======================================================================= asignar-numero
describe('asignar-numero.mjs: el documento de cada flujo sale del registro', () => {
  const NUMERO = '1000000081';
  const WABA = '1000000082';
  // Comercios propios SIN documentos de configuración: es lo que el script dice que crearía.
  const PROPIOS: [string, string][] = [['reg-asig-agenda', 'agendamiento'], ['reg-asig-venta', 'venta'], ['reg-asig-captacion', 'onboarding']];
  const asignar = (tenant: string, flujo: string) => correr('plataforma/asignar-numero.mjs', '--operador', 'operador@ejemplo.com',
    '--tenant', tenant, '--numero', NUMERO, '--waba', WABA, '--flujo', flujo, '--alias', 'cliente02');
  beforeAll(async () => {
    await db.doc(`rutasWhatsApp/${NUMERO}`).delete();
    for (const [t, f] of PROPIOS) {
      await db.recursiveDelete(db.doc(`tenants/${t}`));
      await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo', vertical: f, flujos: [f] });
    }
  }, 60_000);

  it.each(PROPIOS)(
    'en seco, el comercio %s con el flujo %s dice que crearía su documento de configuración', async (tenant, flujo) => {
      const r = asignar(tenant, flujo);
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toContain(`se crea config/${flujo}`);
      expect(r.salida).toMatch(/Seco: no se escribió nada/);
      expect((await db.doc(`rutasWhatsApp/${NUMERO}`).get()).exists).toBe(false);
    });

  it('NEGATIVA: un flujo desconocido no llega a Firestore (sale con 2)', () => {
    const r = asignar('reg-asig-agenda', 'recordatorios');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/--flujo desconocido: recordatorios/);
  });
});
