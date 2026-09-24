#!/usr/bin/env node
/**
 * =============================================================================
 * LAS CITAS QUE YA TIENE EL COMERCIO → UN .ICS PARA IMPORTAR A GOOGLE CALENDAR
 * =============================================================================
 *
 * POR QUÉ EXISTE. El 23/09/2026 el Dr. Bellido preguntó cómo pasar al
 * calendario las citas de octubre que ya tiene agendadas en su sistema: «¿cómo
 * esos pacientes yo los puedo jalar al Google Calendar? De la única manera
 * sería manual». No: se llena una planilla y se importa un archivo.
 *
 * Y HAY UNA RAZÓN MÁS FUERTE QUE LA COMODIDAD. Una cita cargada a mano en el
 * calendario **no la encuentra el asistente**. `buscar_mi_cita` busca en el
 * calendario por el TELÉFONO del paciente, que `agendar_cita` escribe en la
 * descripción del evento. Un evento sin esa línea existe para ocupar el
 * horario, pero es invisible para cancelar o mover: el paciente de octubre que
 * escriba «quiero cambiar mi cita» va a recibir «no encuentro ninguna cita».
 * Este script escribe la descripción con el MISMO formato, letra por letra, que
 * escribe el flujo:
 *
 *     Cliente: <nombre>
 *     Telefono: <solo dígitos, con código de país>
 *     Agendado por NovuChat.
 *
 * NO ESCRIBE EN NINGÚN CALENDARIO. Produce un archivo; quien lo importa es una
 * persona desde Google Calendar (Configuración → Importar y exportar), eligiendo
 * el calendario del negocio. Así la carga masiva de datos de pacientes la
 * autoriza y la ve quien es dueño de esos datos.
 *
 *   node scripts/citas-a-calendario.mjs --plantilla citas.csv
 *   node scripts/citas-a-calendario.mjs --entrada citas.csv --salida citas.ics \
 *     [--minutos 30] [--pais 591] [--zona America/La_Paz]
 *
 * La planilla lleva una fila por cita, con cabecera:
 *
 *     fecha,hora,nombre,telefono,servicio
 *     2026-10-07,11:00,Ana Quispe,71234567,control-del-nino-sano
 *
 * Salida: 0 si escribió el .ics, 1 si la planilla tiene errores (los lista
 * todos, con el número de fila), 2 si la llamada está mal.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const PLANTILLA = opcion('plantilla');
const ENTRADA = opcion('entrada');
const SALIDA = opcion('salida');
const MINUTOS = Number(opcion('minutos') ?? 30);
const PAIS = String(opcion('pais') ?? '591');
const ZONA = String(opcion('zona') ?? 'America/La_Paz');
const COLUMNAS = ['fecha', 'hora', 'nombre', 'telefono', 'servicio'];

if (PLANTILLA) {
  writeFileSync(PLANTILLA,
    COLUMNAS.join(',') + '\n'
    + '2026-10-07,11:00,Ana Quispe,71234567,control-del-nino-sano\n'
    + '2026-10-07,11:30,Luis Mamani,72345678,consulta-pediatrica\n', 'utf8');
  console.log(`\n  ✓ Planilla de ejemplo en ${PLANTILLA}`);
  console.log('    Una fila por cita. La fecha en AAAA-MM-DD y la hora en HH:MM (24 h).');
  console.log('    El teléfono, como lo tenga: se normaliza a código de país + número.\n');
  process.exit(0);
}

const problemas = [];
if (!ENTRADA) problemas.push('falta --entrada (o usa --plantilla para generar una de ejemplo)');
else if (!existsSync(ENTRADA)) problemas.push(`no existe ${ENTRADA}`);
if (!SALIDA) problemas.push('falta --salida (el .ics que se va a escribir)');
if (!Number.isInteger(MINUTOS) || MINUTOS < 5 || MINUTOS > 480) problemas.push('--minutos entre 5 y 480');
if (!/^\d{1,4}$/.test(PAIS)) problemas.push('--pais son solo dígitos (591 para Bolivia)');
if (problemas.length) {
  console.error(`\n  ✗ ${problemas.join('\n  ✗ ')}\n`);
  console.error('  Uso: citas-a-calendario.mjs --entrada citas.csv --salida citas.ics');
  console.error('       [--minutos 30] [--pais 591] [--zona America/La_Paz]');
  console.error('       citas-a-calendario.mjs --plantilla citas.csv\n');
  process.exit(2);
}

// Un CSV con comas dentro de un campo entre comillas: un nombre puede llevarla.
const celdas = (linea) => {
  const salida = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (c === '"') comillas = false;
      else actual += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { salida.push(actual); actual = ''; }
    else actual += c;
  }
  salida.push(actual);
  return salida.map((x) => x.trim());
};

const lineas = readFileSync(ENTRADA, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
if (!lineas.length) { console.error('\n  ✗ La planilla está vacía.\n'); process.exit(1); }
const cabecera = celdas(lineas[0]).map((c) => c.toLowerCase());
const faltan = COLUMNAS.filter((c) => !cabecera.includes(c));
if (faltan.length) {
  console.error(`\n  ✗ La cabecera no tiene: ${faltan.join(', ')}`);
  console.error(`    Tiene que ser: ${COLUMNAS.join(',')}\n`);
  process.exit(1);
}
const indice = Object.fromEntries(COLUMNAS.map((c) => [c, cabecera.indexOf(c)]));

// EL TELÉFONO, EN LA MISMA FORMA QUE LO ESCRIBE META. El webhook trae el número
// como dígitos con código de país y sin «+» (`59170000001`), y así lo guarda el
// flujo y así lo busca. Un «+591 7123-4567» de la planilla se normaliza a eso,
// o `buscar_mi_cita` no lo encuentra nunca.
const telefonoDe = (crudo) => {
  let d = String(crudo).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith(PAIS)) d = PAIS + d;
  return d;
};

const errores = [];
const citas = [];
for (let n = 1; n < lineas.length; n++) {
  const fila = celdas(lineas[n]);
  const fila_ = (c) => String(fila[indice[c]] ?? '').trim();
  const donde = `fila ${n + 1}`;
  const fecha = fila_('fecha');
  const hora = fila_('hora');
  const nombre = fila_('nombre');
  const servicio = fila_('servicio');
  const telefono = telefonoDe(fila_('telefono'));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { errores.push(`${donde}: la fecha «${fecha}» no es AAAA-MM-DD`); continue; }
  if (!/^\d{1,2}:\d{2}$/.test(hora)) { errores.push(`${donde}: la hora «${hora}» no es HH:MM`); continue; }
  const [a, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  // Una fecha como 2026-02-31 pasa la forma y no existe: se comprueba de verdad.
  const real = new Date(Date.UTC(a, m - 1, d));
  if (real.getUTCFullYear() !== a || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) {
    errores.push(`${donde}: la fecha ${fecha} no existe`); continue;
  }
  if (hh > 23 || mm > 59) { errores.push(`${donde}: la hora ${hora} no existe`); continue; }
  if (!nombre) { errores.push(`${donde}: falta el nombre`); continue; }
  // Un teléfono corto es un dato mal copiado, y una cita que el asistente no va
  // a poder encontrar. Mejor frenar acá que descubrirlo con un paciente.
  if (telefono.length < PAIS.length + 7) { errores.push(`${donde}: el teléfono «${fila_('telefono')}» es demasiado corto`); continue; }
  if (!servicio) { errores.push(`${donde}: falta el servicio`); continue; }

  citas.push({ fecha, hora, nombre, telefono, servicio, minutoDelDia: hh * 60 + mm });
}

if (errores.length) {
  console.error(`\n  ✗ ${errores.length} problema(s) en la planilla, no se escribió nada:\n`);
  for (const e of errores) console.error(`    · ${e}`);
  console.error('');
  process.exit(1);
}
if (!citas.length) { console.error('\n  ✗ La planilla no tiene ninguna cita.\n'); process.exit(1); }

// CITAS QUE SE PISAN DENTRO DE LA PLANILLA. No se frena por esto —puede haber
// dos profesionales, o el comercio puede querer sobrevender a propósito— pero
// se avisa: importarlas dejaría el calendario con la doble reserva que el
// candado del flujo existe para evitar, y el candado NO revisa lo que se
// importó a mano.
const avisos = [];
const porDia = new Map();
for (const c of citas) {
  const lista = porDia.get(c.fecha) ?? [];
  for (const otra of lista) {
    if (Math.abs(otra.minutoDelDia - c.minutoDelDia) < MINUTOS) {
      avisos.push(`${c.fecha}: «${otra.nombre}» a las ${otra.hora} y «${c.nombre}» a las ${c.hora} se pisan`);
    }
  }
  lista.push(c);
  porDia.set(c.fecha, lista);
}

const dosDigitos = (n) => String(n).padStart(2, '0');
const local = (fecha, minutoDelDia) => {
  const [a, m, d] = fecha.split('-').map(Number);
  // Hora local pura (sin «Z»): el TZID de cada evento dice en qué zona leerla,
  // así que no hay que convertir nada a UTC ni acertarle al horario de verano.
  const base = new Date(Date.UTC(a, m - 1, d, 0, minutoDelDia));
  return `${base.getUTCFullYear()}${dosDigitos(base.getUTCMonth() + 1)}${dosDigitos(base.getUTCDate())}`
    + `T${dosDigitos(base.getUTCHours())}${dosDigitos(base.getUTCMinutes())}00`;
};
// El ICS corta las líneas a 75 octetos y continúa con un espacio al principio.
const plegar = (linea) => {
  const bytes = Buffer.from(linea, 'utf8');
  if (bytes.length <= 75) return linea;
  const partes = [];
  let desde = 0;
  while (desde < bytes.length) {
    let corte = Math.min(desde + (partes.length ? 74 : 75), bytes.length);
    // No se corta en medio de un carácter multibyte.
    while (corte > desde && corte < bytes.length && (bytes[corte] & 0xc0) === 0x80) corte--;
    partes.push((partes.length ? ' ' : '') + bytes.slice(desde, corte).toString('utf8'));
    desde = corte;
  }
  return partes.join('\r\n');
};
const escapar = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

const sello = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const cuerpo = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NovuChat//citas-a-calendario//ES', 'CALSCALE:GREGORIAN'];
citas.forEach((c, i) => {
  const inicio = local(c.fecha, c.minutoDelDia);
  const fin = local(c.fecha, c.minutoDelDia + MINUTOS);
  cuerpo.push('BEGIN:VEVENT');
  cuerpo.push(`UID:novuchat-importada-${c.fecha.replace(/-/g, '')}-${dosDigitos(i)}-${c.telefono}@novuchat`);
  cuerpo.push(`DTSTAMP:${sello}`);
  cuerpo.push(`DTSTART;TZID=${ZONA}:${inicio}`);
  cuerpo.push(`DTEND;TZID=${ZONA}:${fin}`);
  cuerpo.push(plegar(`SUMMARY:${escapar(`Cita ${c.nombre} — ${c.servicio}`)}`));
  // LA MISMA DESCRIPCIÓN QUE ESCRIBE `agendar_cita`, letra por letra: es lo que
  // hace que el asistente pueda encontrar esta cita. Una prueba lo exige.
  cuerpo.push(plegar(`DESCRIPTION:${escapar(`Cliente: ${c.nombre}\nTelefono: ${c.telefono}\nAgendado por NovuChat.`)}`));
  cuerpo.push('END:VEVENT');
});
cuerpo.push('END:VCALENDAR');
writeFileSync(SALIDA, cuerpo.join('\r\n') + '\r\n', 'utf8');

console.log(`\n  ✓ ${citas.length} cita(s) en ${SALIDA}`);
console.log(`    Duración: ${MINUTOS} min · zona ${ZONA} · teléfonos con código ${PAIS}`);
if (avisos.length) {
  console.log(`\n  ! ${avisos.length} cita(s) se pisan entre sí. Si es a propósito, adelante;`);
  console.log('    si no, corrígelas ANTES de importar: el candado del flujo no revisa');
  console.log('    lo que se importó a mano.');
  for (const a of avisos) console.log(`    · ${a}`);
}
console.log('\n  Para importarlo: Google Calendar → Configuración → Importar y exportar,');
console.log('    elegir este archivo y el calendario del negocio. Lo hace una persona:');
console.log('    este script no escribe en ningún calendario.\n');
