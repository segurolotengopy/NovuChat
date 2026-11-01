/**
 * `scripts/modulos/verificar-todas-con-modulos.mjs` (H2b-cierre): el seco que dice si es seguro
 * desplegar las reglas que tratan `modulos` como la ÚNICA fuente. Pura (sin Firestore).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clasificarFicha, verificar } from '../../scripts/modulos/verificar-todas-con-modulos.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const TEXTO = readFileSync(join(aqui, '..', '..', 'scripts', 'modulos', 'verificar-todas-con-modulos.mjs'), 'utf8');

describe('verificar-todas-con-modulos: la ficha sin lista `modulos` se detecta', () => {
  it('solo una LISTA cuenta (vacía también); ausente, null, cadena, mapa y número no', () => {
    expect(clasificarFicha({ modulos: [] }).ok).toBe(true);
    expect(clasificarFicha({ modulos: ['agenda'] }).ok).toBe(true);
    expect(clasificarFicha({}).motivo).toBe('ausente');
    expect(clasificarFicha({ modulos: undefined }).motivo).toBe('ausente');
    expect(clasificarFicha({ modulos: null }).motivo).toBe('nula');
    for (const m of ['agenda', { agenda: true }, 5, true]) expect(clasificarFicha({ modulos: m }).motivo).toBe('no es lista');
    expect(clasificarFicha(null).ok).toBe(false);
    // `flujos` o `vertical` no sustituyen a la lista.
    expect(clasificarFicha({ flujos: ['venta'], vertical: 'venta' }).ok).toBe(false);
  });

  it('falla (faltan) con una sola ficha sin lista; las dadas de baja no cuentan', () => {
    const r = verificar([
      { id: 'a', ficha: { modulos: ['productos'] } },
      { id: 'bellido', ficha: { flujos: ['agendamiento'] } },
      { id: 'vieja', ficha: { estado: 'dado_de_baja' } },
    ]);
    expect(r.total).toBe(3);
    expect(r.conModulos).toBe(1);
    expect(r.bajasSinModulos).toBe(1);
    expect(r.faltan).toEqual([{ id: 'bellido', motivo: 'ausente' }]);
  });

  it('pasa cuando todas tienen lista', () => {
    expect(verificar([{ id: 'a', ficha: { modulos: [] } }, { id: 'b', ficha: { modulos: ['agenda'] } }]).faltan).toEqual([]);
    expect(verificar([]).faltan).toEqual([]);
  });

  it('es un seco: ninguna llamada de escritura en el texto del script', () => {
    const sinComentarios = TEXTO.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(sinComentarios).not.toMatch(/\.(set|update|delete|create|add|commit|batch|runTransaction|recursiveDelete)\s*\(/);
    expect(sinComentarios).toMatch(/--aplicar/);
  });
});
