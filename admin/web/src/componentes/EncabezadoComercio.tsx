import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { modoDelComercio, type ModoComercio } from '../lib/modoComercio';
import { TextoSeguro } from './TextoSeguro';
import { ChipModo } from './ChipModo';

/**
 * FRANJA DEL COMERCIO, arriba de todas sus páginas: el nombre del negocio y,
 * para quien puede saberlo, el chip «PRUEBA» / «PRODUCCIÓN».
 *
 * SOLO LECTURA. No escribe nada: el nombre es de `tenants/{id}` y la modalidad
 * de `cuenta/estado`, y los dos los escribe el servidor (`CLAUDE.md` §7).
 *
 * QUIÉN VE EL CHIP. `cuenta/estado` lo leen el administrador del comercio y el
 * propietario de NovuChat; al OPERADOR las reglas se lo niegan, y está bien
 * así: el plan y los pagos no son cosa del cocinero ni del repartidor. Por eso
 * para el operador ni siquiera se abre la lectura —sería un PERMISSION_DENIED
 * seguro en la consola del navegador— y la franja muestra solo el nombre. No
 * hay en `tenants/{id}` un dato legítimo de la modalidad que él pueda leer, y
 * no se abren las reglas para esto.
 *
 * UN ERROR NO ROMPE LA CABECERA. Si alguna de las dos lecturas falla (permisos,
 * un comercio suspendido cuyo `cuenta/estado` ya no se abre, red), se deja de
 * mostrar ESA parte y nada más. La cabecera es la salida de todas las páginas:
 * no puede caerse por un dato decorativo.
 *
 * Los estados llevan el `tenantId` al que corresponden: al pasar de un negocio
 * a otro no se ve, ni por un instante, el nombre o el modo del anterior.
 */
export function EncabezadoComercio({ tenantId, leeCuenta }: { tenantId: string; leeCuenta: boolean }) {
  const [nombre, setNombre] = useState<{ id: string; valor: unknown } | null>(null);
  const [modo, setModo] = useState<{ id: string; valor: ModoComercio } | null>(null);

  useEffect(() => onSnapshot(doc(db, 'tenants', tenantId),
    (d) => setNombre({ id: tenantId, valor: d.data()?.nombre }),
    () => setNombre(null)), [tenantId]);

  useEffect(() => {
    if (!leeCuenta) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setModo({ id: tenantId, valor: modoDelComercio(d.data()) }),
      () => setModo(null));
  }, [tenantId, leeCuenta]);

  const nombreVigente = nombre?.id === tenantId ? nombre.valor : undefined;
  const modoVigente = leeCuenta && modo?.id === tenantId ? modo.valor : null;
  if (typeof nombreVigente !== 'string' && !modoVigente) return null;

  return (
    <div className="contenedor franja-comercio" aria-label="Comercio">
      {typeof nombreVigente === 'string' &&
        <TextoSeguro valor={nombreVigente} maxLargo={80} className="franja-comercio-nombre" />}
      {modoVigente && <ChipModo modo={modoVigente} />}
    </div>
  );
}
