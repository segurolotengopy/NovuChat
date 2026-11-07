/**
 * Flujo de Q'Taco para el numero 3727 (envio directo por Graph), workflow NUEVO y SEPARADO del vivo.
 * Lee el JSON versionado y comprueba lo que no puede fallar: nada compartido con el vivo (ruta de entrada y del carrito),
 * credenciales propias, sin ids reales, plantillas por lineas ACTIVAS (06/11/2026) y el constructor al dia.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import { verificarEnCopia } from './lib/venta-minima-mundo';

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
    expect(() => execFileSync(process.execPath, ['construir.mjs', '--verificar'], { cwd: DIR, stdio: 'pipe', env: entornoDelEmulador(undefined) })).not.toThrow();
  });
  it('nombre distinto del vivo y mismos nodos', () => {
    expect(NUEVO.name).not.toBe(VIVO.name);
    // el 3727 lleva los 8 nodos del miniCRM (módulo `crm`, 06/11/2026; ver venta-minima-crm.test.ts); el resto es el mismo flujo
    expect(NUEVO.nodes.length).toBe(VIVO.nodes.length + 8);
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
  it('plantillasPedidoLineas activas (06/11/2026): l2/l4/l6 aprobadas en la WABA del 3727; la plantilla antigua sigue como respaldo', () => {
    const cb = nodo(NUEVO, 'Config base').parameters.assignments.assignments as J[];
    expect(cb.find((a) => a.name === 'plantillasPedidoLineas')?.value).toBe('2:pedido_registrado_l2,4:pedido_registrado_l4,6:pedido_registrado_l6');
    expect(cb.find((a) => a.name === 'idiomaPlantillaPedidoLineas')?.value).toBe('es');
    expect(cb.find((a) => a.name === 'plantillaPedido')?.value).toBe('pedido_registrado');
    // El flujo VIVO de Q'Taco (qtaco.json) NO cambia: sigue con la clave vacia.
    const vivo = nodo(VIVO, 'Config base').parameters.assignments.assignments as J[];
    expect(vivo.find((a) => a.name === 'plantillasPedidoLineas')?.value).toBe('');
  });
  it('sin disparador de WhatsApp ni suscripciones (prohibicion 7)', () => {
    expect(texto).not.toMatch(/whatsAppTrigger|subscribed_apps|subscriptions/);
  });
  it('solo un destinatario de aviso (completo): el aviso de cocina NO se manda (decision de Andres)', () => {
    const cb = nodo(NUEVO, 'Config base').parameters.assignments.assignments as J[];
    const d = String(cb.find((a) => a.name === 'destinatariosAviso')?.value);
    expect(d).toMatch(/^completo:REEMPLAZAR_NUMERO_AVISO_1_QTACO$/);
    expect(d).not.toMatch(/cocina|AVISO_2/);
  });
});

describe("Q'Taco 3727: los negativos (copias en temporal, nunca el repositorio)", () => {
  const F = 'venta-minima.qtaco-3727.json';
  const editarTexto = (vm: string, f: (t: string) => string) => writeFileSync(join(vm, F), f(readFileSync(join(vm, F), 'utf8')));
  const datosDe = (vm: string) => join(vm, '..', '..', '..', 'admin', 'scripts', 'datos', 'venta-minima', 'qtaco-3727.json');

  it('FALLA --verificar si al 3727 se le pone un marcador del vivo', () => {
    const r = verificarEnCopia((vm) => editarTexto(vm, (t) => t.replace('REEMPLAZAR_WABA_ID_QTACO_3727', 'REEMPLAZAR_WABA_ID_QTACO')));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/marcadores del flujo vivo/);
  });
  it('FALLA --verificar si al 3727 se le pone una credencial del vivo', () => {
    const r = verificarEnCopia((vm) => editarTexto(vm, (t) => t.replace('Graph WhatsApp QTaco 3727 (Bearer)', "Graph WhatsApp Q'Taco (Bearer)")));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/credenciales del flujo vivo/);
  });
  it('FALLA construir si los datos del 3727 apuntan a una credencial del vivo', () => {
    const r = verificarEnCopia((vm) => {
      const d = JSON.parse(readFileSync(datosDe(vm), 'utf8'));
      d.credenciales.medios = "WhatsApp Q'Taco (envío)";
      writeFileSync(datosDe(vm), JSON.stringify(d));
    }, []);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/credenciales del flujo vivo/);
  });
  it('FALLA construir con un carritoMarcador fuera de la lista', () => {
    const r = verificarEnCopia((vm) => {
      const d = JSON.parse(readFileSync(datosDe(vm), 'utf8'));
      d.carritoMarcador = 'REEMPLAZAR_RUTA_CARRITO_OTRO';
      writeFileSync(datosDe(vm), JSON.stringify(d));
    }, []);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/carritoMarcador/);
  });
});
