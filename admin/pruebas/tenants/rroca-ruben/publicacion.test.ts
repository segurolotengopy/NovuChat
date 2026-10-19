/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-5, LA GUARDIA DE PUBLICACIÓN.
 *
 * Regla firme de Principal (19/10/2026): el flujo de Rubén NO se publica ni se importa a n8n con marcadores `REEMPLAZAR_*` ni con plantillas de aviso que Meta no aprobó.
 * Esta suite NIEGA: cada marcador residual, cada estado distinto de APPROVED (PENDING, REJECTED, ausente…), nombre de plantilla vacío o con marcador, idioma vacío; en el JSON que se
 * publica y en los datos. Y deja la ruta feliz (todo sustituido y aprobado). También prueba `publicar-flujo.sh`: se niega con --aplicar si la guardia falla, pide confirmación
 * explícita y, sin terminal, solo sigue con `--confirmo-ruben`; y no cambia nada para los demás flujos.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { AQUI, ARCHIVO_DE_DATOS, CLAVES_DE_PLANTILLA, cargarDatos, guardiaDePublicacion } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';

const RROCA: string = AQUI;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const leer = (r: string): string => readFileSync(r, 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const DATOS_VERSIONADOS = JSON.parse(leer(ARCHIVO_DE_DATOS)) as { configBase: Record<string, unknown> };
const PRODUCCION = JSON.parse(leer(join(RROCA, 'rroca-ruben.json'))) as Flujo;
const PRUEBA = JSON.parse(leer(join(RROCA, 'rroca-ruben.prueba.json'))) as Flujo;
const MARCADORES = /REEMPLAZAR_[A-Z0-9][A-Z0-9_]*/g;

type Asignacion = { name: string; value: unknown };
const asignaciones = (f: Flujo): Asignacion[] => (f.nodes.find((n) => n.name === 'Config base')!.parameters as { assignments: { assignments: Asignacion[] } }).assignments.assignments;
const fijar = (f: Flujo, nombre: string, valor: unknown): void => { asignaciones(f).find((a) => a.name === nombre)!.value = valor; };

/** El flujo tal como quedaría tras `preparar-import.sh` (todos los marcadores sustituidos) y con las plantillas aprobadas en «Config base». */
function publicable(base: Flujo = PRODUCCION): Flujo {
  const f = JSON.parse(JSON.stringify(base).replace(MARCADORES, 'valorsustituido')) as Flujo;
  for (const { estado } of CLAVES_DE_PLANTILLA as Array<{ estado: string }>) fijar(f, estado, 'APPROVED');
  return f;
}
/** Los datos con las plantillas aprobadas. */
function datosAprobados(): { configBase: Record<string, unknown> } {
  const d = copia(DATOS_VERSIONADOS);
  d.configBase['avisoComprobanteEstado'] = 'APPROVED';
  d.configBase['avisoConsultaEstado'] = 'APPROVED';
  return d;
}
const hallazgos = (flujo: Flujo, datos = datosAprobados()): string[] => guardiaDePublicacion({ flujo, datos }) as string[];

describe('guardia de publicación: la ruta feliz y el JSON versionado de hoy', () => {
  it('con todo sustituido y las plantillas APPROVED (Config base y datos) no hay hallazgos, en producción y en la prueba', () => {
    expect(hallazgos(publicable(PRODUCCION))).toEqual([]);
    expect(hallazgos(publicable(PRUEBA))).toEqual([]);
  });

  it('el JSON versionado de hoy NO es publicable: marcadores y plantillas PENDING', () => {
    const h = guardiaDePublicacion({ flujo: PRODUCCION, datos: DATOS_VERSIONADOS }) as string[];
    expect(h.filter((x) => /marcador sin sustituir/.test(x)).length).toBeGreaterThan(0);
    expect(h.join('|')).toMatch(/Config base: avisoComprobanteEstado es «PENDING»/);
    expect(h.join('|')).toMatch(/datos: avisoConsultaEstado es «PENDING»/);
  });

  it('los datos versionados siguen en PENDING (hasta que Meta apruebe): la prueba de "datos" es real', () => {
    expect(DATOS_VERSIONADOS.configBase['avisoComprobanteEstado']).not.toBe('APPROVED');
  });
});

describe('guardia de publicación: cada marcador REEMPLAZAR_* residual se niega', () => {
  const marcadoresDelFlujo = [...new Set(JSON.stringify(PRODUCCION).match(MARCADORES) ?? [])];

  it('el JSON de producción trae marcadores que la guardia conoce', () => {
    expect(marcadoresDelFlujo.length).toBeGreaterThanOrEqual(6);
  });

  for (const marcador of marcadoresDelFlujo) {
    it(`deja pasar todo salvo ${marcador}: se niega y lo nombra, sin mostrar valores`, () => {
      // Todos los marcadores sustituidos salvo ESTE, y las plantillas aprobadas.
      const ya = JSON.parse(JSON.stringify(PRODUCCION).replace(MARCADORES, (m) => (m === marcador ? m : 'valorsustituido'))) as Flujo;
      for (const { estado } of CLAVES_DE_PLANTILLA as Array<{ estado: string }>) fijar(ya, estado, 'APPROVED');
      const h = hallazgos(ya);
      expect(h.length).toBeGreaterThan(0);
      expect(h.join('|')).toContain(marcador);
      expect(h.every((x) => /marcador sin sustituir/.test(x))).toBe(true);
    });
  }

  it('un marcador en una credencial o en un nodo cualquiera también se niega (no solo en «Config base»)', () => {
    const f = publicable(PRODUCCION);
    const n = f.nodes.find((x) => x.name === 'Enviar a WhatsApp')!;
    (n as unknown as { notes: string }).notes = 'REEMPLAZAR_ALGO_NUEVO';
    expect(hallazgos(f).join('|')).toMatch(/REEMPLAZAR_ALGO_NUEVO \(nodo «Enviar a WhatsApp»\)/);
  });

  it('el texto "REEMPLAZAR_…" de un comentario del código NO es un marcador (no hay falso positivo)', () => {
    expect(JSON.stringify(PRODUCCION)).toContain('REEMPLAZAR_…');
    expect(hallazgos(publicable(PRODUCCION))).toEqual([]);
  });

  it('un flujo vacío o sin «Config base» se niega', () => {
    expect(hallazgos({ nodes: [] } as unknown as Flujo).join('|')).toMatch(/no trae nodos/);
    const f = publicable(PRODUCCION);
    f.nodes = f.nodes.filter((n) => n.name !== 'Config base');
    expect(hallazgos(f).join('|')).toMatch(/no trae «Config base»/);
  });
});

describe('guardia de publicación: las plantillas de aviso tienen que estar APPROVED, con nombre e idioma', () => {
  const ESTADOS_NO = ['PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', '', 'approved', 'Approved'];

  for (const { estado } of CLAVES_DE_PLANTILLA as Array<{ estado: string }>) {
    for (const malo of ESTADOS_NO) {
      it(`${estado} = «${malo}» en «Config base» se niega`, () => {
        const f = publicable(PRODUCCION);
        fijar(f, estado, malo);
        expect(hallazgos(f).join('|')).toContain(`Config base: ${estado} es`);
      });
      it(`${estado} = «${malo}» en los datos se niega`, () => {
        const d = datosAprobados();
        d.configBase[estado] = malo;
        const h = hallazgos(publicable(PRODUCCION), d);
        expect(h.join('|')).toContain(`datos: ${estado} es`);
        expect(h.filter((x) => x.startsWith('Config base'))).toEqual([]);
      });
    }
    it(`${estado} ausente se niega`, () => {
      const d = datosAprobados();
      delete d.configBase[estado];
      expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain(`datos: ${estado} es «ausente»`);
    });
  }

  for (const { nombre } of CLAVES_DE_PLANTILLA as Array<{ nombre: string }>) {
    for (const vacio of ['', '   ', 'REEMPLAZAR_NOMBRE_PLANTILLA']) {
      it(`${nombre} = «${vacio}» (nombre vacío o marcador) se niega`, () => {
        const f = publicable(PRODUCCION);
        fijar(f, nombre, vacio);
        expect(hallazgos(f).join('|')).toContain(`falta el nombre de la plantilla (${nombre})`);
        const d = datosAprobados();
        d.configBase[nombre] = vacio;
        expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain(`datos: falta el nombre de la plantilla (${nombre})`);
      });
    }
  }

  for (const vacio of ['', '  ']) {
    it(`avisoPlantillaIdioma = «${vacio}» (idioma vacío) se niega, en el flujo y en los datos`, () => {
      const f = publicable(PRODUCCION);
      fijar(f, 'avisoPlantillaIdioma', vacio);
      expect(hallazgos(f).join('|')).toContain('Config base: falta el idioma de las plantillas');
      const d = datosAprobados();
      d.configBase['avisoPlantillaIdioma'] = vacio;
      expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain('datos: falta el idioma de las plantillas');
    });
  }

  it('una sola plantilla aprobada no alcanza: las DOS tienen que estarlo', () => {
    const f = publicable(PRODUCCION);
    fijar(f, 'avisoConsultaEstado', 'PENDING');
    const h = hallazgos(f);
    expect(h.some((x) => x.includes('avisoConsultaEstado'))).toBe(true);
    expect(h.some((x) => x.includes('avisoComprobanteEstado'))).toBe(false);
  });

  it('el mensaje no muestra el contenido de un estado largo (se recorta)', () => {
    const f = publicable(PRODUCCION);
    fijar(f, 'avisoConsultaEstado', 'X'.repeat(200));
    expect(hallazgos(f).join('|')).not.toContain('X'.repeat(30));
  });
});

describe('construir.mjs --publicable: la línea de comandos', () => {
  const correr = (...args: string[]) => spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--publicable', ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
  const dir = mkdtempSync(join(tmpdir(), 'rroca-pub-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sobre el JSON versionado sale en 1 y nombra los marcadores y las plantillas', () => {
    const r = correr();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stderr).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
    expect(r.stderr).toMatch(/PENDING/);
  });

  it('con un flujo sustituido pero los datos versionados en PENDING sigue negado (los datos cuentan)', () => {
    const ruta = join(dir, 'sustituido.json');
    writeFileSync(ruta, JSON.stringify(publicable(PRODUCCION)));
    const r = correr('--flujo', ruta);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/datos: avisoComprobanteEstado es «PENDING»/);
    expect(r.stderr).not.toMatch(/marcador sin sustituir/);
  });

  it('ruta feliz: flujo sustituido y datos aprobados sale en 0', () => {
    const rutaF = join(dir, 'feliz.json');
    const rutaD = join(dir, 'datos.json');
    writeFileSync(rutaF, JSON.stringify(publicable(PRODUCCION)));
    writeFileSync(rutaD, JSON.stringify({ ...JSON.parse(leer(ARCHIVO_DE_DATOS)), configBase: datosAprobados().configBase }));
    const r = correr('--flujo', rutaF, '--datos', rutaD);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/se puede publicar/);
  });

  it('un flujo que no existe o un argumento sobrante salen en error y no publican', () => {
    expect(correr('--flujo', join(dir, 'no-existe.json')).status).toBe(1);
    expect(correr('--flujo').status).toBe(2);
    expect(correr('sobrante').status).toBe(2);
    expect(spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--publicable', '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) }).status).toBe(2);
  });

  it('el armado no cambia: --verificar sigue en 0 y no se llega a la guardia', () => {
    const r = spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('publicar-flujo.sh: la guardia y la confirmación del flujo de Rubén', () => {
  const SCRIPT = join(REPO, 'scripts/publicar-flujo.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rroca-sh-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const correr = (args: string[], cwd = REPO, script = SCRIPT) =>
    spawnSync('bash', [script, ...args, '--env', join(dir, 'no-hay-env')], { cwd, encoding: 'utf8', env: entornoDelEmulador(undefined), stdio: ['ignore', 'pipe', 'pipe'] });
  const RUBEN = join(RROCA, 'rroca-ruben.json');

  it('con --aplicar y el JSON versionado (marcadores, PENDING) se NIEGA antes de leer el .env o hablar con n8n', () => {
    const r = correr(['--flujo', RUBEN, '--aplicar']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(r.stderr + r.stdout).toMatch(/marcador sin sustituir/);
    expect(r.stderr).not.toMatch(/Falta /);
  });

  it('también se niega con el nombre `.local.json` que deja preparar-import.sh si aún trae un marcador', () => {
    const local = join(dir, 'rroca-ruben.local.json');
    const f = publicable(PRODUCCION);
    (f.nodes[0] as unknown as { notes: string }).notes = 'REEMPLAZAR_SIN_VALOR';
    writeFileSync(local, JSON.stringify(f));
    const r = correr(['--flujo', local, '--aplicar']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
  });

  it('en seco informa lo que falta y SIGUE (no aborta el diagnóstico): llega hasta pedir el .env', () => {
    const r = correr(['--flujo', RUBEN]);
    expect(r.stdout + r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stdout).toMatch(/en seco se sigue/);
    expect(r.stdout + r.stderr).toMatch(/Falta /);
  });

  it('el nombre del flujo (no solo el del archivo) lo marca como el de Rubén', () => {
    const otro = join(dir, 'cualquier-nombre.json');
    writeFileSync(otro, JSON.stringify({ name: 'NovuChat — Venta digital de Rubén (rroca-ruben)', nodes: [] }));
    const r = correr(['--flujo', otro, '--aplicar']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
  });

  it('un flujo de otro cliente NO pasa por la guardia (sigue como siempre: pide el .env)', () => {
    const r = correr(['--flujo', join(REPO, 'Flujos/experimental/venta-minima/venta-minima.json'), '--aplicar']);
    expect(r.stdout + r.stderr).not.toMatch(/Rubén|guardia de publicación/);
    expect(r.stdout + r.stderr).toMatch(/Falta /);
  });

  // La confirmación se prueba con una copia del script y una guardia de juguete que SIEMPRE aprueba: así se llega al paso de confirmación sin depender de que el JSON real esté listo.
  function copiaConGuardiaAprobada(): string {
    const raiz = join(dir, 'raiz');
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos/experimental/rroca-ruben'), { recursive: true });
    copyFileSync(SCRIPT, join(raiz, 'scripts/publicar-flujo.sh'));
    writeFileSync(join(raiz, 'Flujos/experimental/rroca-ruben/construir.mjs'), 'process.exit(0);\n');
    writeFileSync(join(raiz, 'Flujos/experimental/rroca-ruben/rroca-ruben.json'), JSON.stringify({ name: 'rroca-ruben', nodes: [] }));
    chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
    return raiz;
  }

  it('con la guardia en verde y sin terminal, --aplicar SIN --confirmo-ruben se NIEGA', () => {
    const raiz = copiaConGuardiaAprobada();
    const r = correr(['--flujo', 'Flujos/experimental/rroca-ruben/rroca-ruben.json', '--aplicar'], raiz, join(raiz, 'scripts/publicar-flujo.sh'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/solo se publica con --confirmo-ruben/);
  });

  it('con --confirmo-ruben (guardia en verde) pasa la confirmación y sigue al paso siguiente (el .env)', () => {
    const raiz = copiaConGuardiaAprobada();
    const r = correr(['--flujo', 'Flujos/experimental/rroca-ruben/rroca-ruben.json', '--aplicar', '--confirmo-ruben'], raiz, join(raiz, 'scripts/publicar-flujo.sh'));
    expect(r.stderr).not.toMatch(/NEGADO/);
    expect(r.stdout + r.stderr).toMatch(/Falta /);
  });

  it('--confirmo-ruben NO salta la guardia: con el JSON real sigue negado', () => {
    const r = correr(['--flujo', RUBEN, '--aplicar', '--confirmo-ruben']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Rubén no se publica/);
  });
});

describe('límites conocidos, declarados y NO implementados (PR-5)', () => {
  const DISENO = leer(join(RROCA, 'DISENO.md'));
  const PROPIO = leer(join(RROCA, 'PROPIO.md'));
  const CODIGO = ['src/lib/rr.js', 'src/lib/avisos.js', 'src/nodos/armar-avisos.js', 'src/nodos/armar-mensajes.js'].map((a) => leer(join(RROCA, a))).join('\n');

  it('el tope global de avisos está declarado como límite conocido (contador por hora, motivoFallo «tope») y todavía NO existe en el código', () => {
    expect(DISENO).toMatch(/Sin tope global de avisos a Rubén \(límite conocido, DECLARADO en el PR-5, NO implementado\)/);
    expect(DISENO).toMatch(/\$getWorkflowStaticData/);
    expect(DISENO).toMatch(/motivoFallo: 'tope'/);
    // Si alguien lo implementa, esta línea falla y obliga a actualizar el documento y la prueba.
    expect(CODIGO).not.toMatch(/motivoFallo\s*[:=]\s*['"]tope['"]/);
    expect(CODIGO).not.toMatch(/getWorkflowStaticData\(\)[^;]*topeHora|avisosPorHora/);
    expect(PROPIO).toMatch(/no hay tope global por hora/);
  });

  it('la excepción de la falla abierta de la pausa tiene su id y su vencimiento a 90 días, en DISENO.md y en PROPIO.md', () => {
    for (const doc of [DISENO, PROPIO]) {
      expect(doc).toContain('rroca-pausa-falla-abierta');
      expect(doc).toMatch(/vence en 90 días \(17\/01\/2027\)/);
    }
    // 19/10/2026 + 90 días = 17/01/2027.
    expect(new Date(Date.UTC(2026, 9, 19) + 90 * 86400000).toISOString().slice(0, 10)).toBe('2027-01-17');
  });

  it('la puerta del turno sigue idéntica al origen (la excepción existe PORQUE no se toca): la falla abierta sigue fijada por su prueba', () => {
    expect(leer(join(REPO, 'admin/pruebas/tenants/rroca-ruben/flujo.test.ts'))).toMatch(/falla abierta, declarada/);
  });
});
