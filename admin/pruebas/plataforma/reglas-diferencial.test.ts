/**
 * PRUEBA DIFERENCIAL DE LAS REGLAS DE H2b-6 — LO QUE NO DEBE CAMBIAR, NO CAMBIA.
 *
 * Es la prueba que cuida a Q'Taco (y a todo comercio vivo): ninguna ficha viva
 * trae `modulos`, así que con las fichas de hoy las reglas nuevas tienen que
 * decidir IGUAL que las de antes. Se corre la MISMA matriz de operaciones
 * (get, list, create, update, delete) sobre las rutas relevantes, con cuatro
 * actores (administrador, operador, propietario y un administrador AJENO) y con
 * las fichas de Q'Taco, Demo A, Demo B, Platinum y NovuChat, contra
 *   · las reglas de ANTES: `firestore-base-previa-h2b6.rules.txt`, copia de
 *     `admin/firestore.rules` en origin/main justo antes de este bloque (con UNA
 *     diferencia de forma: el valor por defecto de `numeroRecepcion` tiene 9
 *     digitos y no 11, porque el saneo del repo publico rechaza 10 o mas; la
 *     regla lo usa solo como defecto y lo valida con `{8,15}`, asi que decide
 *     igual); y
 *   · las reglas de AHORA: `admin/firestore.rules`.
 * y se compara operación por operación. La ÚNICA diferencia admitida es la que
 * Andres aprobó (decisión N2): `funcionarios/{id}/privado` se cierra al
 * administrador de un comercio SIN agenda. Cualquier otra diferencia es un
 * defecto de las reglas nuevas.
 *
 * Las fichas son SINTÉTICAS: la de Q'Taco tiene la forma exacta de la real
 * (sin `modulos`) con valores inventados; ningún dato de ningún comercio.
 *
 * También: las negativas entre comercios con esas fichas (un administrador de
 * Q'Taco no ve ni escribe nada de otro tenant, y viceversa) y los tres modos de
 * `modulos` presente (lista, vacía, cadena).
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp,
  writeBatch, increment,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const ANTES = readFileSync(join(aqui, 'firestore-base-previa-h2b6.rules.txt'), 'utf8');
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);

let entorno: RulesTestEnvironment;
const iniciar = async (reglas: string): Promise<void> => {
  if (entorno) await entorno.cleanup();
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: reglas, host: '127.0.0.1', port: PUERTO },
  });
};

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});

// ---------------------------------------------------------------------------
// Fichas sintéticas (SIN `modulos`), con la forma de las vivas.
// ---------------------------------------------------------------------------
const sintetica = { creadoEn: Timestamp.fromMillis(1_700_000_000_000), creadoPor: 'u-sintetico',
  estado: 'activo', plan: 'crecimiento', waPhoneNumberId: 'pnid-sintetico', waWabaId: 'waba-sintetica' };
const PERFILES: Record<string, { ficha: Record<string, unknown>; agenda: boolean }> = {
  qtaco: { ficha: { ...sintetica, nombre: 'Comercio sintetico Q', flujos: ['venta'], vertical: 'venta' }, agenda: false },
  demoA: { ficha: { ...sintetica, nombre: 'Demo A sintetico', flujos: ['agendamiento'], vertical: 'agendamiento' }, agenda: true },
  demoB: { ficha: { ...sintetica, nombre: 'Demo B sintetico', flujos: ['venta'], vertical: 'venta' }, agenda: false },
  platinum: { ficha: { ...sintetica, nombre: 'Platinum sintetico', flujos: ['agendamiento'], vertical: 'agendamiento' }, agenda: true },
  platinumViejo: { ficha: { ...sintetica, nombre: 'Ficha vieja sintetica', vertical: 'agendamiento' }, agenda: true },
  novuchat: { ficha: { ...sintetica, nombre: 'NovuChat sintetico', flujos: ['onboarding'], vertical: 'onboarding' }, agenda: false },
  // Un comercio con reservas Y pedidos, que hoy existe como combinación.
  doble: { ficha: { ...sintetica, nombre: 'Doble sintetico', flujos: ['agendamiento', 'venta'], vertical: 'agendamiento' }, agenda: true },
};
const OTRO = 'otro';
const FICHA_OTRO = { ...sintetica, nombre: 'Otro sintetico', flujos: ['agendamiento', 'venta', 'onboarding'], vertical: 'venta' };

const sello = (uid: string) => ({ actualizadoPor: uid, actualizadoEn: serverTimestamp() });

/** Siembra un tenant completo, sin reglas, con lo que las rutas de la matriz leen o editan. */
const sembrar = async (t: string, ficha: Record<string, unknown>): Promise<void> => {
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const r = (p: string) => doc(db, `tenants/${t}/${p}`);
    const ts = Timestamp.now();
    await setDoc(doc(db, 'tenants', t), ficha);
    await setDoc(r('cuenta/estado'), { plan: 'pro', estadoPago: 'al_dia' });
    await setDoc(r('config/negocio'), { nombreNegocio: t, direccion: 'Calle Falsa 100', tratamiento: 'usted',
      estiloEmojis: 'pocos', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/agendamiento'), { duracionPorDefectoMin: 45, anticipacionMinimaMin: 60,
      anticipacionMaximaDias: 60, permitirCancelacion: true, horasRecordatorio: 24, actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/venta'), { costoDelivery: 10, recargoFlota: 5, radioEntregaKm: 5, tiempoCocinaMin: 20,
      tiempoDespachoMin: 30, pedidoMinimo: 30, aceptaDelivery: true, aceptaRetiroEnLocal: true,
      actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/marca'), { logo: '', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/onboarding'), { topeAviso: 25, plantillaAviso: 'solicitud_contacto', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('config/campanas'), { lista: [], actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('catalogo/item1'), { nombre: 'Corte', precio: 50, moneda: 'BOB', activo: true, actualizadoPor: 'seed', actualizadoEn: ts });
    await deleteDoc(r('catalogo/nuevo'));
    await setDoc(r('fotosCatalogo/item1'), { datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9,
      tipo: 'image/webp', actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('contadores/catalogo'), { items: 1, ultimoItem: 'item1', actualizadoEn: ts });
    await setDoc(r('funcionarios/f1'), { nombre: 'Dra. Rojas', especialidad: 'Odontologia', calendarioId: '',
      horarioTrabajo: { mar: '14:00-18:00' }, servicios: [], activo: true, actualizadoPor: 'seed', actualizadoEn: ts });
    await deleteDoc(r('funcionarios/nuevo'));
    await setDoc(r('funcionarios/f1/privado/datos'), { telefono: '70000009', correo: 'x@ejemplo.com', actualizadoPor: 'seed', actualizadoEn: ts });
    await deleteDoc(r('funcionarios/f1/privado/otro'));
    await setDoc(r('agenda/f1_20260901_44'), { funcionarioId: 'f1', inicio: ts, fin: ts, servicioId: 'item-4', creadoEn: ts });
    await setDoc(r('contactos/k1'), { nombre: 'Dueña', rolNegocio: 'dueno', telefono: '70000001',
      esContactoComercial: true, actualizadoPor: 'seed', actualizadoEn: ts });
    await setDoc(r('conversaciones/c1'), { telefono: '70000001', ultimoMensaje: 'Hola', canal: 'whatsapp', ultimoEn: ts, mensajesTotal: 1 });
    await setDoc(r('conversaciones/c1/mensajes/m1'), { direccion: 'entrante', tipo: 'text', texto: 'Hola', ts });
    await setDoc(r('conversaciones/c1/privado/datos'), { telefono: '70000001', notas: 'x' });
    await setDoc(r('pagos/p1'), { tipo: 'mensualidad', estado: 'pendiente', monto: 1 });
    await setDoc(r('pedidos/p1'), { total: 10, estado: 'nuevo' });
    await setDoc(r('reclamos/r1'), { asunto: 'x', texto: 'y', categoria: 'falla', estado: 'nuevo', creadoPor: 'u', creadoEn: ts });
    await setDoc(r('metricas/2026-09'), { conversaciones: 3, mensajes: 42 });
    await setDoc(r('bitacora/b1'), { ts, tipo: 'mensaje_saliente', resultado: 'ok', canal: 'whatsapp',
      destinoEnmascarado: '5917****001', conversacionId: 'c1', codigo: '200', latenciaMs: 1, tamanoTexto: 1 });
    await setDoc(r('miembros/u1'), { rol: 'admin' });
    await setDoc(r('invitaciones/i1'), { hashToken: 'x', rol: 'oper' });
    await setDoc(r('auditoria/e1'), { accion: 'alta' });
    await setDoc(r('movimientosStock/m1'), { itemId: 'item1', delta: -1, motivo: 'venta', saldo: 0 });
    await setDoc(r('accesosSoporte/u-soporte'), { expira: Timestamp.fromMillis(Date.now() + 3_600_000), otorgadoPor: 'u' });
  });
};

type Actor = 'admin' | 'oper' | 'propietario' | 'ajeno' | 'anon';
const ACTORES: Actor[] = ['admin', 'oper', 'propietario', 'ajeno', 'anon'];
const contexto = (actor: Actor, t: string): ReturnType<RulesTestEnvironment['unauthenticatedContext']> => {
  switch (actor) {
    case 'admin': return entorno.authenticatedContext(`u-admin-${t}`, claims({ [t]: 'admin' }));
    case 'oper': return entorno.authenticatedContext(`u-oper-${t}`, claims({ [t]: 'oper' }));
    case 'propietario': return entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com'));
    // Administrador de OTRO comercio, actuando sobre `t`.
    case 'ajeno': return entorno.authenticatedContext('u-admin-ajeno', claims({ [OTRO]: 'admin' }));
    default: return entorno.unauthenticatedContext();
  }
};

type Op = { id: string; correr: (fs: ReturnType<ReturnType<typeof contexto>['firestore']>, t: string, uid: string) => Promise<unknown> };
const P = (t: string, p: string): string => `tenants/${t}/${p}`;

// Lecturas: get de cada ruta y list de cada colección.
const RUTAS_GET = ['', 'config/negocio', 'config/agendamiento', 'config/venta', 'config/marca', 'config/onboarding',
  'config/campanas', 'catalogo/item1', 'fotosCatalogo/item1', 'contadores/catalogo', 'funcionarios/f1',
  'funcionarios/f1/privado/datos', 'agenda/f1_20260901_44', 'contactos/k1', 'conversaciones/c1',
  'conversaciones/c1/mensajes/m1', 'conversaciones/c1/privado/datos', 'cuenta/estado', 'pagos/p1', 'pedidos/p1',
  'reclamos/r1', 'metricas/2026-09', 'bitacora/b1', 'miembros/u1', 'invitaciones/i1', 'auditoria/e1',
  'movimientosStock/m1', 'accesosSoporte/u-soporte'];
const COLECCIONES = ['config', 'catalogo', 'fotosCatalogo', 'funcionarios', 'conversaciones', 'pedidos', 'contactos',
  'agenda', 'pagos', 'reclamos', 'metricas', 'bitacora', 'miembros'];

const ops: Op[] = [
  ...RUTAS_GET.map((r): Op => ({ id: `get ${r || '(ficha)'}`,
    correr: (fs, t) => getDoc(r ? doc(fs, P(t, r)) : doc(fs, `tenants/${t}`)) })),
  ...COLECCIONES.map((c): Op => ({ id: `list ${c}`, correr: (fs, t) => getDocs(collection(fs, P(t, c))) })),
  // Escrituras. Van antes de los borrados y no se pisan entre sí.
  { id: 'update config/negocio', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'config/negocio')), { direccion: 'Otra 1', ...sello(u) }) },
  { id: 'update config/negocio catalogoWebActivo=true', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'config/negocio')), { catalogoWebActivo: true, ...sello(u) }) },
  { id: 'update config/agendamiento', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'config/agendamiento')), { duracionPorDefectoMin: 30, ...sello(u) }) },
  { id: 'update config/venta', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'config/venta')), { costoDelivery: 12, ...sello(u) }) },
  { id: 'update config/marca', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'config/marca')), { logo: 'data:image/png;base64,AAAA', ...sello(u) }) },
  { id: 'update config/onboarding', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'config/onboarding')), { topeAviso: 30, ...sello(u) }) },
  { id: 'create config/campanas', correr: (fs, t, u) => setDoc(doc(fs, P(t, 'config/campanas')), { lista: [], ...sello(u) }) },
  { id: 'update catalogo/item1', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'catalogo/item1')), { precio: 95, ...sello(u) }) },
  { id: 'create fotosCatalogo/item1', correr: (fs, t, u) => setDoc(doc(fs, P(t, 'fotosCatalogo/item1')),
      { datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp', ...sello(u) }) },
  { id: 'create catalogo/nuevo + contador', correr: (fs, t, u) => {
      const l = writeBatch(fs);
      l.set(doc(fs, P(t, 'catalogo/nuevo')), { nombre: 'Torta', precio: 90, moneda: 'BOB', activo: true, ...sello(u) });
      l.update(doc(fs, P(t, 'contadores/catalogo')), { items: increment(1), ultimoItem: 'nuevo', actualizadoEn: serverTimestamp() });
      return l.commit();
    } },
  { id: 'create funcionarios/nuevo', correr: (fs, t, u) => setDoc(doc(fs, P(t, 'funcionarios/nuevo')),
      { nombre: 'Ana', especialidad: '', calendarioId: '', horarioTrabajo: {}, servicios: [], activo: true, ...sello(u) }) },
  { id: 'update funcionarios/f1/privado/datos', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'funcionarios/f1/privado/datos')), { telefono: '70000010', ...sello(u) }) },
  { id: 'create funcionarios/f1/privado/otro', correr: (fs, t, u) => setDoc(doc(fs, P(t, 'funcionarios/f1/privado/otro')), { telefono: '70000011', ...sello(u) }) },
  { id: 'update contactos/k1', correr: (fs, t, u) => updateDoc(doc(fs, P(t, 'contactos/k1')), { nombre: 'Otra', ...sello(u) }) },
  { id: 'create agenda/ranura', correr: (fs, t) => setDoc(doc(fs, P(t, 'agenda/f1_20260902_44')),
      { funcionarioId: 'f1', inicio: Timestamp.now(), fin: Timestamp.now(), servicioId: 'item-4', creadoEn: Timestamp.now() }) },
  { id: 'update pedidos/p1', correr: (fs, t) => updateDoc(doc(fs, P(t, 'pedidos/p1')), { estado: 'x' }) },
  { id: 'update cuenta/estado', correr: (fs, t) => updateDoc(doc(fs, P(t, 'cuenta/estado')), { plan: 'pro' }) },
  { id: 'update conversaciones/c1', correr: (fs, t) => updateDoc(doc(fs, P(t, 'conversaciones/c1')), { ultimoMensaje: 'x' }) },
  { id: 'update tenants/{t} (ficha)', correr: (fs, t) => updateDoc(doc(fs, `tenants/${t}`), { modulos: ['agenda'] }) },
  // Borrados, al final.
  { id: 'delete fotosCatalogo/item1', correr: (fs, t) => deleteDoc(doc(fs, P(t, 'fotosCatalogo/item1'))) },
  { id: 'delete catalogo/item1 + contador', correr: (fs, t) => {
      const l = writeBatch(fs);
      l.delete(doc(fs, P(t, 'catalogo/item1')));
      l.update(doc(fs, P(t, 'contadores/catalogo')), { items: increment(-1), ultimoItem: 'item1', actualizadoEn: serverTimestamp() });
      return l.commit();
    } },
  { id: 'delete config/venta', correr: (fs, t) => deleteDoc(doc(fs, P(t, 'config/venta'))) },
  { id: 'delete funcionarios/f1', correr: (fs, t) => deleteDoc(doc(fs, P(t, 'funcionarios/f1'))) },
  { id: 'delete contactos/k1', correr: (fs, t) => deleteDoc(doc(fs, P(t, 'contactos/k1'))) },
  { id: 'delete conversaciones/c1', correr: (fs, t) => deleteDoc(doc(fs, P(t, 'conversaciones/c1'))) },
  { id: 'delete funcionarios/f1/privado/datos', correr: (fs, t) => deleteDoc(doc(fs, P(t, 'funcionarios/f1/privado/datos'))) },
];

const permitida = async (op: () => Promise<unknown>): Promise<boolean> => {
  try { await op(); return true; } catch (e) {
    if (String((e as { code?: string }).code ?? e).includes('permission-denied')) return false;
    throw e;
  }
};

type Matriz = Map<string, boolean>;
const clave = (perfil: string, actor: string, op: string): string => `${perfil} | ${actor} | ${op}`;

/** Corre la matriz completa contra las reglas cargadas. */
const matriz = async (): Promise<Matriz> => {
  const m: Matriz = new Map();
  for (const [perfil, { ficha }] of Object.entries(PERFILES)) {
    for (const actor of ACTORES) {
      await sembrar(perfil, ficha);
      await sembrar(OTRO, FICHA_OTRO);
      const ctx = contexto(actor, perfil);
      const fs = ctx.firestore();
      const uid = actor === 'admin' ? `u-admin-${perfil}` : actor === 'oper' ? `u-oper-${perfil}` : actor === 'propietario' ? 'u-novuchat' : 'u-admin-ajeno';
      for (const op of ops) {
        m.set(clave(perfil, actor, op.id), await permitida(() => op.correr(fs, perfil, uid)));
      }
    }
  }
  return m;
};

let antes: Matriz;
let ahora: Matriz;

describe('reglas: prueba diferencial contra las reglas de origin/main', () => {
  beforeAll(async () => {
    await iniciar(ANTES);
    antes = await matriz();
    await iniciar(AHORA);
    ahora = await matriz();
  }, 900_000);
  afterAll(async () => { await entorno?.cleanup(); });

  it('la matriz no es trivial: hay operaciones permitidas y negadas en las reglas de antes', () => {
    const v = [...antes.values()];
    expect(v.length).toBe(Object.keys(PERFILES).length * ACTORES.length * ops.length);
    expect(v.filter(Boolean).length).toBeGreaterThan(300);
    expect(v.filter((x) => !x).length).toBeGreaterThan(300);
  });

  it('las ÚNICAS diferencias son funcionarios/*/privado para el administrador de un comercio sin agenda', () => {
    const diferencias = [...antes.keys()].filter((k) => antes.get(k) !== ahora.get(k));
    // Resumen para la descripción del PR.
    const resumen = diferencias.map((k) => `${k}: antes ${antes.get(k) ? 'PERMITE' : 'NIEGA'} -> ahora ${ahora.get(k) ? 'PERMITE' : 'NIEGA'}`);
    console.log(`MATRIZ DIFERENCIAL: ${antes.size} operaciones comparadas, ${diferencias.length} diferencias\n${resumen.join('\n')}`);
    for (const k of diferencias) {
      const [perfil, actor, op] = k.split(' | ');
      expect(op, `diferencia no declarada: ${k}`).toMatch(/^(update|create) funcionarios\/f1\/privado\//);
      expect(actor, k).toBe('admin');
      expect(PERFILES[perfil as string]?.agenda, `${k}: el perfil tiene agenda`).toBe(false);
      expect(antes.get(k), k).toBe(true);
      expect(ahora.get(k), k).toBe(false);
    }
    // Y la diferencia aprobada SÍ ocurre en cada comercio sin agenda (si no, la
    // prueba no está mirando donde debe).
    for (const [perfil, p] of Object.entries(PERFILES)) {
      for (const op of ['update funcionarios/f1/privado/datos', 'create funcionarios/f1/privado/otro']) {
        const k = clave(perfil, 'admin', op);
        expect(antes.get(k), `${k}: base`).toBe(true);
        expect(ahora.get(k), k).toBe(p.agenda);
      }
    }
  });

  // Q'Taco, con nombre y apellido: lo que podía, lo sigue pudiendo; lo cerrado, cerrado.
  const PUEDE_ADMIN = ['update config/negocio', 'update config/negocio catalogoWebActivo=true', 'update config/venta',
    'update config/marca', 'create config/campanas', 'update catalogo/item1', 'create fotosCatalogo/item1',
    'create catalogo/nuevo + contador', 'delete fotosCatalogo/item1', 'delete catalogo/item1 + contador',
    'get config/venta', 'get config/marca', 'get config/negocio', 'get config/onboarding', 'get catalogo/item1',
    'get fotosCatalogo/item1', 'get contadores/catalogo', 'get pedidos/p1', 'list catalogo', 'list pedidos',
    'update contactos/k1', 'get cuenta/estado'];
  const NO_PUEDE_ADMIN = ['update config/onboarding', 'update config/agendamiento', 'create funcionarios/nuevo',
    'update funcionarios/f1/privado/datos', 'create funcionarios/f1/privado/otro', 'update pedidos/p1',
    'update cuenta/estado', 'delete config/venta', 'create agenda/ranura', 'update tenants/{t} (ficha)'];
  it("Q'Taco: el administrador puede TODO lo que podía y sigue sin poder lo cerrado", () => {
    for (const op of PUEDE_ADMIN) expect(ahora.get(clave('qtaco', 'admin', op)), `qtaco admin ${op}`).toBe(true);
    for (const op of NO_PUEDE_ADMIN) expect(ahora.get(clave('qtaco', 'admin', op)), `qtaco admin ${op}`).toBe(false);
  });
  it("Q'Taco: el propietario lee su configuración y NO sus conversaciones ni escribe config/onboarding", () => {
    // Lo que el propietario lee hoy de un comercio (la ficha y la cuenta) lo sigue leyendo.
    const leia = ['get (ficha)', 'get cuenta/estado', 'get pagos/p1'];
    expect(leia.filter((op) => antes.get(clave('qtaco', 'propietario', op))).length).toBeGreaterThan(0);
    for (const op of leia) {
      expect(ahora.get(clave('qtaco', 'propietario', op)), `qtaco propietario ${op}`).toBe(antes.get(clave('qtaco', 'propietario', op)));
    }
    for (const op of ['get conversaciones/c1', 'get conversaciones/c1/mensajes/m1', 'get conversaciones/c1/privado/datos',
      'get funcionarios/f1/privado/datos', 'get config/onboarding', 'update config/onboarding', 'update config/venta']) {
      expect(ahora.get(clave('qtaco', 'propietario', op)), `qtaco propietario ${op}`).toBe(false);
    }
  });
  it("Q'Taco: el operador lee y no escribe", () => {
    expect(ahora.get(clave('qtaco', 'oper', 'get config/venta'))).toBe(true);
    for (const op of ['update config/venta', 'update config/negocio', 'update catalogo/item1', 'create fotosCatalogo/item1']) {
      expect(ahora.get(clave('qtaco', 'oper', op)), op).toBe(false);
    }
  });

  it('entre comercios: el administrador ajeno y el anónimo no leen ni escriben NADA de ningún perfil', () => {
    for (const perfil of Object.keys(PERFILES)) {
      for (const actor of ['ajeno', 'anon']) {
        for (const op of ops) {
          expect(ahora.get(clave(perfil, actor, op.id)), `${perfil} | ${actor} | ${op.id}`).toBe(false);
        }
      }
    }
  });

  it("entre comercios, al revés: el administrador de cada perfil, sobre el tenant «otro», no puede nada", async () => {
    for (const [perfil, { ficha }] of Object.entries(PERFILES)) {
      await sembrar(OTRO, FICHA_OTRO);
      await sembrar(perfil, ficha);
      const fs = entorno.authenticatedContext(`u-admin-${perfil}`, claims({ [perfil]: 'admin' })).firestore();
      for (const op of ops) {
        expect(await permitida(() => op.correr(fs, OTRO, `u-admin-${perfil}`)), `${perfil} admin sobre otro: ${op.id}`).toBe(false);
      }
    }
  }, 600_000);

  // `modulos` presente: lista, vacía y cadena. Cada una sobre el MISMO tenant de Q'Taco.
  it("con `modulos` presente en la ficha de Q'Taco: lista sin los suyos, vacía y cadena", async () => {
    const ficha = PERFILES['qtaco']?.ficha as Record<string, unknown>;
    const caso = async (modulos: unknown, esperado: Record<string, boolean>) => {
      await sembrar('qtaco', { ...ficha, modulos });
      const fs = entorno.authenticatedContext('u-admin-qtaco', claims({ qtaco: 'admin' })).firestore();
      for (const [id, ok] of Object.entries(esperado)) {
        const op = ops.find((o) => o.id === id) as Op;
        await sembrar('qtaco', { ...ficha, modulos });
        expect(await permitida(() => op.correr(fs, 'qtaco', 'u-admin-qtaco')), `modulos=${JSON.stringify(modulos)}: ${id}`).toBe(ok);
      }
    };
    // Lista solo con agenda: se niega lo de venta, el catálogo y las campañas.
    await caso(['agenda'], { 'update config/venta': false, 'update config/marca': false,
      'update catalogo/item1': false, 'create config/campanas': false, 'update config/agendamiento': true,
      'update funcionarios/f1/privado/datos': true, 'update config/negocio': true });
    // Lista vacía: nada de módulos, pero la configuración común sigue.
    await caso([], { 'update config/venta': false, 'update config/marca': false, 'update catalogo/item1': false,
      'create fotosCatalogo/item1': false, 'create config/campanas': false, 'update config/agendamiento': false,
      'update funcionarios/f1/privado/datos': false, 'update config/negocio': true });
    // Cadena: no es lista, manda `flujos` (['venta']): idéntico a la ficha de hoy.
    await caso('agenda', { 'update config/venta': true, 'update config/marca': true, 'update catalogo/item1': true,
      'create config/campanas': true, 'update config/agendamiento': false, 'update funcionarios/f1/privado/datos': false });
    // Lista con los módulos de Q'Taco: puede lo mismo que hoy.
    await caso(['pedidos', 'catalogo-web', 'productos', 'campanas'], { 'update config/venta': true, 'update config/marca': true,
      'update catalogo/item1': true, 'create config/campanas': true, 'update config/onboarding': false });
  }, 600_000);
});
