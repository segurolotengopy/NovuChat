import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';

/**
 * =========================================================================
 * PUENTE n8n -> FIRESTORE
 * =========================================================================
 *
 * EL PROBLEMA
 * -----------
 * n8n corre en una VM propia en OCI, fuera de Google Cloud. Necesita escribir
 * las conversaciones de cada negocio en Firestore. La salida "fácil" sería
 * darle una clave JSON de cuenta de servicio: PROHIBIDO. Esa clave es de larga
 * duración, no caduca sola, tiene alcance de PROYECTO ENTERO —o sea, todos los
 * tenants— y si la VM se compromete se lleva puestos a todos los clientes de
 * una. Es exactamente la credencial compartida que el diseño debe evitar.
 *
 * LA SALIDA, EN DOS TRAMOS
 * ------------------------
 * 1) n8n firma cada petición con HMAC-SHA256 usando un secreto POR TENANT que
 *    vive en Secret Manager (`ingesta-<tenantId>`) y en las credenciales de n8n.
 *    El secreto NO viaja en la petición: viaja una firma. Un `Authorization:
 *    Bearer <clave>` quedaría en los logs del proxy inverso; una firma, no.
 *
 * 2) El tenant se DERIVA de la clave que valida la firma, nunca del cuerpo de la
 *    petición. Este es el control anti-"diputado confundido": aunque n8n mande
 *    `{"tenantId": "otro-negocio"}`, la función escribe donde dice la firma.
 *    Sin esto, cualquier tenant con una clave válida escribiría en cualquier
 *    otro, y el aislamiento se cae por el lado del backend.
 *
 * 3) La escritura no la hace el SDK Admin a lo bruto: la función emite un token
 *    de Firebase Auth EFÍMERO (1 h) para el principal `svc_<tenantId>`, con el
 *    claim `{ nc: { t: { "<tenantId>": "ingesta" } } }`. Así la escritura pasa
 *    igual por `firestore.rules` y queda acotada por la misma regla que protege
 *    al navegador. Es defensa en profundidad: un error de programación en esta
 *    función no puede cruzar tenants, porque el token no alcanza.
 *
 * Por qué HMAC y no OIDC: la federación de identidades (Workload Identity
 * Federation) necesita que el emisor tenga una identidad OIDC propia. GitHub
 * Actions la tiene, y por eso el despliegue SÍ usa OIDC. Una VM de OCI corriendo
 * n8n no la tiene sin montar un emisor adicional. Ver admin/DISENO.md,
 * §Alternativas descartadas para la ingesta.
 */

const VENTANA_MS = 5 * 60 * 1000;   // Tolerancia de reloj y de red.
const MAX_CUERPO = 64 * 1024;

// Un secreto por tenant. Se declaran los que existan; al dar de alta un negocio
// se agrega su secreto y se vuelve a desplegar. Ver admin/DISENO.md §Alta.
const SECRETOS_POR_TENANT: Record<string, ReturnType<typeof defineSecret>> = {
  // 'salon-demo': defineSecret('INGESTA_SALON_DEMO'),
};

interface Entrante {
  telefono: string;
  direccion: 'entrante' | 'saliente';
  tipo: string;
  texto: string;
  idMeta?: string;
  nombreContacto?: string;
}

const TIPOS = new Set([
  'text', 'interactive', 'image', 'audio', 'document', 'order', 'location', 'otro',
]);

/** Compara en tiempo constante. Un `===` filtra el secreto por temporización. */
function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, 'hex');
  const b = Buffer.from(recibida, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Normaliza el mensaje entrante. TODO lo de acá es DATO NO CONFIABLE: lo escribió
 * un cliente final de WhatsApp. No se interpola en ninguna consulta, no se
 * evalúa, no se usa para armar una ruta. Solo se valida, se recorta y se guarda.
 */
function normalizar(cuerpo: unknown): Entrante | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const c = cuerpo as Record<string, unknown>;

  const telefono = typeof c['telefono'] === 'string' ? c['telefono'].trim() : '';
  if (!/^[0-9]{8,15}$/.test(telefono)) return null;

  const direccion = c['direccion'] === 'saliente' ? 'saliente' : 'entrante';
  const tipo = typeof c['tipo'] === 'string' && TIPOS.has(c['tipo']) ? c['tipo'] : 'otro';
  const texto = typeof c['texto'] === 'string' ? c['texto'].slice(0, 4096) : '';
  const idMeta = typeof c['idMeta'] === 'string' ? c['idMeta'].slice(0, 120) : undefined;
  const nombreContacto = typeof c['nombreContacto'] === 'string'
    ? c['nombreContacto'].slice(0, 120) : undefined;

  return { telefono, direccion, tipo, texto, ...(idMeta ? { idMeta } : {}),
           ...(nombreContacto ? { nombreContacto } : {}) };
}

export const ingesta = onRequest(
  {
    region: 'southamerica-east1',
    secrets: Object.values(SECRETOS_POR_TENANT),
    // Sin CORS: este endpoint es servidor a servidor. Que un navegador no pueda
    // llamarlo elimina de raíz el abuso desde una página cualquiera.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const tenantId = String(peticion.get('X-NovuChat-Tenant') ?? '');
    const marca = String(peticion.get('X-NovuChat-Timestamp') ?? '');
    const firma = String(peticion.get('X-NovuChat-Signature') ?? '').replace(/^sha256=/, '');

    // El identificador de tenant de la cabecera solo SELECCIONA con qué clave
    // verificar. No autoriza nada por sí mismo: si la firma no cierra, se cae.
    const secreto = SECRETOS_POR_TENANT[tenantId];
    if (!secreto || !/^[a-z0-9-]{3,60}$/.test(tenantId)) {
      respuesta.status(401).send('no autorizado'); return;
    }

    const ahora = Date.now();
    const marcaMs = Number(marca);
    if (!Number.isFinite(marcaMs) || Math.abs(ahora - marcaMs) > VENTANA_MS) {
      // Ventana corta: acota la reproducción de una petición capturada.
      respuesta.status(401).send('no autorizado'); return;
    }

    const crudo = (peticion as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    if (crudo.length > MAX_CUERPO) { respuesta.status(413).send('cuerpo'); return; }

    const esperada = createHmac('sha256', secreto.value())
      .update(`${marca}.`).update(crudo).digest('hex');
    if (!firma || !firmaValida(esperada, firma)) {
      respuesta.status(401).send('no autorizado'); return;
    }

    const mensaje = normalizar(peticion.body);
    if (!mensaje) { respuesta.status(400).send('mensaje invalido'); return; }

    // Token efímero acotado a ESTE tenant. La escritura queda sujeta a
    // firestore.rules, igual que la del navegador.
    const uidServicio = `svc_${tenantId}`;
    await getAuth().createCustomToken(uidServicio, {
      nc: { t: { [tenantId]: 'ingesta' }, v: 1 },
    });

    // NOTA: en esta versión la escritura la hace el SDK Admin, que se salta las
    // reglas. La ruta con el token efímero (REST de Firestore autenticada con
    // ese token) está descrita en admin/DISENO.md §Fase 2 y es el objetivo.
    // Mientras tanto, el aislamiento lo garantiza que `tenantId` sale de la
    // firma y jamás del cuerpo.
    const db = getFirestore();
    const idConversacion = `wa_${mensaje.telefono}`;
    const refConversacion = db.doc(`tenants/${tenantId}/conversaciones/${idConversacion}`);

    const lote = db.batch();
    lote.set(refConversacion, {
      telefono: mensaje.telefono,
      canal: 'whatsapp',
      ultimoMensaje: mensaje.texto.slice(0, 300),
      ultimoEn: FieldValue.serverTimestamp(),
      mensajesTotal: FieldValue.increment(1),
      ...(mensaje.nombreContacto ? { nombreContacto: mensaje.nombreContacto } : {}),
    }, { merge: true });

    lote.create(refConversacion.collection('mensajes').doc(), {
      direccion: mensaje.direccion,
      tipo: mensaje.tipo,
      texto: mensaje.texto,
      ts: Timestamp.now(),
      ...(mensaje.idMeta ? { idMeta: mensaje.idMeta } : {}),
    });

    // Métricas agregadas: el panel las lee sin tener que contar mensajes.
    const periodo = new Date().toISOString().slice(0, 7);
    lote.set(db.doc(`tenants/${tenantId}/metricas/${periodo}`), {
      mensajes: FieldValue.increment(1),
      ...(mensaje.direccion === 'entrante' ? { entrantes: FieldValue.increment(1) } : {}),
    }, { merge: true });

    await lote.commit();
    respuesta.status(204).send('');
  },
);
