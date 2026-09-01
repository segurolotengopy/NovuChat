import { createHmac, timingSafeEqual } from 'node:crypto';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * =============================================================================
 * VERIFICACIÓN DE FIRMA DE LAS PETICIONES DE n8n
 * =============================================================================
 *
 * EL PROBLEMA QUE RESUELVE, y que dejó al mapa de secretos de `ingesta.ts`
 * vacío desde el principio. Un secreto de Cloud Functions se declara con un
 * NOMBRE FIJO en el código (`defineSecret`), porque tiene que existir en tiempo
 * de despliegue. La idea original era un secreto por número —
 * `INGESTA_PNID_<phone_number_id>`—, y eso obliga a escribir el identificador
 * del número de WhatsApp en el código. Este repositorio es PÚBLICO y los
 * identificadores de número se sanean, así que el mapa nunca se pudo llenar y
 * la ingesta quedó sin ningún número habilitado.
 *
 * LA SALIDA: un ALIAS. El secreto se llama por un apodo que no revela nada
 * (`demoA`, `demoB`), y quién es cada alias vive en `/rutasWhatsApp/{numero}`,
 * en la base, donde ya vive todo lo demás de ese número. El código no nombra
 * ningún número y sigue habiendo UN SECRETO POR NÚMERO: comprometer el de un
 * comercio no alcanza a los demás, que era la propiedad que se quería.
 *
 * LO QUE NO CAMBIA, porque es lo que sostiene el aislamiento:
 *
 *   - La cabecera con el número solo SELECCIONA con qué clave verificar. No
 *     autoriza nada: si la firma no cierra, se rechaza.
 *   - El tenant se deriva de la clave que validó la firma, NUNCA del cuerpo.
 *     Aunque n8n mandara `{"tenantId": "otro-negocio"}`, ese campo se ignora.
 *   - La firma cubre la marca de tiempo Y el cuerpo crudo, con una ventana
 *     corta, para que una petición capturada no se pueda reproducir.
 *   - La comparación es en tiempo constante: un `===` filtra el secreto por
 *     temporización.
 */

export const SECRETOS_POR_ALIAS: Record<string, ReturnType<typeof defineSecret>> = {
  demoA: defineSecret('INGESTA_DEMOA'),
  demoB: defineSecret('INGESTA_DEMOB'),
};

const VENTANA_MS = 5 * 60 * 1000;   // Tolerancia de reloj y de red.
const MAX_CUERPO = 64 * 1024;

/** Compara en tiempo constante. Un `===` filtra el secreto por temporización. */
function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, 'hex');
  const b = Buffer.from(recibida, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface Ruta {
  phoneNumberId: string;
  tenantId: string;
  flujo: string;
  estado: string;
}

/**
 * =============================================================================
 * DOS FORMAS DE AUTENTICAR, Y POR QUÉ
 * =============================================================================
 *
 * FIRMA HMAC (preferida). Cubre cuerpo y marca de tiempo, así que además de
 * autenticar impide reproducir una petición capturada y alterarla. Es lo que
 * debería usar cualquier llamador que pueda calcularla.
 *
 * TOKEN FIJO EN CABECERA (para n8n). n8n no puede firmar sin tener la clave a
 * mano dentro de un nodo del flujo, y la prohibición 2 de CLAUDE.md dice que un
 * secreto vive en `.env` y en el gestor de contraseñas, no en un archivo del
 * repositorio ni —por el mismo criterio— suelto en el lienzo. Un token fijo, en
 * cambio, entra en una CREDENCIAL de n8n, que n8n guarda cifrada y no exporta
 * en el JSON del flujo.
 *
 * QUÉ SE PIERDE Y POR QUÉ SE ACEPTA. El token no protege contra reproducción
 * ni prueba integridad del cuerpo. Lo segundo lo cubre TLS. Lo primero lo cubre
 * la idempotencia de este endpoint: reproducir una petición vuelve a escribir
 * el MISMO documento y el contador no se mueve, que es justo el daño que habría
 * que evitar. En otro endpoint —uno que cobrara, o que mandara un mensaje— esta
 * concesión no sería aceptable.
 *
 * En los dos casos el token o la clave son POR NÚMERO, y el tenant sale de la
 * ruta, nunca del cuerpo.
 */
async function tokenValido(peticion: { get(n: string): string | undefined },
                           secreto: string): Promise<boolean> {
  const cabecera = String(peticion.get('Authorization') ?? '');
  const dado = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
  if (!dado) return false;
  // Tiempo constante también acá: comparar con `===` filtra el token.
  const a = Buffer.from(dado);
  const b = Buffer.from(secreto);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Devuelve la ruta del comercio si —y solo si— la petición viene firmada con el
 * secreto de ESE número, o trae su token. `null` en cualquier otro caso, sin
 * decir por qué: a quien no pasa no se le explica qué le faltó.
 */
export async function rutaAutenticada(peticion: {
  get(nombre: string): string | undefined;
  rawBody?: Buffer;
}): Promise<Ruta | null> {
  const phoneNumberId = String(peticion.get('X-NovuChat-Numero') ?? '');
  const marca = String(peticion.get('X-NovuChat-Timestamp') ?? '');
  const firma = String(peticion.get('X-NovuChat-Signature') ?? '').replace(/^sha256=/, '');

  // Lo barato primero. Descartar por forma antes de tocar la base evita que una
  // petición basura cueste una lectura.
  if (!/^[0-9]{6,25}$/.test(phoneNumberId)) return null;

  const crudo = peticion.rawBody ?? Buffer.from('');
  if (crudo.length > MAX_CUERPO) return null;

  const doc = await getFirestore().doc(`rutasWhatsApp/${phoneNumberId}`).get();
  if (!doc.exists) return null;

  const alias = String(doc.get('aliasSecreto') ?? '');
  const secreto = SECRETOS_POR_ALIAS[alias];
  if (!secreto) return null;

  if (firma) {
    const marcaMs = Number(marca);
    if (!Number.isFinite(marcaMs) || Math.abs(Date.now() - marcaMs) > VENTANA_MS) return null;
    const esperada = createHmac('sha256', secreto.value())
      .update(`${marca}.`).update(crudo).digest('hex');
    if (!firmaValida(esperada, firma)) return null;
  } else if (!await tokenValido(peticion, secreto.value())) {
    return null;
  }

  return {
    phoneNumberId,
    tenantId: String(doc.get('tenantId') ?? ''),
    flujo: String(doc.get('flujo') ?? ''),
    estado: String(doc.get('estado') ?? ''),
  };
}

/**
 * Enmascara un teléfono para que pueda viajar a un documento que NovuChat lee.
 * Deja los primeros tres y los últimos tres, que alcanzan para que el negocio
 * reconozca a su cliente y no alcanzan para identificarlo desde afuera. El
 * formato coincide con el que exigen las reglas de `/cierres` y de la bitácora.
 */
export function enmascarar(telefono: string): string {
  const d = telefono.replace(/\D/g, '');
  if (d.length < 7) return '***';
  return `${d.slice(0, 3)}****${d.slice(-3)}`;
}
