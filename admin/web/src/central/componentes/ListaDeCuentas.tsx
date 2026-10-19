/**
 * LISTA DE TARJETAS DEL SELECTOR: pura (sin Firestore ni sesión), para poder
 * probarla en render estático. La arma `SelectorDeCuenta`.
 * Ruta que espera cada tarjeta: `/negocio/<id>/inicio` (la cablea App.tsx).
 */
import { Link } from 'react-router-dom';
import type { Rol } from '../../core/lib/sesion';
import { TextoSeguro } from './TextoSeguro';

export type FichaDeCuenta =
  | { lectura: 'cargando' }
  | { lectura: 'error' }
  | { lectura: 'ok'; nombre: string | null; estado: string | null };

export interface CuentaVista {
  id: string;
  rol: Rol;
  ficha: FichaDeCuenta;
}

const ROL: Record<string, string> = { admin: 'Administrador', oper: 'Operador' };

/** La lista de tarjetas, pura (sin Firestore): lo que se prueba y lo que se pinta. */
export function ListaDeCuentas({ cuentas, ultima, alElegir }: {
  cuentas: CuentaVista[];
  ultima: string | null;
  alElegir?: (id: string) => void;
}) {
  const ordenadas = [...cuentas].sort((a, b) => Number(b.id === ultima) - Number(a.id === ultima));
  return (
    <ul style={{ listStyle: 'none', padding: 0 }}>
      {ordenadas.map((c) => {
        const esUltima = c.id === ultima;
        const ficha = c.ficha;
        const baja = ficha.lectura === 'ok' && ficha.estado === 'dado_de_baja';
        const suspendida = ficha.lectura === 'ok' && ficha.estado === 'suspendido';
        const nombre = ficha.lectura === 'ok' && ficha.nombre ? ficha.nombre : c.id;
        const cuerpo = (
          <>
            <strong><TextoSeguro valor={nombre} maxLargo={80} /></strong>
            <span className="text-muted"> · {ROL[c.rol] ?? c.rol}</span>
            {esUltima && <span className="situacion ok"> Última usada</span>}
            {suspendida && <span className="situacion alerta"> Suspendida</span>}
            {baja && <span className="situacion alerta"> Dada de baja</span>}
            {ficha.lectura === 'error' && <span className="situacion alerta"> No se pudo leer esta cuenta</span>}
            {ficha.lectura === 'cargando' && <span className="text-muted"> Cargando…</span>}
            <div>{esUltima && !baja ? `Continuar con ${nombre}` : 'Entrar'}</div>
          </>
        );
        return (
          <li key={c.id} className="tarjeta">
            {baja
              ? <span aria-disabled="true" style={{ opacity: 0.6 }}>{cuerpo}</span>
              : <Link to={`/negocio/${encodeURIComponent(c.id)}/inicio`} onClick={() => alElegir?.(c.id)}>{cuerpo}</Link>}
          </li>
        );
      })}
    </ul>
  );
}
