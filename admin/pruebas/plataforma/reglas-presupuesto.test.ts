/**
 * PRESUPUESTO DE EXPRESIONES DE LAS REGLAS (H2b-6) — NINGUNA OPERACIÓN CUESTA MÁS QUE EN main.
 *
 * Firestore corta una petición que evalúa más de 1.000 expresiones («maximum
 * of 1000 expressions to be evaluated») y la rechaza como PERMISSION_DENIED:
 * una regla correcta pero más cara que la anterior le quita al comercio una
 * escritura que antes tenía (la revisión de seguridad del #422 lo midió con la
 * ficha de Q'Taco: `config/negocio` completo con 4, 5 y 6 días de horario
 * pasaba en main y no en el PR). La prueba de «decide igual» NO lo ve si la
 * operación de la matriz es liviana; esta lo mide.
 *
 * CÓMO SE MIDE. El emulador no dice cuántas expresiones gastó una petición; se
 * mide el MARGEN. A `tenantOperativo` —que toda escritura evalúa— se le suma un
 * lastre de K expresiones triviales y se busca, por bisección, el K más alto con
 * el que la operación todavía pasa. Margen(operación, reglas) = K máximo.
 * Cuanto menos margen, más cara la operación: el costo en expresiones es
 * `tope − margen`. La prueba exige, en cada operación,
 * `margen(PR) >= min(margen(main), HOLGURA)`: una operación AJUSTADA en main
 * (config/negocio de Q'Taco, campañas) no puede costar más en el PR; una con
 * holgura puede gastar parte de ella (las exigencias nuevas de `privado`,
 * `productos` y `campanas` y la lectura de `modulos` cuestan unas expresiones)
 * pero no bajar de HOLGURA. Las reglas de main son
 * `firestore-base-previa-h2b6.rules.txt`. `PRESUPUESTO_FILTRO` (regex) mide
 * solo algunas operaciones al iterar.
 *
 * Las operaciones son las que tocan lo que H2b-6 cambió y las más pesadas del
 * resto: `config/negocio` completo con la forma de Q'Taco (3 a 7 días de
 * horario, al ENCENDER `catalogoWebActivo` y ya encendido), alta de producto con
 * contador en lote (de lo mínimo a lo máximo), lote mixto con foto, campañas
 * (10), documentos de flujo, `privado` y la edición del propietario. Los
 * pedidos y el carrito los escribe solo el servidor (regla `false`): no gastan.
 *
 * Fichas y valores SINTÉTICOS; ningún dato de ningún comercio.
 */
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc, doc, setDoc, updateDoc, serverTimestamp, Timestamp, writeBatch, increment,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const ANTES = readFileSync(join(aqui, 'firestore-base-previa-h2b6.rules.txt'), 'utf8');
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
const KMAX = 480;
/** Expresiones que una operación con holgura en main tiene que conservar en el PR. */
const HOLGURA = 25;

/** Lastre de `k` expresiones triviales colgado de `tenantOperativo`. */
const conLastre = (reglas: string, k: number): string => {
  if (k === 0) return reglas;
  const original = "return estadoTenant(tenantId) == 'activo';";
  expect(reglas.split(original).length - 1, 'tenantOperativo con la forma esperada').toBe(1);
  // Árbol BALANCEADO: una cadena larga de `&&` la rechaza el compilador por profundidad.
  const arbol = (n: number): string => (n <= 1 ? "tenantId != ''" : `(${arbol(Math.floor(n / 2))} && ${arbol(n - Math.floor(n / 2))})`);
  const lastre = arbol(k);
  return reglas.replace(original, `return estadoTenant(tenantId) == 'activo' && (${lastre});`);
};

let entorno: RulesTestEnvironment | undefined;
const iniciar = async (reglas: string): Promise<void> => {
  if (entorno) await entorno.cleanup();
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: reglas, host: '127.0.0.1', port: PUERTO },
  });
};
const env = (): RulesTestEnvironment => entorno as RulesTestEnvironment;

const claims = (tenants: Record<string, string>, propietario = false, proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});
const UA = 'u-admin-t';
const sello = (u: string) => ({ actualizadoPor: u, actualizadoEn: serverTimestamp() });

// ---------------------------------------------------------------------------
// Fichas sintéticas, sin `modulos`.
// ---------------------------------------------------------------------------
const TS = Timestamp.fromMillis(1_700_000_000_000);
const comun = { creadoEn: TS, creadoPor: 'u-x', estado: 'activo', plan: 'crecimiento', waPhoneNumberId: 'pn', waWabaId: 'wb' };
const FICHAS: Record<string, Record<string, unknown>> = {
  qtaco: { ...comun, nombre: 'Q', flujos: ['venta'], vertical: 'venta' },
  agenda: { ...comun, nombre: 'A', flujos: ['agendamiento'], vertical: 'agendamiento' },
  doble: { ...comun, nombre: 'D', flujos: ['agendamiento', 'venta'], vertical: 'agendamiento' },
  novuchat: { ...comun, nombre: 'N', flujos: ['onboarding'], vertical: 'onboarding' },
};

const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const horarios = (k: number) => Object.fromEntries(DIAS.slice(0, k).map((d) => [d, '09:00-18:00']));
// La forma de lo que guarda la consola (Configuracion.tsx): identidad, dirección,
// recepción, voz, paleta, descripción, asistente, instrucciones, mapa, ubicación,
// mensajes, política y horario.
const negocio = (k: number): Record<string, unknown> => ({
  nombreNegocio: 'N', direccion: 'x', numeroRecepcion: '591000009', tratamiento: 'tu', estiloEmojis: 'pocos',
  zonaHoraria: 'America/La_Paz', moneda: 'BOB', paleta: 'vino',
  descripcion: 'd', nombreAsistente: 'Kenji', instruccionesExtra: 'i',
  direccionMaps: 'https://maps.app.goo.gl/abc', ubicacion: { lat: -17.8, lng: -63.2 },
  mensajeCierre: 'c', politicaCancelacion: 'p', horarios: horarios(k),
});

/** El documento ya guardado: lo editable más lo que escribe solo el servidor (verificación de instrucciones). */
const guardado = (k: number, extra: Record<string, unknown> = {}) => ({
  ...negocio(k), instruccionesVigentes: 'i', instruccionesRevision: { estado: 'ok' }, ...extra,
  actualizadoPor: 's', actualizadoEn: Timestamp.now(),
});

const itemBase =(u: string) => ({ nombre: 'n'.repeat(80), activo: true, ...sello(u) });
const itemCompleto = (u: string) => ({
  ...itemBase(u), descripcion: 'd'.repeat(300), area: 'gastronomia', precio: 1000, moneda: 'USD',
  duracionMin: 1440, imagenUrl: `https://ejemplo.com/${'a'.repeat(400)}`,
});
const dia = (n: number) => new Date(Date.now() - 4 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const campanas = Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 1}`, texto: `Campaña ${i + 1}`, inicio: dia(0), fin: dia(30) }));

type Fs = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;
type Actor = 'admin' | 'propietario';
type Prueba = {
  id: string; ficha: string; actor?: Actor;
  seed?: (db: Fs) => Promise<void>;
  correr: (fs: Fs) => Promise<unknown>;
};

const P = (p: string) => `tenants/t/${p}`;
const pruebas: Prueba[] = [];

// config/negocio con la forma de Q'Taco: 3..7 días, al encender y ya encendido.
for (const k of [3, 4, 5, 6, 7]) {
  for (const encendido of [false, true]) {
    pruebas.push({
      id: `config/negocio completo, ${k} días, ${encendido ? 'catalogoWebActivo ya encendido' : 'ENCIENDE catalogoWebActivo'}`,
      ficha: 'qtaco',
      seed: (db) => setDoc(doc(db, P('config/negocio')), guardado(k, encendido ? { catalogoWebActivo: true } : {})),
      correr: (fs) => updateDoc(doc(fs, P('config/negocio')), { ...negocio(k), catalogoWebActivo: true, ...sello(UA) }),
    });
  }
}
pruebas.push({
  id: 'config/negocio completo, 7 días, catalogoWebActivo=false', ficha: 'qtaco',
  seed: (db) => setDoc(doc(db, P('config/negocio')), guardado(7)),
  correr: (fs) => updateDoc(doc(fs, P('config/negocio')), { ...negocio(7), catalogoWebActivo: false, ...sello(UA) }),
});
pruebas.push({
  id: 'config/negocio completo, 7 días, comercio de agenda (catalogoWebActivo=false)', ficha: 'agenda',
  seed: (db) => setDoc(doc(db, P('config/negocio')), guardado(7)),
  correr: (fs) => updateDoc(doc(fs, P('config/negocio')), { ...negocio(7), ...sello(UA) }),
});

// Documentos de flujo.
pruebas.push({ id: 'config/venta (update)', ficha: 'qtaco',
  seed: (db) => setDoc(doc(db, P('config/venta')), { costoDelivery: 10, actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
  correr: (fs) => updateDoc(doc(fs, P('config/venta')), { costoDelivery: 12, ...sello(UA) }) });
pruebas.push({ id: 'config/marca (update)', ficha: 'qtaco',
  seed: (db) => setDoc(doc(db, P('config/marca')), { logo: '', actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
  correr: (fs) => updateDoc(doc(fs, P('config/marca')), { logo: 'data:image/png;base64,AAAA', ...sello(UA) }) });
pruebas.push({ id: 'config/marca (create)', ficha: 'qtaco',
  correr: (fs) => setDoc(doc(fs, P('config/marca')), { logo: 'data:image/png;base64,AAAA', ...sello(UA) }) });
pruebas.push({ id: 'config/agendamiento (update)', ficha: 'agenda',
  seed: (db) => setDoc(doc(db, P('config/agendamiento')), { duracionPorDefectoMin: 45, actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
  correr: (fs) => updateDoc(doc(fs, P('config/agendamiento')), { duracionPorDefectoMin: 30, ...sello(UA) }) });
pruebas.push({ id: 'config/onboarding (update, administrador)', ficha: 'novuchat',
  seed: (db) => setDoc(doc(db, P('config/onboarding')), { topeAviso: 25, actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
  correr: (fs) => updateDoc(doc(fs, P('config/onboarding')), { topeAviso: 30, ...sello(UA) }) });
pruebas.push({ id: 'config/onboarding (set, propietario)', ficha: 'novuchat', actor: 'propietario',
  seed: (db) => setDoc(doc(db, P('config/onboarding')), { topeAviso: 25, actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
  correr: (fs) => setDoc(doc(fs, P('config/onboarding')), { topeAviso: 30, ...sello('u-novuchat') }, { merge: true }) });

// Campañas: 10 (el tope más pesado) y vacía.
pruebas.push({ id: 'config/campanas, 10 campañas (create)', ficha: 'qtaco',
  seed: (db) => setDoc(doc(db, P('cuenta/estado')), { plan: 'pro' }),
  correr: (fs) => setDoc(doc(fs, P('config/campanas')), { lista: campanas, ...sello(UA) }) });
pruebas.push({ id: 'config/campanas, lista vacía (update)', ficha: 'qtaco',
  seed: async (db) => {
    await setDoc(doc(db, P('cuenta/estado')), { plan: 'pro' });
    await setDoc(doc(db, P('config/campanas')), { lista: [], actualizadoPor: 's', actualizadoEn: Timestamp.now() });
  },
  correr: (fs) => updateDoc(doc(fs, P('config/campanas')), { lista: [], ...sello(UA) }) });

// Catálogo: alta con contador en lote, de lo mínimo a lo máximo.
const altaLote = (fs: Fs, datos: Record<string, unknown>) => {
  const l = writeBatch(fs);
  l.set(doc(fs, P('catalogo/nuevo')), datos);
  l.update(doc(fs, P('contadores/catalogo')), { items: increment(1), ultimoItem: 'nuevo', actualizadoEn: serverTimestamp() });
  return l.commit();
};
const CAMPOS_ITEM = ['descripcion', 'area', 'precio', 'moneda', 'duracionMin', 'imagenUrl'];
for (let n = 0; n <= CAMPOS_ITEM.length; n++) {
  pruebas.push({ id: `catalogo: alta + contador en lote con ${n} campos opcionales`, ficha: 'qtaco',
    correr: (fs) => {
      const c = itemCompleto(UA) as Record<string, unknown>;
      const d: Record<string, unknown> = { ...itemBase(UA) };
      for (const k of CAMPOS_ITEM.slice(0, n)) d[k] = c[k];
      return altaLote(fs, d);
    } });
}
pruebas.push({ id: 'catalogo: edición de un producto', ficha: 'qtaco',
  correr: (fs) => updateDoc(doc(fs, P('catalogo/i1')), { precio: 95, ...sello(UA) }) });
pruebas.push({ id: 'catalogo: baja + contador en lote', ficha: 'qtaco',
  correr: (fs) => {
    const l = writeBatch(fs);
    l.delete(doc(fs, P('catalogo/i1')));
    l.update(doc(fs, P('contadores/catalogo')), { items: increment(-1), ultimoItem: 'i1', actualizadoEn: serverTimestamp() });
    return l.commit();
  } });
pruebas.push({ id: 'fotosCatalogo (create)', ficha: 'qtaco',
  correr: (fs) => setDoc(doc(fs, P('fotosCatalogo/i1')), {
    datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp', ...sello(UA) }) });
pruebas.push({ id: 'fotosCatalogo (delete)', ficha: 'qtaco',
  seed: (db) => setDoc(doc(db, P('fotosCatalogo/i1')), {
    datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp', actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
  correr: (fs) => deleteDoc(doc(fs, P('fotosCatalogo/i1'))) });
pruebas.push({ id: 'lote mixto: alta de producto completo + contador + foto', ficha: 'qtaco',
  correr: (fs) => {
    const l = writeBatch(fs);
    l.set(doc(fs, P('catalogo/nuevo')), itemCompleto(UA));
    l.update(doc(fs, P('contadores/catalogo')), { items: increment(1), ultimoItem: 'nuevo', actualizadoEn: serverTimestamp() });
    l.set(doc(fs, P('fotosCatalogo/nuevo')), {
      datos: 'data:image/webp;base64,AAAABBBB', ancho: 9, alto: 9, bytes: 9, tipo: 'image/webp', ...sello(UA) });
    return l.commit();
  } });

// Funcionarios y datos privados.
const funcionario = (u: string) => ({
  nombre: 'Ana', especialidad: '', calendarioId: '', horarioTrabajo: { mar: '14:00-18:00', jue: '14:00-18:00' },
  servicios: [], activo: true, ...sello(u) });
for (const ficha of ['agenda', 'doble']) {
  pruebas.push({ id: `funcionarios (create), comercio ${ficha}`, ficha,
    correr: (fs) => setDoc(doc(fs, P('funcionarios/nuevo')), funcionario(UA)) });
  pruebas.push({ id: `funcionarios/privado (update), comercio ${ficha}`, ficha,
    seed: (db) => setDoc(doc(db, P('funcionarios/f1/privado/datos')), { telefono: '70000009', actualizadoPor: 's', actualizadoEn: Timestamp.now() }),
    correr: (fs) => updateDoc(doc(fs, P('funcionarios/f1/privado/datos')), { telefono: '70000010', correo: 'x@ejemplo.com', notas: 'n', ...sello(UA) }) });
  pruebas.push({ id: `funcionarios/privado (create), comercio ${ficha}`, ficha,
    correr: (fs) => setDoc(doc(fs, P('funcionarios/f1/privado/otro')), { telefono: '70000011', correo: 'x@ejemplo.com', ...sello(UA) }) });
}

/** Siembra el tenant, corre la prueba con lastre `k` y dice si pasó. Lanza si falla por otra cosa. */
const pasa = async (p: Prueba, reglas: string, k: number): Promise<boolean> => {
  await iniciar(conLastre(reglas, k));
  // Reiniciar el entorno NO borra los datos: sin esto, el alta de una corrida choca con la de la anterior.
  await env().clearFirestore();
  await env().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants/t'), FICHAS[p.ficha] as Record<string, unknown>);
    await setDoc(doc(db, P('cuenta/estado')), { plan: 'pro', limites: { productos: 500, campanas: 10 } });
    await setDoc(doc(db, P('contadores/catalogo')), { items: 1, ultimoItem: 'i1', actualizadoEn: Timestamp.now() });
    await setDoc(doc(db, P('catalogo/i1')), { nombre: 'x', activo: true, actualizadoPor: 's', actualizadoEn: Timestamp.now() });
    await setDoc(doc(db, P('funcionarios/f1')), { ...funcionario('s'), actualizadoEn: Timestamp.now() });
    if (p.seed) await p.seed(db);
  });
  const ctx = p.actor === 'propietario'
    ? env().authenticatedContext('u-novuchat', claims({}, true, 'google.com'))
    : env().authenticatedContext('u-admin-t', claims({ t: 'admin' }));
  try { await p.correr(ctx.firestore()); return true; } catch (e) {
    if (String((e as { code?: string }).code ?? e).includes('permission-denied')) return false;
    throw e;
  }
};

/** Mayor lastre con el que la operación todavía pasa (−1: ni sin lastre). */
const margen = async (p: Prueba, reglas: string): Promise<number> => {
  if (!(await pasa(p, reglas, 0))) return -1;
  let bajo = 0;
  let alto = KMAX + 1;
  if (await pasa(p, reglas, KMAX)) return KMAX;
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2);
    if (await pasa(p, reglas, medio)) bajo = medio; else alto = medio;
  }
  return bajo;
};

describe('reglas: presupuesto de expresiones contra las reglas de origin/main', () => {
  afterAll(async () => { await entorno?.cleanup(); });

  it('ninguna operación gasta más expresiones que en main (margen del PR >= margen de main)', async () => {
    const filas: string[] = [];
    const peores: string[] = [];
    // PRESUPUESTO_FILTRO: expresión regular para medir solo algunas operaciones al iterar sobre las reglas.
    const filtro = process.env['PRESUPUESTO_FILTRO'] ? new RegExp(process.env['PRESUPUESTO_FILTRO']) : null;
    for (const p of pruebas.filter((x) => !filtro || filtro.test(x.id))) {
      const mAntes = await margen(p, ANTES);
      const mAhora = await margen(p, AHORA);
      // -1: ni sin lastre pasa (main ya se pasa del tope en esa operación). El PR no puede ser peor.
      filas.push(`${p.id} | margen main ${mAntes} | margen PR ${mAhora} | gasto PR − gasto main = ${mAntes - mAhora}`);
      // Regla: una operación AJUSTADA en main (margen < HOLGURA) no puede costar más en el PR.
      // Una con holgura puede gastar parte de ella (la exigencia nueva de `privado`, `productos`,
      // `campanas` o la lectura de `modulos` cuestan expresiones), pero nunca bajar de HOLGURA.
      if (mAhora < Math.min(mAntes, HOLGURA)) peores.push(`${p.id}: main ${mAntes}, PR ${mAhora}`);
    }
    console.log(`PRESUPUESTO (margen = expresiones sobrantes; más margen = más barato)\n${filas.join('\n')}`);
    expect(peores, 'operaciones más caras que en main').toEqual([]);
  }, 1_800_000);
});
