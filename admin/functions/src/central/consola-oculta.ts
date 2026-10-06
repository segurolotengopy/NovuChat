/**
 * CONSOLA OCULTA — la lista cerrada de funciones que la consola de UN comercio
 * no pinta (`tenants/{id}.consolaOculta`). Archivo puro y sin `import`: lo leen
 * la consola (`useConsolaOculta`), el script de plataforma que la escribe y las
 * pruebas, igual que `registro.ts`.
 *
 * POR QUÉ NO SALE DEL REGISTRO DE MÓDULOS. El registro decide qué PESTAÑAS trae
 * cada módulo encendido. Estas cinco cosas no son pestañas de módulo: «Horario»
 * y «Hoy» son de Configuración y del Tablero (central), «Invitar» es un
 * formulario de Usuarios, «Pagar» es una pestaña central que no depende de
 * ningún módulo y el reemplazo del QR es un bloque de la pestaña de Cobros que
 * solo se oculta con el cobro real activo. Apagar el módulo entero sería
 * esconder de más (Q'Taco necesita Cobros para registrar su primer QR).
 *
 * ES SOLO PRESENTACIÓN. Ocultar no es un límite: lo que el servidor permite o
 * rechaza no cambia. Quien necesite que algo NO se pueda hacer lo prohíbe en
 * `firestore.rules` o en la Function, no aquí. Lo que esta lista evita es
 * ofrecer una puerta que NovuChat decidió no abrir todavía (no está probada, o
 * dice algo falso del asistente).
 *
 * LA ESCRIBE NovuChat, nunca el comercio: `firestore.rules` no deja a ningún
 * navegador escribir `tenants/{id}`; el único camino es
 * `scripts/plataforma/aplicar-consola-oculta.mjs`.
 *
 * SIN LISTA = COMPORTAMIENTO DE SIEMPRE. Un id desconocido se ignora; un valor
 * que no es lista (cadena, objeto, null) no oculta nada.
 */

/** Los ids cerrados. Agregar uno es un cambio de código, con su prueba. */
export const IDS_CONSOLA_OCULTA = ['horario', 'hoy', 'invitar', 'pagar', 'reemplazoQr'] as const;
export type IdConsolaOculta = (typeof IDS_CONSOLA_OCULTA)[number];

export const esIdConsolaOculta = (v: unknown): v is IdConsolaOculta =>
  typeof v === 'string' && (IDS_CONSOLA_OCULTA as readonly string[]).includes(v);

/** Lo que de una ficha de `tenants/{id}` importa para ocultar. */
export interface FichaConConsolaOculta {
  readonly consolaOculta?: unknown;
}

/**
 * Los ids ocultos de una ficha, en el orden de `IDS_CONSOLA_OCULTA` y sin
 * repetidos. Ignora lo desconocido y todo lo que no sea una lista.
 */
export function consolaOcultaDeFicha(ficha: FichaConConsolaOculta | null | undefined): IdConsolaOculta[] {
  if (!ficha || !Object.prototype.hasOwnProperty.call(ficha, 'consolaOculta')) return [];
  const crudo = ficha.consolaOculta;
  if (!Array.isArray(crudo)) return [];
  return IDS_CONSOLA_OCULTA.filter((id) => crudo.includes(id));
}

/**
 * ¿La consola pinta `id`? Con la lista todavía sin leer (`null`) NO: lo ocultable
 * no aparece y desaparece. Con la lista leída, sí salvo que `id` esté en ella.
 */
export function esVisible(ocultos: readonly IdConsolaOculta[] | null, id: IdConsolaOculta): boolean {
  return ocultos !== null && !ocultos.includes(id);
}

/**
 * ¿Se esconde el formulario de reemplazo del QR? Solo si `reemplazoQr` está en la
 * lista Y el cobro real está activo (o todavía no se sabe: `leido` falso). Sin
 * cobro activo el formulario se pinta, o el PRIMER QR no podría registrarse.
 */
export function reemplazoQrOculto(ocultos: readonly IdConsolaOculta[] | null, leido: boolean, activo: boolean): boolean {
  return ocultos === null || (ocultos.includes('reemplazoQr') && (!leido || activo));
}

/**
 * Valida el texto `a,b,c` que recibe el script. `{ ok, lista }` o
 * `{ ok: false, problemas }`. A diferencia de la lectura, AQUÍ un id fuera de
 * la lista cerrada se rechaza (quien escribe tiene que saber lo que escribe).
 * Una lista vacía no existe: para volver a mostrar todo se usa `--revertir`.
 */
export function validarListaConsolaOculta(texto: unknown):
  { ok: true; lista: IdConsolaOculta[] } | { ok: false; problemas: string[] } {
  if (typeof texto !== 'string' || texto === '') return { ok: false, problemas: ['--ocultar vacío'] };
  const problemas: string[] = [];
  const partes = texto.split(',');
  partes.forEach((p, i) => {
    if (p === '') problemas.push('--ocultar trae un elemento vacío');
    else if (!esIdConsolaOculta(p)) problemas.push(`--ocultar: id desconocido (${p.slice(0, 40)}); los ids son ${IDS_CONSOLA_OCULTA.join(', ')}`);
    else if (partes.indexOf(p) !== i) problemas.push(`--ocultar: id repetido (${p})`);
  });
  if (problemas.length > 0) return { ok: false, problemas };
  return { ok: true, lista: partes as IdConsolaOculta[] };
}
