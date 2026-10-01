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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const verificar = process.argv.includes('--verificar');

const leer = (ruta) => readFileSync(join(AQUI, ruta), 'utf8');
const LIB = leer('src/lib/agenda.js').trimEnd();
const COMUN = leer('src/nodos/_comun.js').trimEnd();
const plantilla = JSON.parse(leer('flujo.plantilla.json'));

const VARIANTES = [
  { archivo: 'agenda-minima.v0.json', quitar: 'Entrada de prueba', nombre: 'NovuChat — Agenda mínima (v0)' },
  { archivo: 'agenda-minima.prueba.json', quitar: 'WhatsApp Trigger', nombre: 'NovuChat — Agenda mínima (v0, prueba)' },
];

function codigoDe(marca, nodo) {
  const modo = marca.startsWith('@@solo:') ? 'solo' : (marca.startsWith('@@comun:') ? 'comun' : 'todo');
  const ruta = marca.slice(modo === 'solo' ? '@@solo:'.length : (modo === 'comun' ? '@@comun:'.length : '@@'.length));
  if (!/^nodos\/[a-z0-9-]+\.js$/.test(ruta)) throw new Error(`${nodo}: ruta de código no válida: ${marca}`);
  if (!existsSync(join(AQUI, 'src', ruta))) throw new Error(`${nodo}: no existe src/${ruta}`);
  const propio = leer(`src/${ruta}`).trimEnd();
  return (modo === 'solo' ? propio : (modo === 'comun' ? `${COMUN}\n\n${propio}` : `${LIB}\n\n${COMUN}\n\n${propio}`)) + '\n';
}

function armar(v) {
  const flujo = JSON.parse(JSON.stringify(plantilla));
  flujo.name = v.nombre;
  flujo.nodes = flujo.nodes.filter((n) => n.name !== v.quitar);
  for (const n of flujo.nodes) {
    const js = n.parameters && n.parameters.jsCode;
    if (typeof js === 'string' && js.startsWith('@@')) n.parameters.jsCode = codigoDe(js, n.name);
  }
  const vivos = new Set(flujo.nodes.map((n) => n.name));
  const conexiones = {};
  for (const [de, salidas] of Object.entries(flujo.connections)) {
    if (!vivos.has(de)) continue;
    conexiones[de] = { main: (salidas.main || []).map((s) => (s || []).filter((c) => vivos.has(c.node))) };
  }
  flujo.connections = conexiones;
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
