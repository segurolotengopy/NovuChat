#!/usr/bin/env node
/**
 * construir.mjs — arma los JSON de la REDIRECCION de Q'Taco (numero anterior) desde la plantilla y los datos.
 *
 *   node construir.mjs               escribe qtaco-redireccion.<datos>.json
 *   node construir.mjs --verificar   no escribe: sale 1 si algun JSON versionado difiere o viola una guardia
 *
 * Los datos son admin/scripts/datos/qtaco-redireccion/<archivo>.json (marcadores REEMPLAZAR_*, nunca un secreto):
 *   qtaco.json             plan A: mismo nombre de workflow y misma ruta que el flujo vivo de Q'Taco (lo reemplaza en su lugar)
 *   qtaco-ruta-nueva.json  plan B: hereda de qtaco.json, con otro nombre y otra ruta de webhook
 * Cada nodo Code lleva "@@nodos/<archivo>.js@@"; "@@dato:a.b@@" y "@@cred:graph@@" se resuelven desde los datos;
 * "Config del negocio" (Set) se llena con `configNegocio`. Node sin dependencias; no lee .env ni llama a la red.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textosDeHallazgos as hallazgosDeExpresionesN8n } from '../../experimental/comun-sin-agente/src/expresiones.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DATOS = join(AQUI, '../../../admin/scripts/datos/qtaco-redireccion');
const verificar = process.argv.includes('--verificar');
const TOPE_DE_NODOS = 12;
const PELIGROSOS = /["'\\{}\r\n]/;

const plantilla = JSON.parse(readFileSync(join(AQUI, 'flujo.plantilla.json'), 'utf8'));

function cargar(archivo, pila = []) {
  if (pila.includes(archivo)) throw new Error(`${archivo}: «hereda» da una vuelta`);
  const d = JSON.parse(readFileSync(join(DATOS, archivo), 'utf8'));
  if (d.hereda === undefined) return d;
  if (typeof d.hereda !== 'string' || !/^[a-z0-9-]+$/.test(d.hereda)) throw new Error(`${archivo}: «hereda» no es un nombre valido`);
  const { hereda, ...propio } = d;
  const base = cargar(`${hereda}.json`, [...pila, archivo]);
  return { ...base, ...propio,
    credenciales: { ...base.credenciales, ...(propio.credenciales || {}) },
    receptor: { ...base.receptor, ...(propio.receptor || {}) },
    configNegocio: { ...base.configNegocio, ...(propio.configNegocio || {}) } };
}

function dato(datos, ruta, donde) {
  let x = datos;
  for (const p of ruta.split('.')) x = x && typeof x === 'object' ? x[p] : undefined;
  if (typeof x !== 'string' || x === '') throw new Error(`${donde}: falta el dato «${ruta}»`);
  if (PELIGROSOS.test(x) && !ruta.startsWith('credenciales.') && ruta !== 'nombreFlujo') throw new Error(`${donde}: el dato «${ruta}» trae comilla, barra, llave o salto de linea`);
  return x;
}

function reemplazar(v, datos, donde) {
  if (typeof v === 'string') return v.replace(/@@dato:([A-Za-z0-9_.]+)@@/g, (_, r) => dato(datos, r, donde));
  if (Array.isArray(v)) return v.map((x) => reemplazar(x, datos, donde));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reemplazar(x, datos, donde)]));
  return v;
}

function asignaciones(cfg) {
  return Object.entries(cfg).map(([name, value]) => {
    const tipo = typeof value === 'number' ? 'number' : 'string';
    if (typeof value === 'string' && (value.startsWith('=') || /["\\{}\r\n]/.test(value))) throw new Error(`configNegocio.${name}: comienza con «=» o trae comilla doble, barra, llave o salto de linea`);
    return { id: `cfg-${name}`, name, value, type: tipo };
  });
}

function armar(datos, archivo) {
  const flujo = JSON.parse(JSON.stringify(plantilla));
  flujo.name = dato(datos, 'nombreFlujo', archivo);
  for (const n of flujo.nodes) {
    n.parameters = reemplazar(n.parameters, datos, `${archivo} · ${n.name}`);
    const js = n.parameters.jsCode;
    if (typeof js === 'string' && js.startsWith('@@')) {
      const m = /^@@nodos\/([a-z0-9-]+\.js)@@$/.exec(js);
      if (!m || !existsSync(join(AQUI, 'src/nodos', m[1]))) throw new Error(`${n.name}: codigo no valido: ${js}`);
      n.parameters.jsCode = readFileSync(join(AQUI, 'src/nodos', m[1]), 'utf8').trimEnd() + '\n';
    }
    for (const cred of Object.values(n.credentials || {})) {
      const m = /^@@cred:(graph)$/.exec(cred.name);
      if (m) cred.name = dato(datos, `credenciales.${m[1]}`, `${archivo} · ${n.name}`);
    }
    if (n.name === 'Config del negocio') n.parameters.assignments.assignments = asignaciones(datos.configNegocio || {});
  }
  return JSON.stringify(flujo, null, 2) + '\n';
}

// GUARDIAS: lo que este flujo NO puede tener ni perder. Se aplican al armado y al archivo versionado.
function guardias(flujo) {
  const f = [];
  const nodos = flujo.nodes || [];
  f.push(...hallazgosDeExpresionesN8n(flujo));
  const por = (n) => nodos.find((x) => x.name === n);
  if (nodos.length > TOPE_DE_NODOS) f.push(`${nodos.length} nodos: el tope es ${TOPE_DE_NODOS}`);
  for (const n of nodos) {
    if (/langchain|googleGemini|whatsApp/i.test(n.type)) f.push(`${n.name}: sin IA ni nodos de medios`);
    if (/subscriptions/i.test(JSON.stringify(n.parameters || {}))) f.push(`${n.name}: nada de /subscriptions (es de la sesion de WhatsApp-Modular)`);
    if (n.type === 'n8n-nodes-base.webhook' && n.name !== 'Entrega del receptor') f.push(`${n.name}: la unica entrada es «Entrega del receptor»`);
    if (n.type === 'n8n-nodes-base.httpRequest' && n.name !== 'Enviar aviso' && n.name !== 'Verificar firma con el receptor') f.push(`${n.name}: solo hay dos llamadas HTTP`);
    if (/\b(URL|Buffer|crypto|require|process)\b\s*[.(]/.test(String(n.parameters?.jsCode || '').replace(/\/\/.*$/gm, ''))) f.push(`${n.name}: usa un global que el Code de n8n no tiene`);
  }
  const v = por('Verificar firma con el receptor');
  if (!v) f.push('falta «Verificar firma con el receptor»');
  else {
    if (v.onError || v.continueOnFail) f.push('el verificador no puede tener «Continue on Fail»');
    if (!/wabaIdEsperado: "(\d{6,25}|REEMPLAZAR_[A-Z0-9_]+)"/.test(String(v.parameters?.jsonBody))) f.push('el verificador no lleva wabaIdEsperado fijo');
  }
  const c = flujo.connections || {};
  const sal = (n, i) => ((c[n]?.main || [])[i] || []).map((x) => x.node);
  if (sal('¿Firma válida?', 0).join() !== 'Aceptar (200)' || sal('¿Firma válida?', 1).join() !== 'Rechazar (401)') f.push('¿Firma válida? debe ir a Aceptar (200) / Rechazar (401)');
  if (sal('Aceptar (200)', 0).join() !== 'Descartar repetidos' || sal('Descartar repetidos', 0).join() !== 'Config del negocio') f.push('200 -> Descartar repetidos -> Config del negocio');
  if (sal('Rechazar (401)', 0).length) f.push('Rechazar (401) no tiene salida');
  if (por('Rechazar (401)')?.parameters?.options?.responseCode !== 401 || por('Aceptar (200)')?.parameters?.options?.responseCode !== 200) f.push('codigos 200/401');
  const e = por('Enviar aviso');
  if (!e || !/^=https:\/\/graph\.facebook\.com\//.test(e.parameters?.url || '')) f.push('Enviar aviso debe ir a Graph');
  if (e?.credentials && Object.values(e.credentials).some((x) => x.id)) f.push('credencial con id: va vacia, la resuelve publicar-flujo.sh');
  if (e?.parameters?.options?.retryOnFail || e?.retryOnFail) f.push('Enviar aviso sin reintentos');
  const t = JSON.stringify(flujo);
  if (/\bAIza|EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]/.test(t)) f.push('parece traer un secreto');
  return f;
}

let difiere = false;
for (const archivo of readdirSync(DATOS).filter((x) => x.endsWith('.json')).sort()) {
  const datos = cargar(archivo);
  const texto = armar(datos, archivo);
  const destino = `qtaco-redireccion.${archivo.replace(/\.json$/, '')}.json`;
  const propias = guardias(JSON.parse(texto));
  if (propias.length) throw new Error(`${destino}: ${propias.join('; ')}`);
  const ruta = join(AQUI, destino);
  if (verificar) {
    const actual = existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
    let versionado = [];
    try { versionado = actual === null ? [] : guardias(JSON.parse(actual)); } catch { versionado = ['no es un JSON valido']; }
    if (versionado.length) { difiere = true; console.error(`✗ ${destino} ${versionado.join('; ')}`); }
    else if (actual !== texto) { difiere = true; console.error(`✗ ${destino} ${actual === null ? 'no existe' : 'difiere de lo que arma la plantilla'}: corra «node construir.mjs»`); }
    else console.log(`✓ ${destino} al dia`);
  } else {
    writeFileSync(ruta, texto);
    console.log(`✓ ${destino} escrito (${JSON.parse(texto).nodes.length} nodos)`);
  }
}
process.exit(difiere ? 1 : 0);
