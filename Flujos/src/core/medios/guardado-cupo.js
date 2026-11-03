// CUPO DE DESCARGAS DEL GUARDADO (módulo común de medios, SOLO canal «rele»; revisión del PR #757).
//
// Por el relé B9 los GET de medios tienen un tope de 500 descargas por día y por WABA, y cada medio guardado gasta 2 (la info y el contenido). Un solo teléfono
// que manda fotos en ráfaga, o una conversación larga, no puede gastar el cupo de todos: pasado el tope el medio NO se guarda (el flujo sigue y responde
// igual; el cliente no lo nota) y se cuenta en `omitidos` para poder verlo. Dos topes, por día de La Paz (UTC-4 fijo):
//   `GM_CUPO.porTelefono` ... medios por teléfono y día (20 por defecto)
//   `GM_CUPO.global` ........ medios por flujo y día (60 por defecto: con 2 GET cada uno son 120 de las 500 del WABA, y entran 4 flujos)
// Se cuenta ANTES de bajar nada. No cuenta lo que escribe la recepción del negocio (es la ventana de las 24 h, no un cliente), ni lo que no es un medio.
// Se pega DELANTE de `guardado-preparar.js` en el mismo nodo Code: un `return []` acá termina la rama en silencio, como el suyo. `GM_FUENTES` y `GM_CUPO`
// los define la cabecera que arma `guardado.mjs`. El estado vive en `$getWorkflowStaticData('global')`, clave `cupoDeMedios`; no guarda ningún dato del cliente
// salvo su número como clave, que se borra al cambiar de día.
// JavaScript plano del nodo Code de n8n: sin require, URL, Buffer ni crypto.
const gcCarga = (GM_FUENTES && GM_FUENTES.carga && typeof GM_FUENTES.carga === 'object') ? GM_FUENTES.carga : {};
const gcCfg = (GM_FUENTES && GM_FUENTES.config && typeof GM_FUENTES.config === 'object') ? GM_FUENTES.config : {};
const gcMsg = Array.isArray(gcCarga.messages) && gcCarga.messages[0] && typeof gcCarga.messages[0] === 'object' ? gcCarga.messages[0] : null;
const GC_MEDIOS = ['image', 'sticker', 'audio', 'voice', 'video', 'document'];
if (gcMsg && GC_MEDIOS.indexOf(String(gcMsg.type || '')) >= 0) {
  const gcTelefono = String(gcMsg.from || '');
  const gcRecepcion = String(gcCfg.numeroRecepcionDigitos || gcCfg.numeroRecepcion || '').replace(/\D/g, '');
  if (!(gcRecepcion && gcTelefono === gcRecepcion)) {
    const gcAhora = Number(gcCarga.ahoraMs) > 0 ? Number(gcCarga.ahoraMs) : Date.now();
    // El día de La Paz (UTC-4 fijo): el cupo de Meta se reinicia por día, y este se reinicia con el día del negocio.
    const gcDia = new Date(gcAhora - 4 * 3600 * 1000).toISOString().slice(0, 10);
    const gcSd = $getWorkflowStaticData('global');
    if (!gcSd.cupoDeMedios || typeof gcSd.cupoDeMedios !== 'object' || Array.isArray(gcSd.cupoDeMedios) || gcSd.cupoDeMedios.dia !== gcDia) {
      gcSd.cupoDeMedios = { dia: gcDia, total: 0, omitidos: 0, porTelefono: {} };
    }
    const gcCupo = gcSd.cupoDeMedios;
    const gcPorTel = Number(GM_CUPO && GM_CUPO.porTelefono) > 0 ? Number(GM_CUPO.porTelefono) : 20;
    const gcGlobal = Number(GM_CUPO && GM_CUPO.global) > 0 ? Number(GM_CUPO.global) : 60;
    const gcDeEste = Object.prototype.hasOwnProperty.call(gcCupo.porTelefono, gcTelefono) ? Number(gcCupo.porTelefono[gcTelefono]) : 0;
    if (gcDeEste >= gcPorTel || gcCupo.total >= gcGlobal) {
      gcCupo.omitidos += 1;
      return [];
    }
    gcCupo.porTelefono[gcTelefono] = gcDeEste + 1;
    gcCupo.total += 1;
  }
}
