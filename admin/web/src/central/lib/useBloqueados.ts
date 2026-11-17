import { useEffect, useState } from 'react';
import { collection, getCountFromServer, limit, onSnapshot, query, where, type QueryConstraint } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { filaBloqueada, type FilaBloqueada } from './bloqueo';
import { consultaDeBloqueadas } from './conversaciones';

/** La consulta de `consultaDeBloqueadas()` (un solo campo, sin orden: no pide índice nuevo) bajo `/tenants/{t}/conversaciones`. */
function restriccionesDeBloqueadas(): QueryConstraint[] {
  const c = consultaDeBloqueadas();
  return [...c.restricciones.map((r) => where(r.campo, r.op, r.valor)), ...(c.limite !== undefined ? [limit(c.limite)] : [])];
}

/**
 * LOS CONTACTOS BLOQUEADOS, EN VIVO (solo si `activo`, o sea, el administrador del negocio; lo usa SOLO su pantalla).
 * `null` = todavía no llegó; `'error'` = la lectura falló. Se ordena en el cliente (`ordenarBloqueadas`).
 */
export function useBloqueados(tenantId: string | undefined, activo: boolean): FilaBloqueada[] | 'error' | null {
  const [filas, setFilas] = useState<FilaBloqueada[] | 'error' | null>(null);
  useEffect(() => {
    if (!tenantId || !activo) { setFilas(null); return; }
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'conversaciones'), ...restriccionesDeBloqueadas()),
      (s) => setFilas(s.docs.flatMap((d) => { const f = filaBloqueada(d.id, d.data()); return f ? [f] : []; })),
      () => setFilas('error'),
    );
  }, [tenantId, activo]);
  return filas;
}

/**
 * EL NÚMERO de «Teléfonos bloqueados (N)» del menú: UNA lectura de conteo (agregación, no documentos) cada vez que
 * cambia la pantalla (`clave`), y no un oyente en vivo de hasta 200 documentos en todas las pantallas del administrador.
 * `null` mientras no llega o si falla (el menú muestra la opción sin número; no se inventa un cero).
 */
export function useCantidadBloqueados(tenantId: string | undefined, activo: boolean, clave: string): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!tenantId || !activo) { setN(null); return; }
    let vivo = true;
    getCountFromServer(query(collection(db, 'tenants', tenantId, 'conversaciones'), where('bloqueada', '==', true)))
      .then((r) => { if (vivo) setN(r.data().count); })
      .catch(() => { if (vivo) setN(null); });
    return () => { vivo = false; };
  }, [tenantId, activo, clave]);
  return n;
}
