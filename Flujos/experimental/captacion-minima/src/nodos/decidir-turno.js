// DECIDIR TURNO: lo que pasa este turno, SIN modelo salvo cuando hace falta. El codigo calcula; el modelo, a lo sumo, pone una
// linea de empatia, contesta una pregunta suelta con los datos y clasifica.
//
// 1. Lee la ficha del telefono (SOLO la lee: el unico que la escribe es «Armar mensajes») y la deja vigente (`ccEstadoVigente`).
// 2. Convierte los MEDIOS en texto: el audio es la transcripcion (hasta 4.400 caracteres); una imagen o un PDF es lo que leyo
//    «Describir imagen» o «Describir documento», con una categoria de lista cerrada (`comprobante` u `otro`). Lo leido NUNCA se
//    mezcla con lo que escribio el cliente: va aparte, rotulado como dato. Sin transcripcion, o fuera de tope, `medioFallo`.
// 3. `ccDecidir` aplica las reglas globales y las del paso (§4) y devuelve el PLAN. Si hace falta el modelo, aca se arma su
//    cuerpo: la `systemInstruction` es ESTATICA (configuracion y corpus; nada del turno), el turno va en `contents`.
//
// Sale UN item: `{ plan, llamarModelo, cuerpoModelo }`. «¿Llamar al modelo?» mira `llamarModelo`.
// EL CORPUS DEL SITIO (el texto del sitio del negocio que el modelo puede usar) entra en la linea marcada de abajo (`@@conocimiento`).
const CM_CONOCIMIENTO = null; // @@conocimiento

const t = cnPrimero('Interpretar entrada') || {};
const cfg = cnCfg();
const ahoraMs = Number(t.ahoraMs) || Date.now();

// --- La ficha vigente ------------------------------------------------------------------------------------------------
const mapa = cnMapaDeFichas(false).mapa;
const e = ccEstadoVigente(cnClaveValida(t.from) && Object.prototype.hasOwnProperty.call(mapa, t.from) ? mapa[t.from] : null, ahoraMs);

// --- Los medios, convertidos en texto --------------------------------------------------------------------------------
let texto = String(t.texto || '');
let textoDeImagen = '';
let categoria = '';
let medioFallo = '';
if (t.tipo === 'audio') {
  const tr = t.esAudio ? cnTextoDeGemini(cnPrimero('Transcribir audio')).trim() : '';
  if (tr !== '' && tr.length <= 4400) texto = tr; else medioFallo = 'audio';
} else if (t.tipo === 'image' || t.tipo === 'document') {
  const lectura = t.esVisual ? (cnPrimero('Describir documento') || cnPrimero('Describir imagen')) : null;
  const o = lectura ? cnJsonDeGemini(lectura) : null;
  // La categoria es de lista cerrada: cualquier otra cosa es `otro`, y no abre ninguna rama nueva.
  if (o) { categoria = o.categoria === 'comprobante' ? 'comprobante' : 'otro'; textoDeImagen = typeof o.texto === 'string' ? ccPlano(o.texto, 500) : ''; }
  if (texto.trim() === '' && textoDeImagen === '' && categoria !== 'comprobante') medioFallo = t.tipo === 'document' ? 'documento' : 'imagen';
} else if (t.via === 'otro') {
  medioFallo = 'tipo';
}

const plan = ccDecidir({
  e: e,
  t: { from: t.from, nombrePerfil: t.nombrePerfil, tipo: t.tipo, texto: texto, via: t.via, idToque: t.idToque, anuncio: t.anuncio === true,
    textoDeImagen: textoDeImagen, categoria: categoria, medioFallo: medioFallo },
  cfg: cfg,
});

let cuerpoModelo = null;
if (plan.llamarModelo === true) {
  cuerpoModelo = ccCuerpoModelo({
    paso: plan.paso0,
    cfg: cfg,
    mensaje: plan.texto,
    preguntaHecha: ccPreguntaHecha(plan.e, cfg),
    textoDeImagen: plan.textoDeImagen,
    rubro: ccNombreDelRubro(plan.e, cfg),
    ahoraMs: ahoraMs,
    conocimiento: CM_CONOCIMIENTO,
  });
}
return [{ json: { plan: plan, llamarModelo: plan.llamarModelo === true, cuerpoModelo: cuerpoModelo, from: t.from } }];
