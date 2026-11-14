/**
 * LINT DE ACCESIBILIDAD DE LA CONSOLA con línea de base cerrada (13/11/2026). Corre ESLint por su API con `admin/web/eslint.a11y.config.js`
 * (solo las reglas recomendadas de jsx-a11y) y falla ante una violación NUEVA o ante una base que sobra: el tope solo baja.
 * Qué mide y cómo bajarlo: docs/arquitectura/accesibilidad-consola.md. Sin red ni emulador.
 *
 * ATENCIÓN: cambiar `ALTA`, `TOPE` o la base hacia arriba exige pasar por el agente `seguridad`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALTA, LINEA_DE_BASE, TOPE, TOPE_POR_REGLA, compararConLineaDeBase } from './linea-de-base';
import { ALTA_FIJADA, TOPE_MAXIMO } from './tope-fijado';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = join(ADMIN, 'web');
const requerir = createRequire(join(WEB, 'package.json'));
// `eslint` vive en admin/web y sus tipos no se resuelven desde aquí: se declara solo lo que se usa.
interface Mensaje { ruleId: string | null; fatal?: boolean; severity?: number; message: string }
type Resultados = { filePath: string; messages: Mensaje[] }[];
interface Motor {
  lintFiles(p: string[]): Promise<Resultados>;
  lintText(t: string, o: { filePath: string }): Promise<Resultados>;
  calculateConfigForFile(p: string): Promise<unknown>;
}
const { ESLint } = requerir('eslint') as { ESLint: new (o: { cwd: string; overrideConfigFile: string }) => Motor };
const jsxA11y = requerir('eslint-plugin-jsx-a11y') as { flatConfigs: { recommended: { rules: Record<string, unknown> } } };

const nuevoEslint = (): Motor => new ESLint({ cwd: WEB, overrideConfigFile: 'eslint.a11y.config.js' });

const rutaDe = (absoluta: string): string => relative(WEB, absoluta).split('\\').join('/');
// Un mensaje sin regla solo es un defecto del lint si es fatal o un ERROR (config rota, parseo). El AVISO de «eslint-disable sin efecto por
// noInlineConfig» (severidad 1, sin regla) no lo es: un disable legítimo del lint general no debe poner esta suite en rojo.
const esDefectoDelLint = (m: Mensaje): boolean => m.fatal === true || (!m.ruleId && m.severity !== 1);
const tsxEnDisco = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? tsxEnDisco(join(dir, e.name)) : e.name.endsWith('.tsx') ? [rutaDe(join(dir, e.name))] : []);

function agrupar(resultados: Resultados): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const r of resultados) {
    const archivo = rutaDe(r.filePath);
    for (const m of r.messages) {
      if (!m.ruleId) continue;
      const clave = `${archivo}#${m.ruleId}`;
      cuenta[clave] = (cuenta[clave] ?? 0) + 1;
    }
  }
  return cuenta;
}

describe('lint de accesibilidad de la consola: la línea de base solo puede bajar', () => {
  let resultados: Resultados;
  beforeAll(async () => {
    resultados = await nuevoEslint().lintFiles(['src']);
  }, 60000);

  it('el lint corrió de verdad: sin errores fatales ni de configuración (un lint que no corrió no aprueba)', () => {
    const malos = resultados.flatMap((r) => r.messages.filter(esDefectoDelLint).map((m) => `${rutaDe(r.filePath)}: ${m.message}`));
    expect(malos).toEqual([]);
    expect(resultados.length).toBeGreaterThan(20);
  });

  it('se revisó TODO archivo .tsx de src: un `ignores` nuevo o una carpeta fuera de `files` no pasa en silencio', () => {
    expect(resultados.map((r) => rutaDe(r.filePath)).sort()).toEqual(tsxEnDisco(join(WEB, 'src')).sort());
  });

  it('lo encontrado coincide con la línea de base: ni violaciones nuevas ni base que sobre', () => {
    expect(compararConLineaDeBase(agrupar(resultados))).toEqual([]);
  });

  it('la base suma TOPE y su desglose por regla es TOPE_POR_REGLA', () => {
    expect(Object.values(LINEA_DE_BASE).reduce((a, b) => a + b, 0)).toBe(TOPE);
    const porRegla: Record<string, number> = {};
    for (const [clave, n] of Object.entries(LINEA_DE_BASE)) {
      const regla = clave.split('#')[1] ?? '';
      porRegla[regla] = (porRegla[regla] ?? 0) + n;
    }
    expect(porRegla).toEqual(TOPE_POR_REGLA);
  });

  it('el tope no sube en silencio: ALTA es la fijada y TOPE no pasa del máximo fijado en tope-fijado.ts (subirlo obliga a tocar dos archivos)', () => {
    expect(ALTA).toBe(ALTA_FIJADA);
    expect(TOPE).toBeLessThanOrEqual(TOPE_MAXIMO);
  });

  it('todo archivo de la base existe en disco', () => {
    const faltan = [...new Set(Object.keys(LINEA_DE_BASE).map((k) => k.split('#')[0] ?? ''))].filter((a) => !existsSync(join(WEB, a)));
    expect(faltan).toEqual([]);
  });

  it('las reglas activas son exactamente las recomendadas del plugin y son al menos 30 (nadie vacía la config)', async () => {
    const config = (await nuevoEslint().calculateConfigForFile('src/__regla__.tsx')) as { rules: Record<string, unknown[]> };
    const activas = Object.entries(config.rules).filter(([, v]) => v[0] !== 0).map(([k]) => k).sort();
    // Las recomendadas que el plugin deja en «off» (p. ej. label-has-for, obsoleta) no cuentan como activas.
    const apagada = (v: unknown) => (Array.isArray(v) ? v[0] : v) === 'off' || (Array.isArray(v) ? v[0] : v) === 0;
    const recomendadas = Object.entries(jsxA11y.flatConfigs.recommended.rules).filter(([, v]) => !apagada(v)).map(([k]) => k).sort();
    expect(activas).toEqual(recomendadas);
    expect(activas.length).toBeGreaterThanOrEqual(30);
  });

  it('nadie afloja una regla: las opciones de cada regla activa son las recomendadas, todas como error, y no hay `settings` de jsx-a11y', async () => {
    const config = (await nuevoEslint().calculateConfigForFile('src/__regla__.tsx')) as { rules: Record<string, unknown[]>; settings?: Record<string, unknown> };
    const opcionesDe = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(1) : []);
    for (const [regla, valor] of Object.entries(jsxA11y.flatConfigs.recommended.rules)) {
      const activa = config.rules[regla];
      if (!activa || activa[0] === 0) continue;
      expect(activa[0], regla).toBe(2);
      expect(activa.slice(1), regla).toEqual(opcionesDe(valor));
    }
    expect(Object.keys(config.settings ?? {})).not.toContain('jsx-a11y');
  });
});

describe('contrapruebas: el motor detecta y la base no se deja engañar', () => {
  const FALSA = 'src/__contraprueba__.tsx';

  it('una imagen sin alt y un div con onClick SÍ dan violaciones', async () => {
    const [img] = await nuevoEslint().lintText('export const A = () => <img src="x" />;\n', { filePath: FALSA });
    expect(img?.messages.map((m) => m.ruleId)).toContain('jsx-a11y/alt-text');
    const [div] = await nuevoEslint().lintText('export const B = ({ f }: { f: () => void }) => <div onClick={f} />;\n', { filePath: FALSA });
    expect(div?.messages.map((m) => m.ruleId)).toContain('jsx-a11y/click-events-have-key-events');
  });

  it('un eslint-disable no apaga la regla', async () => {
    const texto = 'export const A = () => (\n  // eslint-disable-next-line jsx-a11y/alt-text\n  <img src="x" />\n);\n';
    const [r] = await nuevoEslint().lintText(texto, { filePath: FALSA });
    expect(r?.messages.map((m) => m.ruleId)).toContain('jsx-a11y/alt-text');
  });

  it('un eslint-disable de OTRA regla (legítimo para el lint general) no pone la suite en rojo, y un error de parseo sí', async () => {
    const texto = 'export const A = () => (\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  <p>hola</p>\n);\n';
    const [r] = await nuevoEslint().lintText(texto, { filePath: FALSA });
    expect(r?.messages.some((m) => !m.ruleId)).toBe(true);
    expect(r?.messages.filter(esDefectoDelLint)).toEqual([]);
    expect(agrupar([{ filePath: join(WEB, FALSA), messages: r?.messages ?? [] }])).toEqual({});
    const [roto] = await nuevoEslint().lintText('export const A = () => <div;\n', { filePath: FALSA });
    expect(roto?.messages.filter(esDefectoDelLint).length).toBeGreaterThan(0);
  });

  describe('compararConLineaDeBase', () => {
    const base = { 'src/a.tsx#jsx-a11y/alt-text': 2, 'src/b.tsx#jsx-a11y/media-has-caption': 1 };
    const igual = { ...base };

    it('lo mismo da []', () => {
      expect(compararConLineaDeBase(igual, base)).toEqual([]);
    });
    it('una violación de más en una clave de la base da «violación NUEVA»', () => {
      expect(compararConLineaDeBase({ ...igual, 'src/a.tsx#jsx-a11y/alt-text': 3 }, base)).toEqual([
        'violación NUEVA de accesibilidad: src/a.tsx · jsx-a11y/alt-text (hay 3, la línea de base admite 2): arréglala; la línea de base no sube',
      ]);
    });
    it('una clave nueva da «violación NUEVA» con base 0', () => {
      expect(compararConLineaDeBase({ ...igual, 'src/c.tsx#jsx-a11y/alt-text': 1 }, base)).toEqual([
        'violación NUEVA de accesibilidad: src/c.tsx · jsx-a11y/alt-text (hay 1, la línea de base admite 0): arréglala; la línea de base no sube',
      ]);
    });
    it('una de menos da «la línea de base sobra»', () => {
      expect(compararConLineaDeBase({ ...igual, 'src/a.tsx#jsx-a11y/alt-text': 1 }, base)).toEqual([
        'la línea de base sobra en src/a.tsx#jsx-a11y/alt-text (hay 1, dice 2): bájala en linea-de-base.ts y baja TOPE y TOPE_MAXIMO',
      ]);
    });
    it('una clave desaparecida da «la línea de base sobra» con hay 0', () => {
      const { 'src/b.tsx#jsx-a11y/media-has-caption': _quitada, ...sin } = igual;
      expect(compararConLineaDeBase(sin, base)).toEqual([
        'la línea de base sobra en src/b.tsx#jsx-a11y/media-has-caption (hay 0, dice 1): bájala en linea-de-base.ts y baja TOPE y TOPE_MAXIMO',
      ]);
    });
  });
});
