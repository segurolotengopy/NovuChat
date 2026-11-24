import { useEffect, useRef, useState } from 'react';
import { SIN_CONTEXTO_DE_AVISO, TEXTO_CASILLA_RETOMAR, ejecutarRetomar, textoAvisoRetomar, type CapaTurno, type ContextoDeAviso } from '../lib/turno';

/**
 * «RETOMAR CONVERSACIÓN»: con la ventana de 24 h cerrada, mandar la plantilla de utilidad que reabre la conversación.
 *
 * CUESTA DINERO (Meta cobra la plantilla fuera de la ventana), así que NUNCA se llama al servidor sin que la persona vea el
 * aviso de costo y MARQUE LA CASILLA: el botón del modal está deshabilitado mientras no esté marcada, y `confirmar()` lo
 * vuelve a comprobar (un envío por teclado o por una prueba no se salta la casilla). El texto del aviso y la cifra salen de
 * `lib/turno.ts` → `planes.ts`: esta pantalla no escribe ningún precio. El servidor es la barrera real (bandera, ventana,
 * `noContactar`, bloqueo, topes); esto solo evita ofrecer lo que va a rechazar.
 *
 *  · La clave de idempotencia nace al confirmar y se REUTILIZA si no hubo respuesta (red, tiempo agotado): reintentar no
 *    manda otra plantilla. Con una respuesta, la clave se descarta.
 *  · El doble clic no manda dos veces (`enCurso` es un `ref`).
 *  · Solo se llama a `retomarConversacion` con `{ tenantId, conversacionId, claveIdempotencia }`: nunca un teléfono.
 *  · Un error se muestra con el texto fijo de su CÓDIGO, nunca con `e.message`.
 *  · FOCO: al abrir va a la casilla; Tab y Mayús+Tab quedan dentro del modal; Escape o Cancelar lo cierran y el foco vuelve al
 *    botón «Retomar conversación».
 */
export interface PropsRetomar {
  tenantId: string;
  conversacionId: string;
  /** Tarifa, titularidad y línea para el aviso de costo; cualquiera puede faltar (un operador no lee los números): no se afirma quién paga. */
  aviso?: ContextoDeAviso;
  /** Falso con el comercio no activo: el botón se ve pero no se puede pulsar. */
  habilitados: boolean;
  capa: CapaTurno;
  /** Para las pruebas de pantalla: arranca con el modal abierto. */
  abiertoAlInicio?: boolean;
}

export function RetomarConversacion(p: PropsRetomar) {
  const [abierto, setAbierto] = useState(p.abiertoAlInicio === true);
  const [casilla, setCasilla] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clave = useRef<string | null>(null);
  const botonRef = useRef<HTMLButtonElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const casillaRef = useRef<HTMLInputElement | null>(null);
  const estabaAbierto = useRef(false);
  const enCurso = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  function cerrar() {
    if (enCurso.current) return;
    setAbierto(false);
    setCasilla(false);
    setError(null);
  }

  // Escape cierra el modal y Tab queda dentro de él (sin manejador de teclado sobre el elemento: lo pide el lint de accesibilidad).
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { cerrar(); return; }
      if (e.key !== 'Tab' || !modalRef.current) return;
      const dentro = [...modalRef.current.querySelectorAll<HTMLElement>('input, button')].filter((x) => !(x as HTMLInputElement).disabled);
      if (dentro.length === 0) return;
      const primero = dentro[0]!;
      const ultimo = dentro[dentro.length - 1]!;
      const activo = document.activeElement;
      if (!modalRef.current.contains(activo)) { e.preventDefault(); primero.focus(); }
      else if (e.shiftKey && activo === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  });

  // Al abrir, el foco va a la casilla; al cerrar sin haber enviado, vuelve al botón que lo abrió.
  useEffect(() => {
    if (abierto) { casillaRef.current?.focus(); estabaAbierto.current = true; return; }
    if (estabaAbierto.current) { estabaAbierto.current = false; botonRef.current?.focus(); }
  }, [abierto]);

  async function confirmar() {
    // La casilla es obligatoria: sin ella no se llama, aunque se fuerce el clic.
    if (enCurso.current || !casilla || !p.habilitados || hecho) return;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    try {
      const r = await ejecutarRetomar(p.capa, { tenantId: p.tenantId, conversacionId: p.conversacionId }, clave.current);
      clave.current = r.abierta ? r.clave : null;
      if (!vivo.current) return;
      if (r.salida.tipo === 'error') setError(r.salida.texto);
      else if (r.salida.tipo === 'fallido') setError('No se envió la plantilla. Puede intentarlo de nuevo.');
      else { setHecho(true); setAbierto(false); setCasilla(false); }
    } catch {
      if (vivo.current) setError('No se pudo preparar el envío. Intente de nuevo.');   // p. ej. el navegador no genera la clave
    } finally {
      enCurso.current = false;
      if (vivo.current) setEnviando(false);
    }
  }

  const idError = 'cv-retomar-error';
  return (
    <div className="cv-retomar" data-testid="retomar">
      <button type="button" ref={botonRef} className="btn btn-primary" onClick={() => setAbierto(true)}
        disabled={!p.habilitados || hecho} aria-haspopup="dialog"
        title={p.habilitados ? undefined : 'El comercio no está activo: no se puede retomar.'}>
        {hecho ? 'Plantilla enviada…' : 'Retomar conversación'}
      </button>
      {hecho && (
        <p role="status" className="cv-turno-aviso">
          Se pidió el envío de la plantilla. El estado aparece en el hilo; podrá escribirle cuando el cliente responda.
        </p>
      )}

      {abierto && (
        <div role="alertdialog" aria-modal="true" ref={modalRef} aria-labelledby="cv-retomar-titulo" aria-describedby="cv-retomar-aviso"
          className="cv-retomar-modal" data-testid="retomar-modal">
          <h3 id="cv-retomar-titulo">Retomar conversación</h3>
          <p id="cv-retomar-aviso" data-testid="retomar-aviso">{textoAvisoRetomar(p.aviso ?? SIN_CONTEXTO_DE_AVISO)}</p>
          <label className="cv-retomar-casilla">
            <input type="checkbox" ref={casillaRef} checked={casilla} disabled={enviando}
              onChange={(e) => setCasilla(e.target.checked)} data-testid="retomar-casilla" />
            {' '}{TEXTO_CASILLA_RETOMAR}
          </label>
          {error && <p id={idError} role="alert" className="cv-error">{error}</p>}
          <div className="cv-adjuntar-botones">
            <button type="button" className="btn btn-primary" onClick={() => void confirmar()}
              disabled={!casilla || enviando} aria-busy={enviando || undefined} aria-describedby={error ? idError : undefined}
              data-testid="retomar-confirmar">
              {enviando ? 'Enviando…' : 'Enviar plantilla'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={cerrar} disabled={enviando}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
