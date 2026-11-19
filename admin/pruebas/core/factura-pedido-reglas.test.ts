/**
 * REGLAS DE `conversaciones/{c}.ultimoPedido` (PR-F): la factura del último pedido solo la escribe el servidor.
 *
 * Se escribe NEGANDO: ni el token de ingesta por SDK cliente, ni el administrador del comercio, ni un operador, ni
 * otro comercio, ni un anónimo pueden crear, cambiar o borrar `ultimoPedido` (falsificar 'dada' o un código ajeno).
 * Control positivo: una conversación que YA lo tiene sigue aceptando el resumen de la ingesta y la gestión de la
 * persona del negocio, y el propio comercio la lee como siempre.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'factura-reglas-a';
const B = 'factura-reglas-b';
const CON = `tenants/${A}/conversaciones/wa_59100000091`;
const NUEVA = `tenants/${A}/conversaciones/wa_59100000092`;
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>, proveedor = 'password') => ({
  nc: { t: tenants, v: 1 }, firebase: { sign_in_provider: proveedor, identities: {} }, email_verified: true,
});
const ingestaA = () => entorno.authenticatedContext('svc-a', claims({ [A]: 'ingesta' }, 'custom')).firestore();
const ingestaB = () => entorno.authenticatedContext('svc-b', claims({ [B]: 'ingesta' }, 'custom')).firestore();
const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const adminB = () => entorno.authenticatedContext('u-admin-b', claims({ [B]: 'admin' })).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

const PEDIDO = { codigo: 'WAL-261119-001', cierreId: 'venta_x', factura: 'pedida', desdeMs: 1, venceMs: 2 };
const base = () => ({ telefono: '59100000092', ultimoMensaje: 'Hola', canal: 'whatsapp', ultimoEn: Timestamp.now(), mensajesTotal: 1 });

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231),
    },
  });
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const fs = ctx.firestore();
    for (const t of [A, B]) {
      await setDoc(doc(fs, 'tenants', t), { nombre: t, estado: 'activo', plan: 'crecimiento', flujos: ['venta'] });
      await setDoc(doc(fs, `tenants/${t}/cuenta/estado`), { plan: 'crecimiento' });
    }
    await setDoc(doc(fs, CON), { ...base(), telefono: '59100000091', ultimoPedido: PEDIDO });
  });
});
afterAll(async () => { await entorno.cleanup(); });

describe('ultimoPedido: nadie lo escribe desde un SDK cliente', () => {
  it('la ingesta por SDK cliente no lo crea (control positivo: sin él, sí)', async () => {
    await assertFails(setDoc(doc(ingestaA(), NUEVA), { ...base(), ultimoPedido: PEDIDO }));
    await assertSucceeds(setDoc(doc(ingestaA(), NUEVA), base()));
    await assertFails(updateDoc(doc(ingestaA(), NUEVA), { ultimoPedido: PEDIDO }));
  });

  it('ni la ingesta, ni el administrador, ni el operador lo cambian o lo borran', async () => {
    for (const fs of [ingestaA(), adminA(), operA()]) {
      await assertFails(updateDoc(doc(fs, CON), { 'ultimoPedido.factura': 'dada' }));
      await assertFails(updateDoc(doc(fs, CON), { ultimoPedido: { ...PEDIDO, codigo: 'WAL-261119-099' } }));
      await assertFails(updateDoc(doc(fs, CON), { ultimoPedido: deleteField() }));
    }
  });

  it('otro comercio y un anónimo tampoco', async () => {
    for (const fs of [ingestaB(), adminB(), anonimo()]) {
      await assertFails(updateDoc(doc(fs, CON), { 'ultimoPedido.factura': 'dada' }));
      await assertFails(setDoc(doc(fs, `tenants/${A}/conversaciones/wa_59100000093`), { ...base(), ultimoPedido: PEDIDO }));
    }
  });

  it('control positivo: con ultimoPedido escrito, la ingesta y la persona siguen operando, y el comercio lo lee', async () => {
    await assertSucceeds(updateDoc(doc(ingestaA(), CON), { ultimoMensaje: 'Otro', mensajesTotal: 2 }));
    await assertSucceeds(updateDoc(doc(adminA(), CON), { notaInterna: 'nota' }));
    await assertSucceeds(getDoc(doc(adminA(), CON)));
    await assertSucceeds(getDoc(doc(operA(), CON)));
    await assertFails(getDoc(doc(adminB(), CON)));
    await assertFails(getDoc(doc(anonimo(), CON)));
  });
});
