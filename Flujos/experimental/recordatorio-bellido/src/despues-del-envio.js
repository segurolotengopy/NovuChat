// Después del envío: ¿Meta lo aceptó? Si sí, la cita se marca; si no, se registra la causa (sin mostrar el token).
const out = [];
const previos = $('Preparar recordatorios').all();
$input.all().forEach((it, k) => {
  const r = it.json || {};
  const base = (previos[k] && previos[k].json) || {};
  // El id del mensaje se lee dentro de una condicion (ternario): asi lo reconoce la red estatica de entregas (core/entregas.test.ts).
  const id = r.messages && r.messages[0] && r.messages[0].id ? r.messages[0].id : '';
  const err = r.error || (r.body && r.body.error) || null;
  out.push({ json: { ...base, enviado: !!id, causa: id ? '' : String((err && (err.code + ' ' + err.message)) || 'sin id de mensaje').slice(0, 200) } });
});
return out;
