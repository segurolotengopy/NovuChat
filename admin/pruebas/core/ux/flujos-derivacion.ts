/**
 * REGISTRO DE FLUJOS CONVERSACIONALES contra la regla de derivación. Descubre del disco `Flujos/experimental/*` con `flujo.plantilla.json` (los esqueletos que conversan)
 * y exige, para cada uno, su tabla (`admin/pruebas/tenants/<t>/derivacion.ts`, dato del tenant que escribe Cartera) o una EXCEPCIÓN declarada, fechada y con su porqué.
 * Las excepciones solo pueden achicarse: si el flujo ya tiene su tabla, la excepción sobra y la prueba pide sacarla.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const EXPERIMENTAL = join(RAIZ, 'Flujos/experimental');

/** Dónde vive la tabla de cada flujo (carpeta de `admin/pruebas/tenants/`). Un flujo sin entrada usa su propio nombre. */
export const TENANT_DE_FLUJO: Record<string, string> = {
  'rroca-antonio': 'rroca-antonio', 'rroca-ruben': 'rroca-ruben', doctoras: 'doctoras', 'venta-minima': 'qtaco', 'chat-novuchat': 'novuchat',
};
export const rutaDeTabla = (flujo: string): string => join(RAIZ, 'admin/pruebas/tenants', TENANT_DE_FLUJO[flujo] ?? flujo, 'derivacion.ts');

export interface Excepcion { desde: string; porque: string }
/** Excepciones iniciales (23/10/2026). Cada una sale cuando su dueño adopta la tabla. */
export const EXCEPCIONES: Record<string, Excepcion> = {
  'agenda-minima': { desde: '2026-10-23', porque: 'Bellido: no se toca (orden de Andres); su flujo no se vigila.' },
  'captacion-minima': { desde: '2026-10-23', porque: 'Sin clasificar: usa cmContactoConBoton desde su lib; la tabla la escribe Cartera (D5, chat y captación).' },
  'chat-novuchat': { desde: '2026-10-23', porque: 'Hoy VIOLA: el botón «Hablar con el equipo» sale en respuestas fijas que resuelven; decisión E1 de Andres pendiente. Cartera adopta en D5.' },
  'doctoras': { desde: '2026-10-23', porque: 'Cumple; su tabla la adopta Cartera (D5, doctoras).' },
  'rroca-antonio': { desde: '2026-10-23', porque: 'Cumple (invariante 13 de su vigilante: PLANES_SIN_BOTON / PLANES_CON_BOTON); su tabla la adopta Cartera (D2).' },
  'rescate-22h': { desde: '2026-11-06', porque: 'No conversa ni deriva: es un barrido que envía UN seguimiento de texto fijo o redactado y verificado, sin botón de derivación ni respuesta a resolver.' },
  'rroca-ruben': { desde: '2026-10-23', porque: 'Hoy VIOLA: armar-mensajes.js con plan.qrAbierto ? conRuben(...) pone el botón en respuestas resueltas (precio, catálogo, imágenes, info, identidad, ingresos, modelo, qr_pendiente). Cartera adopta en D3.' },
  'venta-minima': { desde: '2026-10-23', porque: 'Hoy VIOLA: «identidad» arma enlace() a wa.me y `ya_cotejado` también; la clasificación sale de resumen.ruta (prefijo antes de «:») y del resultado del cobro. Cartera adopta en D4 (Q\'Taco).' },
};

export const CLIENTES = join(RAIZ, 'Flujos/clientes');

/** Lista CERRADA de flujos mudados a `clientes/` con otro nombre de carpeta: nombre COMPLETO del JSON -> nombre del registro. Solo los que de verdad se mudaron. */
export const MUDADOS: Record<string, string> = { 'chat-novuchat.novuchat.json': 'chat-novuchat', 'rroca-antonio.json': 'rroca-antonio', 'rroca-ruben.json': 'rroca-ruben', 'venta-minima.qtaco.json': 'venta-minima', 'venta-minima.qtaco-3727.json': 'venta-minima' };

/** Problemas de la lista de mudados: un JSON que no existe en `experimental/<valor>/` ni en `clientes/*\/`, o un valor que no es carpeta de `experimental/` ni clave del registro. */
export function problemasDeMudados(
  mudados: Record<string, string> = MUDADOS, experimental: string = EXPERIMENTAL, clientes: string = CLIENTES, excepciones: Record<string, Excepcion> = EXCEPCIONES,
): string[] {
  const p: string[] = [];
  const dirs = (raiz: string): string[] => (existsSync(raiz) ? readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
  for (const [json, valor] of Object.entries(mudados)) {
    const hoy = existsSync(join(experimental, valor, json)) || dirs(clientes).some((d) => existsSync(join(clientes, d, json)));
    if (json.split('.')[0] !== valor) p.push(`${json}: el JSON no empieza por «${valor}» (el nombre del registro es lo que va antes del primer punto)`);
    if (!hoy) p.push(`${json}: no existe en experimental/${valor}/ ni en clientes/*/`);
    if (!dirs(experimental).includes(valor) && !Object.hasOwn(excepciones, valor)) p.push(`${json}: «${valor}» no es carpeta de experimental/ ni clave del registro`);
  }
  return p;
}

/**
 * Nombre de registro de un flujo MUDADO: el de su JSON (`chat-novuchat.novuchat.json` -> `chat-novuchat`), no el de su carpeta de `clientes/`
 * (`novuchat`): una mudanza puede cambiar la carpeta, nunca el JSON. Solo cuenta si ese nombre ya está en el registro (una clave de `excepciones`),
 * para que un flujo nuevo de `clientes/` siga el camino de la lista única y no entre aquí por su cuenta.
 */
export function flujosMudadosDelRegistro(excepciones: Record<string, Excepcion> = EXCEPCIONES, raiz: string = CLIENTES, mudados: Record<string, string> = MUDADOS): string[] {
  if (!existsSync(raiz)) return [];
  return readdirSync(raiz, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(raiz, d.name, 'flujo.plantilla.json')))
    .flatMap((d) => readdirSync(join(raiz, d.name)).filter((f) => Object.hasOwn(mudados, f)).map((f) => mudados[f] as string))
    .filter((n) => Object.hasOwn(excepciones, n));
}

/** Los flujos conversacionales del disco (los que traen `flujo.plantilla.json`), en `experimental/` y los ya mudados que están en el registro. */
export function flujosConversacionales(): string[] {
  const deExperimental = readdirSync(EXPERIMENTAL, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(EXPERIMENTAL, d.name, 'flujo.plantilla.json')))
    .map((d) => d.name);
  return [...new Set([...deExperimental, ...flujosMudadosDelRegistro()])].sort();
}
/**
 * LA LISTA ÚNICA (migración, etapa 0, 12/11/2026): los flujos de producción que atienden a un cliente (`atiendeCliente`) y NO caen en el registro de
 * arriba, que es por carpeta de `Flujos/experimental/` con plantilla: los de la raíz de `Flujos/` y los de `Flujos/clientes/`. Para cada uno,
 * `tabla` dice si tiene su tabla de derivación (`rutaDeTabla` de su carpeta); el que no la tiene va a `excepciones.ts` (regla `ux-derivacion`).
 */
export function flujosFueraDelRegistro(
  produccion: string[], atiende: (ruta: string) => boolean, enRegistro: string[] = flujosConversacionales(),
  hayTabla: (carpeta: string) => boolean = (c) => existsSync(rutaDeTabla(c)), mudados: Record<string, string> = MUDADOS,
): { flujo: string; tabla: boolean }[] {
  return produccion.filter(atiende).flatMap((ruta) => {
    const partes = ruta.split('/');
    if (partes[0] === 'experimental' && enRegistro.includes(partes[1] ?? '')) return [];
    if (partes[0] === 'clientes' && partes.length === 3 && Object.hasOwn(mudados, partes[2] as string) && enRegistro.includes(mudados[partes[2] as string] as string)) return [];
    const carpeta = partes.length > 1 ? (partes[1] ?? '') : '';
    return [{ flujo: ruta, tabla: carpeta !== '' && hayTabla(carpeta) }];
  });
}

/** Los problemas del registro: un flujo sin tabla ni excepción; una excepción sin fecha o porqué; una excepción que sobra (ya hay tabla o el flujo no existe). */
export function problemasDelRegistro(
  flujos: string[] = flujosConversacionales(), excepciones: Record<string, Excepcion> = EXCEPCIONES, hayTabla: (f: string) => boolean = (f) => existsSync(rutaDeTabla(f)),
): string[] {
  const p: string[] = [];
  for (const f of flujos) {
    const tabla = hayTabla(f); const ex = excepciones[f];
    if (!tabla && !ex) p.push(`${f}: flujo conversacional sin tabla de derivación ni excepción declarada`);
    if (tabla && ex) p.push(`${f}: ya tiene tabla; la excepción sobra`);
  }
  for (const [f, e] of Object.entries(excepciones)) {
    if (!flujos.includes(f)) p.push(`${f}: excepción de un flujo que no existe`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.desde) || !e.porque.trim()) p.push(`${f}: la excepción necesita fecha (AAAA-MM-DD) y porqué`);
  }
  return p;
}
