/**
 * LECTURAS EN VIVO QUE COMPARTEN LAS PANTALLAS DE LA CUENTA: los números del
 * comercio con su titularidad y el tipo de cambio del día. Solo lectura, por
 * `onSnapshot`; ninguna escribe nada.
 *
 * `useRutasDelComercio(tenantId, habilitado)` devuelve `undefined` mientras
 * carga, `null` si no se pudo o no se intentó leer, y la lista en cualquier
 * otro caso. HOY `rutasWhatsApp` la abren las reglas SOLO al propietario, así
 * que las pantallas del comercio pasan `habilitado = permisos.propietario`:
 * un administrador ni intenta la consulta (sería un PERMISSION_DENIED seguro
 * en la consola del navegador; revisión de seguridad de #203, LOW 3) y ve
 * «sin información» en vez de una titularidad supuesta. Cuando `central`
 * publique la regla de listado para el administrador del comercio
 * (`allow list: if esPropietario() || (esAdmin(resource.data.tenantId) &&
 * tenantLegible(resource.data.tenantId))`), se quita la condición y nada más.
 */
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { rutaDe, type RutaWhatsApp } from '../../lib/ejes';

export function useRutasDelComercio(tenantId: string, habilitado: boolean): RutaWhatsApp[] | null | undefined {
  const [rutas, setRutas] = useState<RutaWhatsApp[] | null | undefined>(undefined);
  useEffect(() => {
    if (!tenantId) return;
    if (!habilitado) { setRutas(null); return; }
    setRutas(undefined);
    return onSnapshot(
      query(collection(db, 'rutasWhatsApp'), where('tenantId', '==', tenantId)),
      (i) => setRutas(i.docs.map((d) => rutaDe(d.id, d.data()))),
      () => setRutas(null));
  }, [tenantId, habilitado]);
  return rutas;
}

/**
 * EL TIPO DE CAMBIO ES PÚBLICO: es el oficial que publica el BCB, y el comercio
 * tiene derecho a ver con cuál se le cobra. `undefined` mientras carga, `null`
 * si no se pudo leer: sin él no hay cifra en bolivianos, y se dice.
 */
export function useTipoCambio(): unknown {
  const [tipoCambio, setTipoCambio] = useState<unknown>(undefined);
  useEffect(() => onSnapshot(doc(db, 'plataforma', 'tipoCambio'),
    (d) => setTipoCambio(d.data() ?? null),
    () => setTipoCambio(null)), []);
  return tipoCambio;
}
