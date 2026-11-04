/**
 * Ningún JSON de `Flujos/` lleva una URL real del relé B9 (segunda revisión del PR #757): TODA cadena que nombra `/v1/envio/` tiene que traer el marcador
 * `REEMPLAZAR_URL_INTERNA_DEL_RELE` (lo repone `preparar-import.sh` desde `RELE_URL_INTERNA`). El repositorio es público: la base interna no se escribe.
 * Sin excepciones en los JSON versionados; un host `*.example` solo vale en las pruebas que arman flujos en memoria (no en archivos de `Flujos/`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const MARCADOR = 'REEMPLAZAR_URL_INTERNA_DEL_RELE';

function jsons(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    if (nombre === 'node_modules' || nombre === '.git') continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) jsons(ruta, acc);
    else if (nombre.endsWith('.json') && !nombre.endsWith('.local.json')) acc.push(ruta);
  }
  return acc;
}
function cadenas(v: unknown, acc: string[] = []): string[] {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) for (const x of v) cadenas(x, acc);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) cadenas(x, acc);
  return acc;
}
// EXCEPCIÓN declarada (no es una URL escrita): `salida-de-persona.json` (H2-F, #511) lee la base de `Config base.releBaseUrl`, un dato del tenant que valida su
// propia lista permitida; el archivo no trae ningún host. Cualquier otra base calculada, o cualquier host literal, debe llevar el marcador.
const BASE_DE_CONFIG = /^=\{\{ \$\('Config base'\)\.first\(\)\.json\.releBaseUrl \}\}\/v1\/envio\//;
const EXCEPCION_DE_ARCHIVO = 'Flujos/salida-de-persona.json';

/** Las cadenas de un texto que nombran el relé y no traen el marcador. */
export function urlsSinMarcador(texto: string, archivo = ''): string[] {
  return cadenas(JSON.parse(texto)).filter((s) => s.includes('/v1/envio/') && !s.includes(MARCADOR) && !(archivo === EXCEPCION_DE_ARCHIVO && BASE_DE_CONFIG.test(s)));
}

describe('ningún JSON de Flujos/ lleva una URL real del relé', () => {
  const archivos = jsons(join(RAIZ, 'Flujos'));
  it('recorre los JSON de Flujos/ (hay muchos)', () => {
    expect(archivos.length).toBeGreaterThan(20);
  });
  it('NIEGA: toda URL con /v1/envio/ trae el marcador REEMPLAZAR_URL_INTERNA_DEL_RELE', () => {
    const malos: string[] = [];
    for (const a of archivos) for (const s of urlsSinMarcador(readFileSync(a, 'utf8'), relative(RAIZ, a))) malos.push(`${relative(RAIZ, a)}: ${s.slice(0, 60)}`);
    expect(malos).toEqual([]);
  });
  it('el detector funciona: una base real, un host *.example o una base calculada sin marcador SE VEN', () => {
    for (const u of ['=https://relay.interno.real/v1/envio/mensajes/1', '=http://relay.example/v1/envio/medios/x', '={{ $json.base }}/v1/envio/medios/x']) {
      expect(urlsSinMarcador(JSON.stringify({ n: { url: u } })), u).toHaveLength(1);
    }
    expect(urlsSinMarcador(JSON.stringify({ n: { url: `=${MARCADOR}/v1/envio/mensajes/1` } }))).toEqual([]);
    // La excepción vale solo para ese archivo y esa expresión exacta.
    const deConfig = JSON.stringify({ n: { url: "={{ $('Config base').first().json.releBaseUrl }}/v1/envio/mensajes/1" } });
    expect(urlsSinMarcador(deConfig, EXCEPCION_DE_ARCHIVO)).toEqual([]);
    expect(urlsSinMarcador(deConfig, 'Flujos/otro.json')).toHaveLength(1);
    expect(urlsSinMarcador(JSON.stringify({ n: { url: '=https://real.host/v1/envio/mensajes/1' } }), EXCEPCION_DE_ARCHIVO)).toHaveLength(1);
  });
});
