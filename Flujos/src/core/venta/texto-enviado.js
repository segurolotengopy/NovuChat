// QUE SE REPORTA COMO SALIENTE: LO QUE SALIO, NO LO QUE EL MODELO DIJO.
//
// LA DEUDA QUE ESTO CIERRA (PR #97, 17/09/2026). En el Demo A y en Platinum el
// reporte del saliente cuelga de `Responder al cliente` desde que la consola
// mostro «¡Listo! Quedó agendada…» mientras el telefono habia recibido otra
// cosa (ejecucion #2867). En el Demo B seguia colgando de `Procesar
// respuesta`: la consola registraba el texto del MODELO. Con el catalogo web
// eso dejaria de ser una imprecision para ser un defecto de facturacion: en el
// turno del catalogo el texto del modelo NO es el que se envia, y el mensaje
// que Meta cobra quedaria mal registrado.
//
// POR QUE HACE FALTA ESTE NODO Y NO ALCANZA UNA EXPRESION. Este flujo no tiene
// un punto unico de salida al cliente: a `Responder al cliente` se llega desde
// cuatro lugares (la respuesta del agente, el enlace del catalogo, el comercio
// no operativo y el uso extendido). Despues del envio, `$json` es la respuesta
// de Meta -que trae el id del mensaje, pero no el texto-, asi que hay que
// averiguar CUAL de los cuatro armo lo que se envio. `isExecuted` lo dice, y
// solo esta disponible dentro de un nodo Code.
//
// NO ENVIA NADA: cuesta CERO mensajes de WhatsApp.
// PROTEGIDO, porque este nodo corre en DOS disparadores. Con el carrito del
// catálogo el mensaje entrante no existe -no lo escribió nadie por WhatsApp- y
// «Normalizar entrada» no se ejecutó: referenciarlo sin proteger tiraría la
// ejecución DESPUÉS de haber enviado un mensaje que Meta ya cobra, y el
// reporte -que es lo que la consola factura- se perdería.
let ent = {};
try { ent = $('Normalizar entrada').first().json ?? {}; } catch (e) { ent = {}; }

// EN ORDEN DE PRECEDENCIA. `Enlace del catálogo` va PRIMERO porque en el turno
// del catalogo tambien corrio `Procesar respuesta`, y lo que el cliente
// recibio es el texto armado con la direccion, no el del modelo.
// «Mensaje del carrito» va primero porque entra por el OTRO disparador: en esa
// ejecución no corrió ninguna de las demás.
// «Respuesta del cobro» va delante de `Procesar respuesta` por la misma razon
// que el enlace del catalogo: en el turno del comprobante el texto que sale es
// el fijo del cotejo, no el del modelo. Hoy el modelo ni siquiera corre en ese
// turno --el comprobante se desvia antes del agente-- pero el orden se escribe
// igual: la precedencia no puede depender de que la topologia no cambie.
const FUENTES = ['Mensaje del carrito', 'Respuesta del cobro', 'Enlace del catálogo',
  'Procesar respuesta', 'Uso extendido', 'Comercio no operativo'];

// `isExecuted` es de toda la ejecucion, no del item, y se lee PROTEGIDO: si
// una referencia fallara, el reporte tiene que salir igual. Una cifra de menos
// en la consola es malo; cortar la ejecucion despues de haber enviado el
// mensaje -que ya se pago- es peor.
const corrio = (n) => { try { return $(n).isExecuted === true; } catch (e) { return false; } };
const itemsDe = (n) => { try { return $(n).all(); } catch (e) { return []; } };

const salidas = $input.all();
const out = [];

for (let i = 0; i < salidas.length; i++) {
  let elegido = {};
  let fuente = '';
  for (const n of FUENTES) {
    if (!corrio(n)) continue;
    const lista = itemsDe(n);
    // Emparejamiento por indice, con el ultimo como respaldo: despues de un
    // Code el emparejamiento hacia atras se rompe.
    const j = (lista[i] ?? lista[lista.length - 1] ?? { json: {} }).json ?? {};
    if (String(j.respuesta ?? '').trim() !== '') { elegido = j; fuente = n; break; }
  }

  const meta = salidas[i].json ?? {};
  out.push({ json: {
    telefono: String(elegido.from ?? ent.from ?? ''),
    texto: String(elegido.respuesta ?? ''),
    // El id que devolvio Meta: es la unica prueba de que el mensaje salio.
    idMeta: String((((meta.messages ?? [])[0]) ?? {}).id ?? ''),
    phoneNumberId: String(elegido.phoneNumberId ?? ent.phoneNumberId ?? ''),
    // Queda en la ejecucion para poder auditar de donde salio el texto.
    fuenteDelTexto: fuente,
  } });
}

return out;
