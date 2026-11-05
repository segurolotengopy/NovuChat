// SIN ESTADO (PR-4a, contrato §6): el servidor de la sesion no contesto el `leer` con una conversacion valida (un servidor sin la rama `sesion`, un 5xx o un timeout
// —el `leer` y el panel viajan en la MISMA llamada, asi que con el panel caido tampoco hay estado—, o la variante de PRUEBA para un telefono que no es de
// `telefonosDePrueba`). Sin version no se puede comprometer, y sin estado el flujo no sabe en que paso va el cliente:
// no se improvisa un paso. Lo unico que se ofrece es PASAR CON RECEPCION (el boton para escribirle directo, que es lo que el flujo cumple): ni aviso al local (el flujo
// no sabe que pedir), ni modelo, ni estado nuevo, ni nada que comprometer. REEMPLAZA la respuesta: un mensaje por turno, ni uno mas.
//
// Cuelga de la rama falsa de «¿Hay estado?» y sale directo a `Armar avisos`, como «Uso extendido». Antes (con el estado en la memoria de n8n) un panel caido seguia por
// `Plan del turno` con la carta de respaldo y derivaba con aviso lo que pedia delivery o confirmaba; ahora no hay estado que retomar: el contrato lo manda asi. SALIDA: un Plan (§4.3). El mensaje con boton es `{tipo:'enlace', cuerpo, botones:[], url, etiqueta}`; sin numero de recepcion
// valido, solo texto (sin nombrar un boton que no existe).
const cfg = vmCfg();
const recepcion = vmDigitos(cfg.numeroRecepcion);
const cuerpo = 'Disculpa, ahora no puedo atender esto por aquí 🙏. Toca «Escribir al local» y lo ves directamente con nuestro equipo.';
return [{ json: {
  estadoNuevo: null,
  mensajes: [recepcion
    ? { tipo: 'enlace', cuerpo: cuerpo, botones: [], url: 'https://wa.me/' + recepcion, etiqueta: 'Escribir al local', sinMenu: true }
    : { tipo: 'texto', cuerpo: 'Disculpa, ahora no puedo atender esto por aquí. Por favor escríbenos de nuevo en unos minutos.', botones: [] }],
  condicionados: null,
  aviso: null,
  pedido: null,
  cierre: null,
  ruta: 'sin_estado',
  errores: ['sin_estado'],
} }];
