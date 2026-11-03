// CUPO DE DESCARGAS DEL GUARDADO (módulo común de medios, SOLO canal «rele»; revisión del PR #757).
//
// Por el relé B9 los GET de medios tienen un tope de 500 descargas por día y por WABA, y cada medio guardado gasta 2 (la info y el contenido). Un solo teléfono
// que manda fotos en ráfaga, o una conversación larga, no puede gastar el cupo de todos: pasado el tope el medio NO se guarda (el flujo sigue y responde
// igual; el cliente no lo nota) y se cuenta para poder verlo. Dos topes, por día de La Paz (UTC-4 fijo):
//   `GM_CUPO.porTelefono` ... medios por teléfono y día (10 por defecto; decisión de Andres, 03/11/2026)
//   `GM_CUPO.global` ........ medios por flujo y día (60 por defecto: con 2 GET cada uno son 120 de las 500 del WABA, y entran 4 flujos)
// Se cuenta ANTES de bajar nada, y SOLO lo que «Preparar guardado» (que va pegado detrás) dejaría pasar: un mensaje con un teléfono, un id de mensaje o un id
// de medio inválidos se descarta ahí y acá NO gasta cupo (las mismas validaciones, repetidas abajo). No cuenta lo que escribe la recepción del negocio (es la
// ventana de las 24 h, no un cliente), ni lo que no es un medio.
// Se pega DELANTE de `guardado-preparar.js` en el mismo nodo Code (el jsCode empieza con la cabecera de `guardado.mjs` y luego este módulo): un `return []`
// acá termina la rama en silencio, como el suyo. `GM_FUENTES` y `GM_CUPO` los define esa cabecera. El estado vive en `$getWorkflowStaticData('global')`,
// clave `cupoDeMedios`; no guarda ningún dato del cliente salvo su número como clave, que se borra al cambiar de día.
//
// LO OMITIDO SE VE: sin agregar mensajes, cada medio omitido por cupo suma uno a `cupoDeMedios.omitidos` y al contador diario `guardadoDeMedios.omitidoPorCupo`
// ({dia, n}), el mismo bloque donde «Resultado del guardado» anota `sinAcceso`, `pedidoInvalido`, `sinDescarga` y `sinTamano`. La rama termina ahí (no hay ítem
// que llegue a la ingesta ni al aviso); el contador está en el estado del flujo para quien lo mire.
//
// LIMITACIÓN DE CONCURRENCIA (riesgo residual aceptado por Andres el 03/11/2026): n8n no da un candado y este estado se lee y se escribe sin él. Una RÁFAGA
// (un álbum de fotos son N ejecuciones simultáneas) lo atraviesa: todas leen el mismo conteo y pasan. El tope por remitente de verdad lo pone el relé
// (WAM); este cupo es una red del flujo, no una garantía exacta.
// JavaScript plano del nodo Code de n8n: sin require, URL, Buffer ni crypto.
const gcCarga = (GM_FUENTES && GM_FUENTES.carga && typeof GM_FUENTES.carga === 'object') ? GM_FUENTES.carga : {};
const gcCfg = (GM_FUENTES && GM_FUENTES.config && typeof GM_FUENTES.config === 'object') ? GM_FUENTES.config : {};
const gcMsg = Array.isArray(gcCarga.messages) && gcCarga.messages[0] && typeof gcCarga.messages[0] === 'object' ? gcCarga.messages[0] : null;
const GC_MEDIOS = ['image', 'sticker', 'audio', 'voice', 'video', 'document'];
if (gcMsg && GC_MEDIOS.indexOf(String(gcMsg.type || '')) >= 0) {
  const gcTelefono = String(gcMsg.from || '');
  const gcRecepcion = String(gcCfg.numeroRecepcionDigitos || gcCfg.numeroRecepcion || '').replace(/\D/g, '');
  // Las validaciones de «Preparar guardado» que descartan un mensaje: lo descartado no se cuenta.
  const gcMedio = gcMsg[String(gcMsg.type)];
  const gcValido = !!gcMedio && typeof gcMedio === 'object'
    && /^\d{8,15}$/.test(gcTelefono)
    && /^[\x21-\x7e]{1,200}$/.test(String(gcMsg.id || ''))
    && /^[A-Za-z0-9_-]{1,100}$/.test(String(gcMedio.id || ''));
  if (gcValido && !(gcRecepcion && gcTelefono === gcRecepcion)) {
    const gcAhora = Number(gcCarga.ahoraMs) > 0 ? Number(gcCarga.ahoraMs) : Date.now();
    // El día de La Paz (UTC-4 fijo): el cupo de Meta se reinicia por día, y este se reinicia con el día del negocio.
    const gcDia = new Date(gcAhora - 4 * 3600 * 1000).toISOString().slice(0, 10);
    const gcSd = $getWorkflowStaticData('global');
    if (!gcSd.cupoDeMedios || typeof gcSd.cupoDeMedios !== 'object' || Array.isArray(gcSd.cupoDeMedios) || gcSd.cupoDeMedios.dia !== gcDia) {
      gcSd.cupoDeMedios = { dia: gcDia, total: 0, omitidos: 0, porTelefono: {} };
    }
    const gcCupo = gcSd.cupoDeMedios;
    const gcCfgCupo = typeof GM_CUPO !== 'undefined' && GM_CUPO && typeof GM_CUPO === 'object' ? GM_CUPO : {};
    const gcPorTel = Number(gcCfgCupo.porTelefono) > 0 ? Number(gcCfgCupo.porTelefono) : 10;
    const gcGlobal = Number(gcCfgCupo.global) > 0 ? Number(gcCfgCupo.global) : 60;
    const gcDeEste = Object.prototype.hasOwnProperty.call(gcCupo.porTelefono, gcTelefono) ? Number(gcCupo.porTelefono[gcTelefono]) : 0;
    if (gcDeEste >= gcPorTel || gcCupo.total >= gcGlobal) {
      gcCupo.omitidos += 1;
      if (!gcSd.guardadoDeMedios || typeof gcSd.guardadoDeMedios !== 'object' || Array.isArray(gcSd.guardadoDeMedios)) gcSd.guardadoDeMedios = {};
      const gcPrevio = gcSd.guardadoDeMedios.omitidoPorCupo && gcSd.guardadoDeMedios.omitidoPorCupo.dia === gcDia ? Number(gcSd.guardadoDeMedios.omitidoPorCupo.n) || 0 : 0;
      gcSd.guardadoDeMedios.omitidoPorCupo = { dia: gcDia, n: Math.min(gcPrevio + 1, 1000) };
      return [];
    }
    gcCupo.porTelefono[gcTelefono] = gcDeEste + 1;
    gcCupo.total += 1;
  }
}
