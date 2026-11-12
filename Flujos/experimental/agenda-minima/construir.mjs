#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «Agenda mínima (v0)» desde la plantilla
 * =============================================================================
 *
 *   node construir.mjs               escribe agenda-minima.v0.json y agenda-minima.prueba.json
 *   node construir.mjs --verificar   no escribe: sale 1 si algún JSON versionado difiere de lo que se arma
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código: cada nodo Code lleva
 * `"jsCode": "@@nodos/<archivo>.js"`. Acá se reemplaza por
 *
 *     src/lib/agenda.js  +  línea en blanco  +  src/nodos/_comun.js  +  línea en blanco  +  src/nodos/<archivo>.js
 *
 * (la librería de agenda y las utilidades comunes, delante del código del nodo: el nodo
 * Code de n8n no tiene módulos). Dos marcas más, para no repetir código que el nodo no usa:
 *   `"@@comun:nodos/<archivo>.js"`  utilidades comunes + el archivo (sin la librería de agenda);
 *   `"@@solo:nodos/<archivo>.js"`   solo el archivo.
 *   `"@@niegaia:nodos/<archivo>.js"` librería + utilidades + `NIEGA_IA_CORE` (la regla de IDENTIDAD del filtro común del core, derivada de su fuente) + el archivo.
 *   `"@@medio:<paquete>"`           un módulo común de medios (`Flujos/src/core/medios/`), tal cual, sin edición.
 * Y la rama común del GUARDADO de medios (`../comun-sin-agente/src/guardado.mjs`, contrato M1↔M2 del 29/10/2026): se INJERTA al armar, colgada de
 * «Reportar mensaje (entrante)» y debajo de todo (corre después de la respuesta); la plantilla, el prompt y los nodos propios no se tocan.
 *
 * DOS VARIANTES, de la misma plantilla:
 *   - agenda-minima.v0.json      PRODUCCIÓN: con «WhatsApp Trigger», SIN «Entrada de prueba».
 *   - agenda-minima.prueba.json  PRUEBA: SIN «WhatsApp Trigger» (activarlo en n8n registra el
 *     disparador en Meta y le quita el webhook al flujo vivo) y CON «Entrada de prueba»
 *     (Webhook POST, ruta `REEMPLAZAR_RUTA_DE_PRUEBA`).
 * Al quitar el nodo que no corresponde se quitan también sus conexiones.
 *
 * Node sin dependencias. No lee ningún .env ni llama a la red.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hallazgosDelGuardado, injertarGuardado } from '../comun-sin-agente/src/guardado.mjs';
import { textosDeHallazgos as hallazgosDeExpresionesN8n } from '../comun-sin-agente/src/expresiones.mjs';
import { hallazgosCrm, injertarCrm, ramaCrm, rutasPaqueteCrmSenales, validarMapaCrm } from '../comun-sin-agente/construir-crm.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** Los datos del tenant (zona Tenants: solo el mapa de columnas del miniCRM; nunca un id de planilla). */
const ARCHIVO_DE_DATOS_CRM = join(AQUI, '../../../admin/scripts/datos/bellido/crm.json');
/** La credencial del miniCRM la calcula el codigo por tenant (igual que en Evy): nunca sale de datos. */
const CREDENCIAL_CRM = (tenant) => `Google Sheets miniCRM (crm-${tenant})`;
const TENANT_CRM = 'bellido';
/** Los 8 nodos de la rama del miniCRM (el modulo `crm` los genera). */
const NODOS_DE_CRM = ['Prospecto para la planilla', 'Buscar teléfono en planilla', 'Leer IDs de la planilla', 'Leer encabezados de la planilla', 'Decidir fila de la planilla', '¿Acción de la planilla?', 'Agregar fila', 'Actualizar fila'];
const verificar = process.argv.includes('--verificar');

const leer = (ruta) => readFileSync(join(AQUI, ruta), 'utf8');
const LIB = leer('src/lib/agenda.js').trimEnd();
const COMUN = leer('src/nodos/_comun.js').trimEnd();
const plantilla = JSON.parse(leer('flujo.plantilla.json'));

const VARIANTES = [
  { archivo: 'agenda-minima.v0.json', quitar: 'Entrada de prueba', nombre: 'NovuChat — Agenda mínima (v0)' },
  { archivo: 'agenda-minima.prueba.json', quitar: 'WhatsApp Trigger', nombre: 'NovuChat — Agenda mínima (v0, prueba)' },
];

// Los tres módulos comunes de medios (`Flujos/src/core/medios/`) se INCLUYEN desde su fuente con `"@@medio:<paquete>"`,
// sin una sola edición: nunca se copian a esta carpeta (una prueba compara el código del nodo con el módulo).
const MEDIOS = {
  'm-transcripcion': '../../src/core/medios/preparar-transcripcion.js',
  'm-imagen': ['../../src/core/medios/anuncio-por-titular.js', '../../src/core/medios/preparar-imagen.js'],
  'm-no-aceptado': '../../src/core/medios/medio-no-aceptado.js',
  // El miniCRM (modulo `crm`, adaptador general de senales): tambien se INCLUYE desde su fuente, nunca se copia.
  ...Object.fromEntries(Object.entries(rutasPaqueteCrmSenales()).map(([k, rutas]) => [k, rutas.map((r) => relative(AQUI, r))])),
};
const MAPA_CRM = JSON.parse(readFileSync(ARCHIVO_DE_DATOS_CRM, 'utf8')).crm;
{
  const errores = validarMapaCrm(MAPA_CRM);
  if (errores.length) throw new Error(`admin/scripts/datos/bellido/crm.json: el mapa de columnas no es valido: ${errores.join('; ')}`);
}

// La regla de IDENTIDAD del FILTRO COMÚN (`Flujos/src/core/texto/filtro-redaccion.js`, prohibición 4: el asistente nunca niega ser una IA) se DERIVA de su fuente al armar, nunca se copia a esta carpeta:
// se lee el bloque «negar ser una IA» de la lista del core y se inyecta como `NIEGA_IA_CORE` delante del código de «Armar mensajes» (`"@@niegaia:nodos/<archivo>.js"`). Se incluye SOLO ese bloque, no todo el
// filtro: el resto (pagos, «recibido», horas…) rechaza texto legítimo de una agenda. Si el core mueve o renombra el bloque, este armado FALLA a propósito (y `niega-ia.test.ts` lo cubre).
function reglaDeIdentidadDelCore() {
  const fuente = leer('../../src/core/texto/filtro-redaccion.js');
  const ini = fuente.indexOf('  // negar ser una IA (prohibición 4');
  const finMarca = "  'carne y hueso',\n";
  const fin = ini < 0 ? -1 : fuente.indexOf(finMarca, ini);
  if (ini < 0 || fin < 0) throw new Error('filtro-redaccion.js: no encuentro el bloque «negar ser una IA» (prohibición 4); agenda mínima lo incluye de ahí');
  const lista = vm.compileFunction(`return [${fuente.slice(ini, fin + finMarca.length)}];`)();
  if (!Array.isArray(lista) || lista.length < 8 || lista.some((x) => typeof x !== 'string')) throw new Error('filtro-redaccion.js: el bloque «negar ser una IA» ya no es una lista de expresiones');
  return `// REGLA DE IDENTIDAD (prohibición 4) derivada de Flujos/src/core/texto/filtro-redaccion.js al armar; no se edita a mano.\nconst NIEGA_IA_CORE = new RegExp(${JSON.stringify(lista.join('|'))});`;
}
const NIEGA_IA_CORE = reglaDeIdentidadDelCore();

function codigoDe(marca, nodo) {
  if (marca.startsWith('@@medio:')) {
    const archivo = MEDIOS[marca.slice('@@medio:'.length)];
    if (!archivo) throw new Error(`${nodo}: paquete de medios desconocido: ${marca}`);
    return [].concat(archivo).map((a) => leer(a).trimEnd()).join('\n') + '\n';
  }
  const modo = marca.startsWith('@@solo:') ? 'solo' : (marca.startsWith('@@comun:') ? 'comun' : (marca.startsWith('@@niegaia:') ? 'niegaia' : 'todo'));
  const ruta = marca.slice(modo === 'solo' ? '@@solo:'.length : (modo === 'comun' ? '@@comun:'.length : (modo === 'niegaia' ? '@@niegaia:'.length : '@@'.length)));
  if (!/^nodos\/[a-z0-9-]+\.js$/.test(ruta)) throw new Error(`${nodo}: ruta de código no válida: ${marca}`);
  if (!existsSync(join(AQUI, 'src', ruta))) throw new Error(`${nodo}: no existe src/${ruta}`);
  const propio = leer(`src/${ruta}`).trimEnd();
  return (modo === 'solo' ? propio : (modo === 'comun' ? `${COMUN}\n\n${propio}` : (modo === 'niegaia' ? `${LIB}\n\n${COMUN}\n\n${NIEGA_IA_CORE}\n\n${propio}` : `${LIB}\n\n${COMUN}\n\n${propio}`))) + '\n';
}

function armar(v) {
  const flujo = JSON.parse(JSON.stringify(plantilla));
  flujo.name = v.nombre;
  flujo.nodes = flujo.nodes.filter((n) => n.name !== v.quitar);
  // LA RAMA DEL miniCRM se GENERA (modulo `crm`), no se copia: 8 nodos colgados de «Armar mensajes» ADEMAS de sus conexiones previas, por debajo del envio
  // (y = 640, a la derecha de todo lo demas). Va en las DOS variantes; la de prueba lleva el id de planilla vacio y por eso no escribe en ninguna hoja.
  const rama = ramaCrm({ credencial: '@@cred:crm', desde: 'Armar mensajes', paquete: 'crm-decidir-senales', x: 9080, y: 640 });
  flujo.nodes.push(...rama.nodes);
  Object.assign(flujo.connections, rama.connections);
  const previoDeArmar = (flujo.connections['Armar mensajes'] && flujo.connections['Armar mensajes'].main && flujo.connections['Armar mensajes'].main[0]) || [];
  flujo.connections['Armar mensajes'] = { main: [[...previoDeArmar, { node: rama.entrada, type: 'main', index: 0 }]] };
  for (const n of flujo.nodes) {
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.startsWith('@@')) n.parameters.jsCode = codigoDe(js, n.name);
    // La credencial del miniCRM la calcula el tenant; nunca sale de datos.
    for (const c of Object.values(n.credentials || {})) if (c && c.name === '@@cred:crm') c.name = CREDENCIAL_CRM(TENANT_CRM);
    // La variante de PRUEBA no escribe en ninguna planilla: el id va vacio (nunca la hoja de un cliente real).
    if (n.name === 'Config base' && v.quitar === 'WhatsApp Trigger') {
      for (const a of n.parameters.assignments.assignments) if (a.name === 'planillaProspectosId') a.value = '';
    }
  }
  const vivos = new Set(flujo.nodes.map((n) => n.name));
  const conexiones = {};
  for (const [de, salidas] of Object.entries(flujo.connections)) {
    if (!vivos.has(de)) continue;
    conexiones[de] = { main: (salidas.main || []).map((s) => (s || []).filter((c) => vivos.has(c.node))) };
  }
  flujo.connections = conexiones;
  // El GUARDADO de medios (módulo común, nunca copiado): credenciales tomadas por nombre del flujo ya armado (ingesta del reporte, WhatsApp de «Descargar medio»).
  injertarGuardado(flujo, { guardarUrl: 'https://us-east1-novuchat-demo.cloudfunctions.net/guardarMedio' });
  // La misma guardia que la prueba de CI «guardado obligatorio»: nueve nodos, ningún Code que lea el binario, retención en «none» (contrato v2 del 30/10).
  const hallazgosGuardado = hallazgosDelGuardado(flujo, { exigir: true });
  if (hallazgosGuardado.length) throw new Error(`${v.archivo}: ${hallazgosGuardado.join('; ')}`);
  // El sandbox de EXPRESIONES de n8n (07/11/2026): ninguna expresión lee prototype/__proto__/constructor ni usa Function, eval, process, require, globalThis o this.
  const hallazgosExpr = hallazgosDeExpresionesN8n(flujo);
  if (hallazgosExpr.length) throw new Error(`${v.archivo}: ${hallazgosExpr.join('; ')}`);
  // El mapa de columnas del tenant (dato, no codigo) dentro de los nodos del modulo y los rangos de lectura de los nodos de Google; y la guardia del miniCRM
  // (rangos que no llegan a la letra del diagnostico del equipo ni pasan de la ultima del bot; retencion de ejecuciones en «none»; la rama completa y su credencial).
  injertarCrm(flujo, MAPA_CRM);
  const hallazgosDelCrm = hallazgosCrm(flujo, MAPA_CRM);
  for (const n of NODOS_DE_CRM) if (!flujo.nodes.some((x) => x.name === n)) hallazgosDelCrm.push(`falta el nodo «${n}»`);
  for (const n of flujo.nodes.filter((x) => x.type === 'n8n-nodes-base.googleSheets' || x.name === 'Leer encabezados de la planilla')) {
    const g = n.credentials && n.credentials.googleApi;
    if (!g || g.name !== CREDENCIAL_CRM(TENANT_CRM)) hallazgosDelCrm.push(`«${n.name}» no usa la credencial ${CREDENCIAL_CRM(TENANT_CRM)}`);
  }
  if (hallazgosDelCrm.length) throw new Error(`${v.archivo}: miniCRM: ${hallazgosDelCrm.join('; ')}`);
  const texto = JSON.stringify(flujo, null, 2) + '\n';
  if (texto.includes('"@@')) throw new Error(`${v.archivo}: quedó una marca @@ sin reemplazar`);
  const ids = flujo.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${v.archivo}: ids de nodo repetidos`);
  return texto;
}

let difiere = false;
for (const v of VARIANTES) {
  const texto = armar(v);
  const ruta = join(AQUI, v.archivo);
  if (verificar) {
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
    if (actual !== texto) {
      difiere = true;
      console.error(`✗ ${v.archivo} ${actual === null ? 'no existe' : 'difiere de lo que arma la plantilla'}: corra «node construir.mjs»`);
    } else {
      console.log(`✓ ${v.archivo} al día`);
    }
  } else {
    writeFileSync(ruta, texto);
    console.log(`✓ ${v.archivo} escrito (${JSON.parse(texto).nodes.length} nodos)`);
  }
}
process.exit(difiere ? 1 : 0);
