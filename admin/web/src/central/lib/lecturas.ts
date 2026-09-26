/**
 * LECTURAS EN VIVO QUE COMPARTEN LAS PANTALLAS DE LA CUENTA: los números del
 * comercio con su titularidad y el tipo de cambio del día. Solo lectura, por
 * `onSnapshot`; ninguna escribe nada.
 *
 * `useRutasDelComercio` devuelve `undefined` mientras carga, `null` si la
 * lectura falló (hoy `rutasWhatsApp` la abren las reglas SOLO al propietario:
 * desde la consola del comercio la consulta cae en PERMISSION_DENIED y la
 * pantalla dice «sin información» en vez de suponer una titularidad) y la
 * lista en cualquier otro caso. Que el administrador del comercio pueda ver
 * la titularidad de su número exige una regla o un espejo que escribe
 * `central`; hasta entonces esta consola no inventa el dato.
 */
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { rutaDe, type RutaWhatsApp } from '../../lib/ejes';

export function useRutasDelComercio(tenantId: string): RutaWhatsApp[] | null | undefined {
  const [rutas, setRutas] = useState<RutaWhatsApp[] | null | undefined>(undefined);
  useEffect(() => {
    if (!tenantId) return;
    setRutas(undefined);
    return onSnapshot(
      query(collection(db, 'rutasWhatsApp'), where('tenantId', '==', tenantId)),
      (i) => setRutas(i.docs.map((d) => rutaDe(d.id, d.data()))),
      () => setRutas(null));
  }, [tenantId]);
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
