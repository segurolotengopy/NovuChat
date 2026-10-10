/**
 * =============================================================================
 * SIMULACIÓN DE «TOMAR», «DEVOLVER» Y «ESCRIBIR» (PROTOTIPO, 09/10/2026)
 * =============================================================================
 *
 * Nada de lo que hay acá envía un mensaje, llama a una Function ni escribe en
 * Firestore. Es un estado LOCAL (se guarda en el navegador, por comercio) que se
 * SUPERPONE a lo que llega de la base: la pantalla muestra «la conversación,
 * como quedaría si esto fuera de verdad».
 *
 * POR QUÉ LOCAL Y NO EN EL EMULADOR. Las reglas de Firestore (`firestore.rules`,
 * que no es de la zona Central) no dejan a una persona del negocio escribir
 * `turno`, `noLeidos` ni mensajes —y así tiene que seguir siendo—. Escribir
 * desde el navegador para «simular» obligaría a aflojarlas. En H2 estos tres
 * pasos serán callables (`tomarConversacion`, `devolverConversacion`,
 * `enviarComoPersona`) y la pantalla leerá el resultado de Firestore igual que
 * hoy lee el resto: lo único que cambia es de dónde sale este superpuesto.
 *
 * Funciones puras sobre un objeto serializable: se prueban sin navegador.
 */
import type { Ficha, Responde } from './conversaciones';

export interface TurnoLocal {
  responde: Responde;
  tomadoPor: string;
  tomadoEn: number;
}

export interface EnviadoLocal {
  id: string;
  texto: string;
  ts: number;
}

export interface Simulacion {
  /** Marca de la siembra: si se vuelve a sembrar, lo guardado de antes deja de valer. */
  semilla: string;
  turnos: Record<string, TurnoLocal>;
  /** Cuándo (ms) se marcó leída cada una: un mensaje del cliente posterior la vuelve a dejar sin leer. */
  leidas: Record<string, number>;
  enviados: Record<string, EnviadoLocal[]>;
}

export const SIMULACION_VACIA = (semilla = ''): Simulacion => ({ semilla, turnos: {}, leidas: {}, enviados: {} });

export function tomar(s: Simulacion, id: string, quien: string, ahora: number): Simulacion {
  return { ...s, turnos: { ...s.turnos, [id]: { responde: 'persona', tomadoPor: quien, tomadoEn: ahora } } };
}

export function devolver(s: Simulacion, id: string, ahora: number): Simulacion {
  return { ...s, turnos: { ...s.turnos, [id]: { responde: 'asistente', tomadoPor: '', tomadoEn: ahora } } };
}

/** La persona solo puede poner los no leídos en cero (nunca subirlos). */
export function marcarLeida(s: Simulacion, id: string, ahora: number): Simulacion {
  return { ...s, leidas: { ...s.leidas, [id]: ahora } };
}

/**
 * «Enviar» en simulación: guarda el texto como si hubiera salido. Devuelve el
 * mismo estado si el texto está vacío o si la conversación no está tomada por
 * una persona (el servidor también lo rechazaría).
 */
export function enviar(s: Simulacion, id: string, texto: string, ahora: number): Simulacion {
  const limpio = texto.trim();
  const turno = s.turnos[id];
  if (!limpio || !turno || turno.responde !== 'persona') return s;
  const previos = s.enviados[id] ?? [];
  const nuevo: EnviadoLocal = { id: `sim-${ahora}-${previos.length}`, texto: limpio.slice(0, 4096), ts: ahora };
  return { ...s, enviados: { ...s.enviados, [id]: [...previos, nuevo] } };
}

/** La ficha tal como quedaría con lo simulado encima. */
export function conSimulacion(f: Ficha, s: Simulacion): Ficha {
  const turno = s.turnos[f.id];
  const enviados = s.enviados[f.id] ?? [];
  const ultimoEnviado = enviados[enviados.length - 1];
  const sobre: Ficha = { ...f };
  if (turno) { sobre.responde = turno.responde; sobre.tomadoPor = turno.tomadoPor; }
  const leidaEn = s.leidas[f.id];
  if (leidaEn !== undefined && (f.ultimoEntranteEn === null || f.ultimoEntranteEn <= leidaEn)) sobre.noLeidos = 0;
  if (ultimoEnviado && (f.ultimoEn === null || ultimoEnviado.ts > f.ultimoEn)) {
    sobre.ultimoMensaje = ultimoEnviado.texto;
    sobre.ultimoEn = ultimoEnviado.ts;
  }
  return sobre;
}

/** Lee lo guardado, descartando lo que no sea de esta siembra o esté dañado. */
export function leerSimulacion(crudo: string | null, semilla: string): Simulacion {
  if (!crudo) return SIMULACION_VACIA(semilla);
  try {
    const v = JSON.parse(crudo) as Partial<Simulacion> | null;
    if (!v || typeof v !== 'object' || v.semilla !== semilla) return SIMULACION_VACIA(semilla);
    return {
      semilla,
      turnos: v.turnos && typeof v.turnos === 'object' ? v.turnos : {},
      leidas: v.leidas && typeof v.leidas === 'object' ? v.leidas : {},
      enviados: v.enviados && typeof v.enviados === 'object' ? v.enviados : {},
    };
  } catch {
    return SIMULACION_VACIA(semilla);
  }
}
