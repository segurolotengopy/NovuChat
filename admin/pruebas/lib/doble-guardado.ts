/**
 * EL DOBLE DEL GUARDADO DE MEDIOS: el servidor `guardarMedio` (contrato M1↔M2 del 29/10/2026, §1 y §2, con el contrato v2 «guardar y descargar TODO» del
 * 30/10) y la descarga PROPIA de Meta de la rama común (`Flujos/experimental/comun-sin-agente/src/guardado.mjs`). Se prueba contra el CONTRATO, no contra el
 * código de M1. Contrato v2: ya no hay modo Anotar (todo medio se guarda con sus bytes); `429` trae `cupo_diario_lleno` o `cupo_telefono_lleno`.
 * Por omisión responde como un comercio con la bandera APAGADA (`409 guardado_apagado`): es el estado por defecto (decisión de Andres) y deja a
 * todas las suites de cada flujo como estaban, sin un mensaje de más. Una prueba cambia la respuesta con `respuesta` (un código y un cuerpo, o una
 * función por llamada), el tamaño que informa Meta con `bytes`, o hace caer la red con `'lanza'`. `llamadas` junta lo que el flujo mandó.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Doble, LlamadaDoble } from './n8n-de-mentira';
import type { J } from './flujo';

export interface RespuestaDelServidor { statusCode: number; body: J | string }
export interface OpcionesDelGuardado {
  /** Lo que contesta `guardarMedio` («Guardar medio» y «Reintentar el guardado»). */
  respuesta?: RespuestaDelServidor | 'lanza' | ((ll: LlamadaDoble) => RespuestaDelServidor | 'lanza');
  /** El tamaño que informa Meta en `GET /{media-id}` de la rama del guardado. */
  bytes?: number;
  /** El mime que informa Meta (por omisión, image/jpeg). */
  mime?: string;
  /** La URL que devuelve Meta (por omisión, la de su CDN). */
  url?: string;
  /** Lo que contesta Meta al aviso de falla. */
  aviso?: 'acepta' | 'error' | 'lanza';
}
export interface RegistroDelGuardado {
  guardar: LlamadaDoble[];
  obtener: LlamadaDoble[];
  descargar: LlamadaDoble[];
  avisos: LlamadaDoble[];
  /** Las llamadas de «Reintentar el guardado» (el único reintento ante un 5xx). */
  reintentos: LlamadaDoble[];
  /** Las llamadas que LLEGARON a `guardarMedio` (las de «Guardar medio» y «Reintentar el guardado» con binario). */
  servidor: LlamadaDoble[];
}

export const APAGADO: RespuestaDelServidor = { statusCode: 409, body: { error: 'guardado_apagado' } };

/** Los dobles de los cinco nodos de red de la rama, y el registro de llamadas. */
export function doblesDelGuardado(o: OpcionesDelGuardado = {}): { dobles: Record<string, Doble>; llamadas: RegistroDelGuardado } {
  const llamadas: RegistroDelGuardado = { guardar: [], obtener: [], descargar: [], avisos: [], reintentos: [], servidor: [] };
  const servidor = (ll: LlamadaDoble): J => {
    llamadas.servidor.push(ll);
    const r = typeof o.respuesta === 'function' ? o.respuesta(ll) : (o.respuesta ?? APAGADO);
    if (r === 'lanza') throw new Error('fetch failed: guardarMedio no responde');
    return { statusCode: r.statusCode, headers: {}, body: r.body };
  };
  const dobles: Record<string, Doble> = {
    'Guardar medio': (ll) => {
      llamadas.guardar.push(ll);
      // Como en n8n: si la descarga falló, el ítem no trae el binario `data` y el nodo falla ANTES de llamar al servidor.
      if (ll.item && ll.item['error'] !== undefined) throw new Error('This operation expects the node\'s input data to contain a binary file \'data\'');
      return servidor(ll);
    },
    'Reintentar el guardado': (ll) => {
      llamadas.reintentos.push(ll);
      return servidor(ll);
    },
    'Pedir el medio a Meta (guardado)': (ll) => {
      llamadas.obtener.push(ll);
      return { id: 'm', url: o.url ?? 'https://lookaside.fbsbx.com/whatsapp_business/attachments/guardado-1', mime_type: o.mime ?? 'image/jpeg', file_size: o.bytes ?? 200_000 };
    },
    'Descargar medio (guardado)': (ll) => {
      llamadas.descargar.push(ll);
      // El nodo real falla con una URL vacía (la rama no baja un medio demasiado grande): el doble hace lo mismo.
      if (!ll.url) throw new Error('Invalid URL');
      return { descargado: true };
    },
    'Avisar falla del guardado': (ll) => {
      llamadas.avisos.push(ll);
      if (o.aviso === 'lanza') throw new Error('fetch failed: red caída');
      // Sin `onError` en el nodo, un rechazo de Meta (4xx) es un error de n8n: el doble lanza igual.
      if (o.aviso === 'error') throw new Error('(#131047) Re-engagement message');
      return { messaging_product: 'whatsapp', messages: [{ id: `wamid.GM${ll.n}` }] };
    },
  };
  return { dobles, llamadas };
}

/**
 * Para las pruebas que corren un `construir.mjs` sobre una COPIA en un temporal (`<raiz>/Flujos/experimental/<flujo>`): el guardado es un módulo
 * común que el constructor INCLUYE (no copia), así que la copia necesita también el armado (`comun-sin-agente/src/guardado.mjs`) y el código de
 * los nodos (`Flujos/src/core/medios/guardado-*.js`), en las mismas rutas relativas.
 */
const FLUJOS_REALES = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos');
export function copiarModuloDelGuardado(raiz: string): void {
  for (const rel of ['experimental/comun-sin-agente/src/guardado.mjs', 'src/core/medios/guardado-preparar.js', 'src/core/medios/guardado-resultado.js', 'src/core/medios/guardado-reintento.js']) {
    const destino = join(raiz, 'Flujos', rel);
    mkdirSync(dirname(destino), { recursive: true });
    cpSync(join(FLUJOS_REALES, rel), destino);
  }
}
