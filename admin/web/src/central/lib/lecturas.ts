/**
 * LECTURAS QUE COMPARTEN LAS PANTALLAS DE LA CUENTA: los ejes de la cuenta y
 * el tipo de cambio del día. Ninguna escribe nada.
 *
 * LOS EJES SE PIDEN AL SERVIDOR (`ejesDeCuenta`, admin del comercio o
 * propietario). Es el único camino por el que el comercio ve la titularidad
 * de sus números: `rutasWhatsApp` es solo del propietario en
 * `firestore.rules`, porque el documento trae el alias del secreto, la WABA y
 * quién lo asignó; la callable devuelve solo lo que la pantalla pinta. El
 * contador de cambios y el modelo vienen ya calculados: la consola no hace
 * aritmética propia.
 *
 * `useEjesDeCuenta` devuelve `ejes: undefined` mientras carga, `null` si falló
 * (con `error`, el mensaje del servidor tal cual) y la respuesta si llegó.
 * `recargar()` vuelve a pedirla: la página del propietario lo llama después de
 * cada cambio que confirma el servidor.
 */
import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, funciones } from '../../lib/firebase';
import { CALLABLES, type EjesDeCuenta } from '../../lib/ejes';
import { mensajeDeError } from '../../lib/errores';

export interface LecturaDeEjes {
  ejes: EjesDeCuenta | null | undefined;
  error: string | null;
  recargar: () => void;
}

export function useEjesDeCuenta(tenantId: string): LecturaDeEjes {
  const [ejes, setEjes] = useState<EjesDeCuenta | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0);
  const recargar = useCallback(() => setVuelta((v) => v + 1), []);

  useEffect(() => {
    if (!tenantId) return;
    let vigente = true;
    httpsCallable<{ tenantId: string }, EjesDeCuenta>(funciones, CALLABLES.leerEjes)({ tenantId })
      .then((r) => { if (vigente) { setEjes(r.data); setError(null); } })
      .catch((e) => { if (vigente) { setEjes(null); setError(mensajeDeError(e, 'No se pudieron leer los ejes de la cuenta.')); } });
    return () => { vigente = false; };
  }, [tenantId, vuelta]);

  return { ejes, error, recargar };
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
