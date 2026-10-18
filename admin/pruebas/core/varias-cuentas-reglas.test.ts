/**
 * VARIAS CUENTAS, REGLAS REALES: «Antonio no ve las cuentas de Rubén y viceversa».
 *
 * Plan del selector de cuentas, §5 y adenda 1 (opción A): la cuenta activa es el
 * `:tenantId` de la URL y el servidor decide en CADA petición con los claims
 * firmados. Entonces lo que se prueba acá es que tener varias cuentas en el
 * token NO mezcla nada: cada cuenta se decide por separado y nadie hereda de otro.
 *
 * Caso real (18/09 → 18/10): el cliente de cuatro tenants son DOS DUEÑOS. Rubén
 * (r1, r2) y Antonio (a1, a2) no se cruzan. El «manager» con membresía en las
 * cuatro es una hipótesis sin confirmar: ve las cuatro y NADA más.
 *
 * Emulador de Firestore con `firestore.rules` tal cual; no se cambia ninguna regla.
 * Los correos y ids son ficticios.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, getDocs, collection, deleteDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const R1 = 'r1', R2 = 'r2', A1 = 'a1', A2 = 'a2', C1 = 'c1';
const TODOS = [R1, R2, A1, A2, C1];

let entorno: RulesTestEnvironment;

const claims = (
  tenants: Record<string, string>, propietario = false,
  proveedor = 'password', correoVerificado = true,
) => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: correoVerificado,
});
const como = (uid: string, c: ReturnType<typeof claims>) =>
  entorno.authenticatedContext(uid, c).firestore();

const ruben = () => como('u-ruben', claims({ [R1]: 'admin', [R2]: 'admin' }));
const antonio = () => como('u-antonio', claims({ [A1]: 'admin', [A2]: 'admin' }));
const manager = () => como('u-manager', claims({ [R1]: 'admin', [R2]: 'admin', [A1]: 'admin', [A2]: 'admin' }));
const oper = () => como('u-oper', claims({ [R1]: 'oper', [A1]: 'admin' }));
const rubenMixto = () => como('u-ruben', claims({ [R1]: 'admin', [R2]: 'oper' }));

type Fs = ReturnType<typeof ruben>;

const configValida = (uid: string) => ({
  nombreNegocio: 'Cuenta Demo', descripcion: 'Demo', zonaHoraria: 'America/La_Paz',
  numeroRecepcion: '59170000000', direccion: 'Av. Siempre Viva 100, zona Sur',
  tratamiento: 'usted', estiloEmojis: 'pocos',
  politicaCancelacion: 'Cancelar con 24 horas de anticipacion.',
  datosQueNoTenemos: ['estacionamiento'], prefijosPermitidos: ['591'],
  mensajeCierre: 'Gracias por escribirnos.',
  mensajeErrorTemporal: 'Tuvimos un problema, intente en un momento.',
  mensajeReservaNoConfirmada: 'No pude confirmar la reserva, le escribe recepcion.',
  mensajeComercioSuspendido: 'Por el momento no atendemos por este medio.',
  moneda: 'BOB', horarios: { lun: '09:00-19:00' }, mensajes: { bienvenida: 'Hola' },
  instruccionesExtra: 'Ninguna.', actualizadoPor: uid, actualizadoEn: serverTimestamp(),
});

/** Todo lo que se prueba leer de una cuenta ajena. */
const lecturas = (t: string): string[] => [
  `tenants/${t}`,
  `tenants/${t}/config/negocio`,
  `tenants/${t}/conversaciones/c1`,
  `tenants/${t}/conversaciones/c1/mensajes/m1`,
  `tenants/${t}/cuenta/estado`,
  `tenants/${t}/invitaciones/i1`,
  `tenants/${t}/miembros/u-seed`,
  `tenants/${t}/auditoria/e1`,
];
const colecciones = (t: string): string[] => [
  `tenants/${t}/conversaciones`, `tenants/${t}/invitaciones`,
  `tenants/${t}/miembros`, `tenants/${t}/auditoria`,
];

async function leeTodo(fs: Fs, t: string) {
  for (const r of lecturas(t)) await assertSucceeds(getDoc(doc(fs, r)));
}
async function noLeeNada(fs: Fs, t: string) {
  for (const r of lecturas(t)) await assertFails(getDoc(doc(fs, r)));
  for (const c of colecciones(t)) await assertFails(getDocs(collection(fs, c)));
}
async function noEscribeNada(fs: Fs, t: string, uid: string) {
  await assertFails(setDoc(doc(fs, `tenants/${t}/config/negocio`), configValida(uid)));
  await assertFails(setDoc(doc(fs, `tenants/${t}/conversaciones/c1`), { ultimoMensaje: 'x' }));
  await assertFails(setDoc(doc(fs, `tenants/${t}/cuenta/estado`), { plan: 'pro' }));
  await assertFails(setDoc(doc(fs, `tenants/${t}/invitaciones/i9`), { hashToken: 'x', rol: 'admin' }));
  await assertFails(setDoc(doc(fs, `tenants/${t}/miembros/${uid}`), { rol: 'admin' }));
  await assertFails(setDoc(doc(fs, `tenants/${t}/auditoria/e9`), { accion: 'borrar' }));
  await assertFails(setDoc(doc(fs, `tenants/${t}`), { nombre: 'mio', estado: 'activo' }));
  await assertFails(deleteDoc(doc(fs, `tenants/${t}/auditoria/e1`)));
  await assertFails(deleteDoc(doc(fs, `tenants/${t}/conversaciones/c1`)));
}

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8231),
    },
  });
});
afterAll(async () => { await entorno?.cleanup(); });

beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const t of TODOS) {
      await setDoc(doc(db, 'tenants', t), { nombre: t, estado: 'activo', plan: 'basico', vertical: 'agendamiento' });
      await setDoc(doc(db, `tenants/${t}/config/negocio`), {
        nombreNegocio: t, direccion: 'Calle Falsa 100', tratamiento: 'usted', estiloEmojis: 'pocos',
        actualizadoPor: 'seed', actualizadoEn: Timestamp.now(),
      });
      await setDoc(doc(db, `tenants/${t}/conversaciones/c1`), {
        telefono: '59170000001', ultimoMensaje: 'Hola', canal: 'whatsapp',
        ultimoEn: Timestamp.now(), mensajesTotal: 2,
      });
      await setDoc(doc(db, `tenants/${t}/conversaciones/c1/mensajes/m1`), {
        direccion: 'entrante', tipo: 'text', texto: 'Hola', ts: Timestamp.now(),
      });
      await setDoc(doc(db, `tenants/${t}/cuenta/estado`), {
        plan: 'basico', estadoPago: 'al_dia', montoMensual: 350, moneda: 'BOB', motivoVisible: '',
      });
      await setDoc(doc(db, `tenants/${t}/invitaciones/i1`), { hashToken: 'x', rol: 'oper' });
      await setDoc(doc(db, `tenants/${t}/miembros/u-seed`), { rol: 'admin' });
      await setDoc(doc(db, `tenants/${t}/auditoria/e1`), { accion: 'alta' });
    }
  });
});

describe('control positivo: cada persona entra a SUS cuentas', () => {
  it('Rubén lee r1 y r2', async () => {
    await leeTodo(ruben(), R1);
    await leeTodo(ruben(), R2);
  });
  it('Antonio lee a1 y a2', async () => {
    await leeTodo(antonio(), A1);
    await leeTodo(antonio(), A2);
  });
  it('el administrador escribe la configuración de SU cuenta (la regla sí deja; la negativa no es por forma)', async () => {
    await assertSucceeds(setDoc(doc(ruben(), `tenants/${R1}/config/negocio`), configValida('u-ruben')));
    await assertSucceeds(setDoc(doc(antonio(), `tenants/${A2}/config/negocio`), configValida('u-antonio')));
  });
});

describe('Antonio no ve las cuentas de Rubén y viceversa', () => {
  for (const t of [R1, R2]) {
    it(`Antonio NO lee nada de ${t}`, async () => { await noLeeNada(antonio(), t); });
    it(`Antonio NO escribe nada en ${t}`, async () => { await noEscribeNada(antonio(), t, 'u-antonio'); });
  }
  for (const t of [A1, A2]) {
    it(`Rubén NO lee nada de ${t}`, async () => { await noLeeNada(ruben(), t); });
    it(`Rubén NO escribe nada en ${t}`, async () => { await noEscribeNada(ruben(), t, 'u-ruben'); });
  }
  it('ninguno de los dos enumera la cartera (list de tenants)', async () => {
    await assertFails(getDocs(collection(ruben(), 'tenants')));
    await assertFails(getDocs(collection(antonio(), 'tenants')));
  });
  it('un solo token con las cuentas de uno no abre la puerta de las del otro, aunque comparta prefijo de id', async () => {
    const solo = como('u-x', claims({ [R1]: 'admin' }));
    await noLeeNada(solo, 'r10');
    await noLeeNada(solo, 'R1');
  });
});

describe('el rol se decide por cuenta, no por persona', () => {
  it('Rubén admin en r1 y oper en r2: en r2 no tiene poderes de admin', async () => {
    await assertSucceeds(setDoc(doc(rubenMixto(), `tenants/${R1}/config/negocio`), configValida('u-ruben')));
    await assertFails(setDoc(doc(rubenMixto(), `tenants/${R2}/config/negocio`), configValida('u-ruben')));
    await assertFails(getDoc(doc(rubenMixto(), `tenants/${R2}/invitaciones/i1`)));
    await assertFails(getDocs(collection(rubenMixto(), `tenants/${R2}/invitaciones`)));
    await assertFails(getDoc(doc(rubenMixto(), `tenants/${R2}/auditoria/e1`)));
    // lo de un operador sí: leer conversaciones
    await assertSucceeds(getDoc(doc(rubenMixto(), `tenants/${R2}/conversaciones/c1`)));
    // y en r1, admin completo
    await assertSucceeds(getDoc(doc(rubenMixto(), `tenants/${R1}/invitaciones/i1`)));
  });
  it('oper en r1 y admin en a1: cada rol vale solo en su cuenta', async () => {
    await assertFails(getDoc(doc(oper(), `tenants/${R1}/invitaciones/i1`)));
    await assertFails(setDoc(doc(oper(), `tenants/${R1}/config/negocio`), configValida('u-oper')));
    await assertSucceeds(getDoc(doc(oper(), `tenants/${R1}/conversaciones/c1`)));
    await assertSucceeds(getDoc(doc(oper(), `tenants/${A1}/invitaciones/i1`)));
    await assertSucceeds(setDoc(doc(oper(), `tenants/${A1}/config/negocio`), configValida('u-oper')));
    // ni r2 ni a2: no está
    await noLeeNada(oper(), R2);
    await noLeeNada(oper(), A2);
  });
});

describe('el manager con las cuatro cuentas (hipótesis sin confirmar)', () => {
  it('ve las cuatro, cada una por su claim', async () => {
    for (const t of [R1, R2, A1, A2]) await leeTodo(manager(), t);
  });
  it('NO obtiene acceso a un quinto tenant (c1) ni lista tenants', async () => {
    await noLeeNada(manager(), C1);
    await noEscribeNada(manager(), C1, 'u-manager');
    await assertFails(getDocs(collection(manager(), 'tenants')));
  });
  it('que el manager vea las cuatro no da acceso a Rubén ni a Antonio a nada nuevo', async () => {
    await noLeeNada(ruben(), A1);
    await noLeeNada(antonio(), R1);
  });
});

describe('las condiciones de sesión valen en TODAS las cuentas', () => {
  const cuatro = { [R1]: 'admin', [R2]: 'admin', [A1]: 'admin', [A2]: 'admin' };
  it('sin correo verificado: nada, en ninguna', async () => {
    const fs = como('u-sv', claims(cuatro, false, 'password', false));
    for (const t of [R1, R2, A1, A2]) await noLeeNada(fs, t);
  });
  it('con sesión de Google (proveedor equivocado): nada, en ninguna', async () => {
    const fs = como('u-g', claims(cuatro, false, 'google.com'));
    for (const t of [R1, R2, A1, A2]) await noLeeNada(fs, t);
  });
  it('un claim de ingesta sobre contraseña no autoriza a una persona', async () => {
    const fs = como('u-colado', claims({ [R1]: 'ingesta' }, false, 'password'));
    await assertFails(setDoc(doc(fs, `tenants/${R1}/conversaciones/c9`), {
      telefono: '59170000009', ultimoMensaje: 'x', canal: 'whatsapp', ultimoEn: Timestamp.now(), mensajesTotal: 1,
    }));
    await assertFails(getDoc(doc(fs, `tenants/${R1}/invitaciones/i1`)));
    await assertFails(getDoc(doc(fs, `tenants/${R1}/auditoria/e1`)));
  });
  it('sin sesión: nada', async () => {
    const fs = entorno.unauthenticatedContext().firestore();
    for (const t of TODOS) await noLeeNada(fs, t);
  });
});

describe('la membresía sembrada no otorga: manda el claim firmado', () => {
  it('una ficha miembros en a1 para Rubén, SIN claim, no le da acceso', async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `tenants/${A1}/miembros/u-ruben`), { rol: 'admin' });
    });
    await noLeeNada(ruben(), A1);
    await noEscribeNada(ruben(), A1, 'u-ruben');
  });
});
