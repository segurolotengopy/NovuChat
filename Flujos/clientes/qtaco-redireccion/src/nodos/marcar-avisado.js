// MARCAR AVISADO: el aviso cuenta como hecho SOLO si Meta devolvio un id de mensaje. Ese cliente queda marcado por la ventana; un envio sin
// id no se marca (el cliente recibira el aviso en su proximo mensaje) y la ejecucion termina en ERROR, no en exito.
const mcandidatos = $('Decidir aviso').all().map((x) => x.json).filter((j) => j.avisar === true);
const mrespuestas = $input.all();
const msd = $getWorkflowStaticData('global');
const mmapa = (msd.avisadosRedireccion && typeof msd.avisadosRedireccion === 'object') ? msd.avisadosRedireccion : {};
const mahora = Date.now();
let mfallidos = 0;
mcandidatos.forEach((c, i) => {
  const r = (mrespuestas[i] && mrespuestas[i].json) || {};
  const id = Array.isArray(r.messages) && r.messages[0] ? String(r.messages[0].id || '') : '';
  if (id !== '') mmapa[c.from] = mahora; else mfallidos++;
});
// Poda: lo mas viejo que max(48 h, 2 x la ventana) ya no cuenta.
const mpoda = Math.max(48, 2 * (Number($('Config del negocio').first().json.ventanaHoras) || 24)) * 3600 * 1000;
for (const k of Object.keys(mmapa)) if (mahora - Number(mmapa[k] || 0) > mpoda) delete mmapa[k];
msd.avisadosRedireccion = mmapa;
if (mfallidos > 0) throw new Error('Aviso de redireccion no enviado a ' + mfallidos + ' cliente(s): Meta no devolvio un id.');
return mcandidatos.map((c) => ({ json: { from: c.from, avisado: true } }));
