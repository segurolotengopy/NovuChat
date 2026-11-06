/**
 * `scripts/datos/qtaco/cargar-campanas.mjs` — LAS DOS CAMPAÑAS DE Q'TACO, CONTRA EL EMULADOR (proyecto de pruebas, nunca producción).
 *
 * El script escribe con el SDK Admin, que se salta las reglas de Firestore: lo único que impide cargar un texto que el flujo no reconocería,
 * pisar campañas ajenas, un comercio que no es Q'Taco o un proyecto equivocado es su propia validación. Se prueba ejecutándolo como proceso y
 * NEGANDO primero: lo que no debe entrar, no entra; SIN `--aplicar` no se escribe nada; la reversa restaura lo previo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '../../../scripts/datos/qtaco/cargar-campanas.mjs');
const ARCHIVO = join(aqui, '../../../scripts/datos/qtaco/campanas-qtaco.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const mod = await import('../../../scripts/datos/qtaco/cargar-campanas.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>) => { ok: boolean; problemas?: string[]; cfg?: Record<string, unknown> };
  validarArchivo: (d: unknown, o?: Record<string, unknown>) => string[];
  diaBolivia: (ms: number) => string;
  sumarDias: (f: string, n: number) => string;
  diasEntre: (a: string, b: string) => number;
  TEXTOS_APROBADOS: Record<string, string>;
  MAX_DIAS_DE_DURACION: number; MAX_DIAS_HASTA_EL_INICIO: number; MINIMO_TEXTO: number; TOPE_TEXTO: number; DIAS_DE_VIGENCIA: number;
};
const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'cargar-campanas-qtaco') ?? initializeApp({ projectId: PROYECTO }, 'cargar-campanas-qtaco');
const db = getFirestore(app);

const T = 'qtaco';
const tmp = mkdtempSync(join(tmpdir(), 'cargar-campanas-qtaco-'));
chmodSync(tmp, 0o700);
let n = 0;
const respaldo = (): string => join(tmp, `respaldo-${n++}.json`);
type Camp = { id: string; texto: string; productoId?: string };
type Datos = { tenant: string; campanas: Camp[] };
const base = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as Datos;
const bueno = (mod2: (d: Datos) => void = () => undefined, tenant = T): Datos => { const d = JSON.parse(JSON.stringify(base)) as Datos; d.tenant = tenant; mod2(d); return d; };
const archivo = (nombre: string, datos: unknown): string => { const ruta = join(tmp, `${nombre}.json`); writeFileSync(ruta, JSON.stringify(datos)); return ruta; };
function correr(args: string[], proyecto = PROYECTO): { codigo: number | null; salida: string } {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', proyecto, ...args], { env: entornoDelEmulador(HOST), encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
const lista = async (): Promise<Array<Record<string, unknown>>> => ((await db.doc(`tenants/${T}/config/campanas`).get()).get('lista') ?? []) as Array<Record<string, unknown>>;
const ajena = { id: 'otra-del-comercio', texto: 'Hola, vengo por el menú ejecutivo del mediodía.', inicio: '2026-11-01', fin: '2026-12-31' };

/** Deja a Q'Taco en el emulador como se pide: activo, con el plan dado y con la lista previa dada (o sin documento de campañas). */
async function sembrar(previa: Array<Record<string, unknown>> | null, plan = 'pro', estado = 'activo'): Promise<void> {
  await db.doc(`tenants/${T}/config/campanas`).delete();
  await db.doc(`tenants/${T}`).set({ nombre: T, estado, vertical: 'venta', flujos: ['venta'] });
  await db.doc(`tenants/${T}/cuenta/estado`).set({ plan });
  if (previa) await db.doc(`tenants/${T}/config/campanas`).set({ lista: previa });
}
beforeAll(() => sembrar(null));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('cargar-campanas.mjs de Q\'Taco — lo que se NIEGA', () => {
  it('otro comercio: --tenant distinto, archivo de otro comercio o sin campo tenant; no se escribe nada', async () => {
    await sembrar(null);
    expect(correr(['--tenant', 'otro-comercio']).codigo).toBe(2);
    expect(correr(['--tenant', 'otro-comercio']).salida).toMatch(/SOLO del comercio «qtaco»/);
    const ajeno = correr(['--archivo', archivo('ajeno', bueno(undefined, 'otro-comercio')), '--respaldo', respaldo(), '--aplicar']);
    expect(ajeno.codigo).toBe(2);
    expect(ajeno.salida).toMatch(/es del comercio «otro-comercio»/);
    const sin = bueno() as Partial<Datos>; delete sin.tenant;
    expect(correr(['--archivo', archivo('sintenant', sin), '--respaldo', respaldo(), '--aplicar']).salida).toMatch(/sin campo tenant/);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
  });
  it('proyecto equivocado: sin los proyectos de la lista blanca, uno real desconocido, confirmación faltante o ajena', () => {
    // El hijo trae variables de emulador: un proyecto que no es demo-* se rechaza por ambiguo.
    const r = correr([], 'proyecto-cualquiera');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/ambiguo/);
    expect(correr([], 'demo-con espacio').codigo).toBe(2);
    const env = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
    expect(mod.analizarArgumentos(['--proyecto', 'proyecto-ajeno-xyz'], env).problemas?.join(' ')).toMatch(/lista blanca/);
    expect(mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--respaldo', join(tmp, 'x.json'), '--aplicar'], env).problemas?.join(' ')).toMatch(/exige --confirmo-produccion qtaco/);
    expect(mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--respaldo', join(tmp, 'x.json'), '--aplicar', '--confirmo-produccion', 'otro'], env).problemas?.join(' ')).toMatch(/tiene que ser «qtaco»/);
    expect(mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-staging', '--confirmo-produccion', 'qtaco'], env).problemas?.join(' ')).toMatch(/solo se usa contra producción/);
    const bien = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--respaldo', join(tmp, 'y.json'), '--aplicar', '--confirmo-produccion', 'qtaco'], env);
    expect(bien.ok, bien.problemas?.join(' ')).toBe(true);
    expect(bien.cfg?.['entorno']).toBe('produccion');
  });
  it('--aplicar sin --respaldo, un respaldo dentro del repositorio y un argumento desconocido no hacen nada', () => {
    expect(correr(['--aplicar']).salida).toMatch(/--aplicar exige --respaldo/);
    expect(correr(['--respaldo', join(aqui, 'dentro.json'), '--aplicar']).salida).toMatch(/dentro del repositorio/);
    expect(correr(['--forzar']).codigo).toBe(2);
  });
  it('un texto distinto del anuncio, vacío, con enlace o invisibles, o un id que no es de Q\'Taco, se rechazan antes de escribir', async () => {
    await sembrar(null);
    const casos: Array<[string, (d: Datos) => void, RegExp]> = [
      ['distinto', (d) => { d.campanas[0]!.texto = 'Hola, vi la promo y quiero pedir.'; }, /no es el texto exacto del anuncio/],
      ['vacio', (d) => { d.campanas[1]!.texto = '   '; }, /texto: obligatorio/],
      ['enlace', (d) => { d.campanas[0]!.texto = `${mod.TEXTOS_APROBADOS['tortas-mexicanas']} https://x.com`; }, /no lleva enlaces/],
      ['invisible', (d) => { d.campanas[0]!.texto = `${mod.TEXTOS_APROBADOS['tortas-mexicanas']}​`; }, /invisibles/],
      ['id-ajeno', (d) => { d.campanas[0]!.id = 'otra-promo'; }, /no es una de las campañas de Q'Taco/],
      ['repetido', (d) => { d.campanas[1] = { ...d.campanas[0]! }; }, /repetido/],
      ['clave', (d) => { (d.campanas[0] as Record<string, unknown>)['fin'] = '2099-01-01'; }, /clave desconocida/],
    ];
    for (const [nombre, mut, esperado] of casos) {
      const r = correr(['--archivo', archivo(nombre, bueno(mut)), '--respaldo', respaldo(), '--aplicar']);
      expect(r.codigo, nombre).toBe(2);
      expect(r.salida, nombre).toMatch(esperado);
    }
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
  });
  it('un productoId que no es un documento ACTIVO del catálogo detiene la carga con un mensaje claro y NO crea productos', async () => {
    await sembrar(null);
    const r = correr(['--archivo', archivo('prod', bueno((d) => { d.campanas[0]!.productoId = 'tortas-sin-queso'; })), '--respaldo', respaldo(), '--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no existe o no está activo en el catálogo del comercio \(este script no crea productos\)/);
    expect((await db.doc(`tenants/${T}/catalogo/tortas-sin-queso`).get()).exists).toBe(false);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    // Un producto inactivo tampoco sirve.
    await db.doc(`tenants/${T}/catalogo/tortas-sin-queso`).set({ nombre: 'x', precio: 15, activo: false });
    expect(correr(['--archivo', archivo('prod2', bueno((d) => { d.campanas[0]!.productoId = 'tortas-sin-queso'; })), '--respaldo', respaldo(), '--aplicar']).codigo).toBe(1);
    await db.doc(`tenants/${T}/catalogo/tortas-sin-queso`).delete();
  });
  it('un comercio suspendido o inexistente, y un plan que no admite dos campañas, no cargan nada (ni recortan en silencio)', async () => {
    await sembrar(null, 'pro', 'suspendido');
    expect(correr(['--respaldo', respaldo(), '--aplicar']).salida).toMatch(/no está activo/);
    await db.doc(`tenants/${T}`).delete();
    expect(correr(['--respaldo', respaldo(), '--aplicar']).salida).toMatch(/No existe el comercio/);
    await sembrar(null, 'impulso');
    const r = correr(['--respaldo', respaldo(), '--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/admite 0/);
    // Con una ajena y plan crecimiento (3) caben; con 2 ajenas, no: no se recorta nada.
    await sembrar([ajena, { ...ajena, id: 'b', texto: 'Hola, vengo por el desayuno.' }, { ...ajena, id: 'c', texto: 'Hola, vengo por la cena.' }], 'crecimiento');
    const lleno = correr(['--respaldo', respaldo(), '--aplicar']);
    expect(lleno.codigo).toBe(1);
    expect(lleno.salida).toMatch(/su plan admite 3/);
    expect(await lista()).toHaveLength(3);
  });
  it('una ajena con el mismo texto que una de las campañas se rechaza (el flujo no sabría de cuál viene)', async () => {
    await sembrar([{ ...ajena, texto: mod.TEXTOS_APROBADOS['jueves-de-mas-2']! }]);
    const r = correr(['--respaldo', respaldo(), '--aplicar']);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/ya tiene el mismo texto/);
    expect(await lista()).toHaveLength(1);
  });
  it('la vigencia que arma el script respeta al servidor: fin ≤ 366 días y la validación pura rechaza otras claves de fecha', () => {
    // Las cifras son las del servidor (`campanas.ts`): si cambian allá, esta prueba obliga a cambiarlas acá.
    const servidor = readFileSync(join(aqui, '../../../functions/src/modulos/campanas/campanas.ts'), 'utf8');
    const cifra = (nombre: string) => Number(new RegExp(`export const ${nombre} = (\\d+);`).exec(servidor)?.[1]);
    expect(mod.MAX_DIAS_DE_DURACION).toBe(cifra('MAX_DIAS_DE_DURACION'));
    expect(mod.MAX_DIAS_HASTA_EL_INICIO).toBe(cifra('MAX_DIAS_HASTA_EL_INICIO'));
    expect(mod.MINIMO_TEXTO).toBe(cifra('MINIMO_TEXTO_CAMPANA'));
    expect(mod.TOPE_TEXTO).toBe(cifra('TOPE_TEXTO_CAMPANA'));
    expect(mod.DIAS_DE_VIGENCIA).toBeLessThanOrEqual(mod.MAX_DIAS_DE_DURACION);
    expect(mod.validarArchivo(bueno())).toEqual([]);
    expect(mod.validarArchivo({ tenant: T, campanas: [] })).toHaveLength(1);
    expect(mod.validarArchivo({ tenant: T, campanas: bueno().campanas, inicio: '2026-01-01' }).join()).toMatch(/clave desconocida/);
  });
});

describe('cargar-campanas.mjs de Q\'Taco — lo que SÍ hace', () => {
  it('en SECO (por omisión) dice qué cargaría, la fecha de renovación, y NO escribe: ni la lista, ni el sello, ni la auditoría, ni el respaldo', async () => {
    await sembrar(null);
    const hoy = mod.diaBolivia(Date.now());
    const r = correr([]);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(new RegExp(`RENOVAR antes del ${mod.sumarDias(hoy, 365)}`));
    expect(r.salida).toMatch(/nuevo\s+tortas-mexicanas/);
    expect(r.salida).toMatch(/nuevo\s+jueves-de-mas-2/);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    expect((await db.collection(`tenants/${T}/auditoria`).get()).size).toBe(0);
  });
  it('con --aplicar escribe las DOS con inicio hoy y fin = hoy + 365 (366 días), sello y auditoría, y NO `revision` ni `vigentes`; conserva la ajena', async () => {
    await sembrar([ajena]);
    const dest = respaldo();
    const r = correr(['--respaldo', dest, '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación por relectura/);
    const doc = (await db.doc(`tenants/${T}/config/campanas`).get()).data() ?? {};
    const l = doc['lista'] as Array<Record<string, unknown>>;
    expect(l.map((c) => c['id']).sort()).toEqual(['jueves-de-mas-2', 'otra-del-comercio', 'tortas-mexicanas']);
    expect(l.find((c) => c['id'] === 'otra-del-comercio')).toEqual(ajena);
    const hoy = mod.diaBolivia(Date.now());
    for (const id of ['tortas-mexicanas', 'jueves-de-mas-2']) {
      const c = l.find((x) => x['id'] === id)!;
      expect(Object.keys(c).sort()).toEqual(['fin', 'id', 'inicio', 'texto']);
      expect(c['texto']).toBe(mod.TEXTOS_APROBADOS[id]);
      expect(c['inicio']).toBe(hoy);
      expect(c['fin']).toBe(mod.sumarDias(hoy, 365));
      expect(mod.diasEntre(c['inicio'] as string, c['fin'] as string) + 1).toBeLessThanOrEqual(366);
    }
    expect(doc['actualizadoPor']).toBe('cargar-campanas-qtaco');
    expect(doc['revision']).toBeUndefined();
    expect(doc['vigentes']).toBeUndefined();
    expect((await db.collection(`tenants/${T}/auditoria`).get()).size).toBeGreaterThan(0);
    // El respaldo existe, es 0600 y guarda el estado previo.
    const rb = JSON.parse(readFileSync(dest, 'utf8')) as { previo: { documento: boolean; lista: unknown[] }; tenant: string };
    expect(rb.tenant).toBe(T);
    expect(rb.previo).toEqual({ documento: true, lista: [ajena] });
    // Un respaldo nunca se pisa.
    expect(correr(['--respaldo', dest, '--aplicar']).codigo).toBe(2);
  });
  it('un id duplicado REEMPLAZA a la campaña previa (no se agrega otra) y las que ya están iguales y vigentes no se tocan', async () => {
    const hoy = mod.diaBolivia(Date.now());
    await sembrar([
      { id: 'tortas-mexicanas', texto: 'Hola, texto viejo de las tortas.', inicio: hoy, fin: hoy },
      { id: 'jueves-de-mas-2', texto: mod.TEXTOS_APROBADOS['jueves-de-mas-2']!, inicio: mod.sumarDias(hoy, -10), fin: mod.sumarDias(hoy, 100) },
      ajena,
    ]);
    const r = correr(['--respaldo', respaldo(), '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/cambia\s+tortas-mexicanas/);
    expect(r.salida).toMatch(/igual\s+jueves-de-mas-2/);
    const l = await lista();
    expect(l).toHaveLength(3);
    expect(l.find((c) => c['id'] === 'tortas-mexicanas')!['texto']).toBe(mod.TEXTOS_APROBADOS['tortas-mexicanas']);
    expect(l.find((c) => c['id'] === 'jueves-de-mas-2')!['inicio']).toBe(mod.sumarDias(hoy, -10));
  });
  it('es idempotente: con las dos ya cargadas e iguales dice «nada que hacer» y no escribe ni crea respaldo', async () => {
    await sembrar(null);
    expect(correr(['--respaldo', respaldo(), '--aplicar']).codigo).toBe(0);
    const dest = respaldo();
    const r = correr(['--respaldo', dest, '--aplicar']);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/nada que hacer/);
    expect(() => readFileSync(dest)).toThrow();
  });
  it('la reversa restaura: devuelve las previas, conserva las ajenas, borra el documento si no existía y NO pisa un cambio ajeno', async () => {
    // 1) El documento no existía: la reversa lo borra.
    await sembrar(null);
    const r1 = respaldo();
    expect(correr(['--respaldo', r1, '--aplicar']).codigo).toBe(0);
    expect((await lista())).toHaveLength(2);
    expect(correr(['--revertir', '--respaldo', r1]).salida).toMatch(/Seco: no se escribió nada/);
    expect(await lista()).toHaveLength(2);
    const rev = correr(['--revertir', '--respaldo', r1, '--aplicar']);
    expect(rev.codigo, rev.salida).toBe(0);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    // 2) Había una versión previa de una de las dos y una ajena: vuelven tal cual; una ajena agregada después se conserva.
    const hoy = mod.diaBolivia(Date.now());
    const previa = { id: 'tortas-mexicanas', texto: 'Hola, texto viejo de las tortas.', inicio: hoy, fin: mod.sumarDias(hoy, 30) };
    await sembrar([previa, ajena]);
    const r2 = respaldo();
    expect(correr(['--respaldo', r2, '--aplicar']).codigo).toBe(0);
    const despues = { id: 'nueva-ajena', texto: 'Hola, vengo por el postre.', inicio: hoy, fin: mod.sumarDias(hoy, 30) };
    await db.doc(`tenants/${T}/config/campanas`).update({ lista: [...(await lista()), despues] });
    const rev2 = correr(['--revertir', '--respaldo', r2, '--aplicar']);
    expect(rev2.codigo, rev2.salida).toBe(0);
    const l = await lista();
    expect(l.map((c) => c['id']).sort()).toEqual(['nueva-ajena', 'otra-del-comercio', 'tortas-mexicanas']);
    expect(l.find((c) => c['id'] === 'tortas-mexicanas')).toEqual(previa);
    // 3) Si alguien cambió una de las campañas escritas, la reversa sale con 2 sin escribir.
    await sembrar(null);
    const r3 = respaldo();
    expect(correr(['--respaldo', r3, '--aplicar']).codigo).toBe(0);
    const cambiada = (await lista()).map((c) => (c['id'] === 'jueves-de-mas-2' ? { ...c, fin: mod.sumarDias(hoy, 10) } : c));
    await db.doc(`tenants/${T}/config/campanas`).update({ lista: cambiada });
    const rev3 = correr(['--revertir', '--respaldo', r3, '--aplicar']);
    expect(rev3.codigo).toBe(2);
    expect(rev3.salida).toMatch(/ya no son las que escribió este script/);
    expect(await lista()).toEqual(cambiada);
    // 4) Un respaldo que no existe o de otro entorno se rechaza.
    expect(correr(['--revertir', '--respaldo', join(tmp, 'no-existe.json')]).codigo).toBe(2);
  });
});
