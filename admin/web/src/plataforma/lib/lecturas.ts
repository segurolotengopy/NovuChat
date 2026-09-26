/**
 * LECTURAS EN VIVO DE PLATAFORMA. Solo el propietario las puede hacer (las
 * reglas abren `plataforma/*` a él y a nadie más); ninguna escribe nada.
 */
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';

/**
 * LA COMPUERTA GLOBAL DEL CORTE (`plataforma/prepago`, `DISENO.md`
 * §4undecies.4). `undefined` mientras carga, `null` si no existe o no se
 * pudo leer (= apagada, como la trata el servidor), el documento si existe.
 */
export function useCompuertaDelCorte(): Record<string, unknown> | null | undefined {
  const [compuerta, setCompuerta] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => onSnapshot(doc(db, 'plataforma', 'prepago'),
    (d) => setCompuerta(d.data() ?? null),
    () => setCompuerta(null)), []);
  return compuerta;
}
