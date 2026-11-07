/**
 * `almacenFirestore()` REAL contra el emulador: la MISMA batería que corre la copia en memoria
 * (`alerta-almacen-contrato.ts`). Prueba el tope en paralelo, la liberación y el duplicado de verdad, con
 * transacciones de Firestore, no con un doble.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bateriaDelAlmacen, eventoGuardado, AHORA, type Fabrica } from './alerta-almacen-contrato.ts';

process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
const { initializeApp, getApps, deleteApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { almacenFirestore, atenderAlerta } = await import('../../functions/src/plataforma/alertaOperativa.ts');
const app = getApps()[0] ?? initializeApp({ projectId: 'demo-novuchat-pruebas' });
const db = getFirestore(app);

const limpiar = async (): Promise<void> => {
  await db.recursiveDelete(db.collection('plataforma/alertas/eventos'));
  await db.recursiveDelete(db.collection('plataforma/alertas/control'));
};
afterAll(async () => { await limpiar(); await deleteApp(app); });

bateriaDelAlmacen('Firestore real, emulador', async (): Promise<Fabrica> => {
  await limpiar();
  return {
    almacen: almacenFirestore(),
    async contadores(tipo, dia) {
      const d = await db.doc(`plataforma/alertas/control/dia_${dia}`).get();
      const t = await db.doc(`plataforma/alertas/control/tipo_${tipo}`).get();
      return { enviados: Number(d.get('enviados') ?? 0), ultimoMs: t.exists ? Number(t.get('ultimoMs') ?? 0) : null };
    },
  };
});

describe('almacén real: el evento guardado y la configuración', () => {
  beforeAll(limpiar);
  it('el documento del evento queda con el id_unico como id y sin el teléfono ni ningún campo ajeno', async () => {
    const a = almacenFirestore();
    expect(await a.crear(eventoGuardado('evt-real-0001'))).toBe(true);
    const d = await db.doc('plataforma/alertas/eventos/evt-real-0001').get();
    expect(Object.keys(d.data()!).sort()).toEqual([
      'asunto', 'contrato', 'dia', 'enlace', 'estado', 'flujo', 'id_unico', 'nivel', 'nodo', 'ocurrido_en', 'ocurrido_ms',
      'proyecto', 'que_paso', 'que_se_espera_de_andres', 'recibido_ms', 'saneado', 'tipo_error',
    ]);
  });
  it('una llamada sin firma no lee la configuración de plataforma/alertas (no cuesta una lectura)', async () => {
    let lecturas = 0;
    const r = await atenderAlerta(
      { metodo: 'POST', cabecera: () => undefined, crudo: Buffer.from('{}') },
      { secreto: 's', ahoraMs: AHORA, cargar: async () => { lecturas++; throw new Error('no debe llamarse'); } });
    expect(r.status).toBe(401);
    expect(lecturas).toBe(0);
  });
});
