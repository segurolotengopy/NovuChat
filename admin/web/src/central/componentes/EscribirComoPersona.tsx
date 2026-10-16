import { useEffect, useRef, useState } from 'react';
import {
  TEXTO_INCIERTO, ejecutarEnvio, estadoDelTexto, motivoVentana, textoContador, textoCuentaRegresiva, ventanaDeEnvio,
  type Borrador, type CapaTurno,
} from '../lib/turno';

/**
 * EL CAMPO PARA ESCRIBIRLE AL CLIENTE COMO PERSONA (H2, contrato §2 y §4).
 *
 * Solo se pinta cuando quien mira TIENE la conversación (el servidor exige el turno de ESA persona). Envía con
 * `enviarComoPersona({ tenantId, conversacionId, texto, claveIdempotencia })`; no manda el teléfono ni nada más: el
 * destinatario sale de la conversación, en el servidor.
 *
 *  · LA CLAVE la genera la consola: una por envío lógico (`claveDelEnvio`). Si el envío no llegó a confirmarse (sin
 *    respuesta del servidor: red, tiempo agotado), repetirlo usa LA MISMA clave y el servidor lo reconoce: no se duplica.
 *    Un resultado `incierto` NUNCA se reenvía solo: el texto se retira del campo, el mensaje queda marcado en el hilo y
 *    escribirlo otra vez es decisión de la persona (con clave nueva).
 *  · LA VENTANA de WhatsApp (24 h desde el último mensaje DEL CLIENTE, `ultimoEntranteEn`) se muestra como cuenta
 *    regresiva. Sin ese dato no se envía y se explica por qué. El servidor vuelve a comprobarla.
 *  · NADA SE ENVÍA DOS VECES POR UN DOBLE CLIC: `enCurso` es un `ref`, que se lee en el mismo instante del clic.
 *  · Sin almacenamiento del navegador: el borrador vive en el estado del componente y se pierde al cambiar de conversación.
 *  · Ctrl+Enter (o Cmd+Enter) envía; Enter solo agrega un salto de línea.
 */

export interface PropsEscribir {
  tenantId: string;
  conversacionId: string;
  /** Hora del último mensaje DEL CLIENTE (de ahí corre la ventana de 24 h); `null` = sin dato. */
  ultimoEntranteEn: number | null;
  /** Los controles se ven, ¿se pueden usar? (falso con el comercio no activo). */
  habilitados: boolean;
  capa: CapaTurno;
}

export function EscribirComoPersona(p: PropsEscribir) {
  const [crudo, setCrudo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const borrador = useRef<Borrador | null>(null);
  const enCurso = useRef(false);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  // La cuenta regresiva: un tic por segundo, solo mientras haya un dato del que contar.
  useEffect(() => {
    if (p.ultimoEntranteEn === null) return;
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p.ultimoEntranteEn]);

  const ventana = ventanaDeEnvio(p.ultimoEntranteEn, ahora);
  const texto = estadoDelTexto(crudo);
  const motivo = motivoVentana(ventana) ?? (p.habilitados ? null : 'El comercio no está activo: no se puede enviar.');
  const puedeEnviar = !enviando && motivo === null && texto.hayTexto && !texto.excede;
  const idAyuda = 'cv-redactor-ayuda';
  const idContador = 'cv-redactor-contador';
  const idError = 'cv-redactor-error';
  const invalido = error !== null || texto.excede;

  async function enviar() {
    if (enCurso.current || !puedeEnviar) return;
    enCurso.current = true;
    setEnviando(true);
    setError(null);
    setAviso(null);
    try {
      const hecho = await ejecutarEnvio(
        p.capa, { tenantId: p.tenantId, conversacionId: p.conversacionId, texto: texto.texto }, borrador.current);
      borrador.current = hecho.borrador;             // cerrado si el servidor contestó; abierto (misma clave) si no hubo respuesta
      if (!vivo.current) return;
      const { salida } = hecho;
      if (salida.tipo === 'error') {
        setError(salida.texto);
      } else if (salida.tipo === 'fallido') {
        setError('El mensaje no se envió. Puede intentarlo de nuevo.');   // el texto queda en el campo
      } else if (salida.tipo === 'incierto') {
        setCrudo('');
        setAviso(`${TEXTO_INCIERTO}. Revise el hilo antes de escribirlo otra vez: no se reenvía solo.`);
      } else {
        setCrudo('');
        setAviso('Enviando… el estado del mensaje aparece en el hilo.');
      }
    } catch {
      if (vivo.current) setError('No se pudo preparar el envío. Intente de nuevo.');   // p. ej. el navegador no puede generar la clave
    } finally {
      enCurso.current = false;
      if (vivo.current) setEnviando(false);
    }
  }

  return (
    <form className="cv-redactor" data-testid="redactor" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      {ventana.estado === 'abierta' && (
        <p className={`cv-redactor-ventana${ventana.restanteMs <= 3_600_000 ? ' cv-redactor-ventana--poco' : ''}`}
          role="timer" aria-live="off" aria-label="Tiempo que queda de la ventana de 24 horas de WhatsApp">
          Ventana de WhatsApp: <time data-testid="cuenta-regresiva">{textoCuentaRegresiva(ventana.restanteMs)}</time>
        </p>
      )}
      {motivo && <p id={idAyuda} className="cv-redactor-motivo" role="status">{motivo}</p>}

      <label htmlFor="cv-redactor-texto" className="cv-redactor-rotulo">Mensaje para el cliente</label>
      <textarea
        id="cv-redactor-texto" className="cv-redactor-campo" rows={3} value={crudo}
        onChange={(e) => { setCrudo(e.target.value); if (aviso) setAviso(null); if (error) setError(null); }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void enviar(); }
        }}
        disabled={motivo !== null} readOnly={enviando}
        aria-invalid={invalido ? true : undefined}
        aria-describedby={[motivo ? idAyuda : '', idContador, error ? idError : ''].filter(Boolean).join(' ')}
        placeholder="Escriba su respuesta. Ctrl+Enter envía."
        autoComplete="off" spellCheck
      />
      <div className="cv-redactor-pie">
        <span id={idContador} className={texto.excede ? 'cv-error' : 'text-muted'}>
          {textoContador(texto.largo)}{texto.excede ? ' — se pasó del máximo' : ''}
        </span>
        <button type="submit" className="btn btn-primary" disabled={!puedeEnviar} aria-busy={enviando || undefined}>
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      {error && <p id={idError} role="alert" className="cv-error cv-redactor-error">{error}</p>}
      {aviso && !error && <p role="status" className="cv-redactor-aviso">{aviso}</p>}
    </form>
  );
}
