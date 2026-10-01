// Citas FICTICIAS de prueba para MAÑANA (La Paz), en el calendario de pruebas. Con el formato del chat:
// titulo «Apellidos, Nombres (CNS|RN)» y descripcion con la linea «Telefono: <numero>».
const cfg = $('Config de la prueba').first().json;
const manana = new Date(Date.now() - 4 * 3600000 + 86400000).toISOString().slice(0, 10);   // mañana, en hora de La Paz
const fin = (hh) => {
  const [h, mi] = hh.split(':').map(Number);
  const t = h * 60 + mi + 30;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const cita = (hh, summary, tel) => ({ json: {
  calendario: cfg.calendarioId, summary,
  start: `${manana}T${hh}:00-04:00`, end: `${manana}T${fin(hh)}:00-04:00`,
  description: 'Cita FICTICIA de prueba del recordatorio\n' + (tel ? 'Telefono: ' + tel + '\n' : '') + 'Servicio: control-del-nino-sano',
} });
return [
  cita('11:00', 'Prueba Recordatorio, Andres (CNS)', cfg.telefonoPruebaAndres),
  cita('11:30', 'Prueba Recordatorio, Silvana (RN)', cfg.telefonoPruebaSilvana),
  cita('12:00', 'Prueba Sin Telefono, Paciente (CNS)', ''),
  cita('12:30', 'Prueba Extranjera, Paciente (CNS)', ['54', '911', '1234', '5678'].join('')),
];
