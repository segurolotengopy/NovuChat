// RECORDATORIO DE CITA AL PACIENTE (Bellido): prepara un item por cita que se debe recordar.
// Funcionalidades (CLIENTES/BELLIDO/solicitudes/recordatorio-al-paciente-funcionalidades):
//  2. solo citas con telefono (linea «Telefono: <numero>») y prefijo permitido;
//  3. una vez por cita: la marca [recordado] en su descripcion;
//  4. solo si el comercio esta operativo;
//  5. el paciente en forma natural, el consultorio, la fecha escrita y la hora en 24 h.
const cfg = $('Config del recordatorio').first().json;
const omitidas = [];
if (String(cfg.estadoComercio || 'operativo') !== 'operativo') return [];
const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);
const MARCA = '[recordado]';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
// «Apellidos, Nombres (CNS|RN)» -> «Nombres Apellidos»; sin coma, tal cual (sin la marca).
const natural = (titulo) => {
  const t = String(titulo || '').replace(/^\s*Cita\s*:?\s*/i, '').split(/\s+[—–]\s+/)[0].replace(/\(\s*(?:CNS|RN)\s*\)/gi, ' ').replace(/\s+/g, ' ').trim();
  const i = t.indexOf(',');
  return (i < 0 ? t : (t.slice(i + 1).trim() + ' ' + t.slice(0, i).trim())).trim() || 'paciente';
};
const salida = [];
for (const item of $input.all()) {
  const ev = item.json;
  const desc = String(ev.description || '').slice(0, 4000);
  if (desc.includes(MARCA)) { omitidas.push('ya recordada'); continue; }
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
  salida.push({ json: {
    eventoId: ev.id, calendarioDelEvento: (ev.organizer || {}).email || cfg.calendarioId,
    telefono, paciente: natural(ev.summary), negocio: String(cfg.nombreNegocio || ''), fecha, hora,
    plantilla: cfg.plantilla, idioma: cfg.idiomaPlantilla, phoneNumberId: cfg.phoneNumberId, waGraphVersion: cfg.waGraphVersion,
    descripcionMarcada: (desc ? desc + '\n' : '') + MARCA + ' ' + new Date().toISOString(),
  }, pairedItem: { item: 0 } });
}
if (!salida.length) return [{ json: { sinRecordatorios: true, omitidas } }];
salida[0].json.omitidas = omitidas;
return salida;
