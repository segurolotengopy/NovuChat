// EL QR DEL COBRO, CON TODO LO QUE HAY QUE DECIR EN EL PIE (23/09/2026).
//
// POR QUÉ EXISTE, y es plata: hasta hoy un turno de cobro costaba DOS mensajes
// --el texto del asistente con el total, y detrás la imagen del QR con un pie
// fijo que repetía lo mismo--. Meta cobra cada mensaje del asistente a 0,0113
// USD desde el 01/10/2026, así que decir en dos lo que entra en uno es un
// gasto sin contrapartida en TODOS los clientes de venta («Base comercial» §1:
// un mensaje largo y completo es más barato que dos cortos). Acá se arma UN
// mensaje: la imagen del QR con el texto del asistente y las instrucciones del
// pago en su pie.
//
// LOS DOS MODOS, Y LA PROHIBICIÓN 3 EN CADA UNO:
//
//   SIMULADO -> la imagen es el QR de demostración de NovuChat, que lleva el
//               rótulo impreso, y el pie ABRE con `rotuloDemo`: dice que es una
//               demostración y que no mueve dinero. Es el comportamiento de
//               siempre, letra por letra.
//   REAL     -> la imagen es el QR del comercio, servido por su ficha desde el
//               panel, y el dinero va a su cuenta. NO va ningún rótulo de
//               simulacro --sería mentira-- y TAMPOCO se afirma ningún pago:
//               acá todavía no pagó nadie. Se dice a quién se le paga, cuánto,
//               y que guarde el comprobante ANTES de salir de la app del banco,
//               que es lo que pidió Andres y no es un detalle de redacción: sin
//               comprobante no hay nada que cotejar y muchas apps no dejan
//               volver atrás a buscarlo (`Analisis/07` §4.4).
//
// CUÁL DE LOS DOS RIGE LO DECIDE EL SERVIDOR, no este nodo: llega en
// `cobroRealActivo` desde `Config del negocio`, que a su vez obedece a
// `configuracionFlujo`. Acá se lee y se obedece.
const cfg = $('Config del negocio').first().json;
const item = $input.first().json;

const cobroReal = String(cfg.cobroRealActivo || '') === 'si';
const conEmojis = String(cfg.nivelEmojis || '') !== 'ninguno';
const e = (s) => (conEmojis ? s + ' ' : '');
const negocio = String(cfg.nombreNegocio || '').trim();
const cuenta = String(cfg.cobroNombreCuenta || '').trim();
const banco = String(cfg.cobroBanco || '').trim();

// EL TEXTO DEL ASISTENTE VA PRIMERO, si entra. `Procesar respuesta` ya decidió
// si entra (`textoEnElQr`) y ya lo pasó por las dos redes de la prohibición 3:
// acá no se vuelve a juzgar, se usa.
const delAsistente = item.textoEnElQr === true ? String(item.respuesta || '').trim() : '';

const lineas = [];
if (delAsistente) lineas.push(delAsistente);

if (cobroReal) {
  const aQuien = [cuenta, banco].filter(Boolean).join(' · ');
  lineas.push(`${e('💳')}Escaneá el QR con la app de tu banco`
    + (aQuien ? ` (la cuenta es de ${aQuien}).` : '.'));
  lineas.push(`${e('🧾')}Cuando termines, guardá o compartí el comprobante ANTES de salir de la `
    + 'app y mandámelo por acá, como foto o PDF.');
} else {
  // EL RÓTULO ABRE EL PIE, no lo cierra: es lo primero que tiene que leer quien
  // recibe la imagen, antes de pensar en escanearla.
  lineas.unshift(String(cfg.rotuloDemo || '').trim());
  lineas.push(String(cfg.captionQr || '').trim());
}

// Meta acepta hasta 1.024 caracteres de pie. `Procesar respuesta` ya dejó el
// texto del asistente por debajo del tope conservador, así que este corte no
// debería activarse nunca; va igual, porque un pie de 1.025 caracteres hace que
// Meta rechace el mensaje entero y el cliente no reciba NADA.
const captionQr = lineas.filter(Boolean).join('\n\n').slice(0, 1024);

// QUÉ IMAGEN SE MANDA. Con cobro real, la dirección pública del QR del comercio
// (el flujo no conoce su contenido y no tiene por qué). Con cobro simulado, el
// media id de la imagen rotulada; y si no hubiera media id, su enlace. Sin
// ninguno de los dos no se manda nada, y eso es lo correcto: mejor no mandar
// que mandar una imagen sin rótulo.
const enlace = cobroReal ? String(cfg.cobroQrUrl || '').trim() : String(cfg.qrUrl || '').trim();
const media = cobroReal ? '' : String(cfg.qrMediaId || '').trim();
const mediaUtil = media !== '' && !media.startsWith('REEMPLAZAR');

return [{ json: {
  ...item,
  captionQr,
  qrEnlace: enlace,
  qrMedia: mediaUtil ? media : '',
  qrEsReal: cobroReal,
  // El total que se cotiza en ESTE QR. Viaja al servidor con el reporte del QR
  // y queda guardado: es el número contra el que se cotejará el comprobante, y
  // nada de lo que el modelo escriba después lo mueve (`cobroVenta.ts`).
  // Sale del texto del asistente, que es donde vive el total del pedido; si no
  // se puede leer, va vacío y el cotejo lo manda a una persona en vez de
  // comparar contra un número inventado.
  cobroTotal: (() => {
    const t = String(item.respuesta || '');
    // Se aceptan «350 Bs», «Bs 350», «350,50 USD» y «USD 350.50».
    const mon = String(cfg.moneda || 'Bs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:' + mon + '\\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\\s*' + mon + ')', 'gi');
    // «1.234,56» y «1,234.56» son el mismo número: manda el último separador,
    // y tres dígitos detrás son millares, no centavos. Es la misma cuenta que
    // `parsearMonto` de `cotejo.ts`, que es quien va a leer el comprobante: si
    // las dos no coincidieran, el cotejo diría «no cuadra» sobre un pago bueno.
    const aNumero = (crudo) => {
      const sep = Math.max(crudo.lastIndexOf('.'), crudo.lastIndexOf(','));
      const detras = sep >= 0 ? crudo.length - sep - 1 : -1;
      const n = (detras === 1 || detras === 2)
        ? Number(crudo.slice(0, sep).replace(/[.,]/g, '') + '.' + crudo.slice(sep + 1))
        : Number(crudo.replace(/[.,]/g, ''));
      return Number.isFinite(n) ? n : null;
    };
    // EL MAYOR, NO EL ÚLTIMO. En un desglose el total es por construcción el
    // número más grande --productos más envío-- y esa propiedad no depende del
    // orden en que el modelo escriba las líneas. Tomar «el último» funcionaba
    // hasta que el modelo cerraba con «el envío son 7 Bs», y entonces se
    // cotejaba el pedido contra el costo del envío.
    let mayor = null;
    let m;
    while ((m = re.exec(t)) !== null) {
      const n = aNumero(String(m[1] || m[2]).trim());
      if (n !== null && n > 0 && (mayor === null || n > mayor)) mayor = n;
    }
    // SIN TOTAL NO SE INVENTA NINGUNO: va vacío, el servidor no coteja el
    // importe y el comprobante lo mira una persona. Es preferible a comparar
    // contra un número que nadie cotizó.
    return mayor === null ? '' : String(mayor);
  })(),
  phoneNumberId: String(cfg.phoneNumberId || item.phoneNumberId || ''),
  waGraphVersion: String(cfg.waGraphVersion || item.waGraphVersion || 'v26.0'),
  from: item.from,
}, pairedItem: { item: 0 } }];
