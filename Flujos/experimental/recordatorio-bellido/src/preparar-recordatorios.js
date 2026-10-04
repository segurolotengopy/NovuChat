// RECORDATORIO DE CITA AL PACIENTE (Bellido): prepara un item por cita que se debe recordar.
// Criterio vigente (Andres, 03/10/2026): solo se recuerda a pacientes que NovuChat gestionó. Haber agendado
// por el sistema habilita el recordatorio (no se le avisa al paciente de antemano) mientras no lo haya cancelado.
// Funcionalidades (CLIENTES/BELLIDO/solicitudes/recordatorio-al-paciente-funcionalidades):
//  1. la cita la creó NovuChat: la descripcion trae la linea «Agendado por NovuChat.» y su iCalUID NO empieza por
//     «novuchat-importada-» (las que carga admin/scripts/datos/citas-a-calendario.mjs no cuentan);
//  2. con telefono y prefijo permitido. El telefono se lee POSICIONAL y anclado, como `citasDelTelefono` de Agenda minima:
//     la linea 2 si la 1 empieza por «Cliente:», si no la 1, y la linea es entera «Telefono: <8 a 15 digitos>» (con o
//     sin tilde y con «+» opcional). Una descripcion con mas de una linea «Telefono:» (un nombre de perfil con un salto
//     de linea puede colar otra) es AMBIGUA y se omite. Con `prefijosPermitidos` vacio falla cerrado: no se envia a
//     ningun prefijo;
//  3. una vez por cita: la marca [recordado]; y nunca si lleva [no recordar] (sin distinguir mayusculas);
//  4. una cita cancelada o borrada no se recuerda; solo si el comercio esta operativo;
//  5. el mensaje no lleva datos del paciente. Plantilla: «Hola {{1}}, Este es un recordatorio sobre tu proxima cita con
//     {{2}} el {{3}} a las {{4}}. ¡Esperamos verte!». {{1}} y {{2}} son valores de configuracion (`saludoVariable`, por
//     omision «te escribimos del consultorio»; `conQuienVariable`, por omision «el Doctor Bellido»), {{3}} es solo
//     la fecha escrita y {{4}} solo la hora en 24 h. Ni el titulo ni el nombre salen en ningun campo del item (ni hacia
//     Meta ni a los registros). Ninguna variable lleva saltos de linea, tabuladores ni 4 o mas espacios seguidos (limite
//     de Meta): se limpian aca.
//  6. cuantas variables lleva el cuerpo de la plantilla es configuracion (`variablesCuerpo`: 4 hoy; 3 si se aprueba una
//     plantilla sin la variable del saludo): el item trae `parametros`, la lista ya armada que usa «Enviar plantilla».
const cfg = $('Config del recordatorio').first().json;
const omitidas = [];
if (String(cfg.estadoComercio || 'operativo') !== 'operativo') return [];
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
// Falla cerrado: sin prefijos configurados no se envia a nadie, y el flujo termina en error (`fallaConfiguracion`).
if (!prefijos.length) return [{ json: { sinRecordatorios: true, omitidas: ['sin prefijos configurados'], fallaConfiguracion: ['sin prefijos configurados'] } }];
// Solo en el flujo de PRUEBA: si el Config trae la lista de telefonos de prueba, nada sale a otro numero (con la lista
// vacia, falla cerrado). El flujo definitivo no trae estas claves y no filtra.
const hayListaDePrueba = 'telefonoPruebaAndres' in cfg || 'telefonoPruebaSilvana' in cfg;
const soloPrueba = [cfg.telefonoPruebaAndres, cfg.telefonoPruebaSilvana].map((t) => String(t || '').replace(/\D/g, '')).filter(Boolean);
const MARCA = '[recordado]';
const MARCA_NOVUCHAT = 'Agendado por NovuChat.';
const PREFIJO_IMPORTADA = 'novuchat-importada-';
const limpiar = (t) => String(t).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const deConfig = (valor, porOmision) => limpiar(valor === undefined || valor === null || limpiar(valor) === '' ? porOmision : valor);
const SALUDO = deConfig(cfg.saludoVariable, 'te escribimos del consultorio');
const CON_QUIEN = deConfig(cfg.conQuienVariable, 'el Doctor Bellido');
const CON_SALUDO = Number(cfg.variablesCuerpo || 4) !== 3;
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const salida = [];
for (const item of $input.all()) {
  const ev = item.json;
  // La descripcion completa es la que vuelve al calendario con la marca; solo se trunca para ANALIZARLA. Las marcas
  // [recordado] y [no recordar] se buscan en la completa: una marca pasada de 4000 caracteres no se puede perder.
  const descCompleta = String(ev.description || '');
  const desc = descCompleta.slice(0, 4000);
  if (ev.status === 'cancelled') { omitidas.push('cancelada'); continue; }
  if (descCompleta.includes(MARCA)) { omitidas.push('ya recordada'); continue; }
  if (/\[no recordar\]/i.test(descCompleta)) { omitidas.push('no recordar'); continue; }
  if (String(ev.iCalUID || '').startsWith(PREFIJO_IMPORTADA)) { omitidas.push('importada'); continue; }
  if (!desc.split(/\r?\n/).some((l) => l.trim() === MARCA_NOVUCHAT)) { omitidas.push('no gestionada por NovuChat'); continue; }
  // Los saltos son `\n`; solo una descripcion SIN ningun `\n` (la que Calendar convierte a HTML al editarla) se parte por `<br>`.
  const lineas = /\n/.test(desc) ? desc.split(/\r?\n/) : desc.split(/<br\s*\/?>/i);
  // La ambiguedad se cuenta sobre la descripcion COMPLETA: una segunda linea «Telefono:» pasada de los 4000 caracteres cuenta.
  const lineasCompletas = /\n/.test(descCompleta) ? descCompleta.split(/\r?\n/) : descCompleta.split(/<br\s*\/?>/i);
  if (lineasCompletas.filter((l) => /^\s*Tel(?:[eé]fono)?\s*:/i.test(l)).length > 1) { omitidas.push('telefono ambiguo'); continue; }
  const lineaTel = lineas.length > 1 && /^\s*Cliente\s*:/i.test(lineas[0]) ? lineas[1] : lineas[0];
  const m = /^\s*Tel(?:[eé]fono)?\s*:\s*\+?(\d{8,15})\s*$/i.exec(lineaTel || '');
  if (!m) { omitidas.push('sin telefono'); continue; }
  const telefono = m[1];
  if (!prefijos.some((p) => telefono.startsWith(p))) { omitidas.push('prefijo no permitido'); continue; }
  if (hayListaDePrueba && !soloPrueba.includes(telefono)) { omitidas.push('fuera de la lista de prueba'); continue; }
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
    eventoId: ev.id, calendarioDelEvento: cfg.calendarioId,   // siempre el calendario configurado, nunca el organizer del evento
    telefono, fecha, hora,
    parametros,
    plantilla: cfg.plantilla, idioma: cfg.idiomaPlantilla, phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion,
    descripcionMarcada: (descCompleta ? descCompleta + '\n' : '') + MARCA + ' ' + new Date().toISOString(),
  }, pairedItem: { item: 0 } });
}
if (!salida.length) {
  // Una omision por CONFIGURACION (variable de mas de 30 caracteres) no es una cita que no corresponde: el flujo termina en error.
  const porConfig = [...new Set(omitidas.filter((o) => o === 'variable de plantilla de mas de 30 caracteres'))];
  return [{ json: porConfig.length ? { sinRecordatorios: true, omitidas, fallaConfiguracion: porConfig } : { sinRecordatorios: true, omitidas } }];
}
salida[0].json.omitidas = omitidas;
return salida;
