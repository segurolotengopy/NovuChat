// RECORDATORIO DE CITA AL PACIENTE (Bellido): prepara un item por cita que se debe recordar.
// Criterio vigente (Andres, 03/10/2026): solo se recuerda a pacientes que NovuChat gestionó. Haber agendado
// por el sistema habilita el recordatorio (no se le avisa al paciente de antemano) mientras no lo haya cancelado.
// Funcionalidades (CLIENTES/BELLIDO/solicitudes/recordatorio-al-paciente-funcionalidades):
//  1. la cita la creó NovuChat: la descripcion trae la linea «Agendado por NovuChat.» y su iCalUID NO empieza por
//     «novuchat-importada-» (las que carga admin/scripts/datos/citas-a-calendario.mjs no cuentan);
//  2. con telefono (linea «Telefono: <numero>», con o sin tilde) y prefijo permitido;
//  3. una vez por cita: la marca [recordado]; y nunca si lleva [no recordar] (sin distinguir mayusculas);
//  4. una cita cancelada o borrada no se recuerda; solo si el comercio esta operativo;
//  5. el mensaje no lleva datos del paciente. Plantilla: «Hola {{1}}, Este es un recordatorio sobre tu proxima cita con
//     {{2}} el {{3}} a las {{4}}. ¡Esperamos verte!». {{1}} y {{2}} son valores de configuracion (`saludoVariable`, por
//     omision «te escribimos del Dr. Bellido»; `conQuienVariable`, por omision «tu peque 👶»), {{3}} es solo
//     la fecha escrita y {{4}} solo la hora en 24 h. Ni el titulo ni el nombre salen en ningun campo del item (ni hacia
//     Meta ni a los registros). Ninguna variable lleva saltos de linea, tabuladores ni 4 o mas espacios seguidos (limite
//     de Meta): se limpian aca.
//  6. cuantas variables lleva el cuerpo de la plantilla es configuracion (`variablesCuerpo`: 4 hoy; 3 si se aprueba una
//     plantilla sin la variable del saludo): el item trae `parametros`, la lista ya armada que usa «Enviar plantilla».
const cfg = $('Config del recordatorio').first().json;
const omitidas = [];
if (String(cfg.estadoComercio || 'operativo') !== 'operativo') return [];
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
const MARCA = '[recordado]';
const MARCA_NOVUCHAT = 'Agendado por NovuChat.';
const PREFIJO_IMPORTADA = 'novuchat-importada-';
const limpiar = (t) => String(t).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const deConfig = (valor, porOmision) => limpiar(valor === undefined || valor === null || limpiar(valor) === '' ? porOmision : valor);
const SALUDO = deConfig(cfg.saludoVariable, 'te escribimos del Dr. Bellido');
const CON_QUIEN = deConfig(cfg.conQuienVariable, 'tu peque 👶');
const CON_SALUDO = Number(cfg.variablesCuerpo || 4) !== 3;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const salida = [];
for (const item of $input.all()) {
  const ev = item.json;
  const desc = String(ev.description || '').slice(0, 4000);
  if (ev.status === 'cancelled') { omitidas.push('cancelada'); continue; }
  if (desc.includes(MARCA)) { omitidas.push('ya recordada'); continue; }
  if (/\[no recordar\]/i.test(desc)) { omitidas.push('no recordar'); continue; }
  if (String(ev.iCalUID || '').startsWith(PREFIJO_IMPORTADA)) { omitidas.push('importada'); continue; }
  if (!desc.split(/\r?\n/).some((l) => l.trim() === MARCA_NOVUCHAT)) { omitidas.push('no gestionada por NovuChat'); continue; }
  const linea = desc.split(/\r?\n/).find((l) => /^\s*Tel[eé]fono\s*:/i.test(l));
  const m = linea && /(\d{8,15})/.exec(linea);
  if (!m) { omitidas.push('sin telefono'); continue; }
  const telefono = m[1];
  if (prefijos.length && !prefijos.some((p) => telefono.startsWith(p))) { omitidas.push('prefijo no permitido'); continue; }
  const inicio = Date.parse(String((ev.start || {}).dateTime || ''));
  if (!Number.isFinite(inicio)) { omitidas.push('evento sin hora'); continue; }
  const lp = new Date(inicio - 4 * 3600000);               // UTC-4 fijo (La Paz)
  const fecha = `${DIAS[lp.getUTCDay()]} ${lp.getUTCDate()} de ${MESES[lp.getUTCMonth()]}`;
  const hora = String(lp.getUTCHours()).padStart(2, '0') + ':' + String(lp.getUTCMinutes()).padStart(2, '0');
  const parametros = (CON_SALUDO ? [SALUDO] : []).concat([CON_QUIEN, fecha, hora].map(limpiar));
  // Meta (plantillas de utilidad) rechaza con «(#100) Invalid parameter» una variable de texto de MAS DE 30 caracteres
  // (comprobado el 04/10/2026 con «te escribimos del consultorio del Dr. Bellido», 44): se omite con su causa, no se envia.
  if (parametros.some((v) => v.length > 30)) { omitidas.push('variable de plantilla de mas de 30 caracteres'); continue; }
  salida.push({ json: {
    eventoId: ev.id, calendarioDelEvento: (ev.organizer || {}).email || cfg.calendarioId,
    telefono, fecha, hora,
    parametros,
    plantilla: cfg.plantilla, idioma: cfg.idiomaPlantilla, phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion,
    descripcionMarcada: (desc ? desc + '\n' : '') + MARCA + ' ' + new Date().toISOString(),
  }, pairedItem: { item: 0 } });
}
if (!salida.length) return [{ json: { sinRecordatorios: true, omitidas } }];
salida[0].json.omitidas = omitidas;
return salida;
