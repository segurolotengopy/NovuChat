// CORE · NEGOCIO · DATOS DEL NEGOCIO (23/10/2026). Horario en palabras, dirección y anuncios vigentes que el servidor devuelve en «Traer configuración», saneados y con respaldo en «Config base». Funciones PURAS para incluir byte a byte en un nodo Code de n8n (JS): sin importaciones ni globales de Node, sin retorno de nivel superior, sin estado entre ejecuciones.
// Forma del cuerpo (admin/functions/src/ingesta.ts, configuracionFlujo): `datosDelNegocio.direccion`, `operacion.horarioAtencion` (no está en la raíz) y `anuncios` (solo aparece si hay alguno).
// Reglas: el cuerpo solo vale con codigo 200 y `tenantId` de texto; con 409 u otro código, o con el panel caído, horario y dirección salen de `base` y no hay anuncios. Manda la consola si trae texto; si no, el respaldo. `horarioAtencionManda: si` en `base` (turno partido) hace ganar a la base. El horario de la consola NUNCA se recorta: si pasa de 400 caracteres se descarta.
// Los topes de los anuncios son los de admin/functions/src/modulos/campanas/campanas.ts (se copian porque el flujo no importa del servidor). NO expone `descripcion` del producto.

const DN_TOPE_DIRECCION = 200;
const DN_TOPE_HORARIO = 400;
const DN_MAX_ANUNCIOS = 20;
const DN_MAX_TITULARES = 3;
const DN_MIN_LARGO_TITULAR = 6;
const DN_MAX_LARGO_TITULAR = 100;
const DN_TOPE_ANGULO = 300;
const DN_TOPE_NOMBRE_PRODUCTO = 80;

// Una sola línea de texto plano: sin marcadores de bloque (<<< >>>), sin [] {}, sin caracteres de control, separadores de línea, invisibles ni de dirección de escritura.
function dnLimpiar(t) {
  if (typeof t !== 'string') return '';
  return t
    .normalize('NFKC')
    .replace(/[\u{0}-\u{1f}\u{7f}-\u{9f}\u{2028}\u{2029}]/gu, ' ')
    .replace(/[\u{ad}\u{34f}\u{61c}\u{115f}\u{1160}\u{180e}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{206f}\u{3164}\u{fe00}-\u{fe0f}\u{feff}\u{ffa0}\u{e0000}-\u{e007f}]/gu, '')
    .replace(/<<<|>>>/g, ' ')
    .replace(/[\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Recorta por caracteres (no por unidades UTF-16): nunca parte un emoji.
function dnRecortar(s, n) {
  return Array.from(s).slice(0, n).join('').trim();
}
function dnEsMarcador(t) {
  return typeof t === 'string' && t.indexOf('REEMPLAZAR_') >= 0;
}
function dnDireccion(t) {
  if (dnEsMarcador(t)) return '';
  return dnRecortar(dnLimpiar(t), DN_TOPE_DIRECCION);
}
// El horario no se recorta nunca: si no cabe, no hay horario de esta fuente.
function dnHorario(t) {
  if (dnEsMarcador(t)) return '';
  const l = dnLimpiar(t);
  return l.length > DN_TOPE_HORARIO ? '' : l;
}
function dnProducto(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  if (typeof p.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(p.id)) return null;
  return {
    id: p.id,
    nombre: dnRecortar(dnLimpiar(p.nombre), DN_TOPE_NOMBRE_PRODUCTO),
    precio: typeof p.precio === 'number' && Number.isFinite(p.precio) && p.precio >= 0 ? p.precio : null,
    agotado: p.agotado === true,
  };
}
function dnAnuncios(lista) {
  if (!Array.isArray(lista)) return [];
  const salida = [];
  for (let i = 0; i < lista.length && salida.length < DN_MAX_ANUNCIOS; i++) {
    const a = lista[i];
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    if (typeof a.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(a.id)) continue;
    const titulares = (Array.isArray(a.titulares) ? a.titulares.slice(0, DN_MAX_ANUNCIOS) : [])
      .map(dnLimpiar)
      .filter((x) => x.length >= DN_MIN_LARGO_TITULAR && x.length <= DN_MAX_LARGO_TITULAR)
      .slice(0, DN_MAX_TITULARES);
    if (titulares.length === 0) continue;
    salida.push({
      id: a.id,
      titulares,
      angulo: dnRecortar(dnLimpiar(a.angulo), DN_TOPE_ANGULO),
      producto: dnProducto(a.producto),
    });
  }
  return salida;
}
// Punto de entrada. Cualquier entrada malformada da la salida segura; si algo lanza (un getter hostil), devuelve el respaldo de `base` con `anuncios: []`. `tenantEsperado` (opcional): si viene, el cuerpo solo vale con ese mismo `tenantId`; un `tenantId` vacío nunca vale. `horarioAtencionManda` solo acepta «si» (sin tilde).
function dnDatosDelNegocio(codigo, cuerpo, base, tenantEsperado) {
  try {
    const b = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
    const vale = codigo === 200 && !!cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)
      && typeof cuerpo.tenantId === 'string' && cuerpo.tenantId !== ''
      && (tenantEsperado === undefined || tenantEsperado === null || cuerpo.tenantId === tenantEsperado);
    const c = vale ? cuerpo : {};
    const op = c.operacion && typeof c.operacion === 'object' ? c.operacion : {};
    const dn = c.datosDelNegocio && typeof c.datosDelNegocio === 'object' ? c.datosDelNegocio : {};
    const horarioConsola = dnHorario(op.horarioAtencion);
    const horarioBase = dnHorario(b.horarioAtencion);
    const manda = typeof b.horarioAtencionManda === 'string' && b.horarioAtencionManda.trim().toLowerCase() === 'si';
    const horarioAtencion = manda && horarioBase !== '' ? horarioBase : (horarioConsola !== '' ? horarioConsola : horarioBase);
    const dirConsola = dnDireccion(dn.direccion);
    return {
      horarioAtencion,
      direccion: dirConsola !== '' ? dirConsola : dnDireccion(b.direccion),
      anuncios: vale ? dnAnuncios(c.anuncios) : [],
    };
  } catch (e) {
    try {
      return { horarioAtencion: dnHorario(base.horarioAtencion), direccion: dnDireccion(base.direccion), anuncios: [] };
    } catch (e2) {
      return { horarioAtencion: '', direccion: '', anuncios: [] };
    }
  }
}
