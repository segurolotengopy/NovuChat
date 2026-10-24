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
  'rroca-ruben': { desde: '2026-10-23', porque: 'Hoy VIOLA: armar-mensajes.js con plan.qrAbierto ? conRuben(...) pone el botón en respuestas resueltas (precio, catálogo, imágenes, info, identidad, ingresos, modelo, qr_pendiente). Cartera adopta en D3.' },
  'venta-minima': { desde: '2026-10-23', porque: 'Hoy VIOLA: «identidad» arma enlace() a wa.me y `ya_cotejado` también; la clasificación sale de resumen.ruta (prefijo antes de «:») y del resultado del cobro. Cartera adopta en D4 (Q\'Taco).' },
};

/** Los flujos conversacionales del disco (los que traen `flujo.plantilla.json`). */
export function flujosConversacionales(): string[] {
  return readdirSync(EXPERIMENTAL, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(EXPERIMENTAL, d.name, 'flujo.plantilla.json')))
    .map((d) => d.name).sort();
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
