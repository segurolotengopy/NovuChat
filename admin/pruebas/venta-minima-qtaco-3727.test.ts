/**
 * Flujo de Q'Taco para el numero 3727 (envio directo por Graph), workflow NUEVO y SEPARADO del vivo.
 * Lee el JSON versionado y comprueba lo que no puede fallar: nada compartido con el vivo (ruta de entrada y del carrito),
 * credenciales propias, sin ids reales, plantillas por lineas vacias y el constructor al dia.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(REPO, 'Flujos', 'experimental', 'venta-minima');
type J = Record<string, any>;
const cargar = (f: string): J => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const NUEVO = cargar('venta-minima.qtaco-3727.json');
const VIVO = cargar('venta-minima.qtaco.json');
const texto = JSON.stringify(NUEVO);
const nodo = (f: J, n: string): J => f.nodes.find((x: J) => x.name === n);
const creds = (f: J) => new Set<string>(f.nodes.flatMap((n: J) => Object.values(n.credentials ?? {}).map((c: any) => c.name as string)).filter(Boolean));

describe("Q'Taco 3727: workflow nuevo, separado del vivo", () => {
  it('el constructor lo deja al dia', () => {
    expect(() => execFileSync('node', ['construir.mjs', '--verificar'], { cwd: DIR, stdio: 'pipe' })).not.toThrow();
  });
  it('nombre distinto del vivo y mismos nodos', () => {
    expect(NUEVO.name).not.toBe(VIVO.name);
    expect(NUEVO.nodes.length).toBe(VIVO.nodes.length);
    expect(NUEVO.settings.executionTimeout).toBe(120);
  });
  it('rutas propias: la de entrada y la del carrito no se comparten con el vivo', () => {
    const rutas = (f: J) => f.nodes.filter((n: J) => n.type === 'n8n-nodes-base.webhook').map((n: J) => n.parameters.path).sort();
    expect(rutas(NUEVO)).toEqual(['REEMPLAZAR_RUTA_CARRITO_QTACO_3727', 'REEMPLAZAR_RUTA_RECEPTOR_QTACO_3727']);
    for (const r of rutas(NUEVO)) expect(rutas(VIVO)).not.toContain(r);
    expect(texto.split('REEMPLAZAR_RUTA_CARRITO_QTACO_3727').length - 1).toBe(1);
    expect(texto).not.toMatch(/REEMPLAZAR_RUTA_CARRITO_QTACO(?!_3727)/);
    expect(texto).not.toMatch(/REEMPLAZAR_RUTA_RECEPTOR_QTACO(?!_3727)/);
  });
  it('el numero y la WABA esperados son marcadores propios (sin ids en el repositorio)', () => {
    expect(texto).toContain('REEMPLAZAR_WABA_ID_QTACO_3727');
    expect(texto).toContain('REEMPLAZAR_PHONE_NUMBER_ID_QTACO_3727');
    expect(texto).not.toMatch(/REEMPLAZAR_(WABA_ID|PHONE_NUMBER_ID)_QTACO(?!_3727)/);
    expect(texto).not.toMatch(/\d{11,}/);
  });
  it('credenciales propias del 3727; ninguna del vivo', () => {
    const c = creds(NUEVO);
    expect(c).toContain('Graph WhatsApp QTaco 3727 (Bearer)');
    expect(c).toContain('WhatsApp QTaco 3727 (envio)');
    expect(c).toContain('NovuChat ingesta (cliente11)');
    for (const v of creds(VIVO)) expect(c.has(v), `no debe reusar «${v}» del vivo`).toBe(false);
    for (const n of ['Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Aviso de respaldo']) {
      expect(nodo(NUEVO, n).credentials.httpHeaderAuth.name, n).toBe('Graph WhatsApp QTaco 3727 (Bearer)');
    }
    for (const n of ['Obtener URL del medio', 'Descargar medio']) expect(nodo(NUEVO, n).credentials.whatsAppApi.name, n).toBe('WhatsApp QTaco 3727 (envio)');
    expect(nodo(NUEVO, 'Carrito del catálogo').credentials.httpHeaderAuth.name).toBe('NovuChat ingesta (cliente11)');
  });
  it('plantillasPedidoLineas vacia: todo sale por pedido_registrado', () => {
    const cb = nodo(NUEVO, 'Config base').parameters.assignments.assignments as J[];
    expect(cb.find((a) => a.name === 'plantillasPedidoLineas')?.value).toBe('');
    expect(cb.find((a) => a.name === 'plantillaPedido')?.value).toBe('pedido_registrado');
  });
  it('sin disparador de WhatsApp ni suscripciones (prohibicion 7)', () => {
    expect(texto).not.toMatch(/whatsAppTrigger|subscribed_apps|subscriptions/);
  });
});
