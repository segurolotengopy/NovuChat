/**
 * AUDITORÍA DE SOLO LECTURA de los enlaces de cada comercio (10/11/2026): ¿quién tiene guardado el enlace del miniCRM
 * y los de manual (operador y administrador)? Imprime SOLO sí/no por comercio, nunca un enlace. No escribe nada.
 *
 *   node scripts/plataforma/auditar-enlaces.mjs --proyecto <id>
 *
 * Misma salvaguarda de proyecto que `crm-enlace.mjs` (lista blanca por variables de entorno). Costo: 1 lectura de la
 * colección de comercios (solo ids) + hasta 4 lecturas por comercio. 0 mensajes por conversación.
 */
import { comprobarProyecto } from './aplicar-consola-oculta.mjs';
import { esEnlaceDeHoja, esEnlaceDeManual } from '../../functions/src/central/enlace-minicrm.ts';

const DOCS = [['minicrm', esEnlaceDeHoja], ['manual-operador', esEnlaceDeManual], ['manual-admin', esEnlaceDeManual]];

export async function auditar(db, log = console.log) {
  const refs = await db.collection('tenants').listDocuments();
  const filas = [];
  for (const r of refs.sort((a, b) => a.id.localeCompare(b.id))) {
    const [ficha, crm, ...enl] = await db.getAll(
      r, r.collection('config').doc('crm'),
      ...DOCS.map(([n]) => r.collection('enlaces').doc(n)), { fieldMask: ['estado', 'activo', 'enlaceHoja', 'enlace'] });
    const fila = { id: r.id, estado: ficha.exists ? String(ficha.get('estado') ?? '?') : 'sin ficha',
      crm: crm.exists ? (crm.get('activo') === false ? 'APAGADO' : 'encendido') : 'ausente(=encendido)' };
    DOCS.forEach(([n, ok], i) => {
      const campo = n === 'minicrm' ? 'enlaceHoja' : 'enlace';
      const v = enl[i].exists ? enl[i].get(campo) : undefined;
      fila[n] = !enl[i].exists ? 'FALTA' : ok(v) ? 'ok' : 'INVALIDO';
    });
    filas.push(fila);
  }
  log('comercio | estado | miniCRM | enlace minicrm | manual operador | manual admin');
  for (const f of filas) log(`${f.id} | ${f.estado} | ${f.crm} | ${f.minicrm} | ${f['manual-operador']} | ${f['manual-admin']}`);
  return filas;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const i = process.argv.indexOf('--proyecto');
  const proyecto = i > 0 ? process.argv[i + 1] : undefined;
  const p = comprobarProyecto(proyecto);
  if (!p.ok) { console.error(`✗ ${p.motivo}`); process.exit(2); }
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  initializeApp({ projectId: proyecto });
  const db = getFirestore();
  await auditar(db);
  await db.terminate().catch(() => {});
  process.exit(0);
}
