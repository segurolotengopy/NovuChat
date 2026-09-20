// EL SEGUNDO TURNO TRAS UN CRUCE DE HORARIO (2026-09-17).
//
// `Reintento tras cruce` NO tiene la herramienta de agendar: por diseño no
// puede crear una cita, asi que aca no hay nada que verificar en el
// calendario. Lo que si hay que vigilar es lo que DICE: si afirma que agendo,
// le mentiria al cliente igual que la respuesta que se deshizo. En ese caso,
// si el modelo fallo o si devolvio vacio, se cae a la red de seguridad de
// siempre: el texto fijo de `Config del negocio`, la transferencia y el aviso
// a recepcion. Una sola vez: este nodo no vuelve al agente.
const base = $('Retomar respuesta').first().json;
const dato = ($input.first() && $input.first().json) || {};
const fallo = dato.error !== undefined || dato.output === undefined;
const bruto = String(dato.output ?? '');
const marca = bruto.includes('[TRANSFERIR]');
// Negrita de WhatsApp por construccion: la misma linea que en `Procesar
// respuesta` y `Mensaje a enviar` (ver el comentario alla).
const NEGRITA_MD = (t) => String(t).replace(/\*\*\*([^*\n]+?)\*\*\*/g, '*_$1_*').replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
const texto = NEGRITA_MD(bruto.split('[TRANSFERIR]').join('').trim());
// Los detectores juzgan el texto sin marcas de formato.
const plano = texto.replace(/[*_~]/g, '');

// LOS MISMOS DETECTORES QUE `Procesar respuesta`, letra por letra: una prueba
// (`platinum-flujo.test.ts`) exige que sean identicos para que un ajuste en
// uno no deje al otro con una version vieja.
const CONFIRMA = /(ha sido|han sido|queda|quedó|quedo|fue|está|esta|ya está|ya esta)\s+(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad|anotad)|\b(he|hemos)\s+(agendado|reservado|registrado|confirmado|reprogramado|reagendado|movido|anotado)\b|(agendé|reservé|registré|reprogramé|reagendé|moví)(?![a-záéíóúñ])|\b(te|le|les|los|las)\s+anot(é|amos)(?![a-záéíóúñ])|\b(cambié|cambiamos|moví|movimos)\s+(tu|su|la)\s+cita\b|\b(cita|reserva|turno)\b[^.!?]{0,40}?\b(agendad|reservad|registrad|confirmad|reprogramad|reagendad|movid|cambiad)[oa]s?\b/i;
const NIEGA = /\bno\s+(pude|se pudo|pudimos|quedó|quedo|está|esta)\b/i;
const YA_EXISTE = /\bya\s+(tiene|tienes|cuenta con|hay)/i;
// Y uno propio de este turno: «ese horario ya esta ocupado» es exactamente lo
// que el reintento tiene que decir, y CONFIRMA lo confunde con «esta
// reservado» de una cita nueva.
const OCUPADO = /\b(ya\s+)?(est[aá]|estaba|se encuentra|estar[ií]a)\s+(ocupad|reservad|tomad)|\bya\s+no\s+est[aá]\s+disponible/i;
// Se juzga ORACION por ORACION: un «no quedo registrada» al principio no
// puede tapar un «quedo agendada a las 15:00» al final.
const oraciones = plano.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
const afirmaAgendo = oraciones.some((s) =>
  CONFIRMA.test(s) && !NIEGA.test(s) && !YA_EXISTE.test(s) && !OCUPADO.test(s));

const motivo = base.motivoCruce || 'hubo un cruce de horario';
const salio = !fallo && texto !== '' && !afirmaAgendo;
if (salio) {
  return [{ json: { ...base,
    respuesta: texto,
    transferir: marca,
    motivoTransferencia: marca
      ? `${motivo}; al ofrecer alternativas el asistente pidio atencion humana`
      : '',
    reintentoTrasCruce: 'ok',
  }, pairedItem: { item: 0 } }];
}

const porQue = fallo ? 'fallo el modelo' : (texto === '' ? 'el modelo no devolvio texto' : 'el modelo volvio a afirmar que agendo');
return [{ json: { ...base,
  respuesta: base.respuesta,
  transferir: true,
  motivoTransferencia: `${motivo}; el reintento de ofrecer alternativas no salio (${porQue}) y el cliente quedo esperando otro horario`,
  reintentoTrasCruce: fallo ? 'fallo' : (texto === '' ? 'vacio' : 'afirmo-agendar'),
}, pairedItem: { item: 0 } }];
