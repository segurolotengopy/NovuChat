/**
 * TÉRMINOS DE PRODUCTO REGISTRADOS: LOS CALLABLES DEL PROPIETARIO (Plataforma, PR 3).
 * La lógica y el porqué están en `terminosProducto.ts`; acá solo la puerta:
 *   - SOLO el propietario de NovuChat con sesión de Google (`exigirPropietario`); un
 *     administrador, un operador, el soporte o un anónimo reciben `permission-denied` y no se
 *     lee ni se escribe nada;
 *   - decidir exige sesión reciente (como los pagos): afecta lo que el asistente deja pasar en
 *     producción;
 *   - errores con mensaje fijo (`MENSAJE`), sin decir qué regla falló.
 * `aprobarTerminoProducto` se fabrica con el predicado de Productos (`nombreDeProductoApto`), que
 * Plataforma no puede importar: lo inyecta `index.ts`, el único que conoce a los módulos.
 * Sin App Check, como el resto de las callables del propietario en Plataforma; sin tope de
 * llamadas por usuario (no hay precedente en Plataforma): cada llamada es una transacción y la
 * puerta es el propietario con Google y sesión reciente.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { exigirPropietario, exigirSesionReciente } from '../core/seguridad/autorizacion.js';
import { db, texto } from '../central/comunes.js';
import { ErrorTermino, MENSAJE, decidirTermino, esDecision, listarTerminos } from './terminosProducto.js';

const aHttps = (e: unknown): never => {
  if (!(e instanceof ErrorTermino)) throw e;
  const codigo = e.codigo === 'invalido' ? 'invalid-argument'
    : e.codigo === 'sin_comercio' || e.codigo === 'sin_termino' ? 'not-found'
      : e.codigo === 'tope' ? 'resource-exhausted' : 'failed-precondition';
  throw new HttpsError(codigo, MENSAJE[e.codigo]);
};

export const crearAprobarTerminoProducto = (nombreApto: (nombre: string) => boolean) => onCall(async (peticion) => {
  const uid = exigirPropietario(peticion);
  const datos = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = texto(datos['tenantId'], 60);
  const itemId = texto(datos['itemId'], 128);
  const decision = datos['decision'];
  if (!esDecision(decision)) throw new HttpsError('invalid-argument', MENSAJE.invalido);
  try {
    exigirSesionReciente(peticion, Date.now());
  } catch {
    throw new HttpsError('unauthenticated', 'Por seguridad, vuelva a iniciar sesión para decidir sobre un término.');
  }
  try {
    const r = await decidirTermino(db(), { tenantId, itemId, decision, quien: uid, nombreApto });
    return { ok: true, estado: r.estado, sinCambio: r.sinCambio, aprobados: r.aprobados };
  } catch (e) { return aHttps(e); }
});

export const terminosProductoDeTenant = onCall(async (peticion) => {
  exigirPropietario(peticion);
  const tenantId = texto((peticion.data as Record<string, unknown> | undefined)?.['tenantId'], 60);
  try {
    return await listarTerminos(db(), tenantId);
  } catch (e) { return aHttps(e); }
});
