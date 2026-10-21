// ADAPTAR TRANSCRIPCIÓN (propio de Rubén). `rrNucleo` es lo que devolvió el núcleo común `Flujos/src/core/medios/preparar-transcripcion.js`, INCLUIDO TAL CUAL arriba de este código: un `userInput` pensado para un agente.
// Este flujo no tiene agente: se traduce a un DATO cerrado `{audioEstado, audioTexto, audioRecortado}`. El texto transcrito no tiene saltos de línea (el núcleo colapsa los espacios): todo lo que va después del primer salto lo escribió el núcleo.
const RR_TR_TRANSCRITO = '(audio transcripto) ';
const RR_TR_MUY_LARGO = 'nota de voz de más de cinco minutos';
const RR_TR_SIGUE = 'la nota de voz seguía';
const rrSalidaNucleo = Array.isArray(rrNucleo) ? rrNucleo : [];
return rrSalidaNucleo.map((it, i) => {
  const u = String((it && it.json && it.json.userInput) || '');
  const lineas = u.split('\n');
  let estado = 'no_entendido'; let texto = ''; let recortado = false;
  if (u.startsWith(RR_TR_TRANSCRITO)) {
    texto = lineas[0].slice(RR_TR_TRANSCRITO.length).trim();
    recortado = lineas.slice(1).some((l) => l.indexOf(RR_TR_SIGUE) >= 0);
    estado = texto === '' ? 'no_entendido' : 'ok';
  } else if (u.indexOf(RR_TR_MUY_LARGO) >= 0) estado = 'largo';
  return { json: { audioEstado: estado, audioTexto: texto.slice(0, 4400), audioRecortado: recortado }, pairedItem: { item: i } };
});
