import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { filaBloqueada, type FilaBloqueada } from './bloqueo';
import { LIMITE_BLOQUEADAS } from './conversaciones';

/**
 * LOS CONTACTOS BLOQUEADOS, EN VIVO (solo si `activo`, o sea, el administrador del negocio).
 * `null` = todavía no llegó; `'error'` = la lectura falló. La consulta es la de `consultaDeBloqueadas()`:
 * un solo campo, sin orden (no pide índice nuevo); se ordena en el cliente (`ordenarBloqueadas`).
 *
 * La usan dos lugares: la opción «Teléfonos bloqueados (N)» del menú lateral (el número) y su pantalla (la lista).
 */
export function useBloqueados(tenantId: string | undefined, activo: boolean): FilaBloqueada[] | 'error' | null {
  const [filas, setFilas] = useState<FilaBloqueada[] | 'error' | null>(null);
  useEffect(() => {
    if (!tenantId || !activo) { setFilas(null); return; }
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'conversaciones'), where('bloqueada', '==', true), limit(LIMITE_BLOQUEADAS)),
      (s) => setFilas(s.docs.flatMap((d) => { const f = filaBloqueada(d.id, d.data()); return f ? [f] : []; })),
      () => setFilas('error'),
    );
  }, [tenantId, activo]);
  return filas;
}
