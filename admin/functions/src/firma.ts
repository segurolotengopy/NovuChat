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
  // ---------------------------------------------------------------------------
  // RESERVA DE ALIAS PARA CLIENTES, declarada el 2026-09-07.
  //
  // QUÉ PROBLEMA RESUELVE. `defineSecret` exige que el nombre esté escrito en el
  // código, así que cada cliente nuevo obligaba a editar este archivo y
  // **desplegar Functions**. Un despliegue por alta es un procedimiento de
  // ingeniería en medio de una gestión comercial: lento, con riesgo, y
  // dependiente de que haya alguien capaz de hacerlo. Con la reserva ya
  // declarada, dar de alta un cliente es: tomar el valor del alias libre que
  // sigue y escribir `aliasSecreto` en su ruta de WhatsApp. Ni una línea de
  // código, ni un despliegue.
  //
  // POR QUÉ CADA UNO CON SU PROPIO SECRETO, y no un solo secreto con un mapa
  // JSON adentro —que sería ilimitado y no necesitaría reserva—: el radio de
  // daño. Un mapa filtrado entrega las claves de TODOS los clientes de una vez.
  // Veinte secretos separados cuestan poco más de un dólar al mes y hacen que
  // filtrar uno sea filtrar uno.
  //
  // POR QUÉ NACEN CON UN VALOR REAL Y ALEATORIO, y no con un marcador. Dos
  // razones, y la segunda no es obvia:
  //  1. Un marcador conocido sería una credencial válida el día que alguien
  //     asigne ese alias y se olvide de rotarlo.
  //  2. Si el valor se creara EN EL ALTA, sería una versión nueva del secreto, y
  //     las instancias de Functions que ya están corriendo siguen con la versión
  //     vieja hasta reciclarse: el cliente recién dado de alta fallaría de forma
  //     intermitente durante unos minutos, que es el peor tipo de falla. Naciendo
  //     con su valor, en el alta no se crea ninguna versión y no hay nada que
  //     esperar.
  //
  // CUANDO SE ACABEN LOS VEINTE, hay que ampliar la reserva y desplegar UNA vez,
  // no una por cliente. Conviene hacerlo con holgura, no con el cliente 20 ya
  // firmado.
  cliente01: defineSecret('INGESTA_CLIENTE01'),
  cliente02: defineSecret('INGESTA_CLIENTE02'),
  cliente03: defineSecret('INGESTA_CLIENTE03'),
  cliente04: defineSecret('INGESTA_CLIENTE04'),
  cliente05: defineSecret('INGESTA_CLIENTE05'),
  cliente06: defineSecret('INGESTA_CLIENTE06'),
  cliente07: defineSecret('INGESTA_CLIENTE07'),
  cliente08: defineSecret('INGESTA_CLIENTE08'),
  cliente09: defineSecret('INGESTA_CLIENTE09'),
  cliente10: defineSecret('INGESTA_CLIENTE10'),
  cliente11: defineSecret('INGESTA_CLIENTE11'),
  cliente12: defineSecret('INGESTA_CLIENTE12'),
  cliente13: defineSecret('INGESTA_CLIENTE13'),
  cliente14: defineSecret('INGESTA_CLIENTE14'),
  cliente15: defineSecret('INGESTA_CLIENTE15'),
  cliente16: defineSecret('INGESTA_CLIENTE16'),
  cliente17: defineSecret('INGESTA_CLIENTE17'),
  cliente18: defineSecret('INGESTA_CLIENTE18'),
  cliente19: defineSecret('INGESTA_CLIENTE19'),
  cliente20: defineSecret('INGESTA_CLIENTE20'),
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
  const cabecera = String(peticion.get('Authorization') ?? '').trim();
  // Se acepta con y sin el prefijo `Bearer`. No es laxitud: el secreto es el
  // mismo en los dos casos y no se gana nada exigiendo la palabra. Lo que se
  // evita es una clase entera de error de configuración —pegar el valor sin el
  // prefijo en la credencial de n8n— que se manifiesta como un 401 idéntico al
  // de un token equivocado, o sea imposible de distinguir desde afuera. Ya nos
  // costó una tarde.
  const dado = (cabecera.startsWith('Bearer ') ? cabecera.slice(7) : cabecera).trim();
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
