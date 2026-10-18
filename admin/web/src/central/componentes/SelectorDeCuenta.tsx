/**
 * SELECTOR DE CUENTA: se muestra cuando la persona tiene más de una cuenta.
 *
 * RUTA QUE ESPERA (la cablea App.tsx en otro PR; acá no se crea ninguna ruta):
 * cada tarjeta es un `<Link to="/negocio/<id>/inicio">`. La cuenta activa es
 * el `:tenantId` de esa URL y nada más; el servidor juzga cada petición contra
 * los claims firmados.
 *
 * SOLO LEE: un `getDoc(tenants/{id})` por cuenta (las reglas lo permiten a los
 * miembros). No escribe nada. El rol viene del token (cosmético); el nombre y
 * la situación, de la ficha. Si la lectura falla, la cuenta NO se oculta: se
 * muestra con su id y «No se pudo leer esta cuenta».
 *
 * Suspendida: habilitada, con marca. Dada de baja: deshabilitada, con marca.
 */
import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import { useSesion } from '../../core/lib/contexto';
import { cuentasDe, guardarUltima, leerUltima } from '../../core/lib/cuentaActiva';
import { ListaDeCuentas, type CuentaVista, type FichaDeCuenta } from './ListaDeCuentas';

export function SelectorDeCuenta() {
  const { permisos, usuario, refrescar } = useSesion();
  const uid = usuario?.uid ?? '';
  const ids = cuentasDe(permisos);
  const clave = ids.join('|');
  const [fichas, setFichas] = useState<Record<string, FichaDeCuenta>>({});

  useEffect(() => {
    let vivo = true;
    for (const id of clave === '' ? [] : clave.split('|')) {
      getDoc(doc(db, 'tenants', id)).then(
        (d) => vivo && setFichas((f) => ({
          ...f,
          [id]: {
            lectura: 'ok',
            nombre: typeof d.get('nombre') === 'string' ? (d.get('nombre') as string) : null,
            estado: typeof d.get('estado') === 'string' ? (d.get('estado') as string) : null,
          },
        })),
        () => vivo && setFichas((f) => ({ ...f, [id]: { lectura: 'error' } })),
      );
    }
    return () => { vivo = false; };
  }, [clave]);

  const cuentas: CuentaVista[] = ids.map((id) => ({
    id,
    rol: permisos.tenants[id]!,
    ficha: fichas[id] ?? { lectura: 'cargando' },
  }));

  return (
    <section>
      <h2>Elija una cuenta</h2>
      <ListaDeCuentas cuentas={cuentas} ultima={leerUltima(uid, permisos)}
        alElegir={(id) => guardarUltima(uid, id)} />
      <p>
        ¿Falta una cuenta?{' '}
        <button type="button" className="enlace" onClick={() => { void refrescar(); }}>Actualizar permisos</button>
      </p>
    </section>
  );
}
