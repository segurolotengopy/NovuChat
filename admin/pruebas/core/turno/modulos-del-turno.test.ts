/**
 * `modulosDelTurno` (F3b-2a): que modulos corren en un turno. Pura, sin Firestore.
 * Contrato: encendidos ∩ (modulos del flujo del numero ∪ comunes), en el orden de `IDS_MODULOS`.
 * Las pruebas niegan primero: lo que NO debe correr.
 */
import { describe, expect, it } from 'vitest';
import { IDS_MODULOS, MODULOS_COMUNES_HOY } from '../../../functions/src/registro.ts';
import {
  MODULO_DE_GANCHO, modulosDelTurno,
} from '../../../functions/src/core/turno/ganchosDelTurno.ts';

const TODOS = [...IDS_MODULOS];

describe('modulosDelTurno: lo que NO corre', () => {
  it('un modulo apagado en la ficha no corre, aunque sea del flujo del numero', () => {
    const r = modulosDelTurno({ modulos: ['productos', 'agenda'] }, 'agendamiento');
    expect(r).not.toContain('cobros');
    expect(r).toEqual(['productos', 'agenda']);
  });

  it('un modulo comun apagado en la ficha tampoco corre', () => {
    expect(modulosDelTurno({ modulos: ['productos'] }, 'agendamiento')).not.toContain('campanas');
  });

  it('un modulo encendido pero fuera del flujo del numero no corre en ese numero', () => {
    const ficha = { modulos: TODOS };
    const enVenta = modulosDelTurno(ficha, 'venta');
    expect(enVenta).not.toContain('agenda');
    expect(enVenta).not.toContain('captacion');
    const enAgenda = modulosDelTurno(ficha, 'agendamiento');
    expect(enAgenda).not.toContain('inventario');
    expect(enAgenda).not.toContain('pedidos');
    expect(enAgenda).not.toContain('catalogo-web');
    const enOnboarding = modulosDelTurno(ficha, 'onboarding');
    expect(enOnboarding).not.toContain('cobros');
    expect(enOnboarding).not.toContain('agenda');
  });

  it('comercio con varios flujos: la ruta decide; no usa todos los modulos de la ficha', () => {
    const ficha = { flujos: ['agendamiento', 'venta'] };
    expect(modulosDelTurno(ficha, 'venta')).not.toContain('agenda');
    expect(modulosDelTurno(ficha, 'agendamiento')).not.toContain('inventario');
  });

  it('un flujo desconocido no enciende modulos de flujo, solo comunes', () => {
    const r = modulosDelTurno({ modulos: TODOS }, 'inventado');
    expect(r).toEqual([...IDS_MODULOS].filter((m) => (MODULOS_COMUNES_HOY as readonly string[]).includes(m)));
    expect(modulosDelTurno({ modulos: TODOS }, '__proto__')).toEqual(r);
    expect(modulosDelTurno({ modulos: TODOS }, 'constructor')).toEqual(r);
  });

  it('ids que no son modulos en la ficha no encienden nada', () => {
    expect(modulosDelTurno({ modulos: ['no-existe', 7, null, 'agenda'] }, 'agendamiento')).toEqual(['agenda']);
  });
});

describe('modulosDelTurno: lo que SI corre', () => {
  it('los comunes corren en cualquier flujo si estan encendidos', () => {
    for (const flujo of ['agendamiento', 'venta', 'onboarding']) {
      const r = modulosDelTurno({ modulos: ['productos', 'campanas'] }, flujo);
      expect(r).toEqual(['productos', 'campanas']);
    }
  });

  it('el orden es el del registro, no el de la lista de la ficha', () => {
    const a = modulosDelTurno({ modulos: ['agenda', 'campanas', 'cobros', 'productos'] }, 'agendamiento');
    const b = modulosDelTurno({ modulos: ['productos', 'cobros', 'agenda', 'campanas'] }, 'agendamiento');
    expect(a).toEqual(['productos', 'cobros', 'agenda', 'campanas']);
    expect(b).toEqual(a);
    const posiciones = a.map((m) => IDS_MODULOS.indexOf(m));
    expect(posiciones).toEqual([...posiciones].sort((x, y) => x - y));
  });

  it('venta con todo encendido: los de venta mas los comunes', () => {
    expect(modulosDelTurno({ modulos: TODOS }, 'venta'))
      .toEqual(['productos', 'cobros', 'inventario', 'pedidos', 'catalogo-web', 'campanas']);
  });

  it('el resultado no depende de duplicados en la lista', () => {
    expect(modulosDelTurno({ modulos: ['agenda', 'agenda', 'cobros'] }, 'agendamiento')).toEqual(['cobros', 'agenda']);
  });
});

describe('modulosDelTurno: fichas sin lista de modulos (anteriores a la migracion)', () => {
  it('con `flujos` y sin `modulos`: los del flujo del numero mas los comunes de hoy', () => {
    expect(modulosDelTurno({ flujos: ['agendamiento'] }, 'agendamiento'))
      .toEqual(['productos', 'cobros', 'agenda', 'campanas']);
    expect(modulosDelTurno({ flujos: ['onboarding'] }, 'onboarding'))
      .toEqual(['productos', 'campanas', 'captacion']);
  });

  it('un flujo de la ruta que la ficha no declara no enciende sus modulos', () => {
    expect(modulosDelTurno({ flujos: ['agendamiento'] }, 'venta')).not.toContain('inventario');
  });

  it('ficha sin ninguna lista, nula o indefinida: solo los comunes, nunca los de un flujo', () => {
    const comunes = ['productos', 'campanas'];
    expect(modulosDelTurno({}, 'agendamiento')).toEqual(comunes);
    expect(modulosDelTurno(null, 'venta')).toEqual(comunes);
    expect(modulosDelTurno(undefined, 'onboarding')).toEqual(comunes);
  });

  it('`modulos` que no es lista se trata como ausente (no apaga ni enciende todo)', () => {
    expect(modulosDelTurno({ modulos: 'agenda', flujos: ['agendamiento'] }, 'agendamiento'))
      .toEqual(['productos', 'cobros', 'agenda', 'campanas']);
  });

  it('`modulos` vacia apaga todo, comunes incluidos: una lista explicita manda', () => {
    expect(modulosDelTurno({ modulos: [], flujos: ['agendamiento'] }, 'agendamiento')).toEqual([]);
  });
});

describe('MODULO_DE_GANCHO', () => {
  it('cada gancho apunta a un modulo del registro', () => {
    for (const m of Object.values(MODULO_DE_GANCHO)) expect(IDS_MODULOS).toContain(m);
  });
});
