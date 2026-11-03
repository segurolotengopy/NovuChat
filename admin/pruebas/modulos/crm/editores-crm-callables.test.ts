/**
 * LOS CALLABLES DE EDICIÓN DEL miniCRM, con el emulador de Firestore (03/11/2026). Drive y la verificación del token
 * son DOBLES: nada sale a Google ni a GCP. Se escribe NEGANDO (cada caso comprueba además que Drive no fue llamado).
 * Los handlers se invocan directo con una petición falsa (la misma forma que ve `onCall`).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (getApps().length === 0) initializeApp({ projectId: PROYECTO });
const { getFirestore } = await import('firebase-admin/firestore');
const { manejarRegistrar, manejarQuitar, manejarConsultar, revocarEditorAlQuitarUsuario } =
  await import('../../../functions/src/modulos/crm/editoresCrm.ts');
const { ErrorDrive, ErrorPermisoNoRevocable, ErrorToken, crearVerificadorGoogle } = await import('../../../functions/src/modulos/crm/editores-crm.ts');
const { PLANES } = await import('../../../functions/src/central/cuenta/planes.ts');
type ClienteDrive = import('../../../functions/src/modulos/crm/editores-crm.ts').ClienteDrive;
type DepsEditores = import('../../../functions/src/modulos/crm/editoresCrm.ts').DepsEditores;
type Peticion = Parameters<ReturnType<typeof manejarRegistrar>>[0];
const db = getFirestore();
/** El `logger` de firebase-functions guarda la consola original al cargar: se lo espía por su propio módulo. */
const requerirDesdeFunctions = createRequire(fileURLToPath(new URL('../../../functions/package.json', import.meta.url)));
const loggerDeFunctions = requerirDesdeFunctions('firebase-functions/logger') as
  Record<'debug' | 'info' | 'log' | 'warn' | 'error', (...a: unknown[]) => void>;

const A = 'edc-a';
const B = 'edc-b';
const correoDe = (local: string) => [local, 'example.invalid'].join('@');
const hoja = (n: string) => `https://docs.google.com/spreadsheets/d/${n.padEnd(12, 'x')}/edit`;
const ARCHIVO_A = 'hoja-de-a'.padEnd(12, 'x');
const ARCHIVO_B = 'hoja-de-b'.padEnd(12, 'x');

function peticion(uid: string, rol: 'admin' | 'oper', tenant: string, data: Record<string, unknown>, correo?: string): Peticion {
  return {
    data, rawRequest: {},
    auth: {
      uid,
      token: {
        nc: { t: { [tenant]: rol }, v: 1 }, firebase: { sign_in_provider: 'password' }, email_verified: true,
        email: correo ?? correoDe(uid),
      },
    },
  } as unknown as Peticion;
}
const sinSesion = (data: Record<string, unknown>) => ({ data, rawRequest: {} }) as unknown as Peticion;

/** Drive falso: anota cada llamada; los fallos se encienden por prueba. */
function driveFalso() {
  const estado = { falloCrear: false, falloBorrar: false, yaExistia: false, propietario: false, barrera: 0 };
  const llamadas: { op: 'crear' | 'borrar'; archivoId: string; dato: string }[] = [];
  let llegaron = 0;
  const cliente: ClienteDrive = {
    async crearPermiso(archivoId, correo) {
      llamadas.push({ op: 'crear', archivoId, dato: correo });
      if (estado.barrera > 0) { // las N llamadas esperan a que todas lleguen: así la carrera es real
        llegaron++;
        while (llegaron < estado.barrera) await new Promise((r) => setTimeout(r, 5));
      }
      if (estado.propietario) throw new ErrorPermisoNoRevocable();
      if (estado.falloCrear) throw new ErrorDrive(503);
      return { permisoId: `perm-${llamadas.length}`, creado: !estado.yaExistia };
    },
    async borrarPermiso(archivoId, permisoId) {
      llamadas.push({ op: 'borrar', archivoId, dato: permisoId });
      if (estado.falloBorrar) throw new ErrorDrive(503);
    },
  };
  return { cliente, llamadas, estado };
}

/** Verificador falso: «ok:<correo>» es válido; los demás prefijos reproducen cada rechazo de la biblioteca. */
const verificarFalso: DepsEditores['verificar'] = async (t) => {
  if (t.startsWith('ok:')) return { correo: t.slice(3).toLowerCase() };
  if (t === 'no-verificado') throw new ErrorToken('correo_no_verificado');
  throw new ErrorToken('invalido'); // audiencia errónea, vencido, firma mala…
};

let fake: ReturnType<typeof driveFalso>;
let pedidos: string[];
const deps = (): DepsEditores => ({
  verificar: verificarFalso,
  drive: (t) => { pedidos.push(t); return fake.cliente; },
});
const registrar = (p: Peticion, d: DepsEditores = deps()) => manejarRegistrar(d)(p);
const quitar = (p: Peticion) => manejarQuitar(deps())(p);
const consultar = (p: Peticion) => manejarConsultar()(p);

const codigo = async (p: Promise<unknown>): Promise<string> =>
  p.then(() => 'sin error', (e: unknown) => ((e as { httpErrorCode?: unknown }).httpErrorCode !== undefined ? (e as { code: string }).code : `otro: ${String(e)}`));

async function sembrar(): Promise<void> {
  for (const t of [A, B]) await db.recursiveDelete(db.doc(`tenants/${t}`));
  for (const t of [A, B]) {
    await db.doc(`tenants/${t}`).set({ nombre: t, estado: 'activo' });
    await db.doc(`tenants/${t}/cuenta/estado`).set({ plan: 'crecimiento' });
    await db.doc(`tenants/${t}/enlaces/minicrm`).set({ enlaceHoja: hoja(t === A ? 'hoja-de-a' : 'hoja-de-b') });
  }
  for (const [t, uid] of [[A, 'adm'], [A, 'op1'], [A, 'op2'], [A, 'pend'], [B, 'admb'], [B, 'opb']] as const) {
    await db.doc(`tenants/${t}/miembros/${uid}`).set({ correo: correoDe(uid), rol: uid.startsWith('adm') ? 'admin' : 'oper', estado: uid === 'pend' ? 'pendiente_verificacion' : 'activo' });
  }
}
const editor = async (t: string, uid: string) => (await db.doc(`tenants/${t}/editoresCrm/${uid}`).get()).data();
const activos = async (t: string) => (await db.collection(`tenants/${t}/editoresCrm`).where('estado', '==', 'activo').get()).size;
async function sembrarActivos(t: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await db.doc(`tenants/${t}/editoresCrm/relleno${i}`).set({ correoGoogle: correoDe(`relleno${i}`), estado: 'activo', permisoId: `p${i}`, archivoId: ARCHIVO_A });
  }
}

beforeEach(async () => { fake = driveFalso(); pedidos = []; await sembrar(); });

describe('registrarEditorCrm: el alta', () => {
  it('control: el operador se da de alta con SU correo; el correo y el archivo salen del token y del enlace del tenant', async () => {
    const r = await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('OP1')}` }));
    expect(r).toEqual({ ok: true, estado: 'activo' });
    expect(fake.llamadas).toEqual([{ op: 'crear', archivoId: ARCHIVO_A, dato: correoDe('op1') }]);
    const f = await editor(A, 'op1');
    expect(f).toMatchObject({ correoGoogle: correoDe('op1'), estado: 'activo', archivoId: ARCHIVO_A, registradoPor: 'op1', verificadoPor: 'token-google' });
    expect(f?.['permisoId']).toBeTruthy();
    const aud = (await db.collection(`tenants/${A}/auditoria`).where('accion', '==', 'editor_crm_alta').get()).docs[0]?.data();
    expect(aud?.['correo']).toBe('o***@example.invalid');
    expect(JSON.stringify(aud)).not.toContain(correoDe('op1'));
  });

  it('NIEGA: un archivo o un enlace puestos en el cuerpo no cambian el archivo compartido', async () => {
    await registrar(peticion('op1', 'oper', A, {
      tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}`, archivoId: ARCHIVO_B, fileId: ARCHIVO_B, enlaceHoja: hoja('hoja-de-b'), correoGoogle: correoDe('otro'),
    }));
    expect(fake.llamadas).toHaveLength(1);
    expect(fake.llamadas[0]?.archivoId).toBe(ARCHIVO_A);
    expect(fake.llamadas[0]?.dato).toBe(correoDe('op1'));
  });

  it('NIEGA: con el tenantId de otro comercio en el cuerpo (sesión de A) no se toca Drive ni se pide su cliente', async () => {
    expect(await codigo(registrar(peticion('admb', 'admin', B, { tenantId: A, idTokenGoogle: `ok:${correoDe('admb')}`, uidDestino: 'op1' })))).toBe('permission-denied');
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: B, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('permission-denied');
    expect(fake.llamadas).toEqual([]);
    expect(pedidos).toEqual([]);
    expect(await editor(B, 'op1')).toBeUndefined();
  });

  it('NIEGA: el admin de A no da de alta a un usuario de B (no es miembro de A) y B conserva su archivo', async () => {
    expect(await codigo(registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('opb')}`, uidDestino: 'opb' })))).toBe('failed-precondition');
    expect(fake.llamadas).toEqual([]);
  });

  it('NIEGA: sin sesión, sin tenantId válido o sin token de Google', async () => {
    expect(await codigo(registrar(sinSesion({ tenantId: A, idTokenGoogle: `ok:${correoDe('x')}` })))).toBe('unauthenticated');
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: '../x', idTokenGoogle: `ok:${correoDe('x')}` })))).toBe('invalid-argument');
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A })))).toBe('invalid-argument');
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('x')}`, uidDestino: '../etc' })))).toBe('invalid-argument');
    expect(fake.llamadas).toEqual([]);
  });

  it('NIEGA: un operador no registra a otro, aunque el token sea de ese otro', async () => {
    let verificaciones = 0;
    const d: DepsEditores = { ...deps(), verificar: async (t) => { verificaciones++; return verificarFalso(t); } };
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op2')}`, uidDestino: 'op2' }), d))).toBe('permission-denied');
    expect(verificaciones).toBe(0);
    expect(fake.llamadas).toEqual([]);
    expect(await editor(A, 'op2')).toBeUndefined();
  });

  it('NIEGA: el operador con un correo de token distinto al de su login', async () => {
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('otra.cuenta')}` })))).toBe('permission-denied');
    expect(fake.llamadas).toEqual([]);
    expect(await editor(A, 'op1')).toBeUndefined();
  });

  it('NIEGA: email_verified=false, audiencia errónea o token vencido (la biblioteca rechaza)', async () => {
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: 'no-verificado' })))).toBe('permission-denied');
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: 'audiencia-erronea-o-vencido' })))).toBe('unauthenticated');
    expect(fake.llamadas).toEqual([]);
  });

  it('NIEGA: GOOGLE_OAUTH_CLIENT_ID vacío falla cerrado con el verificador real, sin llamar a Drive', async () => {
    const d: DepsEditores = { verificar: crearVerificadorGoogle(() => ''), drive: deps().drive };
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }), d))).toBe('failed-precondition');
    expect(fake.llamadas).toEqual([]);
    expect(await editor(A, 'op1')).toBeUndefined();
  });

  it('NIEGA: un usuario pendiente de verificación, o que no es miembro, no queda como editor', async () => {
    expect(await codigo(registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('pend')}`, uidDestino: 'pend' })))).toBe('failed-precondition');
    expect(await codigo(registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('nadie')}`, uidDestino: 'nadie' })))).toBe('failed-precondition');
    expect(fake.llamadas).toEqual([]);
  });

  it('NIEGA: sin enlace, con un enlace que no es una hoja de Google, o con el miniCRM apagado', async () => {
    const p = () => peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` });
    await db.doc(`tenants/${A}/enlaces/minicrm`).delete();
    expect(await codigo(registrar(p()))).toBe('failed-precondition');
    await db.doc(`tenants/${A}/enlaces/minicrm`).set({ enlaceHoja: 'https://evil.example/spreadsheets/d/aaaaaaaaaaaaaaaa' });
    expect(await codigo(registrar(p()))).toBe('failed-precondition');
    await db.doc(`tenants/${A}/enlaces/minicrm`).set({ enlaceHoja: hoja('hoja-de-a') });
    await db.doc(`tenants/${A}/config/crm`).set({ activo: false });
    expect(await codigo(registrar(p()))).toBe('failed-precondition');
    expect(fake.llamadas).toEqual([]);
  });

  it('NIEGA: si Drive no puede crear el permiso no queda editor activo ni se informa éxito', async () => {
    fake.estado.falloCrear = true;
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('unavailable');
    expect(await editor(A, 'op1')).toBeUndefined();
  });

  it('NIEGA: un mismo Gmail no queda activo para dos personas', async () => {
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }));
    expect(await codigo(registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}`, uidDestino: 'op2' })))).toBe('already-exists');
    expect(fake.llamadas).toHaveLength(1);
  });

  it('el administrador da de alta a un tercero con el token de ese Gmail (puede ser otro distinto del login) y queda «admin»', async () => {
    await registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('gmail.de.op2')}`, uidDestino: 'op2' }));
    expect(await editor(A, 'op2')).toMatchObject({ correoGoogle: correoDe('gmail.de.op2'), registradoPor: 'adm', verificadoPor: 'admin' });
  });

  it('es idempotente: repetir el alta no duplica ni consume un cupo más', async () => {
    const p = () => peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` });
    await registrar(p());
    await registrar(p());
    expect(await activos(A)).toBe(1);
    await sembrarActivos(A, 3); // 1 + 3 = 4 de 5
    await registrar(p());
    expect(await activos(A)).toBe(4);
  });
});

describe('registrarEditorCrm: revisión de seguridad (03/11/2026)', () => {
  const sembrarPendiente = (uid: string, correo: string, permiso = 'perm-viejo') =>
    db.doc(`tenants/${A}/editoresCrm/${uid}`).set({ correoGoogle: correo, estado: 'revocado_pendiente', permisoId: permiso, archivoId: ARCHIVO_A });

  it('NIEGA: con la baja pendiente y OTRO Gmail, primero se revoca el permiso viejo; si no se puede, se rechaza sin pisarlo', async () => {
    await sembrarPendiente('op1', correoDe('viejo'));
    const p = () => peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` });
    fake.estado.falloBorrar = true;
    expect(await codigo(registrar(p()))).toBe('unavailable');
    expect(fake.llamadas.map((l) => l.op)).toEqual(['borrar']);
    expect(await editor(A, 'op1')).toMatchObject({ estado: 'revocado_pendiente', permisoId: 'perm-viejo', correoGoogle: correoDe('viejo') });
    fake.estado.falloBorrar = false;
    fake.llamadas.length = 0;
    expect(await codigo(registrar(p()))).toBe('sin error');
    expect(fake.llamadas.map((l) => `${l.op}:${l.dato}`)[0]).toBe('borrar:perm-viejo');
    expect(fake.llamadas.map((l) => l.op)).toEqual(['borrar', 'crear']);
    expect(await editor(A, 'op1')).toMatchObject({ estado: 'activo', correoGoogle: correoDe('op1') });
    expect((await editor(A, 'op1'))?.['permisoId']).not.toBe('perm-viejo');
  });

  it('NIEGA: un Gmail con la baja pendiente de otra persona tampoco se registra para alguien más', async () => {
    await sembrarPendiente('op2', correoDe('op1'));
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('already-exists');
    expect(fake.llamadas).toEqual([]);
  });

  it('NIEGA (carrera): dos altas a la vez con el MISMO Gmail para dos personas: solo una queda y la otra deshace lo que creó', async () => {
    fake.estado.barrera = 2;
    const tok = `ok:${correoDe('compartido')}`;
    const r = await Promise.all([
      codigo(registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: tok, uidDestino: 'op1' }))),
      codigo(registrar(peticion('adm', 'admin', A, { tenantId: A, idTokenGoogle: tok, uidDestino: 'op2' }))),
    ]);
    expect([...r].sort()).toEqual(['already-exists', 'sin error']);
    const vivos = (await db.collection(`tenants/${A}/editoresCrm`).where('correoGoogle', '==', correoDe('compartido')).get()).docs;
    expect(vivos).toHaveLength(1);
    expect(fake.llamadas.filter((l) => l.op === 'borrar')).toHaveLength(1);
  });

  it('NIEGA (carrera): con un solo cupo libre, dos altas a la vez de personas distintas: entra una', async () => {
    await sembrarActivos(A, PLANES.crecimiento.editoresCrm - 1);
    fake.estado.barrera = 2;
    const r = await Promise.all([
      codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }))),
      codigo(registrar(peticion('op2', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op2')}` }))),
    ]);
    expect([...r].sort()).toEqual(['resource-exhausted', 'sin error']);
    expect(await activos(A)).toBe(PLANES.crecimiento.editoresCrm);
  });

  it('rechazo por tope: se borra el permiso solo si lo CREÓ esta llamada', async () => {
    await sembrarActivos(A, PLANES.crecimiento.editoresCrm - 1);
    await db.doc(`tenants/${A}/editoresCrm/otro`).set({ correoGoogle: correoDe('otro'), estado: 'activo', permisoId: 'po', archivoId: ARCHIVO_A });
    // el rechazo previo (conteo) no corre porque el tope se llena justo antes de la transacción: se simula con la barrera
    fake.estado.barrera = 1;
    const llenar = fake.cliente.crearPermiso;
    fake.cliente.crearPermiso = async (...a) => { const r = await llenar(...a); await db.doc(`tenants/${A}/editoresCrm/otro`).set({ correoGoogle: correoDe('otro'), estado: 'activo', permisoId: 'po', archivoId: ARCHIVO_A }); return r; };
    await db.doc(`tenants/${A}/editoresCrm/otro`).delete();
    fake.estado.yaExistia = true;
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('resource-exhausted');
    expect(fake.llamadas.filter((l) => l.op === 'borrar')).toEqual([]);
    fake.estado.yaExistia = false;
    fake.llamadas.length = 0;
    await db.doc(`tenants/${A}/editoresCrm/otro`).delete();
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('resource-exhausted');
    expect(fake.llamadas.filter((l) => l.op === 'borrar')).toHaveLength(1);
  });

  it('si deshacer el permiso falla, el fallo queda en la auditoría (no se traga)', async () => {
    await sembrarActivos(A, PLANES.crecimiento.editoresCrm - 1);
    const crear = fake.cliente.crearPermiso;
    fake.cliente.crearPermiso = async (...a) => {
      const r = await crear(...a);
      await db.doc(`tenants/${A}/editoresCrm/otro`).set({ correoGoogle: correoDe('otro'), estado: 'activo', permisoId: 'po', archivoId: ARCHIVO_A });
      fake.estado.falloBorrar = true;
      return r;
    };
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('resource-exhausted');
    const aud = (await db.collection(`tenants/${A}/auditoria`).where('accion', '==', 'editor_crm_alta').get()).docs.map((d) => d.data());
    expect(aud.some((x) => x['resultado'] === 'rechazado_permiso_sin_deshacer')).toBe(true);
    expect(await editor(A, 'op1')).toBeUndefined();
  });

  it('NIEGA: si el Gmail ya es propietario de la hoja se rechaza y no queda editor', async () => {
    fake.estado.propietario = true;
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('failed-precondition');
    expect(await editor(A, 'op1')).toBeUndefined();
  });

  it('guarda creadoPorSistema: true si lo creó el sistema, false si adoptó un permiso writer que ya existía', async () => {
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }));
    fake.estado.yaExistia = true;
    await registrar(peticion('op2', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op2')}` }));
    expect((await editor(A, 'op1'))?.['creadoPorSistema']).toBe(true);
    expect((await editor(A, 'op2'))?.['creadoPorSistema']).toBe(false);
  });
});

describe('registrarEditorCrm: el tope sale del plan', () => {
  it('NIEGA el alta que pasa el tope del plan (5 hoy) y no llama a Drive; con uno menos, sí cabe', async () => {
    const tope = PLANES.crecimiento.editoresCrm;
    await sembrarActivos(A, tope);
    const p = () => peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` });
    expect(await codigo(registrar(p()))).toBe('resource-exhausted');
    expect(fake.llamadas).toEqual([]);
    await db.doc(`tenants/${A}/editoresCrm/relleno0`).delete();
    expect(await codigo(registrar(p()))).toBe('sin error');
    expect(await activos(A)).toBe(tope);
  });

  it('cambiar el plan cambia el tope: el callable no lleva el número escrito', async () => {
    const original = PLANES.crecimiento.editoresCrm;
    const mutable = PLANES.crecimiento as { editoresCrm: number };
    try {
      mutable.editoresCrm = 2;
      await sembrarActivos(A, 2);
      const p = () => peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` });
      expect(await codigo(registrar(p()))).toBe('resource-exhausted');
      mutable.editoresCrm = 3;
      expect(await codigo(registrar(p()))).toBe('sin error');
    } finally {
      mutable.editoresCrm = original;
    }
  });

  it('la copia `limites.editoresCrm` de la cuenta manda sobre el plan', async () => {
    await db.doc(`tenants/${A}/cuenta/estado`).set({ plan: 'crecimiento', limites: { editoresCrm: 1 } });
    await sembrarActivos(A, 1);
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('resource-exhausted');
  });

  it('el tope es por comercio: los editores de B no cuentan en A', async () => {
    await sembrarActivos(B, 5);
    expect(await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` })))).toBe('sin error');
  });
});

describe('quitarEditorCrm: la baja', () => {
  async function conEditor(uid: string): Promise<void> {
    await registrar(peticion(uid, 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe(uid)}` }));
    fake.llamadas.length = 0;
  }

  it('el admin quita a otro: se borra el permiso guardado y queda «revocado» (solo con Drive confirmando)', async () => {
    await conEditor('op1');
    const permiso = (await editor(A, 'op1'))?.['permisoId'] as string;
    const r = await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    expect(r).toEqual({ ok: true, estado: 'revocado' });
    expect(fake.llamadas).toEqual([{ op: 'borrar', archivoId: ARCHIVO_A, dato: permiso }]);
    expect((await editor(A, 'op1'))?.['estado']).toBe('revocado');
  });

  it('NIEGA: con Drive caído queda «revocado_pendiente» y nunca se informa «revocado»; el reintento lo cierra', async () => {
    await conEditor('op1');
    fake.estado.falloBorrar = true;
    const r = await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    expect(r).toEqual({ ok: false, estado: 'revocado_pendiente' });
    expect((await editor(A, 'op1'))?.['estado']).toBe('revocado_pendiente');
    const aud = (await db.collection(`tenants/${A}/auditoria`).where('accion', '==', 'editor_crm_baja').get()).docs[0]?.data();
    expect(aud?.['resultado']).toBe('pendiente');
    fake.estado.falloBorrar = false;
    expect(await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }))).toEqual({ ok: true, estado: 'revocado' });
    expect((await editor(A, 'op1'))?.['estado']).toBe('revocado');
  });

  it('NIEGA: un operador no quita a otro; sí puede quitarse a sí mismo', async () => {
    await conEditor('op1');
    await conEditor('op2');
    expect(await codigo(quitar(peticion('op2', 'oper', A, { tenantId: A, uidDestino: 'op1' })))).toBe('permission-denied');
    expect(fake.llamadas).toEqual([]);
    expect((await editor(A, 'op1'))?.['estado']).toBe('activo');
    expect(await quitar(peticion('op2', 'oper', A, { tenantId: A }))).toEqual({ ok: true, estado: 'revocado' });
  });

  it('NIEGA: el admin de B no quita a un editor de A; quien no es editor da «no encontrado»', async () => {
    await conEditor('op1');
    expect(await codigo(quitar(peticion('admb', 'admin', B, { tenantId: A, uidDestino: 'op1' })))).toBe('permission-denied');
    expect(await codigo(quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op2' })))).toBe('not-found');
    expect(fake.llamadas).toEqual([]);
  });

  it('el permiso se borra del archivo guardado al alta, aunque el enlace del comercio haya cambiado después', async () => {
    await conEditor('op1');
    await db.doc(`tenants/${A}/enlaces/minicrm`).set({ enlaceHoja: hoja('hoja-nueva') });
    await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    expect(fake.llamadas[0]?.archivoId).toBe(ARCHIVO_A);
  });

  it('NIEGA: sin cliente de Drive (no configurado) no se dice «revocado»', async () => {
    await conEditor('op1');
    const r = await manejarQuitar({ drive: () => null })(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    expect(r).toEqual({ ok: false, estado: 'revocado_pendiente' });
  });
});

describe('el gancho de quitarUsuario', () => {
  it('revoca al editor de ese comercio y no toca a los demás', async () => {
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }));
    await registrar(peticion('op2', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op2')}` }));
    fake.llamadas.length = 0;
    await revocarEditorAlQuitarUsuario(deps())(A, 'op1', 'adm');
    expect((await editor(A, 'op1'))?.['estado']).toBe('revocado');
    expect((await editor(A, 'op2'))?.['estado']).toBe('activo');
    expect(fake.llamadas).toHaveLength(1);
  });
  it('con Drive caído deja «revocado_pendiente» y NO lanza (quitarUsuario sigue)', async () => {
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }));
    fake.estado.falloBorrar = true;
    await expect(revocarEditorAlQuitarUsuario(deps())(A, 'op1', 'adm')).resolves.toBeUndefined();
    expect((await editor(A, 'op1'))?.['estado']).toBe('revocado_pendiente');
  });
  it('quien nunca fue editor no genera llamadas a Drive', async () => {
    await revocarEditorAlQuitarUsuario(deps())(A, 'op2', 'adm');
    expect(fake.llamadas).toEqual([]);
  });
});

describe('consultarMiEdicionCrm', () => {
  it('quien no es editor: «ninguno» y sin enlace', async () => {
    expect(await consultar(peticion('op1', 'oper', A, { tenantId: A }))).toEqual({ estado: 'ninguno', enlaceHoja: null });
  });
  it('el editor activo recibe el enlace de SU comercio y el correo abreviado', async () => {
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }));
    const r = await consultar(peticion('op1', 'oper', A, { tenantId: A })) as { estado: string; enlaceHoja: string | null; correo: string };
    expect(r.estado).toBe('activo');
    expect(r.enlaceHoja).toBe(hoja('hoja-de-a'));
    expect(r.correo).toBe('o***@example.invalid');
  });
  it('NIEGA: revocado, revocado_pendiente o miniCRM apagado no entregan el enlace', async () => {
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: `ok:${correoDe('op1')}` }));
    await db.doc(`tenants/${A}/config/crm`).set({ activo: false });
    expect((await consultar(peticion('op1', 'oper', A, { tenantId: A })) as { enlaceHoja: unknown }).enlaceHoja).toBeNull();
    await db.doc(`tenants/${A}/config/crm`).delete();
    fake.estado.falloBorrar = true;
    await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    expect(await consultar(peticion('op1', 'oper', A, { tenantId: A }))).toEqual({ estado: 'revocado_pendiente', enlaceHoja: null });
    fake.estado.falloBorrar = false;
    await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    expect(await consultar(peticion('op1', 'oper', A, { tenantId: A }))).toEqual({ estado: 'revocado', enlaceHoja: null });
  });
  it('NIEGA: sin sesión, o con el tenant de otro comercio', async () => {
    expect(await codigo(consultar(sinSesion({ tenantId: A })))).toBe('unauthenticated');
    expect(await codigo(consultar(peticion('opb', 'oper', B, { tenantId: A })))).toBe('permission-denied');
  });
});

describe('ningún secreto en los registros', () => {
  let escrito: string[];
  const espias: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    escrito = [];
    const anotar = (...a: unknown[]) => { escrito.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); return true; };
    espias.push(vi.spyOn(process.stdout, 'write').mockImplementation(anotar as never));
    espias.push(vi.spyOn(process.stderr, 'write').mockImplementation(anotar as never));
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      espias.push(vi.spyOn(console, m).mockImplementation(anotar as never));
      espias.push(vi.spyOn(loggerDeFunctions, m).mockImplementation(anotar as never));
    }
  });
  afterEach(() => { for (const e of espias.splice(0)) e.mockRestore(); });

  it('ni el token, ni el correo completo, ni la clave aparecen aunque Drive falle', async () => {
    const TOKEN = `ok:${correoDe('op1')}`;
    fake.estado.falloCrear = true;
    await codigo(registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: TOKEN })));
    fake.estado.falloCrear = false;
    await registrar(peticion('op1', 'oper', A, { tenantId: A, idTokenGoogle: TOKEN }));
    fake.estado.falloBorrar = true;
    await quitar(peticion('adm', 'admin', A, { tenantId: A, uidDestino: 'op1' }));
    await revocarEditorAlQuitarUsuario(deps())(A, 'op1', 'adm');
    const todo = escrito.join('\n');
    expect(escrito.length, 'control: el espía sí ve los registros del servidor').toBeGreaterThan(0);
    expect(todo).not.toContain(TOKEN);
    expect(todo).not.toContain(correoDe('op1'));
    expect(todo).not.toMatch(/private_key|BEGIN PRIVATE|Bearer /);
    const auditorias = (await db.collection(`tenants/${A}/auditoria`).get()).docs.map((d) => JSON.stringify(d.data())).join('\n');
    expect(auditorias).not.toContain(correoDe('op1'));
    expect(auditorias).not.toContain(TOKEN);
  });
});
