/**
 * `scripts/datos/qtaco/cargar-campanas.mjs` — LAS DOS CAMPAÑAS DE Q'TACO, CONTRA EL EMULADOR (proyecto de pruebas, nunca producción).
 *
 * El script escribe con el SDK Admin, que se salta las reglas de Firestore: lo único que impide cargar un texto que el flujo no reconocería,
 * pisar campañas ajenas, un comercio que no es Q'Taco o un proyecto equivocado es su propia validación. Se prueba ejecutándolo como proceso y
 * NEGANDO primero: lo que no debe entrar, no entra; SIN `--aplicar` no se escribe nada; la reversa restaura lo previo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  ejecutar: (cfg: Record<string, unknown>, datos: unknown, deps: Record<string, unknown>) => Promise<number>;
  enFranjaDeMedianoche: (ms: number) => boolean;
  MAX_DIAS_DE_DURACION: number; MAX_DIAS_HASTA_EL_INICIO: number; MINIMO_TEXTO: number; TOPE_TEXTO: number; DIAS_DE_VIGENCIA: number;
};
const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
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
async function sembrar(previa: Array<Record<string, unknown>> | null, plan = 'pro', estado = 'activo', modulos: string[] = ['campanas']): Promise<void> {
  // El emulador se comparte con otras suites que usan el mismo id de comercio: se parte siempre de cero (también la auditoría).
  for (const d of (await db.collection(`tenants/${T}/auditoria`).get()).docs) await d.ref.delete();
  await db.doc(`tenants/${T}/config/campanas`).delete();
  await db.doc(`tenants/${T}`).set({ nombre: T, estado, vertical: 'venta', flujos: ['venta'], modulos });
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
  // El reloj va inyectado: ninguna prueba depende de la hora en que corre (ni de la medianoche).
  const AHORA = Date.UTC(2026, 10, 10, 16, 0, 0); // 12:00 en La Paz
  const HOY = mod.diaBolivia(AHORA);
  const salida: string[] = [];
  const log = (t: string): void => { salida.push(t); };
  /** Un servidor de mentira: cuando cambia la lista, escribe `revision` como lo haría `verificarCampanas`. */
  function servidor(estados: Record<string, { estado: string; motivo?: string }> = {}): () => void {
    return db.doc(`tenants/${T}/config/campanas`).onSnapshot((snap) => {
      const l = (snap.get('lista') ?? []) as Array<{ id: string }>;
      const marca = JSON.stringify(l);
      if (!snap.exists || l.length === 0 || (snap.get('revision') as { hash?: string } | undefined)?.hash === marca) return;
      const porCampana = Object.fromEntries(l.map((c) => [c.id, { motivo: '', ...(estados[c.id] ?? { estado: 'aprobada' }) }]));
      void snap.ref.update({ revision: { hash: marca, porCampana, revisadoPor: 'simulado' } });
    }, () => undefined);
  }
  async function aplicar(extra: Record<string, unknown> = {}, datos: unknown = bueno(), ahora = AHORA): Promise<{ codigo: number; salida: string }> {
    salida.length = 0;
    const codigo = await mod.ejecutar({ entorno: 'emulador', aplicar: true, revertir: false, respaldo: respaldo(), ...extra }, datos, { db, Timestamp, log, ahora: () => ahora, esperaMs: 3000, pausaMs: 50 });
    return { codigo, salida: salida.join('\n') };
  }
  const iguales = (fin: string) => (id: string) => ({ id, texto: mod.TEXTOS_APROBADOS[id]!, inicio: mod.sumarDias(HOY, -10), fin });

  it('en SECO (por omisión) dice qué cargaría, la fecha de renovación, y NO escribe: ni la lista, ni el sello, ni la auditoría, ni el respaldo', async () => {
    await sembrar(null);
    const antes = mod.diaBolivia(Date.now());
    const r = correr([]);
    const despues = mod.diaBolivia(Date.now());
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    // Sin depender de la hora de corrida: vale el fin calculado con el día de antes o el de después.
    expect([antes, despues].some((d) => r.salida.includes(`RENOVAR antes del ${mod.sumarDias(d, 365)}`))).toBe(true);
    expect(r.salida).toMatch(/nuevo\s+tortas-mexicanas/);
    expect(r.salida).toMatch(/nuevo\s+jueves-de-mas-2/);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    expect((await db.collection(`tenants/${T}/auditoria`).get()).size).toBe(0);
  });
  it('con --aplicar escribe las DOS con inicio hoy y fin = hoy + 365 (366 días), sello y auditoría; conserva la ajena; el servidor las aprueba', async () => {
    await sembrar([ajena]);
    const parar = servidor();
    const dest = respaldo();
    const r = await aplicar({ respaldo: dest });
    parar();
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación por relectura/);
    expect(r.salida).toMatch(/El servidor aprobó las campañas/);
    const doc = (await db.doc(`tenants/${T}/config/campanas`).get()).data() ?? {};
    const l = doc['lista'] as Array<Record<string, unknown>>;
    expect(l.map((c) => c['id']).sort()).toEqual(['jueves-de-mas-2', 'otra-del-comercio', 'tortas-mexicanas']);
    expect(l.find((c) => c['id'] === 'otra-del-comercio')).toEqual(ajena);
    for (const id of ['tortas-mexicanas', 'jueves-de-mas-2']) {
      const c = l.find((x) => x['id'] === id)!;
      expect(Object.keys(c).sort()).toEqual(['fin', 'id', 'inicio', 'texto']);
      expect(c['texto']).toBe(mod.TEXTOS_APROBADOS[id]);
      expect(c['inicio']).toBe(HOY);
      expect(c['fin']).toBe(mod.sumarDias(HOY, 365));
      expect(mod.diasEntre(c['inicio'] as string, c['fin'] as string) + 1).toBeLessThanOrEqual(366);
    }
    expect(doc['actualizadoPor']).toBe('cargar-campanas-qtaco');
    expect((await db.collection(`tenants/${T}/auditoria`).get()).size).toBeGreaterThan(0);
    const rb = JSON.parse(readFileSync(dest, 'utf8')) as { previo: { documento: boolean; lista: unknown[] }; tenant: string };
    expect(rb.tenant).toBe(T);
    expect(rb.previo).toEqual({ documento: true, lista: [ajena] });
    // Un respaldo nunca se pisa (lo exige el análisis de argumentos).
    expect(correr(['--respaldo', dest, '--aplicar']).codigo).toBe(2);
  });
  it('la REVISIÓN del servidor manda: una campaña rechazada sale con código 1 y su motivo; sin revisión en el plazo, también 1', async () => {
    await sembrar(null);
    const parar = servidor({ 'jueves-de-mas-2': { estado: 'rechazada', motivo: 'el texto no es de este negocio' } });
    const r = await aplicar();
    parar();
    expect(r.codigo, r.salida).toBe(1);
    expect(r.salida).toMatch(/jueves-de-mas-2\s+rechazada — el texto no es de este negocio/);
    expect(r.salida).toMatch(/tortas-mexicanas\s+aprobada/);
    expect(r.salida).toMatch(/NO aprobó/);
    // Nadie escribe `revision`: el script no la inventa, espera el plazo y lo dice.
    await sembrar(null);
    salida.length = 0;
    const codigo = await mod.ejecutar({ entorno: 'emulador', aplicar: true, revertir: false, respaldo: respaldo() }, bueno(), { db, Timestamp, log, ahora: () => AHORA, esperaMs: 200, pausaMs: 50 });
    expect(codigo).toBe(1);
    expect(salida.join('\n')).toMatch(/no escribió su revisión/);
  });
  it('una campaña «igual» cuya revisión está rechazada, o falta, NO se da por buena («nada que hacer» solo si está aprobada)', async () => {
    const igual = iguales(mod.sumarDias(HOY, 100));
    const fila = (id: string) => ({ ...igual(id) });
    await sembrar([fila('tortas-mexicanas'), fila('jueves-de-mas-2')]);
    await db.doc(`tenants/${T}/config/campanas`).update({ revision: { hash: 'x', porCampana: { 'tortas-mexicanas': { estado: 'aprobada', motivo: '' }, 'jueves-de-mas-2': { estado: 'rechazada', motivo: 'no pasó' } } } });
    const mala = await aplicar();
    expect(mala.codigo, mala.salida).toBe(1);
    expect(mala.salida).not.toMatch(/nada que hacer/);
    expect(mala.salida).toMatch(/jueves-de-mas-2: la revisión del servidor es «rechazada» — no pasó/);
    await db.doc(`tenants/${T}/config/campanas`).update({ revision: null });
    expect((await aplicar()).codigo).toBe(1);
    await db.doc(`tenants/${T}/config/campanas`).update({ revision: { hash: 'x', porCampana: { 'tortas-mexicanas': { estado: 'aprobada' }, 'jueves-de-mas-2': { estado: 'aprobada' } } } });
    const buena = await aplicar();
    expect(buena.codigo, buena.salida).toBe(0);
    expect(buena.salida).toMatch(/nada que hacer/);
  });
  it('RENOVACIÓN: igual pero a menos de 30 días del fin = «cambia» (fin a 5 días); a 30 o más = «igual»; RENOVAR muestra el fin MÁS PRÓXIMO', async () => {
    const aprobada = { hash: 'x', porCampana: { 'tortas-mexicanas': { estado: 'aprobada' }, 'jueves-de-mas-2': { estado: 'aprobada' } } };
    await sembrar([iguales(mod.sumarDias(HOY, 5))('jueves-de-mas-2'), iguales(mod.sumarDias(HOY, 30))('tortas-mexicanas')]);
    await db.doc(`tenants/${T}/config/campanas`).update({ revision: aprobada });
    const seco = await aplicar({ aplicar: false });
    expect(seco.salida).toMatch(/cambia\s+jueves-de-mas-2/);
    expect(seco.salida).toMatch(/igual\s+tortas-mexicanas/);
    expect(seco.salida).toContain(`RENOVAR antes del ${mod.sumarDias(HOY, 30)}`);
    // Con las dos a 40 y 60 días, el más próximo es el de 40.
    await sembrar([iguales(mod.sumarDias(HOY, 60))('jueves-de-mas-2'), iguales(mod.sumarDias(HOY, 40))('tortas-mexicanas')]);
    await db.doc(`tenants/${T}/config/campanas`).update({ revision: aprobada });
    expect((await aplicar({ aplicar: false })).salida).toContain(`RENOVAR antes del ${mod.sumarDias(HOY, 40)}`);
    // Aplicada, la renovada queda con inicio hoy y fin hoy + 365.
    await sembrar([iguales(mod.sumarDias(HOY, 5))('jueves-de-mas-2'), iguales(mod.sumarDias(HOY, 100))('tortas-mexicanas')]);
    await db.doc(`tenants/${T}/config/campanas`).update({ revision: aprobada });
    const parar = servidor();
    const r = await aplicar();
    parar();
    expect(r.codigo, r.salida).toBe(0);
    const l = await lista();
    const j = l.find((c) => c['id'] === 'jueves-de-mas-2')!;
    expect([j['inicio'], j['fin']]).toEqual([HOY, mod.sumarDias(HOY, 365)]);
    expect(l.find((c) => c['id'] === 'tortas-mexicanas')!['fin']).toBe(mod.sumarDias(HOY, 100));
  });
  it('NO se aplica entre las 23:50 y las 24:00 de La Paz (reloj inyectado); a las 23:49 y a las 00:00 sí', async () => {
    const laPaz = (h: number, m: number) => Date.UTC(2026, 10, 10, h + 4, m); // 23:55 La Paz = 03:55Z del día siguiente
    expect(mod.enFranjaDeMedianoche(laPaz(23, 50))).toBe(true);
    expect(mod.enFranjaDeMedianoche(laPaz(23, 59))).toBe(true);
    expect(mod.enFranjaDeMedianoche(laPaz(23, 49))).toBe(false);
    expect(mod.enFranjaDeMedianoche(laPaz(0, 0))).toBe(false);
    await sembrar(null);
    const r = await aplicar({}, bueno(), laPaz(23, 55));
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/No se aplica entre las 23:50 y las 24:00/);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    const parar = servidor();
    expect((await aplicar({}, bueno(), laPaz(23, 49))).codigo).toBe(0);
    parar();
  });
  it('el archivo tiene que traer EXACTAMENTE las campañas de Q\'Taco: una sola, o sin una de ellas, se rechaza', async () => {
    await sembrar(null);
    const sola = bueno((d) => { d.campanas = [d.campanas[0]!]; });
    const r = await aplicar({}, sola);
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/falta la campaña «jueves-de-mas-2»/);
    expect(await lista()).toEqual([]);
  });
  it('un comercio SIN el módulo «campanas» encendido no recibe nada', async () => {
    await sembrar(null, 'pro', 'activo', ['productos']);
    const r = await aplicar();
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene el módulo «campanas»/);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    const sinCampo = correr(['--respaldo', respaldo(), '--aplicar']);
    expect(sinCampo.codigo).toBe(1);
  });
  it('es idempotente: con las dos ya cargadas, aprobadas y vigentes dice «nada que hacer» y no escribe ni crea respaldo', async () => {
    await sembrar(null);
    const parar = servidor();
    expect((await aplicar()).codigo).toBe(0);
    const dest = respaldo();
    const r = await aplicar({ respaldo: dest });
    parar();
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/nada que hacer/);
    expect(() => readFileSync(dest)).toThrow();
  });
  it('un id duplicado REEMPLAZA a la campaña previa (no se agrega otra)', async () => {
    await sembrar([
      { id: 'tortas-mexicanas', texto: 'Hola, texto viejo de las tortas.', inicio: HOY, fin: HOY },
      iguales(mod.sumarDias(HOY, 100))('jueves-de-mas-2'),
      ajena,
    ]);
    const parar = servidor();
    const r = await aplicar();
    parar();
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/cambia\s+tortas-mexicanas/);
    expect(r.salida).toMatch(/igual\s+jueves-de-mas-2/);
    const l = await lista();
    expect(l).toHaveLength(3);
    expect(l.find((c) => c['id'] === 'tortas-mexicanas')!['texto']).toBe(mod.TEXTOS_APROBADOS['tortas-mexicanas']);
    expect(l.find((c) => c['id'] === 'jueves-de-mas-2')!['inicio']).toBe(mod.sumarDias(HOY, -10));
  });
  it('la reversa restaura: devuelve las previas, conserva las ajenas, borra el documento si no existía y NO pisa un cambio ajeno', async () => {
    const revertir = (ruta: string, aplicarYa = true) => aplicar({ revertir: true, respaldo: ruta, aplicar: aplicarYa });
    // 1) El documento no existía: la reversa lo borra. En seco no escribe.
    await sembrar(null);
    let parar = servidor();
    const r1 = respaldo();
    expect((await aplicar({ respaldo: r1 })).codigo).toBe(0);
    parar();
    expect(await lista()).toHaveLength(2);
    expect((await revertir(r1, false)).salida).toMatch(/Seco: no se escribió nada/);
    expect(await lista()).toHaveLength(2);
    const rev = await revertir(r1);
    expect(rev.codigo, rev.salida).toBe(0);
    expect((await db.doc(`tenants/${T}/config/campanas`).get()).exists).toBe(false);
    // 2) Había una versión previa de una de las dos y una ajena: vuelven tal cual; una ajena agregada después se conserva.
    const previa = { id: 'tortas-mexicanas', texto: 'Hola, texto viejo de las tortas.', inicio: HOY, fin: mod.sumarDias(HOY, 30) };
    await sembrar([previa, ajena]);
    parar = servidor();
    const r2 = respaldo();
    expect((await aplicar({ respaldo: r2 })).codigo).toBe(0);
    parar();
    const despues = { id: 'nueva-ajena', texto: 'Hola, vengo por el postre.', inicio: HOY, fin: mod.sumarDias(HOY, 30) };
    await db.doc(`tenants/${T}/config/campanas`).update({ lista: [...(await lista()), despues] });
    const rev2 = await revertir(r2);
    expect(rev2.codigo, rev2.salida).toBe(0);
    const l = await lista();
    expect(l.map((c) => c['id']).sort()).toEqual(['nueva-ajena', 'otra-del-comercio', 'tortas-mexicanas']);
    expect(l.find((c) => c['id'] === 'tortas-mexicanas')).toEqual(previa);
    // 3) Si alguien cambió una de las campañas escritas, la reversa sale con 2 sin escribir.
    await sembrar(null);
    parar = servidor();
    const r3 = respaldo();
    expect((await aplicar({ respaldo: r3 })).codigo).toBe(0);
    parar();
    const cambiada = (await lista()).map((c) => (c['id'] === 'jueves-de-mas-2' ? { ...c, fin: mod.sumarDias(HOY, 10) } : c));
    await db.doc(`tenants/${T}/config/campanas`).update({ lista: cambiada });
    const rev3 = await revertir(r3);
    expect(rev3.codigo).toBe(2);
    expect(rev3.salida).toMatch(/ya no son las que escribió este script/);
    expect(await lista()).toEqual(cambiada);
    // 4) Un respaldo que no existe se rechaza.
    expect(correr(['--revertir', '--respaldo', join(tmp, 'no-existe.json')]).codigo).toBe(2);
  });
  it('NEGADO: un respaldo con contenido malo (id ajeno, claves de más, demasiadas campañas, enlace simbólico, archivo enorme) se rechaza con 2 y no escribe', async () => {
    const buenoR = (mut: (r: Record<string, any>) => void = () => undefined): Record<string, unknown> => {
      const r: Record<string, any> = {
        version: 1, entorno: 'emulador', tenant: T, creadoEn: 'x', previo: { documento: true, lista: [ajena] },
        escrito: [{ id: 'tortas-mexicanas', texto: mod.TEXTOS_APROBADOS['tortas-mexicanas'], inicio: HOY, fin: mod.sumarDias(HOY, 365) }],
      };
      mut(r);
      return r;
    };
    const guardar = (nombre: string, r: unknown, modo = 0o600): string => { const ruta = join(tmp, `rb-${nombre}.json`); writeFileSync(ruta, typeof r === 'string' ? r : JSON.stringify(r), { mode: modo }); return ruta; };
    await sembrar([ajena]);
    const antes = await lista();
    const casos: Array<[string, string]> = [
      ['ajeno', guardar('ajeno', buenoR((r) => { r['escrito'][0].id = 'otra-del-comercio'; }))],
      ['clave-escrita', guardar('clave-escrita', buenoR((r) => { r['escrito'][0].titulares = ['x']; }))],
      ['clave-regla', guardar('clave-regla', buenoR((r) => { r['previo'].lista[0].admin = true; }))],
      ['regla-corta', guardar('regla-corta', buenoR((r) => { r['previo'].lista = [{ id: 'x', texto: 'y' }]; }))],
      ['texto-largo', guardar('texto-largo', buenoR((r) => { r['previo'].lista[0].texto = 'a'.repeat(301); }))],
      ['id-repetido', guardar('id-repetido', buenoR((r) => { r['previo'].lista = [ajena, ajena]; }))],
      ['demasiadas', guardar('demasiadas', buenoR((r) => { r['previo'].lista = Array.from({ length: 11 }, (_, i) => ({ ...ajena, id: `a${i}` })); }))],
      ['vacio', guardar('vacio', buenoR((r) => { r['escrito'] = []; }))],
      ['enorme', guardar('enorme', JSON.stringify(buenoR((r) => { r['relleno'] = 'z'.repeat(70_000); })))],
    ];
    for (const [nombre, ruta] of casos) {
      const r = correr(['--revertir', '--respaldo', ruta, '--aplicar']);
      expect(r.codigo, `${nombre}: ${r.salida}`).toBe(2);
      expect(await lista(), nombre).toEqual(antes);
    }
    // Un enlace simbólico a un respaldo bueno tampoco se lee.
    const real = guardar('real', buenoR());
    const enlace = join(tmp, 'rb-enlace.json');
    symlinkSync(real, enlace);
    expect(correr(['--revertir', '--respaldo', enlace, '--aplicar']).codigo).toBe(2);
    expect(await lista()).toEqual(antes);
  });
});
