// PUNTO UNICO DE SALIDA AL CLIENTE (2026-09-17, ejecucion #2867 de Platinum).
//
// EL DEFECTO. `Reportar mensaje (saliente)` colgaba de `Procesar respuesta`,
// ANTES del candado, y reportaba lo que el modelo habia escrito. Cuando el
// candado deshizo una cita solapada y cambio el texto, la consola mostro
// «¡Listo! Quedó agendada…» mientras el telefono recibio «Disculpe, no pude
// confirmar…». La consola es lo que el comercio usa para saber que paso, y
// mentia.
//
// EL ARREGLO. Todo camino que termina en `Responder al cliente` pasa por aca
// -- respuesta normal, reintento tras un cruce, texto fijo, comercio no
// operativo, uso extendido -- y el reporte cuelga DESPUES del envio y lee de
// este nodo: reporta exactamente lo que salio, y solo si salio (un envio
// rechazado por Meta corta la ejecucion antes de llegar al reporte).
//
// Es un nodo de paso: no decide nada. Solo deja el item con `pairedItem`
// explicito para que `$('Mensaje a enviar').item` resuelva aunque el camino
// venga de nodos que construyen items nuevos.
//
// Lo UNICO que toca del texto es la negrita de Markdown (2026-09-17): como
// todo lo que sale al cliente pasa por aca -- tambien los textos fijos que el
// comercio escribe en su consola --, un **asi** que llegara desde cualquier
// rama sale como *asi*. La misma linea que en `Procesar respuesta` y
// `Procesar reintento`; una prueba exige que las tres sean identicas.
const NEGRITA_MD = (t) => String(t).replace(/\*\*\*([^*\n]+?)\*\*\*/g, '*_$1_*').replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');

// LATENCIA DE PUNTA A PUNTA (bloque 3). `Normalizar entrada` anota `recibidoEn`
// al entrar; aca se cierra el cronometro. No se manda a ningun lado: queda en
// los datos de la ejecucion, que es de donde `ver-ejecuciones.sh` saca el p50 y
// el p90. Hacia falta porque la rama de medios agrega una descarga y una
// llamada al modelo (Analisis/34 §3.1: +2 a 4 s en audio, +1 a 2 en imagen), y
// sin medirlo no se sabe si el p90 de 10 s aguanta. Sin `recibidoEn` --un
// camino viejo, o un item armado por otro nodo-- no se inventa nada.
const recibido = Number($('Normalizar entrada').first().json.recibidoEn);
const latenciaMs = Number.isFinite(recibido) && recibido > 0 ? Date.now() - recibido : null;

return $input.all().map((i, idx) => ({
  json: {
    ...i.json,
    respuesta: NEGRITA_MD(i.json.respuesta ?? ''),
    ...(latenciaMs === null ? {} : { latenciaMs }),
  },
  pairedItem: { item: idx },
}));
