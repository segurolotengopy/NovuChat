/**
 * EL ESTADO DE LA CONVERSACIÓN EN EL SERVIDOR, DE MENTIRA, PARA LAS SUITES DE «VENTA MÍNIMA» (PR-4a).
 *
 * Una pieza para todas: el servidor de sesión de mentira común (`comun-sin-agente/herramientas/servidor-de-sesion.mjs`, que una prueba diferencial compara con el núcleo real) más los dobles de los
 * nodos `Comprometer *` y el gancho que agrega `conversacion` y `visto` a la respuesta de «Traer configuración» (el `leer` viaja en la misma llamada que la configuración).
 *
 * Cada «Traer configuración» estrena un número de ejecución que se suma al idCompromiso (el n8n de mentira da SIEMPRE el mismo `$execution.id`; en n8n real cada ejecución tiene el suyo).
 * Un reintento de n8n (retryOnFail) vuelve a mandar el MISMO idCompromiso: el servidor contesta `repetido`.
 */
import { crearServidorDeSesion, type ServidorDeSesion } from '../../../Flujos/experimental/comun-sin-agente/herramientas/servidor-de-sesion.mjs';
import type { J } from './flujo';
import type { Doble, LlamadaDoble } from './n8n-de-mentira';

export const ESPACIO = 'venta-minima';
export const ESPACIO_PRUEBA = 'venta-minima-prueba';
export const NODOS_COMPROMETER = ['Comprometer turno', 'Comprometer compensación'] as const;

const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export interface SesionDeMentira {
  servidor: ServidorDeSesion;
  pid: string;
  /** Todo `comprometer` que llegó, por nodo, tal cual salió del flujo (antes de sumarle el número de ejecución). */
  compromisos: { nodo: string; cuerpo: J }[];
  /** Cosas que el flujo no debía hacer (cabecera, URL o cuerpo mal formados). */
  malFormado: string[];
  /** Con `true`, el servidor es uno VIEJO sin la rama `sesion`: la respuesta de configuración no trae `conversacion` ni `visto`. */
  sinRama: boolean;
  /** El gancho `alResponder` de `crearMundo`. */
  alResponder: (ll: LlamadaDoble, r: J) => J;
  /** Los dobles de los nodos `Comprometer *`. */
  dobles: Record<string, Doble>;
  /** El bloque `{v, estado, pedidos}` que guardó el servidor para el teléfono (o null). */
  bloque(tel: string, espacio?: string): J | null;
  /** El estado de la conversación de ese teléfono (lo que antes era `staticData.ventaMinima.estados[tel]`). */
  estado(tel: string, espacio?: string): J;
  /** Los pedidos guardados de ese teléfono (lo que antes era `staticData.ventaMinima.pedidos`). */
  pedidos(tel: string, espacio?: string): J;
  version(tel: string, espacio?: string): number;
  /** Una copia de lo que guarda el servidor (los documentos de estado; no los vistos) y su vuelta atrás: simula dos ejecuciones que LEEN el mismo estado. */
  copia(): [string, unknown][];
  restaurar(copia: [string, unknown][]): void;
  /** Siembra el bloque tal cual (sube la versión). */
  sembrarBloque(tel: string, bloque: J | null, espacio?: string, venceEnMin?: number): void;
  /** Siembra solo el estado (y, si se pasan, los pedidos). */
  sembrar(tel: string, estado: J | null, pedidos?: J, espacio?: string, venceEnMin?: number): void;
}

export function crearSesion(op: { pid: string; ahora: () => number; servidor?: ServidorDeSesion; espacios?: string[] | null }): SesionDeMentira {
  const servidor = op.servidor ?? crearServidorDeSesion({ ahoraMs: op.ahora, espacios: op.espacios ?? null });
  let ejecucion = 0;
  const s: SesionDeMentira = {
    servidor, pid: op.pid, compromisos: [], malFormado: [], sinRama: false,
    alResponder: (ll, r) => {
      if (ll.nodo !== 'Traer configuración') return r;
      ejecucion++;
      if (s.sinRama) return r;
      const cuerpo = (ll.cuerpo ?? {}) as J;
      if (!cuerpo['sesion']) return r;
      const rs = servidor.atender(op.pid, cuerpo);
      if (rs.statusCode !== 200) return { statusCode: rs.statusCode, body: rs.body };
      if (r['statusCode'] === 200 && r['body'] && typeof r['body'] === 'object') return { ...r, body: { ...(r['body'] as J), conversacion: rs.body['conversacion'], visto: rs.body['visto'] } };
      return r;
    },
    dobles: {},
    bloque: (tel, espacio = ESPACIO) => {
      const c = servidor.conversacion(op.pid, espacio, tel);
      return (c.estado ?? null) as J | null;
    },
    estado: (tel, espacio = ESPACIO) => ((s.bloque(tel, espacio) ?? {})['estado'] ?? {}) as J,
    pedidos: (tel, espacio = ESPACIO) => ((s.bloque(tel, espacio) ?? {})['pedidos'] ?? {}) as J,
    copia: () => [...servidor.docs.entries()].map(([k, v]) => [k, clonar(v)] as [string, unknown]),
    restaurar: (copia) => { servidor.docs.clear(); for (const [k, v] of copia) servidor.docs.set(k, clonar(v)); },
    version: (tel, espacio = ESPACIO) => servidor.conversacion(op.pid, espacio, tel).version,
    sembrarBloque: (tel, bloque, espacio = ESPACIO, venceEnMin = 4320) => servidor.sembrar(op.pid, espacio, tel, bloque, venceEnMin),
    sembrar: (tel, estado, pedidos = {}, espacio = ESPACIO, venceEnMin = 4320) => servidor.sembrar(op.pid, espacio, tel, { v: 1, estado, pedidos }, venceEnMin),
  };
  for (const nodo of NODOS_COMPROMETER) {
    s.dobles[nodo] = (ll) => {
      if (ll.encabezados['X-NovuChat-Numero'] !== op.pid) s.malFormado.push(`${nodo}: falta X-NovuChat-Numero (${String(ll.encabezados['X-NovuChat-Numero'])})`);
      if (!/cloudfunctions\.net\/configuracionFlujo$/.test(ll.url)) s.malFormado.push(`${nodo}: URL inesperada ${ll.url}`);
      const cuerpo = (ll.cuerpo ?? {}) as J;
      if (Object.keys(cuerpo).sort().join() !== 'sesion,telefono') s.malFormado.push(`${nodo}: el cuerpo trae más que telefono y sesion`);
      s.compromisos.push({ nodo, cuerpo: clonar(cuerpo) });
      const q = cuerpo['sesion'] as J;
      return servidor.atender(op.pid, { ...cuerpo, sesion: { ...q, idCompromiso: `${String(q['idCompromiso'])}-x${ejecucion}` } });
    };
  }
  return s;
}

// ----------------------------------------------------------------------------- para las suites que corren los nodos Code uno por uno (sin el n8n de mentira)
/** Lo que agrega «Traer configuración» a la respuesta del panel: `conversacion` y `visto` (el `leer` de la sesión, con el id del mensaje). */
export function leerSesion(s: SesionDeMentira, from: string, idMensaje: string, ejecucion: string, espacio: string = ESPACIO): J {
  const r = s.servidor.atender(s.pid, { telefono: from, sesion: { v: 1, accion: 'leer', espacio, canal: 'wa', ejecucion, ...(idMensaje ? { idMensaje } : {}) } });
  return r.statusCode === 200 ? { conversacion: r.body['conversacion'], visto: r.body['visto'] } : {};
}
/** La respuesta del nodo HTTP «Comprometer turno» (o «Comprometer compensación») al compromiso que armó el flujo, o undefined si no armó ninguno. */
export function comprometer(s: SesionDeMentira, compromiso: J | null | undefined): J | undefined {
  if (!compromiso) return undefined;
  s.compromisos.push({ nodo: 'Comprometer turno', cuerpo: clonar(compromiso) });
  return s.servidor.atender(s.pid, compromiso) as unknown as J;
}
