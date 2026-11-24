// Registra SOLO el nombre del flujo y la hora. Todo lo demas de la entrada del Error Trigger
// (ids de ejecucion, url, mensaje de error, nodo, datos) se descarta aqui: nunca se copia ni se reenvia.
const entrada = $input.first().json || {};
const wf = entrada.workflow && typeof entrada.workflow === 'object' ? entrada.workflow : {};
const flujo = typeof wf.name === 'string' ? wf.name.replace(/[^\p{L}\p{N} ._()\u00b7\u2014-]/gu, '_').replace(/\d(?:[\s.-]?\d){5,}/g, '_').slice(0, 80) : 'flujo desconocido';
const l = new Date(Date.now() - 4 * 60 * 60 * 1000);
const dos = (n) => String(n).padStart(2, '0');
const hora = l.getUTCFullYear() + '-' + dos(l.getUTCMonth() + 1) + '-' + dos(l.getUTCDate()) + ' ' + dos(l.getUTCHours()) + ':' + dos(l.getUTCMinutes()) + ':' + dos(l.getUTCSeconds()) + ' (America/La_Paz, UTC-4)';
return [{ json: { flujo, hora } }];
