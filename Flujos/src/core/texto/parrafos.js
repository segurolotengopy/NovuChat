// CORE · TEXTO · PÁRRAFOS (regla de Andres, 20/10/2026). Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node, sin retorno de nivel superior.
// Origen canónico: la partición de Rubén (rr.js), con el prefijo rr→ct; la de Antonio es idéntica. Cada cliente lo incluye desde aquí; nunca se copia.
const CT_PARRAFO_MAX = 220;
// UNA SOLA función de partición: la usan `ctParrafos` y el vigilante de las pruebas (no puede haber desacuerdo entre quien reparte y quien vigila).
// Parte tras . ! ? … cuando sigue una mayúscula, una cifra o una apertura, y vuelve a unir: abreviaturas («Sr.», «Dr.», «etc.»), «Bs.» seguido de una cifra, y el número corto de una lista en línea («1. Pack 2. Libro»); un año o una cifra final («en 2026. Tiene…», «Cuesta 150. Incluye…») NO unen.
// «No» NO es abreviatura: «No. El libro no trae videos.» son dos oraciones.
function ctOraciones(bloque) {
  const partes = bloque.split(/(?<=[.!?…])\s+(?=[¿¡«"A-ZÁÉÍÓÚÑ0-9])/);
  const out = [];
  for (const p of partes) {
    const previa = out.length ? out[out.length - 1] : '';
    const une = out.length && (/(^|\s)(Sr|Sra|Srta|Dr|Dra|Lic|Ing|etc|Nº|N°)\.$/.test(previa)
      || (/(^|\s)Bs\.$/.test(previa) && /^\d/.test(p))
      // El número de una lista en línea es CORTO (1 o 2 cifras) y el elemento siguiente termina en otro número («1. Pack 2. Libro») o ya estamos dentro de una lista; un año («en 2026. Tiene…») o una cifra
      // final («Cuesta 150. Incluye…», «Son 12. Incluye…») NO unen.
      || (/(^|\s)\d{1,2}\.$/.test(previa) && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p) && (/\s\d{1,2}\.$/.test(p) || /(^|\s)\d{1,2}\.\s/.test(previa))));
    if (une) out[out.length - 1] += ' ' + p; else out.push(p);
  }
  return out;
}
// ¿Esta oración es la pregunta final? Cuenta aunque tras el «?» venga un emoji o espacios.
function ctEsPregunta(oracion) { return /\?[^\p{L}\p{N}]*$/u.test(oracion); }
// La entrada se corta a 4096 caracteres ANTES de partir (acota el costo de las expresiones regulares); para textos de hasta 4096 es idéntica a rrParrafos.
function ctParrafos(texto) {
  const t = String(texto === undefined || texto === null ? '' : texto).slice(0, 4096).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (t === '') return t;
  return t.split('\n\n').map((bloque) => {
    if (bloque.indexOf('\n') >= 0) return bloque;
    const ors = ctOraciones(bloque);
    if (ors.length < 2) return bloque;
    const pars = [];
    let i = 0;
    while (i < ors.length) {
      const esUltima = i === ors.length - 1;
      // La pregunta final va sola; dos oraciones juntas solo si caben y la segunda no es la pregunta final.
      const sigueFinal = i + 1 === ors.length - 1 && ctEsPregunta(ors[ors.length - 1]);
      if (!esUltima && !sigueFinal && (ors[i] + ' ' + ors[i + 1]).length <= CT_PARRAFO_MAX) { pars.push(ors[i] + ' ' + ors[i + 1]); i += 2; } else { pars.push(ors[i]); i += 1; }
    }
    return pars.join('\n\n');
  }).join('\n\n');
}
