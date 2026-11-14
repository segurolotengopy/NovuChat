/**
 * DIBUJAR Y MEDIR para las pruebas con motor (13/11/2026): monta la `App` real con `react-dom/client` dentro de jsdom y corre axe-core.
 * Sin `vi.mock` aquí. Los tipos DOM se declaran mínimos porque `admin/tsconfig.json` no trae `lib: dom` (como en `lint.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const desdeAdmin = createRequire(join(ADMIN, 'package.json'));

interface Nodo { innerHTML: string; outerHTML: string; textContent: string | null }
interface Documento { documentElement: Nodo & { lang: string }; body: Nodo; title: string; getElementById(id: string): unknown }
const global = globalThis as unknown as { document: Documento; localStorage: { clear(): void }; IS_REACT_ACT_ENVIRONMENT?: boolean };
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p?: unknown, ...h: unknown[]) => unknown };
const { act } = desdeWeb('react') as { act: (f: () => unknown) => Promise<void> };
const { createRoot } = desdeWeb('react-dom/client') as { createRoot: (el: unknown) => { render(e: unknown): void; unmount(): void } };
const { MemoryRouter } = desdeWeb('react-router-dom') as Record<string, unknown>;

export interface AxeNodo { target: unknown[] }
export interface AxeResultado { id: string; help: string; nodes: AxeNodo[] }
export interface AxeInforme { violations: AxeResultado[]; incomplete: AxeResultado[]; passes: AxeResultado[]; inapplicable: AxeResultado[] }
export interface AxeRegla { ruleId: string; tags: string[] }
export interface Axe {
  version: string;
  run(contexto: unknown, opciones: unknown): Promise<AxeInforme>;
  getRules(tags?: string[]): AxeRegla[];
}
export const axe = desdeAdmin('axe-core') as Axe;

export const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Lista CERRADA de reglas de axe que no se pueden evaluar en jsdom, con el motivo literal. Agregar una exige pasar por `seguridad`. */
export const DESACTIVADAS: Readonly<Record<string, string>> = {
  'color-contrast': 'jsdom no tiene canvas ni colores calculados',
  'link-in-text-block': 'necesita colores calculados, que jsdom no da',
  'target-size': 'sin layout daría «pasa» falso',
  'scrollable-region-focusable': 'scrollHeight siempre es 0 en jsdom',
  'label-content-name-mismatch': 'usa canvas y es experimental',
  'css-orientation-lock': 'vitest descarta el CSS',
};

const html = readFileSync(join(ADMIN, 'web', 'index.html'), 'utf8');
const IDIOMA = /<html[^>]*\blang="([^"]+)"/.exec(html)?.[1] ?? 'es';
const TITULO = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Dibujo { texto: string; html: string; desmontar: () => Promise<void> }

export async function dibujarRuta(ruta: string, App: unknown): Promise<Dibujo> {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.document.documentElement.lang = IDIOMA;
  global.document.title = TITULO;
  global.document.body.innerHTML = '<div id="raiz"></div>';
  global.localStorage.clear();
  const raiz = createRoot(global.document.getElementById('raiz'));
  await act(() => { raiz.render(createElement(MemoryRouter, { initialEntries: [ruta] }, createElement(App))); });
  let anterior = '';
  let asentado = false;
  for (let i = 0; i < 8; i++) {
    await act(async () => { await esperar(0); });
    const ahora = global.document.body.innerHTML;
    if (ahora === anterior) { asentado = true; break; }
    anterior = ahora;
  }
  if (!asentado) throw new Error(`la ruta ${ruta} no se asentó tras 8 vueltas`);
  return {
    texto: global.document.body.textContent ?? '',
    html: global.document.body.outerHTML,
    desmontar: async () => { await act(() => { raiz.unmount(); }); },
  };
}

export const desactivadasParaAxe = (): Record<string, { enabled: boolean }> =>
  Object.fromEntries(Object.keys(DESACTIVADAS).map((r) => [r, { enabled: false }]));

export const correrAxe = (): Promise<AxeInforme> => axe.run(global.document, {
  runOnly: { type: 'tag', values: ETIQUETAS },
  rules: desactivadasParaAxe(),
  resultTypes: ['violations', 'incomplete'],
});

/** Contraprueba: axe sobre un HTML escrito a mano, con el marco (idioma y título) de la consola. */
export function correrAxeSobreHtml(cuerpo: string): Promise<AxeInforme> {
  global.document.documentElement.lang = IDIOMA;
  global.document.title = 'Contraprueba';
  global.document.body.innerHTML = cuerpo;
  return correrAxe();
}

/** `pagina#regla` → nodos de las violaciones; `pagina#regla:incompleta` → nodos de las incompletas (cuentan igual). */
export function agruparAxe(pagina: string, r: AxeInforme): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const v of r.violations) cuenta[`${pagina}#${v.id}`] = v.nodes.length;
  for (const v of r.incomplete) cuenta[`${pagina}#${v.id}:incompleta`] = v.nodes.length;
  return cuenta;
}

export function reglasEvaluadas(r: AxeInforme): string[] {
  return [...new Set([...r.violations, ...r.incomplete, ...r.passes, ...r.inapplicable].map((x) => x.id))].sort();
}

/** Las reglas WCAG de las etiquetas, sin experimentales, obsoletas ni desactivadas. */
export function reglasEsperadas(): string[] {
  return axe.getRules(ETIQUETAS)
    .filter((r) => !r.tags.includes('experimental') && !r.tags.includes('deprecated') && !(r.ruleId in DESACTIVADAS))
    .map((r) => r.ruleId).sort();
}

/** Por qué un dibujo no vale como muestra: poco texto, «Cargando…», «Sin permiso» o falta el dato centinela. Pura. */
export function problemasDeDibujo(texto: string, centinelas: string[]): string[] {
  const p: string[] = [];
  if (texto.replace(/\s+/g, '').length < 40) p.push('texto demasiado corto (< 40 caracteres sin espacios)');
  if (texto.includes('Cargando…')) p.push('quedó en «Cargando…»');
  if (texto.includes('Sin permiso')) p.push('dice «Sin permiso»');
  for (const c of centinelas) if (!texto.includes(c)) p.push(`falta el centinela «${c}»`);
  return p;
}
