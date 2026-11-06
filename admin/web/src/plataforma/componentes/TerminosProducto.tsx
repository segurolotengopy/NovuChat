import { useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { TextoSeguro } from '../../central/componentes/TextoSeguro';
import type { DecisionTermino, FilaTermino } from '../lib/terminos';

/**
 * LOS TÉRMINOS DE PRODUCTO QUE EL COMERCIO REGISTRÓ (Plataforma, PR 3).
 *
 * El comercio registra el nombre literal de un producto con «prompt/prompts» (por ejemplo
 * «100 prompts») y, SOLO si NovuChat lo aprueba, el asistente lo trata como el nombre de un
 * producto y no como una instrucción. Esta pantalla lista lo pendiente, lo aprobado, y deja
 * aprobar, rechazar o revocar, cada acción con su confirmación.
 *
 * LA PANTALLA ACOMPAÑA, EL SERVIDOR MANDA: aprobar vuelve a validar todo en una transacción
 * (filtro estricto, ítem activo y apto, nombre sin cambios, tope de aprobados), y si algo no
 * cuadra devuelve un mensaje fijo. El nombre del producto y el término son texto del comercio:
 * se muestran con `TextoSeguro`, nunca como HTML ni como instrucción.
 *
 * Componente puro: la página trae la lista (`terminosProductoDeTenant`) y conecta `onDecidir` con
 * `aprobarTerminoProducto` (con el reintento de sesión reciente de `operar`).
 */
export function TerminosProducto({ filas, aprobados, tope, cargando, ocupado, onDecidir }: {
  filas: readonly FilaTermino[] | null;
  aprobados: number;
  tope: number;
  cargando: boolean;
  ocupado: boolean;
  onDecidir: (itemId: string, decision: DecisionTermino) => void;
}) {
  const pendientes = (filas ?? []).filter((f) => f.estado === 'pendiente');
  const vigentes = (filas ?? []).filter((f) => f.estado === 'aprobado');
  const rechazados = (filas ?? []).filter((f) => f.estado === 'rechazado').length;
  return (
    <section>
      <h3>Nombres de producto registrados</h3>
      <p className="ayuda">
        Aprobados: {aprobados} de {tope}. Un término aprobado deja que el asistente lo use como el nombre de un
        producto del catálogo; no cambia nada más. Esta decisión afecta lo que el asistente permite en producción.
      </p>
      {filas === null
        ? <p className="text-muted">{cargando ? 'Leyendo…' : 'No se pudo leer la lista.'}</p>
        : pendientes.length === 0 && vigentes.length === 0
          ? <p className="text-muted">No hay términos registrados por este comercio{rechazados > 0 ? ` (rechazados: ${rechazados})` : ''}.</p>
          : (
            <>
              {pendientes.length > 0 && <h4>Pendientes</h4>}
              {pendientes.map((f) => (
                <FilaDeTermino key={f.itemId} fila={f} ocupado={ocupado} lleno={aprobados >= tope}
                  acciones={['aprobar', 'rechazar']} onDecidir={onDecidir} />
              ))}
              {vigentes.length > 0 && <h4>Aprobados</h4>}
              {vigentes.map((f) => (
                <FilaDeTermino key={f.itemId} fila={f} ocupado={ocupado} lleno={false}
                  acciones={['revocar']} onDecidir={onDecidir} />
              ))}
            </>
          )}
    </section>
  );
}

const ROTULO: Record<DecisionTermino, string> = { aprobar: 'Aprobar', rechazar: 'Rechazar', revocar: 'Revocar' };
const ADVERTENCIA: Record<DecisionTermino, string> = {
  aprobar: 'Desde ahora el asistente de este comercio aceptará este nombre como un producto. Afecta producción.',
  rechazar: 'El término queda rechazado; el comercio tendría que registrarlo de nuevo.',
  revocar: 'El asistente deja de aceptar este nombre como producto. Afecta producción.',
};

function FilaDeTermino({ fila, ocupado, lleno, acciones, onDecidir }: {
  fila: FilaTermino;
  ocupado: boolean;
  lleno: boolean;
  acciones: readonly DecisionTermino[];
  onDecidir: (itemId: string, decision: DecisionTermino) => void;
}) {
  const [preguntando, setPreguntando] = useState<DecisionTermino | null>(null);
  const aprobable = fila.activo && fila.hashVigente && !lleno;
  return (
    <div className="tarjeta">
      <p>
        <strong><TextoSeguro valor={fila.nombre ?? '(el producto ya no existe)'} maxLargo={120} /></strong>
        {' '}· término: «<TextoSeguro valor={fila.termino} maxLargo={80} />»
      </p>
      {fila.estado === 'pendiente' && !fila.activo && <p className="ayuda">El producto está inactivo o ya no existe: no se puede aprobar.</p>}
      {fila.estado === 'pendiente' && fila.activo && !fila.hashVigente && (
        <p className="ayuda">El nombre del producto cambió después del registro: no se puede aprobar este término.</p>
      )}
      {fila.estado === 'pendiente' && lleno && <p className="ayuda">Ya está el tope de aprobados: revoque uno antes.</p>}
      {fila.estado === 'aprobado' && !(fila.activo && fila.hashVigente) && (
        <p className="ayuda">El producto cambió o está inactivo: este término ya no está vigente para el asistente.</p>
      )}
      {preguntando
        ? <Confirmacion resumen={`${ROTULO[preguntando]} «${fila.termino}»`} advertencia={ADVERTENCIA[preguntando]} ocupado={ocupado}
            onConfirmar={() => { onDecidir(fila.itemId, preguntando); setPreguntando(null); }}
            onCancelar={() => setPreguntando(null)} />
        : acciones.map((a) => (
          <button key={a} type="button" className={a === 'aprobar' ? 'btn btn-primary' : 'btn btn-secondary'}
            disabled={ocupado || (a === 'aprobar' && !aprobable)} onClick={() => setPreguntando(a)}>
            {ROTULO[a]}
          </button>
        ))}
    </div>
  );
}
