#!/usr/bin/env node
/**
 * quitar-miembro-visualizacion.mjs — borra del ESPEJO `tenants/<t>/miembros/<uid>` (lo que lista la página Usuarios de la consola) la
 * fila de una persona que YA está en baja. SECO por omisión.
 *
 * POR QUÉ. `asignar-rol.mjs --quitar` quita el rol y cierra sesiones, pero deja la fila con `estado: 'baja'`, y la consola la sigue mostrando
 * (Usuarios.tsx lista todo el espejo). Pedido de Andres (07/11/2026): que un correo deje de verse en la consola de todos los clientes.
 *
 * LO QUE HACE Y LO QUE NO.
 *   · SOLO borra la fila del espejo de los comercios que se nombran en `--tenants`, y solo si la fila está en `baja`, la cuenta NO tiene
 *     ya el rol en ese comercio (claim) y NO es la titular de la cuenta. Si algo no cuadra, ese comercio se salta y se dice por qué.
 *   · NUNCA borra la cuenta de Auth, ni toca claims, ni tokens, ni la colección de auditoría, ni nada de Plataforma.
 *   · `--aplicar` exige `--respaldo` (ruta absoluta FUERA de todo repositorio, carpeta 0700, archivo 0600, no se pisa) con el contenido
 *     de cada fila borrada; `--revertir --respaldo <ruta>` la restituye. El correo de la persona no se imprime nunca.
 *
 *   node scripts/plataforma/quitar-miembro-visualizacion.mjs --proyecto <id> --correo <correo> --tenants a,b,c \
 *        [--aplicar --respaldo <ruta>]
 *   node scripts/plataforma/quitar-miembro-visualizacion.mjs --proyecto <id> --correo <correo> --revertir --respaldo <ruta> [--aplicar]
 * Salida: 0 hecho o seco sin problemas · 1 algún comercio saltado o error · 2 llamada mal hecha.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
export const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Por qué NO se puede borrar la fila de un comercio (o '' si se puede). Puro. */
export function motivoParaSaltar({ miembro, claimRol, titularUid, uid }) {
  if (!miembro) return 'no hay fila de miembro';
  if (miembro.estado !== 'baja') return `la fila no está en baja (estado ${String(miembro.estado)}): dar de baja primero`;
  if (claimRol) return 'la cuenta todavía tiene el rol en el claim: dar de baja primero';
  if (titularUid && titularUid === uid) return 'es la titular de la cuenta: solo NovuChat la cambia';
  return '';
}

/** Valida que el respaldo esté fuera de todo repositorio (no hay .git hacia arriba), carpeta 0700 y archivo nuevo. */
export function comprobarRespaldo(ruta, { existe = existsSync, stat = statSync } = {}) {
  if (!ruta || !isAbsolute(ruta)) return 'el respaldo debe ser una ruta absoluta';
  let d = dirname(ruta);
  for (let i = 0; i < 40; i += 1) {
    if (existe(join(d, '.git'))) return 'el respaldo no puede estar dentro de un repositorio';
    const p = dirname(d);
    if (p === d) break;
    d = p;
  }
  if (existe(ruta)) return 'el respaldo ya existe: no se pisa';
  if (existe(dirname(ruta)) && (stat(dirname(ruta)).mode & 0o077) !== 0) return 'la carpeta del respaldo debe ser 0700';
  return '';
}

/** Núcleo: `io` inyecta la lectura/escritura. Devuelve { filas, saltados, codigo }. */
export async function quitar({ uid, tenants, aplicar, io }) {
  const filas = [];
  const saltados = [];
  for (const t of tenants) {
    const { miembro, claimRol, titularUid } = await io.leer(t);
    const motivo = motivoParaSaltar({ miembro, claimRol, titularUid, uid });
    if (motivo) saltados.push({ tenant: t, motivo }); else filas.push({ tenant: t, datos: miembro });
  }
  if (aplicar && filas.length) {
    await io.respaldar(filas);
    for (const f of filas) await io.borrar(f.tenant);
  }
  return { filas, saltados, codigo: saltados.length ? 1 : 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const a = process.argv.slice(2);
  const arg = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  const proyecto = arg('--proyecto');
  const correo = (arg('--correo') ?? '').trim().toLowerCase();
  const aplicar = a.includes('--aplicar');
  const respaldo = arg('--respaldo');
  const revertir = a.includes('--revertir');
  const tenants = (arg('--tenants') ?? '').split(',').filter(Boolean);
  const mal = [];
  if (!proyecto) mal.push('falta --proyecto');
  if (!CORREO.test(correo)) mal.push('--correo no es un correo');
  if (!revertir && (tenants.length === 0 || !tenants.every((t) => ID_TENANT.test(t)))) mal.push('--tenants: lista de comercios inválida');
  if ((aplicar || revertir) && !respaldo) mal.push('falta --respaldo');
  if (aplicar && !revertir) { const m = comprobarRespaldo(respaldo); if (m) mal.push(m); }
  if (mal.length) { console.error(`  ✗ ${mal.join('\n  ✗ ')}`); process.exit(2); }

  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  initializeApp({ projectId: proyecto });
  const db = getFirestore();
  const u = await getAuth().getUserByEmail(correo).catch(() => null);
  if (!u) { console.error('  ✗ no hay cuenta con ese correo'); process.exit(1); }
  const claimsT = ((u.customClaims ?? {}).nc ?? {}).t ?? {};

  if (revertir) {
    const guardado = JSON.parse(readFileSync(respaldo, 'utf8'));
    if (guardado.uid !== u.uid) { console.error('  ✗ el respaldo no es de esa cuenta'); process.exit(1); }
    for (const f of guardado.filas) {
      if (!ID_TENANT.test(f.tenant)) { console.error('  ✗ comercio inválido en el respaldo'); process.exit(1); }
      console.log(`  ${aplicar ? '✓ restituida' : 'seco: se restituiría'} la fila de ${f.tenant}`);
      if (aplicar) await db.doc(`tenants/${f.tenant}/miembros/${u.uid}`).set(f.datos);
    }
    process.exit(0);
  }

  const res = await quitar({
    uid: u.uid, tenants, aplicar,
    io: {
      leer: async (t) => {
        const ficha = await db.doc(`tenants/${t}`).get();
        if (!ficha.exists) return { miembro: null, claimRol: null, titularUid: null };
        const m = await db.doc(`tenants/${t}/miembros/${u.uid}`).get();
        return { miembro: m.exists ? m.data() : null, claimRol: claimsT[t] ?? null, titularUid: ficha.get('titularCuentaUid') ?? null };
      },
      respaldar: async (filas) => {
        mkdirSync(dirname(respaldo), { recursive: true, mode: 0o700 });
        writeFileSync(respaldo, JSON.stringify({ uid: u.uid, filas: filas.map((f) => ({ tenant: f.tenant, datos: f.datos })) }), { flag: 'wx', mode: 0o600 });
        chmodSync(respaldo, 0o600);
      },
      borrar: async (t) => { await db.doc(`tenants/${t}/miembros/${u.uid}`).delete(); },
    },
  });
  for (const f of res.filas) console.log(`  ${aplicar ? '✓ borrada' : 'seco: se borraría'} la fila de ${f.tenant} (estaba en baja)`);
  for (const s of res.saltados) console.log(`  ✗ ${s.tenant}: ${s.motivo}`);
  if (!aplicar) console.log('  No se escribió nada. Agrega --aplicar --respaldo <ruta>.');
  process.exit(res.codigo);
}
