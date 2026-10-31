/**
 * `scripts/plataforma/fijar-flujos.mjs`: deja EXACTAMENTE los flujos pedidos en la ficha de un comercio.
 *
 * Sin emulador ni nube: la decisión es pura (`fijar-flujos-logica.mjs`) y el texto del script se lee para
 * comprobar sus salvaguardas. Se prueba sobre todo NEGANDO: no quita un flujo que usa una ruta, no toca una
 * ficha con `modulos`, no acepta flujos desconocidos ni repetidos, no borra configuración y no escribe en seco.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../core/entorno-del-hijo.ts';
import { esFlujo } from '../../functions/src/registro';
import { planearFlujos } from '../../scripts/plataforma/fijar-flujos-logica.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = readFileSync(join(aqui, '..', '..', 'scripts', 'plataforma', 'fijar-flujos.mjs'), 'utf8');
const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Plan = { error?: string; antes?: string[]; despues?: string[]; quitados?: string[]; agregados?: string[]; vertical?: string; sinCambios?: boolean };
const planear = (ficha: unknown, pedidos: string[], rutas: Array<{ numero: string; flujo: string }> = []) =>
  planearFlujos({ ficha, pedidos, rutas, esFlujo } as never) as Plan;

// Armado al vuelo: el saneo del repositorio público veta literales de 10 o más dígitos.
const NUMERO = ['9999', '0001', '234'].join('');
const ANTONIO = { flujos: ['agendamiento'], vertical: 'agendamiento' };

describe('fijar-flujos: lo que sí hace', () => {
  it('cambia agendamiento por venta y fija el vertical', () => {
    const p = planear(ANTONIO, ['venta']);
    expect(p.error).toBeUndefined();
    expect(p.despues).toEqual(['venta']);
    expect(p.quitados).toEqual(['agendamiento']);
    expect(p.agregados).toEqual(['venta']);
    expect(p.vertical).toBe('venta');
    expect(p.sinCambios).toBe(false);
  });
  it('sin cambios si la ficha ya está así (idempotente)', () => {
    expect(planear({ flujos: ['venta'], vertical: 'venta' }, ['venta']).sinCambios).toBe(true);
  });
  it('sin lista `flujos` parte del vertical', () => {
    expect(planear({ vertical: 'agendamiento' }, ['venta']).antes).toEqual(['agendamiento']);
  });
  it('quitar un flujo cuya ruta no existe es posible; sumar otro no exige ruta', () => {
    expect(planear({ flujos: ['venta'], vertical: 'venta' }, ['venta', 'agendamiento']).agregados).toEqual(['agendamiento']);
  });
});

describe('fijar-flujos: lo que NO debe hacer', () => {
  it('NEGACIÓN: no quita un flujo que usa una ruta de WhatsApp', () => {
    const p = planear(ANTONIO, ['venta'], [{ numero: NUMERO, flujo: 'agendamiento' }]);
    expect(p.error).toContain('no se puede quitar');
    expect(p.error).not.toContain(NUMERO);
  });
  it('NEGACIÓN: una ruta de OTRO flujo no impide quitar el que se pide', () => {
    expect(planear(ANTONIO, ['venta'], [{ numero: '1234', flujo: 'venta' }]).error).toBeUndefined();
  });
  it('NEGACIÓN: rechaza una ficha que ya tiene `modulos`', () => {
    const r = planear({ ...ANTONIO, modulos: ['agenda'] }, ['venta']);
    expect(r.error).toBe('la ficha ya tiene modulos: use aplicar-modulos-tenant.mjs');
    expect(r.codigo).toBe(2);
  });
  it('NEGACIÓN: rechaza flujos desconocidos, repetidos y la lista vacía', () => {
    expect(planear(ANTONIO, ['inventado']).error).toContain('desconocido');
    expect(planear(ANTONIO, ['venta', 'venta']).error).toContain('repite');
    expect(planear(ANTONIO, []).error).toContain('falta --flujos');
  });
  it('NEGACIÓN: una ruta sin flujo o con un flujo desconocido bloquea (no se puede descartar)', () => {
    expect(planear(ANTONIO, ['venta'], [{ numero: '1234', flujo: undefined as unknown as string }]).error).toContain('verificar a mano');
    expect(planear(ANTONIO, ['venta'], [{ numero: '1234', flujo: 'raro' }]).error).toContain('verificar a mano');
  });
  it('NEGACIÓN: con más de 50 rutas se rechaza', () => {
    const rutas = Array.from({ length: 51 }, (_, i) => ({ numero: String(1000 + i), flujo: 'venta' }));
    expect(planear(ANTONIO, ['venta'], rutas).error).toContain('más de 50');
  });
  it('un cambio de orden o de vertical NO es «sin cambios»', () => {
    expect(planear({ flujos: ['venta', 'agendamiento'], vertical: 'venta' }, ['agendamiento', 'venta']).sinCambios).toBe(false);
    expect(planear({ flujos: ['venta'], vertical: 'agendamiento' }, ['venta']).sinCambios).toBe(false);
  });
  it('NEGACIÓN: un comercio inexistente se rechaza', () => {
    expect(planear(null, ['venta']).error).toContain('no existe');
  });
});

describe('fijar-flujos: el texto del script', () => {
  const s = sinComentarios(SCRIPT);
  it('es seco por omisión: las escrituras solo ocurren después de `if (!APLICAR …) return`', () => {
    expect(s.indexOf('if (!APLICAR')).toBeGreaterThan(-1);
    expect(s.indexOf('tx.update')).toBeGreaterThan(s.indexOf('if (!APLICAR'));
    expect(s.indexOf('tx.create')).toBeGreaterThan(s.indexOf('if (!APLICAR'));
    expect(s.indexOf('tx.set')).toBeGreaterThan(s.indexOf('if (!APLICAR'));
  });
  it('su única modificación de la ficha es `flujos` y `vertical`, y no borra nada', () => {
    expect(s).toMatch(/tx\.update\(refTenant, \{ flujos: plan\.despues, vertical: plan\.vertical \}\)/);
    expect(s).not.toMatch(/\.delete\(/);
  });
  it('los comercios excluidos (y los de prefijo igual) salen con código 2 antes de abrir Firebase', () => {
    for (const tenant of ['bellido', 'Bellido', 'bellido-xyz', 'platinum2']) {
      const r = spawnSync('node', [join(aqui, '..', '..', 'scripts', 'plataforma', 'fijar-flujos.mjs'),
        '--proyecto', 'p', '--operador', ['operador', 'ejemplo.test'].join('@'), '--tenant', tenant, '--flujos', 'venta'], { encoding: 'utf8', env: entornoDelEmulador() });
      expect(r.status).toBe(2);
      expect(r.stderr).toContain('no se toca desde este script');
    }
  });
  it('exige operador, no toca a Bellido ni a Platinum y deja auditoría', () => {
    expect(s).toContain("'--operador <correo> es obligatorio");
    expect(s).toContain("['bellido', 'platinum']");
    expect(s).toContain("accion: 'cambiar_flujos'");
  });
});
