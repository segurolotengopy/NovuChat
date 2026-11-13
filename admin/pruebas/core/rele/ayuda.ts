/**
 * Ayuda común de las suites del relé B9 (PR 1): arma un flujo mínimo con la cadena de envío del canal `rele` injertada y la corre en el n8n de mentira
 * con un DOBLE del relé que contesta lo que dice el guion de cada prueba. Nada de esto llama a la red.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injertar, type OpcionesDeEnvio } from '../../../../Flujos/src/core/sin-agente/envio.mjs';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type LlamadaDoble, type Mundo, type ResultadoTurno } from '../../lib/n8n-de-mentira';

const aqui = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(aqui, '../../../..');
export const leer = (ruta: string): string => readFileSync(join(RAIZ, ruta), 'utf8');
export const MENSAJES_JS = leer('Flujos/src/core/sin-agente/mensajes.js');

export const CLIENTE = 'prueba';
/** El `$workflow.id` del flujo de prueba (entra en la Idempotency-Key). */
export const WF = 'WF1';
export const CRED_RELE = 'AAB1 envío · prueba';
export const CRED_INGESTA = 'Ingesta de prueba';
export const OPC_RELE: OpcionesDeEnvio = {
  canal: 'rele', cliente: CLIENTE, credenciales: { rele: CRED_RELE, ingesta: CRED_INGESTA }, ingestaUrl: 'https://ingesta.example/ingesta',
};

const ARMAR = [
  'const e = $input.first().json;',
  "const lista = (e.mensajes || []).map((m) => Object.assign({ phoneNumberId: '5551234', reportar: true, tipoReporte: 'text' }, m));",
  'return (e.sinNumerar === true ? lista : cmNumerar(lista)).map((json) => ({ json }));',
].join('\n');

/** Un flujo mínimo: Entrada → (Config del negocio, Armar mensajes) → la cadena de envío injertada. */
export function flujoConCadena(opciones: Partial<OpcionesDeEnvio> = {}): Flujo {
  const base = {
    id: WF, name: 'prueba-rele', settings: {},
    nodes: [
      { name: 'Entrada de prueba', type: 'n8n-nodes-base.noOp', parameters: {}, position: [0, 0] },
      { name: 'Config del negocio', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [{ json: { modoPrueba: false } }];' }, position: [200, -100] },
      { name: 'Armar mensajes', type: 'n8n-nodes-base.code', parameters: { jsCode: `${MENSAJES_JS}\n${ARMAR}\n` }, position: [200, 300] },
    ],
    connections: { 'Entrada de prueba': { main: [[{ node: 'Config del negocio', type: 'main', index: 0 }, { node: 'Armar mensajes', type: 'main', index: 0 }]] } },
  } as unknown as Flujo;
  return injertar(base, { ...OPC_RELE, ...opciones });
}

/** Un mensaje de texto de la prueba (el payload lleva `to` con «+», como lo arma un flujo real a veces). */
export const mensaje = (i: number, extra: J = {}): J => ({
  para: `+7000000${i}`, texto: `texto ${i}`, respaldo: `respaldo ${i}`,
  payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: `+7000000${i}`, type: 'text', text: { preview_url: true, body: `texto ${i}` } },
  ...extra,
});

export const ok = (id: string): J => ({ messages: [{ id: `wamid.${id}` }] });
export const falla = (codigo: string, extra: J = {}): J => ({ error: { codigo, reintentable: false, ...extra } });

export interface Envio { nodo: string; clave: string; vez: number; url: string; cuerpo: J; encabezados: Record<string, string>; parametros: J }
export type Guion = (envio: Envio) => J;

export interface MundoRele { mu: Mundo; envios: Envio[]; porNodo: (nodo: string) => Envio[] }

/** El mundo con el doble del relé: `guion` contesta cada envío ("vez" cuenta los envíos con la MISMA clave en el mismo nodo). */
export function mundoRele(guion: Guion, opciones: Partial<OpcionesDeEnvio> = {}, extra: Record<string, (ll: LlamadaDoble) => J> = {}): MundoRele {
  const envios: Envio[] = [];
  const veces = new Map<string, number>();
  const doble = (nodo: string) => (ll: LlamadaDoble): J => {
    const clave = ll.encabezados['Idempotency-Key'] ?? '';
    const vez = (veces.get(`${nodo}|${clave}`) ?? 0) + 1;
    veces.set(`${nodo}|${clave}`, vez);
    const e: Envio = { nodo, clave, vez, url: ll.url, cuerpo: ll.cuerpo ?? {}, encabezados: ll.encabezados, parametros: ll.parametros };
    envios.push(e);
    return guion(e);
  };
  const mu = crearMundo({
    flujo: flujoConCadena(opciones), ahoraMs: Date.UTC(2026, 10, 2, 15, 0, 0),
    dobles: {
      'Enviar a WhatsApp': doble('Enviar a WhatsApp'), 'Enviar respaldo': doble('Enviar respaldo'),
      'Reportar mensaje (saliente)': () => ({ ok: true }),
      ...extra,
    },
  });
  return { mu, envios, porNodo: (n) => envios.filter((e) => e.nodo === n) };
}

/** Como `turno`, pero el error de la ejecución queda en `resultado.fallo`: para los casos que terminan en error a propósito (incierto o agotado, I4). */
export const turnoConError = (m: MundoRele, mensajes: J[], op: { idEjecucion?: string; sinNumerar?: boolean } = {}): ResultadoTurno => turno(m, mensajes, { ...op, tolerarFallo: true });
/** `tolerarFallo` solo en los casos que terminan EN ERROR a propósito (incierto o agotado, decisión I4): ahí el error queda en `resultado.fallo`; en los demás un error lanza. */
export const turno = (m: MundoRele, mensajes: J[], op: { idEjecucion?: string; sinNumerar?: boolean; tolerarFallo?: boolean } = {}): ResultadoTurno =>
  m.mu.turno({ mensajes, sinNumerar: op.sinNumerar === true }, { idEjecucion: op.idEjecucion ?? 'E1', tolerarFallo: op.tolerarFallo === true });
