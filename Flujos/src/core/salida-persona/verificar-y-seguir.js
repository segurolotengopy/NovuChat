// SALIDA DE PERSONA, paso 7: ¿se confirmo todo?, y ¿hay otra vuelta?
//
// Entra la respuesta de `confirmarSalidaPersona` de cada mensaje del lote (el nodo
// HTTP ya las proceso TODAS antes de llegar aqui). Si alguna confirmacion no fue
// un 200 con ok, la ejecucion FALLA con un mensaje que nombra el mensaje y el
// resultado (nunca el texto ni el telefono): una confirmacion perdida es un error
// visible, no un exito falso. El mensaje queda `enviando` y el siguiente reclamo
// lo pasa a `incierto` a los 2 minutos; nunca se reenvia solo.
//
// Sin fallas: sale UN item que vuelve a `Reclamar`. El bucle termina cuando el
// reclamo llega vacio (`Planificar lote` no emite nada) o al llegar al tope de
// vueltas de `Config base` (lo que quede pendiente lo toma el barrido).
const cfg = $('Config base').first().json;
const enviados = $('Resultado del envío').all();
const fallas = [];
$input.all().forEach((it, i) => {
  const r = it.json || {};
  const cuerpo = (r.body && typeof r.body === 'object') ? r.body : {};
  if (Number(r.statusCode) !== 200 || cuerpo.ok !== true) {
    const e = enviados[i] ? enviados[i].json : {};
    fallas.push(`${String(e.mensajeId ?? '?')} (${String(e.resultado ?? '?')}) -> HTTP ${String(r.statusCode ?? 'sin respuesta')}`);
  }
});
if (fallas.length > 0) {
  throw new Error('Salida de persona: no se pudo confirmar ' + fallas.length + ' mensaje(s): ' + fallas.join('; '));
}

const tope = Math.max(1, Math.min(50, Number(cfg.maxVueltas) || 10));
if ($runIndex + 1 >= tope) return [];
return [{ json: { vuelta: $runIndex + 1 } }];
