/**
 * «Aceptar (200)» VA ANTES DE TODA ESPERA Y DE TODA LLAMADA AL RELÉ (pedido de WAM, PR #757 ronda 3).
 *
 * El receptor espera 5 s por intento al destino y a los 64 s corta y reintenta hasta 6 h. Si el flujo tardara en contestar 200 (porque primero espera un reintento
 * del envío o llama al relé), el receptor reentregaría el mismo evento y el cliente recibiría la respuesta repetida. Por eso, en el flujo armado de cada constructor:
 *   - desde «Entrega del receptor», todo camino hacia un nodo Wait o hacia una llamada al relé (`/v1/envio/` o el marcador de su URL) pasa por «Aceptar (200)»;
 *   - lo único que corre antes de «Aceptar (200)» es la verificación de firma («Verificar firma con el receptor» y «¿Firma válida?»), que NO usa el relé
 *     (va al verificador interno).
 * Es una prueba de posición y conexiones, sobre los JSON versionados de los constructores y sobre un flujo armado con el canal rele.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const EXP = join(RAIZ, 'Flujos', 'experimental');
const RECEPTOR = 'Entrega del receptor';
const ACEPTAR = 'Aceptar (200)';
const ANTES_DE_ACEPTAR = ['Verificar firma con el receptor', '¿Firma válida?', 'Rechazar (401)'];

interface Nodo { name: string; type: string; parameters?: J }
interface FlujoMinimo { nodes: Nodo[]; connections: Record<string, { main?: Array<Array<{ node: string }> | null> }> }

/** Los flujos de producción de los constructores con receptor: rroca-evy, rroca-emma, rroca-ruben, rroca-antonio y las doctoras. */
function flujosDeProduccion(): Array<{ ruta: string; flujo: FlujoMinimo }> {
  const dirs = ['rroca-evy', 'rroca-emma', 'rroca-ruben', 'rroca-antonio', 'doctoras'];
  const salida: Array<{ ruta: string; flujo: FlujoMinimo }> = [];
  for (const d of dirs) {
    for (const n of readdirSync(join(EXP, d))) {
      if (!/^(rroca-[a-z]+|doctoras\.rroca-[a-z]+)\.json$/.test(n)) continue;
      salida.push({ ruta: `${d}/${n}`, flujo: JSON.parse(readFileSync(join(EXP, d, n), 'utf8')) as FlujoMinimo });
    }
  }
  return salida;
}

const hijos = (f: FlujoMinimo, nombre: string): string[] => ((f.connections[nombre]?.main) ?? []).flatMap((s) => (s ?? []).map((c) => c.node));

/** Los nodos alcanzables desde `desde` SIN pasar por `salvo`. */
function alcanzables(f: FlujoMinimo, desde: string, salvo: string): Set<string> {
  const visto = new Set<string>();
  const pila = [desde];
  while (pila.length) {
    const n = pila.pop()!;
    if (visto.has(n) || n === salvo) continue;
    visto.add(n);
    pila.push(...hijos(f, n));
  }
  return visto;
}

const esEspera = (n: Nodo): boolean => n.type === 'n8n-nodes-base.wait';
const llamaAlRele = (n: Nodo): boolean => /\/v1\/envio\/|REEMPLAZAR_URL_INTERNA_DEL_RELE/.test(JSON.stringify(n.parameters ?? {}));

/** Lo que está mal en el flujo según el pedido de WAM; vacío si está bien. */
export function hallazgosDeAceptar200(f: FlujoMinimo): string[] {
  const h: string[] = [];
  const por = (n: string): Nodo | undefined => f.nodes.find((x) => x.name === n);
  const aceptar = por(ACEPTAR);
  if (!por(RECEPTOR)) return ['falta «Entrega del receptor»'];
  if (!aceptar) return ['falta «Aceptar (200)»'];
  if (aceptar.type !== 'n8n-nodes-base.respondToWebhook') h.push('«Aceptar (200)» no es un respondToWebhook');
  const antes = alcanzables(f, RECEPTOR, ACEPTAR);
  for (const n of antes) {
    const nodo = por(n);
    if (!nodo) continue;
    if (esEspera(nodo)) h.push(`«${n}» (una espera) corre antes de «Aceptar (200)»`);
    if (llamaAlRele(nodo)) h.push(`«${n}» llama al relé antes de «Aceptar (200)»`);
    if (n !== RECEPTOR && !ANTES_DE_ACEPTAR.includes(n)) h.push(`«${n}» corre antes de «Aceptar (200)» (solo la verificación de firma puede)`);
  }
  // Todo camino a «Aceptar (200)» pasa por la verificación: la firma no depende del relé.
  const verificar = por('Verificar firma con el receptor');
  if (!verificar) h.push('falta «Verificar firma con el receptor»');
  else if (llamaAlRele(verificar)) h.push('«Verificar firma con el receptor» depende del relé (va al verificador interno)');
  return h;
}

describe('«Aceptar (200)» queda antes de toda espera y de toda llamada al relé', () => {
  const flujos = flujosDeProduccion();
  it('se revisan los flujos de producción de Evy, Emma, Rubén, Antonio y las doctoras', () => {
    expect(flujos.map((x) => x.ruta).sort()).toEqual([
      'doctoras/doctoras.rroca-emma.json', 'doctoras/doctoras.rroca-evy.json', 'rroca-antonio/rroca-antonio.json',
      'rroca-emma/rroca-emma.json', 'rroca-evy/rroca-evy.json', 'rroca-ruben/rroca-ruben.json',
    ]);
  });
  for (const { ruta, flujo } of flujosDeProduccion()) {
    it(`${ruta}: solo la verificación de firma corre antes de «Aceptar (200)», y ahí no hay relé ni esperas`, () => {
      expect(hallazgosDeAceptar200(flujo)).toEqual([]);
    });
    it(`${ruta}: «Entrega del receptor» → verificación → «¿Firma válida?» → «Aceptar (200)» y nada más en el camino`, () => {
      expect(hijos(flujo, RECEPTOR)).toEqual(['Verificar firma con el receptor']);
      expect(hijos(flujo, 'Verificar firma con el receptor')).toEqual(['¿Firma válida?']);
      expect(hijos(flujo, '¿Firma válida?')).toContain(ACEPTAR);
    });
  }

  it('con una espera y una llamada al relé DESPUÉS de «Aceptar (200)» (la cadena de envío del canal rele), la regla se cumple', () => {
    const base = flujosDeProduccion().find((x) => x.ruta === 'rroca-evy/rroca-evy.json')!;
    const f = JSON.parse(JSON.stringify(base.flujo)) as FlujoMinimo;
    // Un Wait y un nodo que llama al relé DESPUÉS de «Aceptar (200)» (lo normal): sigue bien.
    f.nodes.push({ name: 'Esperar reintento', type: 'n8n-nodes-base.wait', parameters: {} }, { name: 'Enviar a WhatsApp', type: 'n8n-nodes-base.httpRequest', parameters: { url: '=REEMPLAZAR_URL_INTERNA_DEL_RELE/v1/envio/mensajes/1' } });
    (f.connections['Descartar repetidos'] ??= { main: [[]] }).main = [[...(f.connections['Descartar repetidos']?.main?.[0] ?? []), { node: 'Esperar reintento' }]];
    f.connections['Esperar reintento'] = { main: [[{ node: 'Enviar a WhatsApp' }]] };
    expect(hallazgosDeAceptar200(f)).toEqual([]);
  });

  describe('NIEGA: si algo se cuela antes de «Aceptar (200)», la prueba lo detecta', () => {
    const copia = (): FlujoMinimo => JSON.parse(JSON.stringify(flujosDeProduccion().find((x) => x.ruta === 'rroca-evy/rroca-evy.json')!.flujo)) as FlujoMinimo;
    it('una espera entre la verificación y «Aceptar (200)»', () => {
      const f = copia();
      f.nodes.push({ name: 'Esperar reintento', type: 'n8n-nodes-base.wait', parameters: {} });
      f.connections['Verificar firma con el receptor']!.main = [[{ node: 'Esperar reintento' }]];
      f.connections['Esperar reintento'] = { main: [[{ node: '¿Firma válida?' }]] };
      expect(hallazgosDeAceptar200(f).join('|')).toMatch(/una espera\) corre antes de «Aceptar \(200\)»/);
    });
    it('una llamada al relé antes de «Aceptar (200)»', () => {
      const f = copia();
      f.nodes.push({ name: 'Pedir al relé', type: 'n8n-nodes-base.httpRequest', parameters: { url: '=REEMPLAZAR_URL_INTERNA_DEL_RELE/v1/envio/medios/x' } });
      f.connections['Entrega del receptor']!.main = [[{ node: 'Pedir al relé' }]];
      f.connections['Pedir al relé'] = { main: [[{ node: 'Verificar firma con el receptor' }]] };
      expect(hallazgosDeAceptar200(f).join('|')).toMatch(/llama al relé antes de «Aceptar \(200\)»/);
    });
    it('una verificación de firma que depende del relé', () => {
      const f = copia();
      f.nodes.find((n) => n.name === 'Verificar firma con el receptor')!.parameters = { url: '=REEMPLAZAR_URL_INTERNA_DEL_RELE/v1/envio/verificar' };
      expect(hallazgosDeAceptar200(f).join('|')).toMatch(/depende del relé|llama al relé antes/);
    });
    it('«Aceptar (200)» que no responde, o ausente', () => {
      const f = copia();
      f.nodes.find((n) => n.name === 'Aceptar (200)')!.type = 'n8n-nodes-base.noOp';
      expect(hallazgosDeAceptar200(f).join('|')).toMatch(/no es un respondToWebhook/);
      f.nodes = f.nodes.filter((n) => n.name !== 'Aceptar (200)');
      expect(hallazgosDeAceptar200(f)).toEqual(['falta «Aceptar (200)»']);
    });
  });
});
