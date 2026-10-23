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
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/<<<|>>>/g, ' ')
    .replace(/[\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function dnEsMarcador(t) {
  return typeof t === 'string' && t.indexOf('REEMPLAZAR_') >= 0;
}
function dnDireccion(t) {
  if (dnEsMarcador(t)) return '';
  return dnLimpiar(t).slice(0, DN_TOPE_DIRECCION).trim();
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
    nombre: dnLimpiar(p.nombre).slice(0, DN_TOPE_NOMBRE_PRODUCTO).trim(),
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
    const titulares = (Array.isArray(a.titulares) ? a.titulares : [])
      .map(dnLimpiar)
      .filter((x) => x.length >= DN_MIN_LARGO_TITULAR && x.length <= DN_MAX_LARGO_TITULAR)
      .slice(0, DN_MAX_TITULARES);
    if (titulares.length === 0) continue;
    salida.push({
      id: a.id,
      titulares,
      angulo: dnLimpiar(a.angulo).slice(0, DN_TOPE_ANGULO).trim(),
      producto: dnProducto(a.producto),
    });
  }
  return salida;
}
// Punto de entrada. Nunca lanza: cualquier entrada malformada da la salida segura.
function dnDatosDelNegocio(codigo, cuerpo, base) {
  const b = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  const vale = codigo === 200 && !!cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) && typeof cuerpo.tenantId === 'string';
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
}
