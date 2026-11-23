/**
 * EL JUEGO DE CONVERSACIÓN (plan 21/11/2026, PR1): el alta de todo comercio enciende el juego completo.
 *
 *  - `faltanDelJuego` compara con `===` exacto contra la unión de JUEGO_DE_FICHA y JUEGO_CON_INFRA.
 *  - `'nueva'` es una pantalla válida de la consola (se verifica desde aquí: core no importa de central).
 *  - Cada `Flujos/clientes/<t>/PROPIO.md` declara «Juego de conversación: completo|excepción» y toda excepción
 *    nombra al tenant en `docs/versiones-por-cliente.md`.
 * Pura: sin emulador. Cada regla trae su contraprueba.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUEGO_CON_INFRA, JUEGO_DE_FICHA, consolaNuevaEncendida, faltanDelJuego, guardadoEncendido } from '../../functions/src/core/conversacion/juego';
import { personaPuedeEnviarMediosDeFicha, personaPuedeEscribirDeFicha, personaPuedeRetomarDeFicha } from '../../functions/src/core/conversacion/turno';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..');
const CLIENTES = join(RAIZ, 'Flujos', 'clientes');
const CONSOLA_CONVERSACIONES = join(AQUI, '..', '..', 'functions', 'src', 'central', 'consola-conversaciones.ts');
const VERSIONES = join(RAIZ, 'docs', 'versiones-por-cliente.md');

const JUEGO_COMPLETO = { ...JUEGO_DE_FICHA, ...JUEGO_CON_INFRA };
const RENGLON = /^Juego de conversación:\s*(completo|excepción)\b.*$/mu;

/** Tenants con PROPIO.md, descubiertos del disco. */
function tenantsConPropio(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(carpeta, d.name, 'PROPIO.md')))
    .map((d) => d.name)
    .sort();
}

/** ¿Hay en versiones-por-cliente.md una FILA o sección que nombre al tenant por su ruta `Flujos/clientes/<t>/` o por su nombre entre comillas invertidas? */
function hayFilaDe(tenant: string, versiones: string): boolean {
  const ruta = `Flujos/clientes/${tenant}/`;
  return versiones.split('\n').some((l) => (l.startsWith('|') || l.startsWith('#')) && (l.includes(ruta) || l.includes(`\`${tenant}\``)));
}

/** Problemas del renglón del juego en cada PROPIO.md y su reflejo en versiones-por-cliente. */
function problemasDeDeclaracion(carpeta: string, versiones: string): string[] {
  const problemas: string[] = [];
  for (const t of tenantsConPropio(carpeta)) {
    const m = readFileSync(join(carpeta, t, 'PROPIO.md'), 'utf8').match(RENGLON);
    if (!m) {
      problemas.push(`${t}: PROPIO.md sin el renglón «Juego de conversación: completo|excepción»`);
    } else if (m[1] === 'excepción' && !hayFilaDe(t, versiones)) {
      problemas.push(`${t}: excepción no reflejada en versiones-por-cliente.md`);
    }
  }
  return problemas;
}

describe('juego de conversación: claves y valores exactos', () => {
  it('JUEGO_DE_FICHA y JUEGO_CON_INFRA tienen los valores que el servidor exige y están congelados', () => {
    expect(JUEGO_DE_FICHA).toEqual({ consolaConversaciones: 'nueva', guardarMedios: true });
    expect(JUEGO_CON_INFRA).toEqual({ personaPuedeEscribir: true, personaPuedeEnviarMedios: true });
    expect(Object.isFrozen(JUEGO_DE_FICHA)).toBe(true);
    expect(Object.isFrozen(JUEGO_CON_INFRA)).toBe(true);
  });

  it('el juego completo no deja nada faltando', () => {
    expect(faltanDelJuego(JUEGO_COMPLETO)).toEqual([]);
  });

  it("'nueva' es pantalla válida de la consola", () => {
    // Se lee como texto: `fronteras.test.ts` prohíbe que core (y su carpeta de pruebas) importe de central.
    const m = readFileSync(CONSOLA_CONVERSACIONES, 'utf8').match(/PANTALLAS_CONVERSACIONES\s*=\s*\[([^\]]*)\]/);
    expect(m, 'PANTALLAS_CONVERSACIONES no encontrada').not.toBeNull();
    const pantallas = [...((m as RegExpMatchArray)[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] ?? '');
    expect(pantallas).toContain(JUEGO_DE_FICHA.consolaConversaciones);
  });

  it('las banderas con infraestructura son las que lee el servidor (turno.ts)', () => {
    expect(personaPuedeEscribirDeFicha(JUEGO_COMPLETO)).toBe(true);
    expect(personaPuedeEnviarMediosDeFicha(JUEGO_COMPLETO)).toBe(true);
    expect(personaPuedeRetomarDeFicha({ personaPuedeRetomar: true })).toBe(true); // su entrada al juego es del PR de R4
  });

  it('los predicados del servidor (juego.ts, los mismos que importan accesoPersona y guardarMedio) aceptan el juego y niegan lo inexacto', () => {
    expect(consolaNuevaEncendida(JUEGO_COMPLETO)).toBe(true);
    expect(guardadoEncendido(JUEGO_COMPLETO)).toBe(true);
    for (const v of ['true', 1, 'TRUE', false, null, undefined]) expect(guardadoEncendido({ guardarMedios: v })).toBe(false);
    for (const v of ['Nueva', 'clasica', 'vieja', true, null, undefined]) expect(consolaNuevaEncendida({ consolaConversaciones: v })).toBe(false);
    expect(guardadoEncendido(null)).toBe(false);
    expect(consolaNuevaEncendida(undefined)).toBe(false);
  });

  it('negativa: el número 1 no vale por true (un != flojo no sobrevive)', () => {
    expect(faltanDelJuego({ ...JUEGO_COMPLETO, guardarMedios: 1 })).toEqual(['guardarMedios']);
    expect(faltanDelJuego({ ...JUEGO_COMPLETO, personaPuedeEscribir: 1 })).toEqual(['personaPuedeEscribir']);
    expect(faltanDelJuego({ ...JUEGO_COMPLETO, personaPuedeEnviarMedios: 1 })).toEqual(['personaPuedeEnviarMedios']);
    // `personaPuedeRetomar` NO es del juego todavía: no la agrega este PR (el alta no tiene escritor para ella).
    expect(faltanDelJuego({ ...JUEGO_COMPLETO })).toEqual([]);
    expect(Object.keys(JUEGO_CON_INFRA)).not.toContain('personaPuedeRetomar');
  });

  it('negativa: ficha sin guardarMedios', () => {
    const { guardarMedios: _g, ...sin } = JUEGO_COMPLETO;
    expect(faltanDelJuego(sin)).toEqual(['guardarMedios']);
  });

  it("negativa: personaPuedeEscribir:'true' como texto falta", () => {
    expect(faltanDelJuego({ ...JUEGO_COMPLETO, personaPuedeEscribir: 'true' })).toEqual(['personaPuedeEscribir']);
  });

  it("negativa: consolaConversaciones:'vieja' falta", () => {
    expect(faltanDelJuego({ ...JUEGO_COMPLETO, consolaConversaciones: 'vieja' })).toEqual(['consolaConversaciones']);
  });

  it('negativa: ficha vacía o ausente falta todo', () => {
    expect(faltanDelJuego({})).toHaveLength(4);
    expect(faltanDelJuego(null)).toHaveLength(4);
  });
});

describe('juego de conversación: cada tenant lo declara en su PROPIO.md', () => {
  it('hay tenants descubiertos del disco', () => {
    expect(tenantsConPropio(CLIENTES).length).toBeGreaterThan(0);
  });

  // PR3 (método) agrega el renglón en cada PROPIO.md y en versiones-por-cliente.md (fuera de la zona de core);
  // entonces esta prueba pasa a activa con: expect(problemasDeDeclaracion(CLIENTES, readFileSync(VERSIONES, 'utf8'))).toEqual([]).
  it.todo('PR3 (método): todo PROPIO.md real declara el renglón y toda excepción está en versiones-por-cliente.md');

  it('negativa: un PROPIO.md temporal sin el renglón falla', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'juego-'));
    try {
      mkdirSync(join(tmp, 'zeta'));
      writeFileSync(join(tmp, 'zeta', 'PROPIO.md'), '# Zeta\n\nSin renglón.\n');
      expect(problemasDeDeclaracion(tmp, '')).toEqual([expect.stringContaining('zeta: PROPIO.md sin el renglón')]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('negativa: una excepción no reflejada en versiones-por-cliente.md falla; reflejada, pasa', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'juego-'));
    try {
      mkdirSync(join(tmp, 'zeta'));
      writeFileSync(join(tmp, 'zeta', 'PROPIO.md'), 'Juego de conversación: excepción — motivo\n');
      expect(problemasDeDeclaracion(tmp, '| otro | `otro` |\nzeta aparece suelto en prosa')).toEqual([expect.stringContaining('zeta: excepción no reflejada')]);
      expect(problemasDeDeclaracion(tmp, '| Zeta | `zeta` | excepción del juego |')).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('un renglón «completo» no exige reflejo', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'juego-'));
    try {
      mkdirSync(join(tmp, 'zeta'));
      writeFileSync(join(tmp, 'zeta', 'PROPIO.md'), 'Juego de conversación: completo (evidencia)\n');
      expect(problemasDeDeclaracion(tmp, '')).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Las piezas de plataforma (`fichaInicial` de alta-comercio.mjs y `pasosDelEncendido` de encender-conversacion.mjs) se prueban
// en `pruebas/plataforma/encender-conversacion.test.ts`: core no importa de `scripts/` ni de plataforma (`fronteras.test.ts`).
