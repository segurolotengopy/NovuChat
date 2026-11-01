// ADAPTADOR GENERAL DE SENALES para el modulo miniCRM (PR-F0): como se califica (columna H), se resume (I) y se prioriza un prospecto a partir de las
// SENALES que deja el flujo (`prospecto.senales`, `quePidio`, `diaPreferido`, `horarioPreferido`, `derivacion`). Sin textos ni nombres de cliente: el
// vocabulario es cerrado y neutro. Lo propio de cada flujo es la funcion que calcula el prospecto desde su ficha; esto solo lo traduce a la planilla.
// Se concatena DESPUES de `crm.js` (usa `crmClasificar`, `crmLimpio`) y define `CRM_ADAPTADOR`, el contrato que `crmDecidirFila` valida.
// Calificacion (H): Caliente = Alta, Tibio = Media, Frio = Baja, No es lead = Descalificado. Escala de menor a mayor: Media no pisa Descalificado, Alta pisa todo.
// REGLA DURA 3: el resumen nunca dice que alguien pago; solo lo que el codigo sabe que paso. MENSAJES: ninguno.
const CRM_CALIFICACION_DE = { 'Caliente': 'Alta', 'Tibio': 'Media', 'Frío': 'Baja', 'No es lead': 'Descalificado' };
const CRM_ESCALA = ['Baja', 'Media', 'Descalificado', 'Alta'];
function crmCalificarSenales(p) {
  const senales = p && p.senales !== null && typeof p.senales === 'object' ? p.senales : {};
  return CRM_CALIFICACION_DE[crmClasificar(senales)];
}
function crmResumirSenales(p, conEstado, calificacionFinal) {
  const partes = [];
  if (calificacionFinal === 'Descalificado') partes.push('Marcado como no lead.');
  const pidio = typeof p.quePidio === 'string' ? crmLimpio(p.quePidio).slice(0, 120) : '';
  if (pidio) partes.push('Pidió: ' + pidio + '.');
  const dia = typeof p.diaPreferido === 'string' ? crmLimpio(p.diaPreferido).slice(0, 40) : '';
  if (dia) partes.push('Día: ' + dia + '.');
  const horario = typeof p.horarioPreferido === 'string' ? crmLimpio(p.horarioPreferido).slice(0, 40) : '';
  if (horario) partes.push('Horario: ' + horario + '.');
  if (p.derivacion === true) partes.push('Derivado a recepción.');
  else if (typeof p.derivacion === 'string' && crmLimpio(p.derivacion)) partes.push('Derivación: ' + crmLimpio(p.derivacion).slice(0, 80) + '.');
  if (!partes.length) return conEstado ? 'Escribió por WhatsApp.' : '';
  return partes.join(' ').slice(0, 400);
}
const CRM_ADAPTADOR = { calificar: crmCalificarSenales, resumir: crmResumirSenales, prioridad: CRM_ESCALA };
