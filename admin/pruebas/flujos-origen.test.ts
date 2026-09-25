/**
 * LOS CINCO FLUJOS REPORTAN DE DÓNDE NACIÓ LA CONVERSACIÓN (`Analisis/38` §2).
 *
 * `origen-del-anuncio.test.ts` prueba la mitad del servidor: que la ingesta
 * guarda el origen al abrir la ventana y cuenta `conversacionesPorAnuncio`.
 * Acá se prueba la otra mitad, sin la cual la cifra sería siempre cero: que
 * cada flujo LEE el `referral` que manda Meta y lo REPORTA.
 *
 * SE APLICA A TODOS O A NINGUNO (`CLAUDE.md`, `Analisis/20` §5). Un cliente que
 * no reporte el origen no rompe nada —el servidor lo cuenta como directo— pero
 * baja la fracción medida de toda la cartera, y nadie lo nota: el número sale
 * más bajo, no sale mal. Por eso la lista de flujos es explícita y la prueba
 * falla cuando aparece uno nuevo que no lo hace.
 *
 * COMO EN `flujos-umbrales.test.ts`, el código y las expresiones se extraen del
 * JSON versionado y se EJECUTAN: si alguien edita un nodo en n8n y exporta, la
 * prueba corre el código nuevo, no una copia que se quedó vieja.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo { name: string; type: string; parameters: Record<string, unknown> }
interface Flujo { nodes: Nodo[] }

/**
 * LOS FLUJOS QUE ATIENDEN A UN CLIENTE FINAL. Los de disparo horario
 * (recordatorios, seguimientos, señas vencidas) no abren conversación: no
 * tienen entrada de WhatsApp que normalizar ni origen que reportar.
 */
const FLUJOS = [
  'demo-a-agendamiento.json',
  'platinum-agendamiento.json',
  'bellido-agendamiento.json',
  'demo-b-venta-cobro.json',
  'novuchat-onboarding.json',
];

const flujo = (archivo: string) =>
  JSON.parse(readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8')) as Flujo;

function nodo(f: Flujo, nombre: string): Nodo {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
}

/** Ejecuta el nodo Code con un webhook de WhatsApp armado a mano. */
function normalizar(archivo: string, mensaje: Record<string, unknown>): Record<string, unknown> {
  const codigo = String(nodo(flujo(archivo), 'Normalizar entrada').parameters['jsCode']);
  // El nodo recibe el webhook YA desempaquetado y con la configuración del
  // negocio mezclada al mismo nivel (así lo arma `Config del negocio`): todo lo
  // que no sea una clave del webhook se arrastra como configuración.
  const entrada = [{
    messages: [{ from: '59170000000', id: 'wamid.PRUEBA', type: 'text',
                 text: { body: 'hola' }, ...mensaje }],
    contacts: [{ profile: { name: 'Prueba' } }],
    metadata: { phone_number_id: '100000000000000' },
    nombreNegocio: 'Prueba',
    direccion: '',
    // Lista vacía = se acepta cualquier origen; si no, el nodo descarta el
    // mensaje por prefijo y la prueba no ejercitaría nada.
    prefijosPermitidos: '',
  }];
  const $input = { all: () => entrada.map((json) => ({ json })), first: () => ({ json: entrada[0] }) };
  // La configuración del negocio que el nodo mezcla en su salida. Mínima: lo
  // que se ejercita acá es el origen, no el resto de la normalización.
  const $ = () => ({ first: () => ({ json: entrada[0] }) });
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', codigo) as (i: unknown, r: unknown)
    => { json: Record<string, unknown> }[];
  return fn($input, $)[0].json;
}

/** Evalúa el `jsonBody` del nodo que reporta a la ingesta. */
function reporte(archivo: string, $json: Record<string, unknown>): Record<string, unknown> {
  const cuerpo = String(nodo(flujo(archivo), 'Reportar mensaje (entrante)').parameters['jsonBody']);
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(cuerpo.trim());
  if (!m) throw new Error(`no es una expresión simple: ${cuerpo.slice(0, 60)}`);
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$json', `return (${m[1]});`) as (j: unknown) => string;
  return JSON.parse(fn($json)) as Record<string, unknown>;
}

/** Lo que Meta agrega al mensaje cuando viene de un anuncio de clic a WhatsApp. */
const REFERRAL = {
  referral: {
    source_type: 'ad',
    source_id: '120200000000000000',
    headline: 'Tratamientos faciales con 20% de descuento',
    source_url: 'https://fb.me/ejemplo',
  },
};

describe.each(FLUJOS)('%s', (archivo) => {
  it('marca `anuncio` cuando Meta manda `referral`', () => {
    expect(normalizar(archivo, REFERRAL)['origen']).toBe('anuncio');
  });

  it('marca `directo` cuando no lo manda', () => {
    expect(normalizar(archivo, {})['origen']).toBe('directo');
  });

  it('el origen VIAJA a la ingesta, no se queda en el flujo', () => {
    // El defecto que este cambio corrige era exactamente este: el flujo leía el
    // anuncio, lo usaba en el prompt, y no lo reportaba nunca.
    expect(reporte(archivo, normalizar(archivo, REFERRAL))).toMatchObject({ origen: 'anuncio' });
    expect(reporte(archivo, normalizar(archivo, {}))).toMatchObject({ origen: 'directo' });
  });

  it('un flujo sin el campo reporta `directo`, nunca `anuncio`', () => {
    // Respaldo del respaldo: si `Normalizar entrada` dejara de poner el campo
    // —por un merge, por una edición en n8n— el reporte no puede inventar un
    // anuncio. Sobreestimar la fracción por campaña infla el margen esperado.
    expect(reporte(archivo, { from: '59170000000', tipo: 'text', userInput: 'hola' }))
      .toMatchObject({ origen: 'directo' });
  });

  it('el origen no trae el titular ni la URL de la campaña', () => {
    // Para la cifra alcanza con SI vino de un anuncio. El titular y la URL son
    // datos de la campaña del comercio y no tienen por qué viajar al servidor.
    const cuerpo = reporte(archivo, normalizar(archivo, REFERRAL));
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toContain('fb.me');
    expect(texto).not.toContain('descuento');
  });
});

describe('La lista de flujos', () => {
  it('cubre TODOS los que reportan un mensaje entrante', () => {
    // Si mañana se agrega un flujo de atención y no reporta el origen, la
    // fracción medida baja para toda la cartera y nadie lo nota: el número sale
    // más bajo, no sale mal. Esta prueba es la que obliga a agregarlo a la
    // lista —y, al agregarlo, a que pase las cinco de arriba—.
    const enDisco = readdirSync(join(aqui, '../../Flujos'))
      .filter((f) => f.endsWith('.json'))
      .filter((f) => flujo(f).nodes.some((n) => n.name === 'Reportar mensaje (entrante)'));
    expect(enDisco.sort()).toEqual([...FLUJOS].sort());
  });
});
