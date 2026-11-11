/**
 * =============================================================================
 * ENTREGAR LOS BYTES DE UN ADJUNTO DE PERSONA AL FLUJO — `leerAdjuntoPersona` (CORE, B2)
 * =============================================================================
 *
 * Decisión D5 de Andres (10/11/2026): la Function, autenticada por número, entrega los bytes a n8n (nada de URL firmada).
 * El flujo «Salida de persona» reclamó el mensaje (`reclamarSalidaPersona`, que ya lo pasó a `enviando`) y llama acá con la
 * credencial de la ingesta DE SU NÚMERO (Bearer o firma HMAC, la de `rutaAutenticada`, igual que reclamar y confirmar).
 *
 * ENTRADA   POST, JSON `{mensajeId, conversacionId}` (exactamente esas dos claves). El comercio sale de la ruta
 *           autenticada, nunca del cuerpo; la ruta de Storage la lee el servidor del metadato, nunca de la petición.
 * SALIDA    200 con los bytes crudos (`application/octet-stream`) y cabeceras `X-NovuChat-Mime`, `X-NovuChat-Sha256`
 *           y `Content-Length`. Errores en texto plano: 405 (método), 401 (credencial, sin decir por qué), 404 (número sin
 *           comercio, mensaje inexistente, de otro comercio u otra línea, metadato vencido o ausente), 400 (forma),
 *           409 (el mensaje no está `enviando`), 503 (almacén o integridad: tamaño o sha256 distinto del guardado).
 *
 * LO QUE EXIGE, cada línea con una prueba que la niega (`pruebas/core/salida-persona.test.ts`):
 *   - comercio activo y ruta activa DEL MISMO comercio;
 *   - un mensaje de PERSONA, saliente, de ESE `phoneNumberId`, de tipo adjunto y en estado `enviando` (un `pendiente` o un
 *     `aceptado` no entregan nada: solo lo que se está enviando ahora);
 *   - el metadato `guardado`, vigente y de ESE mensaje; la ruta validada por `rutaValidaDeEnviado`; el tamaño dentro del
 *     tope del tipo; los bytes con el sha256 guardado.
 *
 * Los registros: solo `{tenantId, tamano, codigo}`. Nunca el teléfono, el mensaje, el objeto, la ruta, el nombre ni la leyenda.
 * Memoria: el archivo mayor es de 16 MiB; 1 GiB con concurrencia 4 como `verMedio`. Cero mensajes por conversación.
 */
import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada, type Ruta } from '../seguridad/firma.js';
import { ID_COMERCIO } from '../conversacion/acceso.js';
import { CLAVE_DE_ENVIO } from '../conversacion/salidaPersona.js';
import { ID_CONVERSACION, milisegundosDeMomento } from '../conversacion/turno.js';
import { almacenDeMedios, rutaValidaDeEnviado, type Almacen } from './almacen.js';
import { TOPE_DE_ADJUNTO, type TipoDeAdjunto } from './salientes.js';

export const CONCURRENCIA_DE_LEER_ADJUNTO = 4;
const TIPOS: readonly string[] = ['image', 'audio', 'document'];

export interface PedidoDeAdjunto { mensajeId: string; conversacionId: string }

/** El pedido validado, o `null` si no es exactamente `{mensajeId, conversacionId}` con su forma. */
export function leerPedido(cuerpo: unknown): PedidoDeAdjunto | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return null;
  const b = cuerpo as Record<string, unknown>;
  if (Object.keys(b).length !== 2) return null;
  const { mensajeId, conversacionId } = b;
  if (typeof mensajeId !== 'string' || !CLAVE_DE_ENVIO.test(mensajeId)) return null;
  if (typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)) return null;
  return { mensajeId, conversacionId };
}

export type ResultadoDeLectura =
  | { codigo: 200; bytes: Buffer; mime: string; sha256: string }
  | { codigo: 404 | 409 | 503; tamano?: number };

/** La lectura (exportada para las pruebas). */
export async function leerAdjunto(
  ruta: Ruta, pedido: PedidoDeAdjunto,
  deps: { db?: Firestore; almacen?: Almacen; ahoraMs?: number } = {},
): Promise<ResultadoDeLectura> {
  const db = deps.db ?? getFirestore();
  const almacen = deps.almacen ?? almacenDeMedios();
  const ahoraMs = deps.ahoraMs ?? Date.now();
  const { tenantId, phoneNumberId } = ruta;

  const refMensaje = db.doc(`tenants/${tenantId}/conversaciones/${pedido.conversacionId}/mensajes/${pedido.mensajeId}`);
  const [tenant, rutaDoc, m] = await Promise.all([
    db.doc(`tenants/${tenantId}`).get(), db.doc(`rutasWhatsApp/${phoneNumberId}`).get(), refMensaje.get(),
  ]);
  if (tenant.get('estado') !== 'activo' || !rutaDoc.exists || rutaDoc.get('estado') !== 'activo'
      || rutaDoc.get('tenantId') !== tenantId) return { codigo: 404 };
  if (!m.exists || m.get('tenantId') !== tenantId || m.get('direccion') !== 'saliente' || m.get('autor') !== 'persona') return { codigo: 404 };
  const de: unknown = m.get('phoneNumberId');
  if (typeof de !== 'string' || de !== phoneNumberId) return { codigo: 404 };
  const tipo: unknown = m.get('tipo');
  if (typeof tipo !== 'string' || !TIPOS.includes(tipo)) return { codigo: 404 };
  if (m.get('estadoEnvio') !== 'enviando') return { codigo: 409 };

  const objeto: unknown = m.get('medio.objeto');
  if (typeof objeto !== 'string' || objeto.length === 0) return { codigo: 404 };
  const meta = await db.doc(`tenants/${tenantId}/mediosEnviados/${objeto}`).get();
  if (!meta.exists || meta.get('estado') !== 'guardado' || meta.get('mensajeId') !== pedido.mensajeId
      || meta.get('conversacionId') !== pedido.conversacionId || meta.get('tipo') !== tipo) return { codigo: 404 };
  const vence = milisegundosDeMomento(meta.get('vence'));
  if (vence === null || vence <= ahoraMs) return { codigo: 404 };
  const valida = rutaValidaDeEnviado(meta.get('ruta'), tenantId, objeto);
  const mime: unknown = meta.get('mime');
  const sha256: unknown = meta.get('sha256');
  const tamanoGuardado: unknown = meta.get('tamano');
  if (valida === null || typeof mime !== 'string' || mime !== m.get('medio.mime') || typeof sha256 !== 'string'
      || typeof tamanoGuardado !== 'number') return { codigo: 404 };

  const maximo = TOPE_DE_ADJUNTO[tipo as TipoDeAdjunto];
  const info = await almacen.metadatos(valida.ruta);
  if (info === null) return { codigo: 404 };
  if (!(info.tamano <= maximo) || info.tamano !== tamanoGuardado) return { codigo: 503, tamano: Number.isFinite(info.tamano) ? info.tamano : undefined };
  const bytes = await almacen.leer(valida.ruta);
  if (bytes === null) return { codigo: 404 };
  if (bytes.length > maximo || bytes.length !== tamanoGuardado
      || createHash('sha256').update(bytes).digest('hex') !== sha256) return { codigo: 503, tamano: bytes.length };
  return { codigo: 200, bytes, mime, sha256 };
}

export const leerAdjuntoPersona = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false, // servidor a servidor
    memory: '1GiB',
    timeoutSeconds: 120,
    maxInstances: 3,
    // Sin `concurrency` en staging (menos de 1 vCPU: firebase-tools la rechaza), como `verMedio`.
    ...(process.env['CPU_FRACCIONARIA'] === 'si' ? {} : { concurrency: CONCURRENCIA_DE_LEER_ADJUNTO }),
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (!ID_COMERCIO.test(ruta.tenantId)) { respuesta.status(404).send('numero no asignado'); return; }
    const pedido = leerPedido(peticion.body);
    if (!pedido) { respuesta.status(400).send('solicitud invalida'); return; }
    try {
      const r = await leerAdjunto(ruta, pedido);
      logger.info('leerAdjuntoPersona', {
        tenantId: ruta.tenantId, codigo: r.codigo, ...(r.codigo === 200 ? { tamano: r.bytes.length } : r.tamano !== undefined ? { tamano: r.tamano } : {}),
      });
      if (r.codigo === 200) {
        respuesta.status(200)
          .set({
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(r.bytes.length),
            'X-NovuChat-Mime': r.mime,
            'X-NovuChat-Sha256': r.sha256,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          })
          .end(r.bytes);
        return;
      }
      respuesta.status(r.codigo).send(r.codigo === 404 ? 'no existe' : r.codigo === 409 ? 'no esta enviando' : 'no disponible');
    } catch (e) {
      const c = (e as { code?: unknown } | null)?.code;
      logger.error('leerAdjuntoPersona: falló', { tenantId: ruta.tenantId, codigo: typeof c === 'string' || typeof c === 'number' ? String(c) : 'desconocido' });
      respuesta.status(503).send('no disponible');
    }
  },
);
