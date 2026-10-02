#!/usr/bin/env node
/**
 * =============================================================================
 * construir.mjs — arma los JSON de «Venta mínima (v0)» desde la plantilla y los datos
 * =============================================================================
 *
 *   node construir.mjs               escribe venta-minima.<tenant>.json y venta-minima.prueba.json
 *   node construir.mjs --verificar   no escribe: sale 1 si algún JSON versionado difiere de lo que se arma
 *
 * QUÉ HACE. `flujo.plantilla.json` es el flujo sin el código y sin los datos del negocio:
 *
 *   - cada nodo Code lleva `"jsCode": "@@nodos/<archivo>.js"` y aquí se reemplaza por
 *
 *         src/lib/comun.js + pedido.js + reserva.js + avisos.js + promos.js + cobro.js   (en ese orden)
 *         + línea en blanco + src/nodos/<archivo>.js
 *
 *     (las librerías delante del código del nodo: el nodo Code de n8n no tiene módulos). Dos marcas
 *     más, para no repetir código que el nodo no usa:
 *       `"@@comun:nodos/<archivo>.js"`  solo `comun.js` + el archivo;
 *       `"@@solo:nodos/<archivo>.js"`   solo el archivo.
 *   - `@@dato:a.b.c@@` (dentro de cualquier texto) se reemplaza por ese dato del tenant;
 *   - `@@cred:ingesta|graph|medios|entradaPrueba` (en el nombre de una credencial) por el nombre que da el tenant;
 *   - `Config base` se llena con `configBase` del tenant (tipos string, number o boolean).
 *
 * LOS DATOS son `admin/scripts/datos/venta-minima/<tenant>.json` (zona Tenants: solo marcadores
 * `REEMPLAZAR_*` y datos del negocio, nunca un token ni una ruta de webhook real):
 *
 *     { nombreFlujo, entrada: 'receptor' | 'trigger' | 'prueba',
 *       credenciales: { ingesta, graph, medios },
 *       receptor: { ruta, urlVerificador, wabaIdEsperado }, pruebaRuta,
 *       hereda?: '<otro tenant>',   // `ensayo.json` hereda de `qtaco.json` y cambia lo que dice
 *       configBase: { … } }
 *
 * UNA SALIDA POR ARCHIVO DE DATOS: `qtaco.json` → `venta-minima.qtaco.json` (entrada del receptor),
 * `ensayo.json` → `venta-minima.prueba.json` (con «Entrada de prueba»). La entrada elegida deja solo
 * SUS nodos; los de las otras dos se quitan con sus conexiones:
 *   receptor  → Entrega del receptor, Verificar firma con el receptor, ¿Firma válida?, Aceptar (200),
 *               Rechazar (401), Descartar repetidos
 *   trigger   → WhatsApp Trigger   (solo con credenciales de una app propia, NUNCA las de AAB1-WA-Prod)
 *   prueba    → Entrada de prueba
 *
 * Node sin dependencias. No lee ningún .env ni llama a la red.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = join(AQUI, '../../../admin/scripts/datos/venta-minima');
const verificar = process.argv.includes('--verificar');

const leer = (ruta) => readFileSync(join(AQUI, ruta), 'utf8');
const ORDEN_LIBS = ['comun', 'pedido', 'reserva', 'avisos', 'promos', 'cobro'];
const LIB = ORDEN_LIBS.map((n) => leer(`src/lib/${n}.js`).trimEnd()).join('\n\n');
const COMUN = leer('src/lib/comun.js').trimEnd();
const plantilla = JSON.parse(leer('flujo.plantilla.json'));

const NODOS_DE_ENTRADA = {
  receptor: ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos'],
  trigger: ['WhatsApp Trigger'],
  prueba: ['Entrada de prueba'],
};

// NODOS QUE SOLO EXISTEN EN LA VARIANTE DE PRUEBA (L2). `Simular aviso` inventa un `wamid` que cuenta como «aviso salido»: en
// producción un nodo así sería una puerta para decirle al cliente «llegó al restaurante» sin que nada haya salido. Se quitan
// con sus conexiones y `¿Avisar de verdad?` se SALTEA (quien llegaba a él llega directo a su salida 0, `Enviar aviso`).
const SOLO_PRUEBA = ['Simular aviso', '¿Avisar de verdad?'];
const PUENTES_FUERA_DE_PRUEBA = { '¿Avisar de verdad?': 0 };

function codigoDe(marca, nodo) {
  const modo = marca.startsWith('@@solo:') ? 'solo' : (marca.startsWith('@@comun:') ? 'comun' : 'todo');
  const ruta = marca.slice(modo === 'solo' ? '@@solo:'.length : (modo === 'comun' ? '@@comun:'.length : '@@'.length));
  if (!/^nodos\/[a-z0-9-]+\.js$/.test(ruta)) throw new Error(`${nodo}: ruta de código no válida: ${marca}`);
  if (!existsSync(join(AQUI, 'src', ruta))) throw new Error(`${nodo}: no existe src/${ruta}`);
  const propio = leer(`src/${ruta}`).trimEnd();
  return (modo === 'solo' ? propio : (modo === 'comun' ? `${COMUN}\n\n${propio}` : `${LIB}\n\n${propio}`)) + '\n';
}

// --- los datos del tenant ---------------------------------------------------------------------------
function cargarDatos(archivo, pila = []) {
  if (pila.includes(archivo)) throw new Error(`${archivo}: «hereda» da una vuelta`);
  const d = JSON.parse(readFileSync(join(DATOS, archivo), 'utf8'));
  if (!d.hereda) return d;
  const base = cargarDatos(`${d.hereda}.json`, [...pila, archivo]);
  const { hereda, ...propio } = d;
  return {
    ...base, ...propio,
    credenciales: { ...base.credenciales, ...(propio.credenciales || {}) },
    receptor: { ...base.receptor, ...(propio.receptor || {}) },
    configBase: { ...base.configBase, ...(propio.configBase || {}) },
  };
}

function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}» en el archivo del tenant`);
  return x;
}

function reemplazarTextos(valor, datos, donde) {
  if (typeof valor === 'string') {
    return valor.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, ruta) => dato(datos, ruta, donde));
  }
  if (Array.isArray(valor)) return valor.map((v) => reemplazarTextos(v, datos, donde));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, reemplazarTextos(v, datos, donde)]));
  return valor;
}

function asignaciones(configBase) {
  return Object.entries(configBase).map(([nombre, valor]) => {
    if (!['string', 'number', 'boolean'].includes(typeof valor)) throw new Error(`configBase.${nombre}: solo texto, número o booleano`);
    return { id: `cb_${nombre}`, name: nombre, type: typeof valor, value: valor };
  });
}

function armar(datos, archivo) {
  const entrada = datos.entrada;
  if (!NODOS_DE_ENTRADA[entrada]) throw new Error(`${archivo}: entrada «${entrada}» no válida (receptor, trigger o prueba)`);
  const flujo = JSON.parse(JSON.stringify(plantilla));
  flujo.name = dato(datos, 'nombreFlujo', archivo);
  const quitar = new Set(Object.entries(NODOS_DE_ENTRADA).filter(([k]) => k !== entrada).flatMap(([, v]) => v));
  if (entrada !== 'prueba') {
    for (const nombre of SOLO_PRUEBA) quitar.add(nombre);
    // Cada conexión que llegaba a un nodo salteado llega ahora a lo que ese nodo tenía en su salida elegida.
    for (const [puente, salida] of Object.entries(PUENTES_FUERA_DE_PRUEBA)) {
      const destino = ((flujo.connections[puente] || {}).main || [])[salida] || [];
      for (const salidas of Object.values(flujo.connections)) {
        salidas.main = (salidas.main || []).map((s) => (s || []).flatMap((c) => (c.node === puente ? destino : [c])));
      }
    }
  }
  flujo.nodes = flujo.nodes.filter((n) => !quitar.has(n.name));
  for (const n of flujo.nodes) {
    n.parameters = reemplazarTextos(n.parameters, datos, `${archivo} · ${n.name}`);
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.startsWith('@@')) n.parameters.jsCode = codigoDe(js, n.name);
    for (const cred of Object.values(n.credentials || {})) {
      const m = /^@@cred:(ingesta|graph|medios|entradaPrueba)$/.exec(cred.name);
      if (m) cred.name = dato(datos, `credenciales.${m[1]}`, `${archivo} · ${n.name}`);
    }
    if (n.name === 'Config base') n.parameters.assignments.assignments = asignaciones(datos.configBase || {});
  }
  const vivos = new Set(flujo.nodes.map((n) => n.name));
  const conexiones = {};
  for (const [de, salidas] of Object.entries(flujo.connections)) {
    if (!vivos.has(de)) continue;
    conexiones[de] = { main: (salidas.main || []).map((s) => (s || []).filter((c) => vivos.has(c.node))) };
  }
  flujo.connections = conexiones;
  const texto = JSON.stringify(flujo, null, 2) + '\n';
  // Una marca sin reemplazar: en cualquier texto salvo el código de los nodos (las librerías mencionan
  // «@@solo:» en un comentario) o, en el código, al principio del `jsCode`.
  const sinMarcas = (v, esCodigo) => {
    if (typeof v === 'string') return esCodigo ? !v.startsWith('@@') : !v.includes('@@');
    if (Array.isArray(v)) return v.every((x) => sinMarcas(x, false));
    if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => sinMarcas(x, k === 'jsCode'));
    return true;
  };
  if (!sinMarcas(flujo, false)) throw new Error(`${archivo}: quedó una marca @@ sin reemplazar`);
  const ids = flujo.nodes.map((n) => n.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${archivo}: ids de nodo repetidos`);
  return texto;
}

// LO QUE UN JSON DE PRODUCCIÓN NO PUEDE TENER, aunque alguien lo haya agregado a mano al archivo versionado.
//   - «Entrada de prueba»: es el único nodo que activa `modoPrueba`; en producción no debe existir, porque
//     una carga que lo trajera podría encender el modo prueba (mensajes a otro número, avisos simulados);
//   - «Simular aviso» y «¿Avisar de verdad?»: simulan que un aviso salió (L2); solo existen en la prueba;
//   - «WhatsApp Trigger» con la entrada del receptor: activarlo reescribe el webhook de toda la app de Meta
//     (prohibición 7 de CLAUDE.md).
function guardiasDeProduccion(entrada, flujo) {
  const hallazgos = [];
  const nombres = new Set(flujo.nodes.map((n) => n.name));
  const tipos = flujo.nodes.map((n) => n.type);
  if (entrada !== 'prueba' && nombres.has('Entrada de prueba')) hallazgos.push('contiene el nodo «Entrada de prueba» (activa modoPrueba): solo va en el JSON de prueba');
  for (const solo of SOLO_PRUEBA) {
    if (entrada !== 'prueba' && nombres.has(solo)) hallazgos.push(`contiene el nodo «${solo}» (inventa avisos «salidos»): solo va en el JSON de prueba`);
  }
  // Retención de ejecuciones (decisión de Andres, 02/10/2026): nada se guarda, ni éxitos ni errores ni progreso, porque
  // las ejecuciones llevan texto de clientes. Vale para todas las variantes.
  const st = flujo.settings || {};
  if (st.saveDataSuccessExecution !== 'none' || st.saveDataErrorExecution !== 'none' || st.saveExecutionProgress !== false) {
    hallazgos.push('los ajustes de retención deben ser saveDataSuccessExecution y saveDataErrorExecution «none» y saveExecutionProgress false (las ejecuciones llevan texto de clientes)');
  }
  if (entrada === 'receptor' && tipos.includes('n8n-nodes-base.whatsAppTrigger')) hallazgos.push('contiene un «WhatsApp Trigger» en la variante del receptor (prohibición 7)');
  return hallazgos;
}

const salidaDe = (archivo) => (archivo === 'ensayo.json' ? 'venta-minima.prueba.json' : `venta-minima.${archivo.replace(/\.json$/, '')}.json`);

let difiere = false;
for (const archivo of readdirSync(DATOS).filter((f) => f.endsWith('.json')).sort()) {
  const datos = cargarDatos(archivo);
  const texto = armar(datos, archivo);
  const destino = salidaDe(archivo);
  const ruta = join(AQUI, destino);
  // Lo que se arma nunca viola las guardias (si la plantilla lo hiciera, falla la construcción)…
  const propios = guardiasDeProduccion(datos.entrada, JSON.parse(texto));
  if (propios.length) throw new Error(`${destino}: ${propios.join('; ')}`);
  if (verificar) {
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
    // …y el archivo VERSIONADO tampoco las viola (aunque alguien lo haya tocado a mano).
    let versionado = [];
    try { versionado = actual === null ? [] : guardiasDeProduccion(datos.entrada, JSON.parse(actual)); } catch (e) { versionado = ['no es un JSON válido']; }
    if (versionado.length) {
      difiere = true;
      console.error(`✗ ${destino} ${versionado.join('; ')}`);
    } else if (actual !== texto) {
      difiere = true;
      console.error(`✗ ${destino} ${actual === null ? 'no existe' : 'difiere de lo que arma la plantilla'}: corra «node construir.mjs»`);
    } else {
      console.log(`✓ ${destino} al día`);
    }
  } else {
    writeFileSync(ruta, texto);
    console.log(`✓ ${destino} escrito (${JSON.parse(texto).nodes.length} nodos)`);
  }
}
process.exit(difiere ? 1 : 0);
