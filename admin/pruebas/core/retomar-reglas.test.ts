/**
 * Plan «Retomar» (R1): LAS REGLAS DE FIRESTORE CIERRAN LO QUE ESCRIBE SOLO EL SERVIDOR, ESCRITO NEGANDO
 *
 * `personaPuedeRetomar` (ficha), `ultimaRetomadaEn` y `turno.retomadoEn` (conversación) y el mensaje de plantilla los escribe
 * SOLO `retomarConversacion` con el SDK Admin. Ni el administrador, ni el operador, ni el soporte, ni otro comercio, ni el
 * token de ingesta los crean o cambian. Control positivo: una conversación YA retomada sigue pudiendo actualizarla la
 * ingesta en otros campos (si no, la regla del turno la dejaría negada y el comercio mudo).
 * Emulador: `FIRESTORE_EMULATOR_PORT` (8231 por defecto).
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'tenant-a-salon';
const B = 'tenant-b-restaurante';
let entorno: RulesTestEnvironment;

const claims = (t: Record<string, string>, p = false, proveedor = 'password') => ({
  nc: { t, ...(p ? { p: true } : {}), v: 1 }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true,
});
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const propietario = () => entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com')).firestore();
const ingestaA = () => entorno.authenticatedContext('svc-a', claims({ [A]: 'ingesta' }, false, 'custom')).firestore();

const C1 = `tenants/${A}/conversaciones/c1`;
const turnoRetomado = () => ({
  responde: 'persona', tomadoPor: 'u-oper-a', tomadoEn: Timestamp.now(), actividadPersonaEn: Timestamp.now(), retomadoEn: Timestamp.now(),
});

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: { rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'), host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8231) },
  });
});
afterAll(async () => { await entorno?.cleanup(); });
beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const t of [A, B]) await setDoc(doc(db, 'tenants', t), { nombre: t, estado: 'activo', plan: 'basico' });
    await setDoc(doc(db, C1), { telefono: '59170000001', ultimoMensaje: 'Hola', canal: 'whatsapp', ultimoEn: Timestamp.now(), mensajesTotal: 2 });
  });
});
const sembrarRetomada = () => entorno.withSecurityRulesDisabled(async (ctx) => {
  await updateDoc(doc(ctx.firestore(), C1), { ultimaRetomadaEn: Timestamp.now(), turno: turnoRetomado() });
});

describe('Retomar: lo que solo escribe el servidor', () => {
  it('NEGATIVA: nadie del navegador escribe `personaPuedeRetomar` (ni el admin, ni el operador, ni el soporte, ni otro comercio)', async () => {
    for (const valor of [true, false, 'true', 1]) {
      for (const cliente of [adminA, operA, propietario, adminB]) {
        await assertFails(updateDoc(doc(cliente(), 'tenants', A), { personaPuedeRetomar: valor }));
      }
    }
    await assertFails(setDoc(doc(adminA(), 'tenants', A), { personaPuedeRetomar: true }, { merge: true }));
  });

  it('NEGATIVA: la persona no escribe `ultimaRetomadaEn` ni `turno.retomadoEn`, solos ni mezclados con un campo permitido', async () => {
    const campos: Record<string, unknown> = {
      ultimaRetomadaEn: Timestamp.now(), 'turno.retomadoEn': Timestamp.now(), turno: turnoRetomado(),
    };
    for (const [campo, valor] of Object.entries(campos)) {
      for (const cliente of [adminA, operA, adminB, propietario]) {
        await assertFails(updateDoc(doc(cliente(), C1), { [campo]: valor }));
        await assertFails(updateDoc(doc(cliente(), C1), { [campo]: valor, notaInterna: 'x' }));
      }
    }
    await sembrarRetomada();
    for (const cliente of [adminA, operA]) {
      await assertFails(updateDoc(doc(cliente(), C1), { ultimaRetomadaEn: deleteField() }));
      await assertFails(updateDoc(doc(cliente(), C1), { 'turno.retomadoEn': deleteField() }));
    }
  });

  it('NEGATIVA: la persona no crea un mensaje de plantilla ni edita su estado', async () => {
    const plantilla = {
      direccion: 'saliente', tipo: 'plantilla', texto: '', ts: Timestamp.now(), autor: 'persona', autorUid: 'u-oper-a',
      estadoEnvio: 'pendiente', tenantId: A, plantilla: { nombre: 'retomar_consulta', idioma: 'es', parametros: ['x'] },
    };
    for (const cliente of [adminA, operA, adminB]) await assertFails(setDoc(doc(cliente(), `${C1}/mensajes/clave-de-retomar-0001`), plantilla));
    await entorno.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), `${C1}/mensajes/clave-de-retomar-0001`), plantilla); });
    await assertFails(updateDoc(doc(adminA(), `${C1}/mensajes/clave-de-retomar-0001`), { estadoEnvio: 'aceptado' }));
  });

  it('NEGATIVA: el token de ingesta no crea una conversación con `ultimaRetomadaEn`, ni la agrega, ni la cambia, ni toca `turno.retomadoEn`', async () => {
    await assertFails(setDoc(doc(ingestaA(), `tenants/${A}/conversaciones/c2`), {
      telefono: '59170000002', ultimoMensaje: 'Hola', canal: 'whatsapp', ultimoEn: Timestamp.now(), mensajesTotal: 1, ultimaRetomadaEn: Timestamp.now(),
    }));
    await assertFails(updateDoc(doc(ingestaA(), C1), { ultimaRetomadaEn: Timestamp.now() }));
    await sembrarRetomada();
    await assertFails(updateDoc(doc(ingestaA(), C1), { ultimaRetomadaEn: Timestamp.fromMillis(1) }));
    await assertFails(updateDoc(doc(ingestaA(), C1), { 'turno.retomadoEn': Timestamp.fromMillis(1) }));
    await assertFails(updateDoc(doc(ingestaA(), C1), { 'turno.retomadoEn': deleteField() }));
  });

  it('NEGATIVA: `plantillasPersona` (métrica) la suma solo el servidor: ni la persona, ni otro comercio, ni la propia ingesta la crean o la cambian', async () => {
    const m = `tenants/${A}/metricas/2026-11`;
    for (const cliente of [adminA, operA, adminB, propietario]) await assertFails(setDoc(doc(cliente(), m), { plantillasPersona: 1 }, { merge: true }));
    await assertFails(setDoc(doc(ingestaA(), m), { plantillasPersona: 1 }));                       // crear
    await assertFails(setDoc(doc(ingestaA(), m), { mensajesPersona: 0, plantillasPersona: 1 }));
    await entorno.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), m), { plantillasPersona: 1 }); });
    await assertFails(updateDoc(doc(ingestaA(), m), { plantillasPersona: 99 }));                   // cambiar
    await assertFails(updateDoc(doc(ingestaA(), m), { plantillasPersona: deleteField() }));
    await assertSucceeds(setDoc(doc(ingestaA(), `tenants/${A}/metricas/2026-12`), { atenciones: 1 })); // control: la ingesta sigue escribiendo lo suyo
  });

  it('POSITIVA: una conversación ya retomada la sigue actualizando la ingesta en sus campos de siempre (no queda negada)', async () => {
    await sembrarRetomada();
    await assertSucceeds(updateDoc(doc(ingestaA(), C1), { ultimoMensaje: 'Respuesta del cliente', ultimoEn: Timestamp.now(), mensajesTotal: 3 }));
  });
});
