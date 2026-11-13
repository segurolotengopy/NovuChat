/**
 * LINT DE ACCESIBILIDAD DE LA CONSOLA con línea de base cerrada (13/11/2026). Corre ESLint por su API con `admin/web/eslint.a11y.config.js`
 * (solo las reglas recomendadas de jsx-a11y) y falla ante una violación NUEVA o ante una base que sobra: el tope solo baja.
 * Qué mide y cómo bajarlo: docs/arquitectura/accesibilidad-consola.md. Sin red ni emulador.
 *
 * ATENCIÓN: cambiar `ALTA`, `TOPE` o la base hacia arriba exige pasar por el agente `seguridad`.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALTA, LINEA_DE_BASE, TOPE, TOPE_POR_REGLA, compararConLineaDeBase } from './linea-de-base';
import { ALTA_FIJADA, TOPE_MAXIMO } from './tope-fijado';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const WEB = join(ADMIN, 'web');
const requerir = createRequire(join(WEB, 'package.json'));
// `eslint` vive en admin/web y sus tipos no se resuelven desde aquí: se declara solo lo que se usa.
interface Mensaje { ruleId: string | null; fatal?: boolean; message: string }
type Resultados = { filePath: string; messages: Mensaje[] }[];
interface Motor {
  lintFiles(p: string[]): Promise<Resultados>;
  lintText(t: string, o: { filePath: string }): Promise<Resultados>;
  calculateConfigForFile(p: string): Promise<unknown>;
}
const { ESLint } = requerir('eslint') as { ESLint: new (o: { cwd: string; overrideConfigFile: string }) => Motor };
const jsxA11y = requerir('eslint-plugin-jsx-a11y') as { flatConfigs: { recommended: { rules: Record<string, unknown> } } };

const nuevoEslint = (): Motor => new ESLint({ cwd: WEB, overrideConfigFile: 'eslint.a11y.config.js' });

function agrupar(resultados: Resultados): Record<string, number> {
  const cuenta: Record<string, number> = {};
  for (const r of resultados) {
    const archivo = r.filePath.slice(WEB.length + 1).split('\\').join('/');
    for (const m of r.messages) {
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
    const malos = resultados.flatMap((r) => r.messages.filter((m) => m.fatal || !m.ruleId).map((m) => `${r.filePath}: ${m.message}`));
    expect(malos).toEqual([]);
    expect(resultados.length).toBeGreaterThan(20);
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
