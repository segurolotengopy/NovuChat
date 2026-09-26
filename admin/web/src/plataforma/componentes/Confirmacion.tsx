/**
 * LA PREGUNTA ANTES DE ESCRIBIR. Toda acción de Plataforma que escribe en la
 * cuenta de un comercio pasa por acá: se muestra qué va a cambiar, y recién
 * con «Confirmar» se llama al servidor. Ocupa el lugar del botón que la abrió
 * (como `.confirmar-baja` del catálogo): se lee como una pregunta, no como
 * dos botones más. Sin estado propio: quien la usa decide qué hay pendiente.
 */
export function Confirmacion({ resumen, advertencia, ocupado, onConfirmar, onCancelar }: {
  resumen: string;
  advertencia?: string;
  ocupado: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <span className="confirmar-baja" role="group" aria-label="Confirmar el cambio">
      <span>¿Confirmar? {resumen}</span>
      {advertencia && <span className="text-muted">{advertencia}</span>}
      <button type="button" className="btn btn-primary btn-chico" disabled={ocupado} onClick={onConfirmar}>
        {ocupado ? 'Guardando…' : 'Confirmar'}
      </button>
      <button type="button" className="btn btn-secondary btn-chico" disabled={ocupado} onClick={onCancelar}>
        Cancelar
      </button>
    </span>
  );
}
