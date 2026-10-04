// Citas FICTICIAS de prueba para MAÑANA (La Paz), en el calendario de pruebas. Con el formato del chat:
// titulo «Apellidos, Nombres (CNS|RN)» y descripcion con la linea «Telefono: <numero>». Las que NovuChat gestiona
// llevan ademas la linea «Agendado por NovuChat.»; una cita manual del doctor no la lleva.
// Deben salir SOLO las dos primeras (Andres y Silvana). Las demas ejercitan el criterio y no deben recibir nada.
// No se pueden crear con este nodo, y las cubre la suite (admin/pruebas/recordatorio-bellido.test.ts): una cita con
// iCalUID «novuchat-importada-…» (el nodo no permite fijar el iCalUID) y una cancelada (no se crea ya cancelada).
const cfg = $('Config de la prueba').first().json;
const manana = new Date(Date.now() - 4 * 3600000 + 86400000).toISOString().slice(0, 10);   // mañana, en hora de La Paz
const fin = (hh) => {
  const [h, mi] = hh.split(':').map(Number);
  const t = h * 60 + mi + 30;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const cita = (hh, summary, tel, extra) => ({ json: {
  calendario: cfg.calendarioId, summary,
  start: `${manana}T${hh}:00-04:00`, end: `${manana}T${fin(hh)}:00-04:00`,
  description: 'Cita FICTICIA de prueba del recordatorio\n' + (tel ? 'Telefono: ' + tel + '\n' : '')
    + 'Servicio: control-del-nino-sano' + (extra && extra.gestionada === false ? '' : '\nAgendado por NovuChat.')
    + (extra && extra.linea ? '\n' + extra.linea : ''),
} });
return [
  // Deben salir: gestionadas por NovuChat, con telefono y prefijo permitido.
  cita('11:00', 'Prueba Recordatorio, Andres (CNS)', cfg.telefonoPruebaAndres),
  cita('11:30', 'Prueba Recordatorio, Silvana (RN)', cfg.telefonoPruebaSilvana),
  // NO deben salir.
  cita('12:00', 'Prueba Manual Sin Marca, Paciente (CNS)', cfg.telefonoPruebaAndres, { gestionada: false }),
  cita('12:30', 'Prueba No Recordar, Paciente (RN)', cfg.telefonoPruebaSilvana, { linea: '[no recordar]' }),
  cita('13:00', 'Prueba Sin Telefono, Paciente (CNS)', ''),
  cita('13:30', 'Prueba Extranjera, Paciente (CNS)', ['54', '911', '1234', '5678'].join('')),
];
