// Arma la alerta operativa y su cuerpo FIRMABLE. Todo el texto es CONSTANTE: de la entrada del Error Trigger solo se
// compara el NOMBRE del ultimo nodo ejecutado (para el nivel); nunca se copia. El flujo ya viene saneado de
// «Registrar flujo y hora». El cuerpo sale con todo caracter no ASCII escapado (\uXXXX): los bytes que se firman son
// exactamente los que viajan, sea cual sea la codificacion que use el envio.
const NODO_DETENER = 'Detener por envío incierto';
const entrada = $('Error del flujo').first().json || {};
const ejec = entrada.execution && typeof entrada.execution === 'object' ? entrada.execution : {};
const urgente = ejec.lastNodeExecuted === NODO_DETENER;
const reg = $input.first().json || {};
const flujo = typeof reg.flujo === 'string' ? reg.flujo : '';
const ahora = Date.now();
const ocurrido = new Date(ahora).toISOString().slice(0, 19) + 'Z';
const tipo = urgente ? 'envio_incierto' : 'error_de_flujo';
const alerta = urgente
  ? {
      nivel: 'urgente', proyecto: 'novuchat',
      asunto: 'Envío incierto: un flujo se detuvo',
      que_paso: 'Un flujo con relé se detuvo: no se sabe si un envío salió o no.\nNo se reintentó para no duplicar el mensaje.\nEl detalle no se copia aquí.',
      que_se_espera_de_andres: 'Revisar en n8n el flujo indicado antes de reintentar; no reenviar a ciegas.',
    }
  : {
      nivel: 'aviso', proyecto: 'novuchat',
      asunto: 'Error en un flujo de n8n',
      que_paso: 'Un flujo terminó con error.\nEl detalle no se copia aquí.',
      que_se_espera_de_andres: 'Revisar en n8n el flujo indicado cuando haya tiempo.',
    };
alerta.enlace = 'https://github.com/segurolotengopy/NovuChat/blob/main/docs/produccion/error-workflow-envio-incierto.md';
alerta.ocurrido_en = ocurrido;
// El id incluye un hash de SOLO LETRAS del flujo (sin cifras ni hex): dos flujos distintos en el mismo segundo no se pisan.
let h = 5381;
for (let i = 0; i < flujo.length; i++) h = (h * 33 + flujo.charCodeAt(i)) % 308915776;
let letras = '';
for (let i = 0; i < 6; i++) { letras = String.fromCharCode(97 + (h % 26)) + letras; h = Math.floor(h / 26); }
alerta.id_unico = tipo + '-' + ocurrido.slice(0, -1) + '-' + letras;
alerta.tipo_error = tipo;
if (flujo) alerta.flujo = flujo;
if (urgente) alerta.nodo = NODO_DETENER;
const cuerpo = JSON.stringify(alerta).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const marca = String(ahora);
// La direccion de la Function se repone al CARGAR el flujo en n8n (scripts/cargar-alerta-n8n.sh); en el repositorio queda el marcador.
const url = 'REEMPLAZAR_URL_ALERTA_OPERATIVA';
return [{ json: { cuerpo, marca, aFirmar: marca + '.' + cuerpo, url } }];
