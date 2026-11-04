// DECIDIR AVISO: de la entrega verificada del receptor saca, por cada cliente que escribio al numero viejo, SI corresponde el aviso
// del numero nuevo. Un aviso por cliente y ventana (ventanaHoras, 24 h: respuesta de servicio). Sin IA, sin medios.
//
// Falla CERRADA: sin phone_number_id configurado (marcador REEMPLAZAR_*), o con un evento de otra linea, no se avisa a nadie.
// No se contesta a: acuses de estado (no traen `messages`), eco del propio numero, mensajes de sistema ni reacciones.
const dcfg = $('Config del negocio').first().json;
const dcuerpo = ($('Entrega del receptor').first().json || {}).body || {};
const dvalor = dcuerpo.value && typeof dcuerpo.value === 'object' ? dcuerpo.value : null;
const ddig = (x) => String(x || '').replace(/\D/g, '');
const dnada = [{ json: { avisar: false } }];

const desperado = String(dcfg.phoneNumberIdEsperado || '');
const dmeta = (dvalor && dvalor.metadata) || {};
if (!dvalor || (dcuerpo.field !== undefined && dcuerpo.field !== 'messages')) return dnada;
if (desperado === '' || desperado.startsWith('REEMPLAZAR_') || String(dmeta.phone_number_id || '') !== desperado) return dnada;
const dmensajes = Array.isArray(dvalor.messages) ? dvalor.messages : [];
if (dmensajes.length === 0) return dnada;

const dahora = Date.now();
const dventana = (Number(dcfg.ventanaHoras) || 24) * 3600 * 1000;
const dsd = $getWorkflowStaticData('global');
const davisados = (dsd.avisadosRedireccion && typeof dsd.avisadosRedireccion === 'object') ? dsd.avisadosRedireccion : {};
const dpropios = [ddig(dmeta.display_phone_number), ddig(dmeta.phone_number_id)].filter((x) => x);
const dnumero = String(dcfg.numeroNuevo || '').trim();
const dnuevo = ddig(dnumero);
if (dnuevo.length < 8) return dnada;
const dtexto = String(dcfg.textoAviso || '').replace('[NUMERO]', () => dnumero).replace('[ENLACE]', () => 'https://wa.me/' + dnuevo);
if (dtexto === '') return dnada;

const dsalida = [];
const dvistos = {};
for (const m of dmensajes) {
  const from = ddig(m && m.from);
  if (!from || dpropios.indexOf(from) >= 0 || dvistos[from]) continue;
  if (m.type === 'system' || m.type === 'reaction') continue;
  const previo = Number(davisados[from] || 0);
  if (previo > 0 && dahora - previo < dventana) continue;
  dvistos[from] = true;
  dsalida.push({ json: {
    avisar: true, from: from, phoneNumberId: desperado, waGraphVersion: String(dcfg.waGraphVersion || 'v26.0'),
    payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: from, type: 'text', text: { preview_url: true, body: dtexto } },
  } });
}
return dsalida.length > 0 ? dsalida : dnada;
