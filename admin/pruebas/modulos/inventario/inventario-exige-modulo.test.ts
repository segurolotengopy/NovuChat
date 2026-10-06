/**
 * =============================================================================
 * EL INVENTARIO EXIGE SU MÓDULO (05/10/2026) — servidor y consola, negando
 * =============================================================================
 *
 * Motivo: Q'Taco no usa inventario y no se entrega una función que no necesita.
 * Ocultar la pestaña (con `tenants.modulos` sin `inventario`) no cerraba nada:
 *
 *   (a) la ruta `/negocio/{id}/inventario` se abría por dirección;
 *   (b) la callable `ajustarStock` solo pedía ser administrador del negocio, de
 *       cualquier negocio: el administrador de un negocio de reservas podía
 *       escribirle `stock` a sus servicios;
 *   (c) la lectura de `movimientosStock` en las reglas no está ligada al módulo:
 *       SEGUIMIENTO, `firestore.rules` lo toca otro PR (un dueño por archivo).
 *
 * Esta suite cierra (a) y (b), y fija la tabla de comportamiento por tipo de
 * ficha. Las pruebas de servidor corren contra el emulador de Firestore, con la
 * callable ejecutada de verdad (`.run`).
 *
 * LO QUE HACÍA `ajustarStock` ANTES, PARA LOS SEIS COMERCIOS DE HOY: autenticar,
 * exigir `nc.t[tenant] === 'admin'` y mover el saldo. NO miraba la ficha. Por eso
 * para Demo A, Platinum y Bellido (reservas; no tienen inventario) la llamada
 * «funcionaba» y ahora responde `permission-denied`. Ninguna pantalla de reservas,
 * flujo de n8n, script ni pestaña la llama (se verificó con búsqueda en el repo):
 * el único otro llamador es la importación de CSV de `Catalogo.tsx`, y solo si el
 * archivo trae una celda `cantidad` con número.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  IDS_FLUJOS, modulosDeFicha, pestanasDe, tieneModulo,
} from '../../../functions/src/registro.ts';
import {
  capacidadesDeConsola, modulosDe, pestanasVisibles,
} from '../../../web/src/central/lib/flujos.ts';

/** La fachada importa `core/lib/firebase` (para `useModulos`); acá no hay navegador ni claves. */
vi.mock('../../../web/src/core/lib/firebase', () => ({ db: {} }));

const aqui = dirname(fileURLToPath(import.meta.url));
const PROYECTO = 'demo-novuchat-pruebas';
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${PUERTO}`;

// EL SDK ADMIN, RESUELTO DESDE `functions/` (una sola app por defecto, la de la función).
const requerir = createRequire(join(aqui, '..', '..', '..', 'functions', 'package.json'));
const { initializeApp, getApps } = requerir('firebase-admin/app') as typeof import('firebase-admin/app');
const { getFirestore } = requerir('firebase-admin/firestore') as typeof import('firebase-admin/firestore');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const I = await import('../../../functions/src/modulos/inventario/inventario.ts');

// ===========================================================================
// Las fichas que representan cada tipo de comercio
// ===========================================================================
type Ficha = Record<string, unknown>;
/** Q'Taco: venta, con la lista explícita de lo que usa (sin inventario). */
const MODULOS_QTACO = ['productos', 'campanas', 'cobros', 'pedidos', 'catalogo-web'];
const QTACO: Ficha = { nombre: 'qtaco', vertical: 'venta', flujos: ['venta'], modulos: MODULOS_QTACO };
const QTACO_SIN_LISTA: Ficha = { nombre: 'qtaco', vertical: 'venta', flujos: ['venta'] };

/** Tipo de ficha → ¿abre el inventario?  Es la tabla del PR. */
const TABLA: Array<[string, Ficha | null, boolean]> = [
  ['venta sin lista (flujos: [venta])', { flujos: ['venta'] }, true],
  ['venta sin lista (solo vertical: venta)', { vertical: 'venta' }, true],
  ['venta con flujos y vertical', { vertical: 'venta', flujos: ['venta'] }, true],
  ['lista con inventario', { modulos: ['productos', 'inventario'] }, true],
  ['lista con inventario sobre una ficha de reservas', { flujos: ['agendamiento'], modulos: ['inventario'] }, true],
  ['venta con lista SIN inventario (Q\'Taco)', QTACO, false],
  ['venta con lista vacía', { flujos: ['venta'], modulos: [] }, false],
  ['reservas sin lista (flujos: [agendamiento])', { flujos: ['agendamiento'] }, false],
  ['reservas sin lista (solo vertical)', { vertical: 'agendamiento' }, false],
  ['captación sin lista', { flujos: ['onboarding'] }, false],
  ['`flujos` que no es lista (cadena)', { flujos: 'venta', vertical: 'venta' }, false],
  ['`flujos` nulo con vertical de venta', { flujos: null, vertical: 'venta' }, false],
  ['`modulos` que no es lista: manda `flujos` (venta)', { flujos: ['venta'], modulos: 'inventario' }, true],
  ['ficha vacía', {}, false],
  ['ficha inexistente', null, false],
];

// ===========================================================================
// 1) SERVIDOR: ajustarStock y dejarDeControlarStock
// ===========================================================================
type Auth = { uid: string; token: Record<string, unknown> } | undefined;
const token = (tenants: Record<string, string>) => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
});
const admin = (t: string): Auth => ({ uid: `u-admin-${t}`, token: token({ [t]: 'admin' }) });
const llamarA = (f: unknown, data: unknown, auth: Auth) =>
  (f as { run: (r: unknown) => Promise<unknown> }).run({ data, auth, rawRequest: {} });
const ajustar = (data: unknown, auth: Auth) => llamarA(I.ajustarStock, data, auth);
const dejar = (data: unknown, auth: Auth) => llamarA(I.dejarDeControlarStock, data, auth);

/** Un negocio con un ítem de 5 en existencias; `ficha` null = sin documento del negocio. */
async function sembrar(t: string, ficha: Ficha | null) {
  await db.recursiveDelete(db.doc(`tenants/${t}`));
  if (ficha) await db.doc(`tenants/${t}`).set(ficha);
  await db.doc(`tenants/${t}/catalogo/torta`).set({
    nombre: 'Torta', precio: 10, moneda: 'BOB', activo: true, stock: 5, actualizadoPor: 'seed', actualizadoEn: new Date(),
  });
}
const stockDe = async (t: string) => (await db.doc(`tenants/${t}/catalogo/torta`).get()).get('stock');
const movimientos = async (t: string) => (await db.collection(`tenants/${t}/movimientosStock`).get()).size;
const denegado = { code: 'permission-denied' };

beforeAll(async () => {
  // Una lectura cualquiera: si el emulador no está, falla acá con un mensaje claro y no en cada prueba.
  await db.doc('tenants/inv-sonda').get();
});

describe('ajustarStock: con el módulo, o con el respaldo de venta, hace lo de siempre', () => {
  it.each(TABLA.filter(([, f, ok]) => ok && f !== null))('%s: fija, suma y deja su movimiento', async (_n, ficha) => {
    const t = 'inv-con-modulo';
    await sembrar(t, ficha);
    expect(await ajustar({ tenantId: t, itemId: 'torta', fijarEn: 8, motivo: 'ajuste' }, admin(t)))
      .toMatchObject({ saldo: 8, delta: 3 });
    expect(await ajustar({ tenantId: t, itemId: 'torta', sumar: 2, motivo: 'reposicion' }, admin(t)))
      .toMatchObject({ saldo: 10, aplicado: 2 });
    expect(await stockDe(t)).toBe(10);
    expect(await movimientos(t)).toBe(2);
    expect(await dejar({ tenantId: t, itemId: 'torta' }, admin(t))).toEqual({ ok: true });
    expect(await stockDe(t)).toBeUndefined();
  });
});

describe('ajustarStock y dejarDeControlarStock: sin el módulo responden permission-denied y no escriben nada', () => {
  it.each(TABLA.filter(([, f, ok]) => !ok && f !== null))('%s', async (_n, ficha) => {
    const t = 'inv-sin-modulo';
    await sembrar(t, ficha);
    await expect(ajustar({ tenantId: t, itemId: 'torta', fijarEn: 99 }, admin(t))).rejects.toMatchObject(denegado);
    await expect(ajustar({ tenantId: t, itemId: 'torta', sumar: 1 }, admin(t))).rejects.toMatchObject(denegado);
    await expect(dejar({ tenantId: t, itemId: 'torta' }, admin(t))).rejects.toMatchObject(denegado);
    expect(await stockDe(t), 'el saldo no se mueve').toBe(5);
    expect(await movimientos(t), 'no queda movimiento').toBe(0);
  });

  it('un negocio SIN ficha (el ítem existe, el documento del negocio no) falla cerrado', async () => {
    const t = 'inv-sin-ficha';
    await sembrar(t, null);
    expect((await db.doc(`tenants/${t}`).get()).exists).toBe(false);
    await expect(ajustar({ tenantId: t, itemId: 'torta', fijarEn: 1 }, admin(t))).rejects.toMatchObject(denegado);
    await expect(dejar({ tenantId: t, itemId: 'torta' }, admin(t))).rejects.toMatchObject(denegado);
    expect(await stockDe(t)).toBe(5);
    expect(await movimientos(t)).toBe(0);
  });

  it('Q\'Taco con su lista: el administrador del propio negocio tampoco puede (la puerta es el módulo, no el rol)', async () => {
    const t = 'inv-qtaco';
    await sembrar(t, QTACO);
    await expect(ajustar({ tenantId: t, itemId: 'torta', sumar: 1 }, admin(t))).rejects.toMatchObject(denegado);
    // Y con el respaldo por flujo (la misma ficha sin lista) sí podría: la lista es lo que lo cierra.
    await sembrar(t, QTACO_SIN_LISTA);
    expect(await ajustar({ tenantId: t, itemId: 'torta', sumar: 1 }, admin(t))).toMatchObject({ saldo: 6 });
  });
});

describe('Lo que ya se exigía antes se sigue exigiendo, y primero', () => {
  it('sin sesión: unauthenticated; con un id inválido: invalid-argument; operador: permission-denied', async () => {
    const t = 'inv-con-modulo';
    await sembrar(t, { flujos: ['venta'] });
    await expect(ajustar({ tenantId: t, itemId: 'torta', sumar: 1 }, undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(ajustar({ tenantId: 'X', itemId: 'torta', sumar: 1 }, admin(t))).rejects.toMatchObject({ code: 'invalid-argument' });
    const oper: Auth = { uid: 'u-oper', token: token({ [t]: 'oper' }) };
    await expect(ajustar({ tenantId: t, itemId: 'torta', sumar: 1 }, oper)).rejects.toMatchObject({
      code: 'permission-denied', message: 'Solo el administrador del negocio.',
    });
    expect(await stockDe(t)).toBe(5);
  });

  it('el administrador de OTRO negocio con el módulo no mueve el stock de éste', async () => {
    await sembrar('inv-ajeno-a', { flujos: ['venta'] });
    await sembrar('inv-ajeno-b', { flujos: ['venta'] });
    await expect(ajustar({ tenantId: 'inv-ajeno-b', itemId: 'torta', sumar: 1 }, admin('inv-ajeno-a')))
      .rejects.toMatchObject({ code: 'permission-denied', message: 'Solo el administrador del negocio.' });
    expect(await stockDe('inv-ajeno-b')).toBe(5);
  });

  it('con el módulo, un ítem que no existe sigue dando not-found y uno sin control, failed-precondition', async () => {
    const t = 'inv-con-modulo';
    await sembrar(t, { flujos: ['venta'] });
    await expect(ajustar({ tenantId: t, itemId: 'no-existe', fijarEn: 1 }, admin(t))).rejects.toMatchObject({ code: 'not-found' });
    await db.doc(`tenants/${t}/catalogo/pan`).set({ nombre: 'Pan', activo: true });
    await expect(ajustar({ tenantId: t, itemId: 'pan', sumar: 1 }, admin(t))).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('el descuento de una venta (`moverStock`) no pasa por la callable y sigue igual', async () => {
    const t = 'inv-sin-modulo';
    await sembrar(t, QTACO);
    expect(await I.moverStock(t, 'torta', -2, 'venta', 'ped_1', 'sistema')).toMatchObject({ aplicado: -2, saldo: 3 });
  });
});

// ===========================================================================
// 2) CONSOLA: ni pestaña ni ruta; y el cálculo de los seis comercios de hoy
// ===========================================================================
describe('Consola: sin el módulo no hay pestaña NI ruta; con el módulo o el respaldo de venta, sí', () => {
  const rutas = (f: Ficha | undefined) => pestanasVisibles(modulosDe(f), { rol: 'admin', propietario: false }).map((p) => p.ruta);

  it.each(TABLA)('%s', (_n, ficha, abre) => {
    const f = ficha ?? undefined;
    const modulos = modulosDe(f);
    expect(modulos.includes('inventario')).toBe(abre);
    // La ruta (lo que decide `Inventario.tsx`) y la pestaña dicen lo mismo, y lo mismo que el servidor.
    expect(capacidadesDeConsola(modulos).conInventario).toBe(abre);
    expect(rutas(f).includes('inventario')).toBe(abre);
    expect(tieneModulo(f, 'inventario')).toBe(abre);
  });

  it('la ruta de Inventario redirige y no abre lecturas antes de saber si hay módulo (guarda de fuente)', () => {
    const src = readFileSync(join(aqui, '..', '..', '..', 'web', 'src', 'modulos', 'inventario', 'Inventario.tsx'), 'utf8');
    const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{])\/\/.*$/gm, '$1');
    const guarda = sinComentarios.slice(
      sinComentarios.indexOf('export function Inventario()'),
      sinComentarios.indexOf('function InventarioDelNegocio'));
    expect(guarda).toContain('const modulos = useModulos(tenantId);');
    expect(guarda).toMatch(/modulos === null\) return <section>/);          // cargando: sin contenido
    expect(guarda).toContain('<Navigate to="/" replace />');                   // sin módulo: al inicio
    expect(guarda).not.toMatch(/onSnapshot|httpsCallable|collection\(/);     // ni una lectura
    // La pantalla de verdad solo se monta después de la guarda.
    expect(guarda.indexOf('<InventarioDelNegocio')).toBeGreaterThan(guarda.indexOf('<Navigate'));
    // Y la ruta sigue declarada en App.tsx apuntando a la misma pantalla.
    const app = readFileSync(join(aqui, '..', '..', '..', 'web', 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/path="\/negocio\/:tenantId\/inventario"[\s\S]{0,200}<Inventario \/>/);
  });
});

describe('Los seis comercios de hoy y Q\'Taco: lo único que se pierde es `inventario`', () => {
  // Demo A, Platinum y Bellido: reservas. Demo B y Q'Taco: venta. NovuChat: captación.
  // (`tenants.modulos` no se escribe en ninguna parte del repositorio: hoy sus fichas tienen
  // `flujos`/`vertical`. Lo vivo no se lee desde una prueba.)
  it('los que no tienen inventario hoy no lo tienen con el módulo exigido; el de venta sin lista, sí', () => {
    for (const f of IDS_FLUJOS) {
      for (const ficha of [{ flujos: [f] }, { vertical: f }, { vertical: f, flujos: [f] }]) {
        expect(tieneModulo(ficha, 'inventario'), JSON.stringify(ficha)).toBe(f === 'venta');
        // Su menú de hoy: sin `inventario` salvo venta, y el resto idéntico.
        expect(pestanasDe(modulosDeFicha(ficha)).some((p) => p.ruta === 'inventario'), JSON.stringify(ficha)).toBe(f === 'venta');
      }
    }
  });

  it('Q\'Taco con modulos [productos, campanas, cobros, pedidos, catalogo-web] pierde SOLO inventario frente a flujos [venta]', () => {
    const conLista = modulosDeFicha(QTACO);
    const sinLista = modulosDeFicha(QTACO_SIN_LISTA);
    expect(new Set(sinLista)).toEqual(new Set(['productos', 'cobros', 'inventario', 'pedidos', 'catalogo-web', 'campanas']));
    expect(sinLista.filter((m) => !conLista.includes(m))).toEqual(['inventario']);
    expect(conLista.filter((m) => !sinLista.includes(m))).toEqual([]);
    expect(conLista).toEqual(sinLista.filter((m) => m !== 'inventario'));
    // Las pestañas: las mismas menos «Inventario».
    const pestanasCon = pestanasDe(conLista).map((p) => p.ruta);
    const pestanasSin = pestanasDe(sinLista).map((p) => p.ruta);
    expect(pestanasSin).toEqual(['pedidos', 'cobros', 'inventario', 'cobro']);
    expect(pestanasCon).toEqual(['pedidos', 'cobros', 'cobro']);
    // Y lo que decide cada pantalla, igual salvo la ruta de inventario.
    expect({ ...capacidadesDeConsola(conLista), conInventario: true }).toEqual(capacidadesDeConsola(sinLista));
    expect(capacidadesDeConsola(conLista).conInventario).toBe(false);
    expect(tieneModulo(QTACO, 'inventario')).toBe(false);
    expect(tieneModulo(QTACO_SIN_LISTA, 'inventario')).toBe(true);
  });
});
