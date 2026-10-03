import type { ReactNode } from 'react';
import { useSesion } from '../lib/contexto';

/**
 * Pantalla sin salida, CON salida.
 *
 * EL DEFECTO QUE ARREGLA. Había dos estados que dejaban a la persona encerrada:
 * «Tu cuenta todavía no está asociada a ningún negocio» y «Sin permiso». Los dos
 * se pintaban sin cabecera —o sea, sin el botón «Salir»— y sin ningún enlace.
 * La sesión quedaba abierta, así que volver a cargar la página devolvía la misma
 * pantalla, y la única forma real de probar con otra cuenta era borrar los datos
 * del navegador. Con Google es peor todavía: el navegador reusa la sesión y ni
 * siquiera pregunta con qué cuenta entrar.
 *
 * ES EL PRIMER CONTACTO DE CASI TODO EL MUNDO CON EL PANEL. Un usuario invitado
 * que entra antes de que le asignen el negocio, alguien que se equivoca de
 * cuenta entre dos que tiene abiertas, un comercio que prueba con su Gmail
 * personal en vez del que le dimos. Que ESE momento sea un callejón es la peor
 * primera impresión posible, y encima parece que el sistema está roto cuando
 * está funcionando exactamente como debe.
 *
 * Por eso el botón cierra la sesión ADEMÁS de explicar: no alcanza con decir
 * «pruebe con otra cuenta» si no hay forma de hacerlo.
 */
export function SinSalida({
  titulo,
  children,
}: {
  titulo: string;
  children: ReactNode;
}) {
  const { usuario, salir } = useSesion();

  return (
    <section>
      <h2>{titulo}</h2>
      {children}
      {usuario?.email && (
        <p>
          Entraste como <strong>{usuario.email}</strong>.
        </p>
      )}
      <button type="button" onClick={salir}>
        Salir y entrar con otra cuenta
      </button>
    </section>
  );
}
