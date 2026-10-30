// Lo que el constructor de un flujo necesita del modulo `crm`: los paquetes de codigo que se INCLUYEN (nunca se copian) y el injerto del mapa de
// columnas del tenant (dato, no codigo). Lo usan los `construir.mjs` de los flujos que llevan miniCRM.
//
//   paquetes.crm-prospecto = [crm.js, nodo-prospecto.js]
//   paquetes.crm-decidir   = [crm.js, <adaptador que pasa el flujo>, nodo-decidir-fila.js]
//   plantilla: "jsCode": "@@medio:crm-prospecto"  /  "@@medio:crm-decidir"
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
/**
 * Las rutas de cada paquete. El ADAPTADOR de captacion (como se califica y se resume) lo pasa quien construye el flujo: el modulo `crm` no sabe
 * donde vive ni lo importa por su cuenta.
 */
export function rutasPaquetesCrm(rutaAdaptador) {
  if (typeof rutaAdaptador !== 'string' || !rutaAdaptador) throw new Error('crm: falta la ruta del adaptador (calificar y resumir)');
  return {
    'crm-prospecto': [join(AQUI, 'crm.js'), join(AQUI, 'nodo-prospecto.js')],
    'crm-decidir': [join(AQUI, 'crm.js'), rutaAdaptador, join(AQUI, 'nodo-decidir-fila.js')],
  };
}
export const MARCA_MAPA = 'const CRM_MAPA = null; // @@crm-mapa';

/** El texto de cada paquete (archivos unidos). */
export function paquetesCrm(rutaAdaptador) {
  return Object.fromEntries(Object.entries(rutasPaquetesCrm(rutaAdaptador)).map(([k, rutas]) => [k, rutas.map((r) => readFileSync(r, 'utf8').trimEnd())]));
}

/** Valida el mapa con el MISMO `crmValidarMapa` que corre en n8n. Devuelve la lista de errores. */
export function validarMapaCrm(mapa) {
  const codigo = readFileSync(join(AQUI, 'crm.js'), 'utf8');
  const { crmValidarMapa } = runInNewContext(`${codigo}\n({ crmValidarMapa })`, {});
  return crmValidarMapa(JSON.parse(JSON.stringify(mapa ?? null)));
}

/** Reemplaza la linea marcadora exactamente una vez. Lanza si hay 0 o mas de 1. */
export function inyectarMapa(codigo, mapa) {
  const partes = codigo.split(MARCA_MAPA);
  if (partes.length !== 2) throw new Error(`la linea «${MARCA_MAPA}» debe aparecer exactamente una vez (aparece ${partes.length - 1})`);
  return partes[0] + `const CRM_MAPA = ${JSON.stringify(mapa)};` + partes[1];
}

const letraBot = (mapa) => Object.values(mapa.columnas).map((c) => c.letra).sort().pop();
const nodo = (flujo, nombre) => {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`crm: el flujo no tiene el nodo «${nombre}»`);
  return n;
};

/**
 * Injerta el mapa del tenant en un flujo ya armado (objeto): el mapa dentro del codigo de cada nodo que incluye `crm.js` y, en los 4 nodos de Google,
 * el rango de lectura (A{fila}:{ultima letra del bot} y A{fila}:A), la fila de encabezados, la primera fila de datos, la columna de busqueda del
 * telefono y `returnFirstMatch: false` (se leen TODAS las coincidencias; el codigo elige la mas reciente). Lanza si el mapa no es valido.
 */
export function injertarCrm(flujo, mapa) {
  const errores = validarMapaCrm(mapa);
  if (errores.length) throw new Error(`crm: el mapa de columnas no es valido: ${errores.join('; ')}`);
  let inyectados = 0;
  for (const n of flujo.nodes) {
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.includes(MARCA_MAPA)) { n.parameters.jsCode = inyectarMapa(js, mapa); inyectados++; }
  }
  if (inyectados === 0) throw new Error('crm: ningun nodo lleva la linea marcadora del mapa');
  const f = mapa.filaEncabezados;
  const buscar = nodo(flujo, 'Buscar teléfono en planilla').parameters;
  buscar.options.dataLocationOnSheet.values.range = `A${f}:${letraBot(mapa)}`;
  buscar.options.returnFirstMatch = false;
  for (const fl of buscar.filtersUI.values) fl.lookupColumn = mapa.columnas.telefono.titulo;
  nodo(flujo, 'Leer IDs de la planilla').parameters.options.dataLocationOnSheet.values.range = `A${f}:A`;
  nodo(flujo, 'Agregar fila').parameters.options.locationDefine.values.headerRow = f;
  const act = nodo(flujo, 'Actualizar fila').parameters.options.locationDefine.values;
  act.headerRow = f;
  act.firstDataRow = f + 1;
  return flujo;
}
