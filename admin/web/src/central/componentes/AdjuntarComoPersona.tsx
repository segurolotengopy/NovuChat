import { useEffect, useRef, useState } from 'react';
import { TextoSeguro } from './TextoSeguro';
import { TEXTO_INCIERTO, nuevaClave } from '../lib/turno';
import { bytesDeBase64 } from '../lib/medios';
import { decodificarImagen } from '../lib/decodificarImagen';
import {
  ACCEPT, MAX_LEYENDA, TOPE_AUDIO, TOPE_GRABACION_MS,
  base64DeDataUrl, claveDelAdjunto, clasificarArchivo, destinatarioAbreviado, ejecutarEnvioDeAdjunto, formatoDeGrabacion,
  leyendaParaEnviar, recodificarImagen, textoErrorLocal, textoErrorMicrofono, ErrorDeAdjunto, Grabadora,
  type AdjuntoPreparado, type BorradorAdjunto, type CapaAdjunto, type ContextoMinimo, type EntornoDeGrabacion,
  type FormatoGrabacion, type FlujoMinimo, type GrabadorMinimo, type LienzoMinimo,
} from '../lib/adjuntos';

/**
 * ENVIAR UN ARCHIVO O UNA NOTA DE VOZ AL CLIENTE COMO PERSONA (Medios B4).
 *
 * Solo se pinta cuando el Detalle lo decide (`verAdjuntar`: conversación tomada por quien mira, ventana abierta, comercio
 * activo y `personaPuedeEnviarMedios`). Envía con `enviarAdjuntoComoPersona`; el destinatario sale de la conversación, en el
 * servidor. No importa Firebase: recibe la capa.
 *
 *  · NADA SALE SIN CONFIRMAR: un panel dice a quién (nombre y últimos 4 dígitos) y que no se puede borrar.
 *  · LA CLAVE de idempotencia es una por archivo preparado: sin respuesta del servidor, reintentar usa la misma clave y no
 *    duplica. Un `incierto` descarta el archivo y avisa: nunca se reenvía solo.
 *  · NOTA DE VOZ: solo si el navegador graba Ogg/Opus o WebM/Opus (nunca mp4). Se fuerza mono y se corta a los 4 minutos.
 *  · La grabación la maneja `Grabadora` (lib/adjuntos.ts): una a la vez, todo se suelta en cualquier camino.
 *  · Un envío en vuelo cuenta como «sin confirmar» desde ANTES de llamar, igual que el texto.
 *  · La vista previa de una imagen es `data:` (la CSP de la consola no admite `blob:` en `img-src`); la del audio, `blob:`
 *    en un `<audio>`, que se revoca al descartar, enviar o desmontar.
 *  · Sin almacenamiento del navegador: lo sin confirmar vive en la memoria del módulo y se pierde al recargar.
 *  · Los audios no llevan texto: no hay campo de leyenda para ellos.
 */

/**
 * ENVÍOS SIN CONFIRMAR, EN MEMORIA DEL MÓDULO. Solo cuando NO hubo respuesta del servidor: al volver a la conversación se
 * conserva el archivo y LA MISMA clave. Se borra al confirmarse, al descartar o con una respuesta definitiva. La llave lleva
 * el uid: otra persona en el mismo navegador no ve ni reutiliza lo de ésta.
 */
type SinConfirmar = { preparado: AdjuntoPreparado; leyenda: string; borrador: BorradorAdjunto };
const ADJUNTOS_SIN_CONFIRMAR = new Map<string, SinConfirmar>();
const llaveDe = (p: { miUid: string | null; tenantId: string; conversacionId: string }) =>
  `${p.miUid ?? ''}|${p.tenantId}|${p.conversacionId}`;

export interface PropsAdjuntar {
  /** El uid de quien envía (solo para separar lo sin confirmar). */
  miUid: string | null;
  tenantId: string;
  conversacionId: string;
  nombreContacto: string;
  telefono: string;
  capa: CapaAdjunto;
  /** Solo para las pruebas: el formato de grabación ya resuelto. En producción se calcula en el navegador. */
  formatoInicial?: FormatoGrabacion | null;
}

const TEXTO_SIN_VOZ =
  'Este navegador no puede grabar notas de voz en un formato que WhatsApp acepte. Puede adjuntar un archivo de audio (mp3, m4a, aac u ogg).';
const TEXTO_AUDIO_SIN_TEXTO = 'Los audios van sin texto; si quiere agregar algo, escríbalo en el cuadro de mensaje.';

const tamanoLegible = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

function leerComoDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, mal) => {
    const l = new FileReader();
    l.onerror = () => mal(new Error('lectura'));
    l.onload = () => ok(String(l.result));
    l.readAsDataURL(b);
  });
}

type Fase = 'reposo' | 'arrancando' | 'preparando' | 'grabando';

/** Las piezas reales del navegador para la grabadora. */
function entornoReal(): EntornoDeGrabacion {
  return {
    crearContexto: () => {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error('sin audio');
      return new AC() as unknown as ContextoMinimo;
    },
    pedirMicrofono: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
    crearGrabador: (f: FlujoMinimo, mimeType: string) =>
      new MediaRecorder(f as unknown as MediaStream, { mimeType, audioBitsPerSecond: 32000 }) as unknown as GrabadorMinimo,
  };
}

export function AdjuntarComoPersona(p: PropsAdjuntar) {
  const guardado = ADJUNTOS_SIN_CONFIRMAR.get(llaveDe(p));
  const [preparado, setPreparado] = useState<AdjuntoPreparado | null>(guardado?.preparado ?? null);
  const [leyenda, setLeyenda] = useState(guardado?.leyenda ?? '');
  const [fase, setFase] = useState<Fase>('reposo');
  const [transcurrido, setTranscurrido] = useState(0);
  const [formato, setFormato] = useState<FormatoGrabacion | null | undefined>(p.formatoInicial);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [urlAudio, setUrlAudio] = useState<string | null>(null);
  // Hay un envío abierto (en vuelo o sin respuesta): el archivo y el texto ya no se pueden cambiar, la clave es la misma.
  const [abierto, setAbierto] = useState(guardado !== undefined);

  const borrador = useRef<BorradorAdjunto | null>(guardado?.borrador ?? null);
  const enCurso = useRef(false);
  const vivo = useRef(true);
  const entrada = useRef<HTMLInputElement>(null);
  const botonEnviar = useRef<HTMLButtonElement>(null);
  const botonConfirmar = useRef<HTMLButtonElement>(null);
  const botonAdjuntar = useRef<HTMLButtonElement>(null);
  const pedirFoco = useRef(false);
  // El archivo o la grabación original, para la vista previa del audio sin volver a decodificar el base64.
  const blobOriginal = useRef<Blob | null>(null);
  const grabadora = useRef<Grabadora | null>(null);

  // Lo sin confirmar solo se recuerda con una sesión identificada (sin uid no se separa de otra persona).
  const recordar = (v: SinConfirmar) => { if (p.miUid !== null) ADJUNTOS_SIN_CONFIRMAR.set(llaveDe(p), v); };
  const olvidar = () => { ADJUNTOS_SIN_CONFIRMAR.delete(llaveDe(p)); };

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; grabadora.current?.destruir(); };
  }, []);

  // El formato de grabación se resuelve en el navegador (en el pintado de servidor no hay MediaRecorder).
  useEffect(() => {
    if (p.formatoInicial !== undefined) return;
    setFormato(formatoDeGrabacion({
      hayMediaRecorder: typeof MediaRecorder !== 'undefined',
      hayGetUserMedia: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
      soporta: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
    }));
  }, [p.formatoInicial]);

  // La vista previa de un audio: URL `blob:` para un `<audio>`, revocada al cambiar o desmontar.
  useEffect(() => {
    if (!preparado || (preparado.clase !== 'audio' && preparado.clase !== 'voz')) { setUrlAudio(null); return; }
    let blob = blobOriginal.current;
    if (!blob) {
      const bytes = bytesDeBase64(preparado.base64);
      if (!bytes) { setUrlAudio(null); return; }
      blob = new Blob([bytes as BlobPart], { type: preparado.mime });
    }
    const url = URL.createObjectURL(blob);
    setUrlAudio(url);
    return () => { URL.revokeObjectURL(url); };
  }, [preparado]);

  // Al abrir la confirmación el foco va a «Sí, enviar».
  useEffect(() => { if (confirmando) botonConfirmar.current?.focus(); }, [confirmando]);
  // Tras enviar bien o descartar, el foco vuelve a «Adjuntar archivo».
  useEffect(() => {
    if (!preparado && fase === 'reposo' && pedirFoco.current) { pedirFoco.current = false; botonAdjuntar.current?.focus(); }
  }, [preparado, fase]);

  function descartar() {
    grabadora.current?.descartar();
    olvidar();
    borrador.current = null;
    blobOriginal.current = null;
    pedirFoco.current = true;
    setPreparado(null); setLeyenda(''); setConfirmando(false); setError(null); setAviso(null); setFase('reposo'); setTranscurrido(0); setAbierto(false);
  }

  function listo(a: AdjuntoPreparado, blob: Blob | null) {
    borrador.current = null;
    olvidar();
    blobOriginal.current = blob;
    setAbierto(false); setPreparado(a); setLeyenda(''); setError(null); setAviso('Archivo listo para enviar'); setFase('reposo');
  }

  async function elegirArchivo(f: File) {
    setError(null); setAviso(null);
    const c = clasificarArchivo(f.name, f.type, f.size);
    if (!c.ok) { setError(textoErrorLocal(c.error)); return; }
    setFase('preparando'); setAviso('Preparando el archivo…');
    try {
      const id = nuevaClave();
      if (c.clase === 'imagen') {
        const r = await recodificarImagen(f, {
          decodificar: (b) => decodificarImagen(b as File),
          crearLienzo: (w, h) => { const l = document.createElement('canvas'); l.width = w; l.height = h; return l as unknown as LienzoMinimo; },
          leerComoDataUrl,
        });
        if (vivo.current) listo({ id, clase: 'imagen', base64: r.base64, mime: 'image/jpeg', tamano: r.tamano }, null);
        return;
      }
      const base64 = base64DeDataUrl(await leerComoDataUrl(f));
      if (!base64) throw new ErrorDeAdjunto('tipo_no_admitido');
      if (vivo.current) {
        if (c.clase === 'documento') listo({ id, clase: 'documento', base64, mime: c.mime, nombre: f.name.slice(0, 240), tamano: f.size }, null);
        else listo({ id, clase: 'audio', base64, mime: c.mime, tamano: f.size }, f);
      }
    } catch (e) {
      if (!vivo.current) return;
      setFase('reposo'); setAviso(null);
      setError(e instanceof ErrorDeAdjunto ? textoErrorLocal(e.codigo) : 'No se pudo preparar el archivo. Intente de nuevo.');
    }
  }

  async function grabar() {
    if (!formato || fase !== 'reposo') return;
    if (!grabadora.current) grabadora.current = new Grabadora(entornoReal(), formato);
    const g = grabadora.current;
    if (g.ocupada) return;   // un doble clic no abre dos micrófonos
    setError(null); setAviso(null); setFase('arrancando');
    try {
      const empezo = await g.iniciar((fin) => { void terminarGrabacion(fin.trozos, formato); }, (ms) => { if (vivo.current) setTranscurrido(ms); });
      if (!vivo.current) return;
      if (empezo) { setTranscurrido(0); setFase('grabando'); setAviso('Grabando…'); } else setFase('reposo');
    } catch (e) {
      if (vivo.current) { setFase('reposo'); setAviso(null); setError(textoErrorMicrofono(e instanceof Error ? e.name : '')); }
    }
  }

  function detener() { grabadora.current?.detener(); }

  async function terminarGrabacion(trozos: Blob[], f: FormatoGrabacion) {
    if (!vivo.current) return;
    setFase('preparando');
    try {
      const blob = new Blob(trozos, { type: f.mimeGrabacion });
      if (blob.size === 0) throw new ErrorDeAdjunto('vacio');   // nunca se envía una grabación muda sin saberlo
      if (blob.size > TOPE_AUDIO) throw new ErrorDeAdjunto('demasiado_grande');
      const base64 = base64DeDataUrl(await leerComoDataUrl(blob));
      if (!base64) throw new ErrorDeAdjunto('vacio');
      if (vivo.current) { listo({ id: nuevaClave(), clase: 'voz', base64, mime: f.mimeDeclarado, tamano: blob.size }, blob); setAviso('Grabación lista'); }
    } catch (e) {
      if (!vivo.current) return;
      setFase('reposo'); setAviso(null);
      setError(e instanceof ErrorDeAdjunto ? textoErrorLocal(e.codigo) : 'No se pudo preparar la grabación. Intente de nuevo.');
    }
  }

  function pedirConfirmacion() {
    if (!preparado || enviando) return;
    if (!leyendaParaEnviar(leyenda, preparado.clase).ok) {
      setError(`El texto no puede pasar de ${MAX_LEYENDA} caracteres ni llevar caracteres de control.`);
      return;
    }
    setError(null);
    setConfirmando(true);
  }

  function cancelar() {
    setConfirmando(false);
    botonEnviar.current?.focus();
  }

  async function enviar() {
    if (enCurso.current || !preparado) return;
    const ley = leyendaParaEnviar(leyenda, preparado.clase);
    if (!ley.ok) { setConfirmando(false); setError(`El texto no puede pasar de ${MAX_LEYENDA} caracteres ni llevar caracteres de control.`); return; }
    enCurso.current = true;
    setEnviando(true); setConfirmando(false); setError(null); setAviso(null);
    try {
      // La clave se fija y el envío se anota como «sin confirmar» ANTES de llamar: si la persona cambia de conversación
      // con el envío en vuelo, al volver ve el mismo archivo con la misma clave.
      const abierto0 = claveDelAdjunto(borrador.current, preparado.id, ley.leyenda ?? '');
      borrador.current = abierto0;
      setAbierto(true);
      recordar({ preparado, leyenda, borrador: abierto0 });
      const hecho = await ejecutarEnvioDeAdjunto(
        p.capa, { tenantId: p.tenantId, conversacionId: p.conversacionId, preparado, leyenda: ley.leyenda }, abierto0);
      borrador.current = hecho.borrador;
      if (hecho.borrador) recordar({ preparado, leyenda, borrador: hecho.borrador }); else olvidar();
      if (!vivo.current) return;
      setAbierto(hecho.borrador !== null);
      const { salida } = hecho;
      if (salida.tipo === 'error') {
        setError(salida.texto);
      } else if (salida.tipo === 'fallido') {
        setError('El archivo no se envió. Puede intentarlo de nuevo.');
      } else if (salida.tipo === 'incierto') {
        pedirFoco.current = true; blobOriginal.current = null;
        setPreparado(null); setLeyenda('');
        setAviso(`${TEXTO_INCIERTO}. Revise el hilo antes de enviarlo otra vez: no se reenvía solo.`);
      } else {
        pedirFoco.current = true; blobOriginal.current = null;
        setPreparado(null); setLeyenda('');
        setAviso('Enviando… el estado del archivo aparece en el hilo.');
      }
    } catch {
      if (vivo.current) setError('No se pudo preparar el envío. Intente de nuevo.');
    } finally {
      enCurso.current = false;
      if (vivo.current) setEnviando(false);
    }
  }

  const dest = destinatarioAbreviado(p.nombreContacto, p.telefono);
  const ocupado = fase !== 'reposo' || enviando;
  const esAudio = preparado?.clase === 'audio' || preparado?.clase === 'voz';
  const idError = 'cv-adjunto-error';

  return (
    <section className="cv-adjuntar" aria-label="Enviar un archivo o una nota de voz" data-testid="adjuntar">
      {!preparado && (
        <div className="cv-adjuntar-botones">
          <button type="button" ref={botonAdjuntar} className="btn btn-secondary cv-adjunto-boton" disabled={ocupado}
                  onClick={() => entrada.current?.click()}>
            Adjuntar archivo
          </button>
          <input ref={entrada} type="file" accept={ACCEPT} hidden tabIndex={-1} aria-hidden="true"
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void elegirArchivo(f); }} />
          {formato && fase !== 'grabando' && (
            <button type="button" className="btn btn-secondary cv-adjunto-boton" disabled={ocupado} onClick={() => void grabar()}>
              Grabar nota de voz
            </button>
          )}
          {fase === 'grabando' && (
            <>
              <button type="button" className="btn btn-primary cv-adjunto-boton" aria-pressed="true" onClick={detener}>
                Detener ({mmss(transcurrido)} / {mmss(TOPE_GRABACION_MS)})
              </button>
              <button type="button" className="btn btn-secondary cv-adjunto-boton" onClick={descartar}>Descartar</button>
            </>
          )}
        </div>
      )}
      {formato === null && !preparado && <p className="cv-adjunto-nota text-muted">{TEXTO_SIN_VOZ}</p>}

      <div role="status" aria-live="polite" className="cv-adjunto-estado">{aviso ?? ''}</div>

      {preparado && (
        <div className="cv-adjunto-previa">
          {preparado.clase === 'imagen' && (
            <img src={`data:image/jpeg;base64,${preparado.base64}`} alt="Vista previa de la imagen que se enviará" />
          )}
          {preparado.clase === 'documento' && (
            <p><TextoSeguro valor={preparado.nombre} maxLargo={80} /> ({tamanoLegible(preparado.tamano)})</p>
          )}
          {esAudio && urlAudio && <audio controls src={urlAudio} aria-label="Vista previa del audio que se enviará" />}
          {esAudio && <p className="cv-adjunto-nota text-muted">{TEXTO_AUDIO_SIN_TEXTO}</p>}
          {!esAudio && (
            <>
              <label htmlFor="cv-adjunto-leyenda" className="cv-redactor-rotulo">Texto que acompaña al archivo (opcional)</label>
              <textarea id="cv-adjunto-leyenda" className="cv-redactor-campo" rows={2} maxLength={MAX_LEYENDA} value={leyenda}
                        onChange={(e) => { setLeyenda(e.target.value); if (error) setError(null); }}
                        disabled={enviando || abierto} aria-describedby={error ? idError : undefined} autoComplete="off" spellCheck />
            </>
          )}
          <div className="cv-adjuntar-botones">
            <button type="button" ref={botonEnviar} className="btn btn-primary cv-adjunto-boton" disabled={enviando || confirmando}
                    aria-busy={enviando || undefined} aria-describedby={error ? idError : undefined} onClick={pedirConfirmacion}>
              {enviando ? 'Enviando…' : abierto ? 'Reintentar envío' : 'Enviar archivo'}
            </button>
            <button type="button" className="btn btn-secondary cv-adjunto-boton" disabled={enviando} onClick={descartar}>
              Descartar
            </button>
          </div>
        </div>
      )}

      {preparado && confirmando && (
        <div role="alertdialog" aria-labelledby="cv-adjunto-confirmar-texto" className="cv-adjunto-confirmar"
             onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelar(); } }}>
          <p id="cv-adjunto-confirmar-texto">
            ¿Enviar este archivo a <TextoSeguro valor={dest.nombre} maxLargo={40} />
            {dest.ultimos4 ? ` (número terminado en ${dest.ultimos4})` : ''}? Una vez enviado no se puede borrar.
          </p>
          <div className="cv-adjuntar-botones">
            <button type="button" ref={botonConfirmar} className="btn btn-primary cv-adjunto-boton" onClick={() => void enviar()}>
              Sí, enviar
            </button>
            <button type="button" className="btn btn-secondary cv-adjunto-boton" onClick={cancelar}>Cancelar</button>
          </div>
        </div>
      )}

      {error && <p id={idError} role="alert" className="cv-error cv-redactor-error">{error}</p>}
    </section>
  );
}
