// RESPALDO CUANDO META RECHAZA EL PIN O EL BOTON (salida de error de
// `Enviar ubicación` y de `Enviar contacto`).
//
// EL DEFECTO. Las dos salidas de error estaban sin conectar: el texto del
// turno ya habia dicho «toca el botón» (o el paciente habia pedido la
// ubicacion) y, si Meta rechazaba el envio, no llegaba nada y nadie se
// enteraba. Aca se arma UN texto corto con el ENLACE a lo que no salio: el mapa
// para el pin, `wa.me` para el boton. Un enlace en un texto no puede fallar por
// el tipo de mensaje, y cumple lo que se habia ofrecido sin prometer nada mas.
//
// SIN PROMESAS: ni «le aviso», ni «le escribimos», ni «le llamamos». Solo el
// enlace. El texto sale por `Enviar respaldo` (un envio de texto ruidoso: si
// Meta tambien lo rechaza la ejecucion se detiene y se ve; es el ultimo
// recurso) y se reporta como saliente porque sale con id de Meta.
//
// NO PASA POR `Mensaje a enviar`: ese embudo, con `transferir`, volveria a armar
// el boton que acaba de fallar y entraria en un ciclo.
//
// COSTO: +1 mensaje al paciente, SOLO cuando Meta rechaza el pin o el boton.
// 0 en el camino normal.
//
// QUIEN FALLO se lee del nodo que alimenta este (`$prevNode`); si no existe, se
// decide por el pedido del turno: el boton si se pedia contacto, el pin si no.
let previo = {};
try { previo = $('Mensaje a enviar').first().json ?? {}; } catch (e) { previo = {}; }
let cfg = {};
try { cfg = $('Config del negocio').first().json ?? {}; } catch (e) { cfg = {}; }

let desde = '';
try { desde = String($prevNode.name ?? ''); } catch (e) { desde = ''; }
const fallo = desde === 'Enviar contacto' ? 'contacto'
  : desde === 'Enviar ubicación' ? 'ubicacion'
    : (previo.enviarContacto === true ? 'contacto' : 'ubicacion');

const usa = /\busted\b/i.test(String(cfg.tratamiento || ''));
const negocio = String(previo.nombreNegocio || cfg.nombreNegocio || '').trim() || 'el negocio';
let texto = '';
if (fallo === 'contacto') {
  const numero = String(previo.numeroRecepcion || cfg.numeroRecepcion || '').replace(/\D/g, '');
  const enlace = 'https://wa.me/' + numero + '?text='
    + encodeURIComponent('Hola, escribo desde el asistente de ' + negocio + '.');
  texto = (usa ? 'No pude enviarle el botón. Para escribirle directo a recepción de ' + negocio + ', abra este enlace: '
    : 'No pude enviarte el botón. Para escribirle directo a recepción de ' + negocio + ', abre este enlace: ') + enlace;
} else {
  const lat = String(previo.ubicacionLat ?? '').trim();
  const lng = String(previo.ubicacionLng ?? '').trim();
  const enlace = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lat + ',' + lng);
  texto = (usa ? 'No pude enviarle el pin de la ubicación. Puede abrirla en el mapa aquí: '
    : 'No pude enviarte el pin de la ubicación. Puedes abrirla en el mapa aquí: ') + enlace;
}

return [{ json: {
  from: String(previo.from || ''),
  phoneNumberId: String(previo.phoneNumberId || cfg.phoneNumberId || ''),
  respuesta: texto,
  respaldoDe: fallo,
}, pairedItem: { item: 0 } }];
