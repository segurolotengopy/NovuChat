// EL CARRITO QUE VUELVE DE LA PAGINA: aca se decide si esta peticion se atiende.
//
// QUIEN AUTENTICA, Y QUIEN NO. La autenticacion la hace el NODO Webhook con su
// credencial de cabecera: `despertarFlujo` (catalogoWeb.ts) manda
// `Authorization: Bearer <el secreto del numero>` -el MISMO que este flujo usa
// para hablar con la ingesta- y n8n contesta 403 a lo que no lo traiga. Quien
// llega hasta este Code ya probo que conoce el secreto.
//
// LA FIRMA HMAC NO SE PUEDE VERIFICAR ACA, y conviene decirlo con todas las
// letras en vez de simular que si. `X-NovuChat-Signature` es un HMAC-SHA256
// sobre "<marca>." + cuerpo con ESE MISMO secreto; comprobarlo exigiria tener
// el secreto DENTRO del lienzo, y la prohibicion 2 de CLAUDE.md dice que un
// secreto no se escribe en un JSON de flujo. La otra via -leerlo del entorno-
// no existe: el Code de n8n corre en un vm2 con `require` cerrado
// (NODE_FUNCTION_ALLOW_BUILTIN vacio) y sin acceso al entorno. Asi que la firma
// se comprueba en FORMA y no en valor: sirve para descartar basura, no para
// autenticar. `catalogoWeb.ts` la manda igual, a proposito, para el dia que el
// flujo pueda verificarla sin romper la prohibicion 2.
//
// LO QUE SI SE COMPRUEBA, que es barato y no depende de ningun secreto:
//   - la FORMA del contrato (tipo, tenant, telefono, items, accion): un cuerpo
//     que no es un carrito no se contesta;
//   - que la marca de tiempo sea RECIENTE, lo que acota la ventana en la que
//     serviria reenviar una peticion capturada entera;
//   - que el numero de la cabecera sea un numero.
// El tenant se coteja despues, en «Mensaje del carrito», contra lo que dice el
// panel para ESE numero: son dos caminos distintos y tienen que coincidir.
const AHORA = Date.now();
// DIEZ MINUTOS, no cinco. Sin verificacion de firma el valor de esta
// comprobacion es acotado -quien pueda reenviar la peticion entera puede
// reescribir la marca-, asi que no vale la pena apretarla hasta el punto de
// tirar un carrito legitimo por un reloj corrido. Lo que si corta es el
// reenvio tardio de una captura.
const TOLERANCIA_MS = 10 * 60 * 1000;
const NUMERO = /^[0-9]{6,25}$/;
const TELEFONO = /^[0-9]{8,15}$/;
const FIRMA = /^sha256=[0-9a-f]{64}$/;
const ACCIONES = ['responder', 'plantilla_carrito_espera'];

// Texto que va a salir por WhatsApp: sin caracteres de control, con tope. Viene
// de nuestro propio servidor, pero lo que se manda a un tercero se sanea igual.
const limpio = (v, max) => String(v ?? '')
  .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const numero = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;

const out = [];

for (const item of $input.all()) {
  const p = item.json ?? {};
  // n8n entrega las cabeceras en minusculas, pero no se confia: se normaliza.
  const cab = {};
  for (const clave of Object.keys(p.headers ?? {})) {
    cab[String(clave).toLowerCase()] = String((p.headers ?? {})[clave] ?? '');
  }
  const cuerpo = (p.body && typeof p.body === 'object') ? p.body : {};

  const num = String(cab['x-novuchat-numero'] ?? '');
  const marca = Number(cab['x-novuchat-timestamp']);
  const firma = String(cab['x-novuchat-signature'] ?? '');
  const telefono = String(cuerpo.telefono ?? '');
  const items = Array.isArray(cuerpo.items) ? cuerpo.items : [];
  const descartados = Array.isArray(cuerpo.descartados) ? cuerpo.descartados : [];

  const fallas = [];
  if (limpio(cuerpo.tipo, 20) !== 'carrito') fallas.push('tipo');
  if (!NUMERO.test(num)) fallas.push('numero');
  if (!TELEFONO.test(telefono)) fallas.push('telefono');
  if (typeof cuerpo.tenantId !== 'string' || cuerpo.tenantId.trim() === '') fallas.push('tenant');
  if (items.length === 0) fallas.push('items');
  if (!ACCIONES.includes(String(cuerpo.accion ?? ''))) fallas.push('accion');
  if (!FIRMA.test(firma)) fallas.push('firma');
  if (!Number.isFinite(marca) || Math.abs(AHORA - marca) > TOLERANCIA_MS) fallas.push('marca');

  out.push({ json: {
    procesar: fallas.length === 0,
    fallas,
    // `numero` es lo que va en la cabecera de la consulta al panel y lo que
    // `Responder al cliente` usa como remitente.
    numero: num,
    from: telefono,
    tenantId: limpio(cuerpo.tenantId, 60),
    pedidoId: limpio(cuerpo.pedidoId, 60),
    conversacionId: limpio(cuerpo.conversacionId, 80),
    accion: String(cuerpo.accion ?? ''),
    ventanaAbierta: cuerpo.ventanaAbierta === true,
    fichaCompartida: cuerpo.fichaCompartida === true,
    items: items.slice(0, 50).map((i) => ({
      nombre: limpio((i ?? {}).nombre, 80) || 'producto',
      cantidad: numero((i ?? {}).cantidad) || 1,
      subtotal: numero((i ?? {}).subtotal),
    })),
    itemsTotal: items.length,
    total: numero(cuerpo.total),
    moneda: cuerpo.moneda === 'USD' ? 'USD' : 'Bs',
    costoEnvio: numero(cuerpo.costoEnvio),
    entrega: String(cuerpo.entrega ?? '') === 'envio' ? 'envio' : 'retiro',
    // `direccion` y `nota` viajan SIEMPRE, aunque vengan vacias.
    direccion: limpio(cuerpo.direccion, 200),
    nota: limpio(cuerpo.nota, 200),
    // Solo los identificadores, que es lo unico que manda el servidor: por eso
    // el mensaje no puede nombrar lo que no entro, y pregunta.
    descartados: descartados.length,
  } });
}

return out;
