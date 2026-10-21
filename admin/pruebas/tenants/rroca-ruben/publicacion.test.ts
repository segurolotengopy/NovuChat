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
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { AQUI, ARCHIVO_DE_DATOS, CLAVES_DE_PLANTILLA, MEDIOS_PARA_ABRIR, cargarDatos, guardiaDePublicacion, modoDePublicacion } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';

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
  // La lista de prueba sustituida lleva dígitos (una lista sin ningún dígito NO cuenta como lista y abriría al público).
  const f = JSON.parse(JSON.stringify(base).replace(/REEMPLAZAR_TELEFONOS_DE_PRUEBA/g, '59100000042').replace(MARCADORES, 'valorsustituido')) as Flujo;
  for (const { estado } of CLAVES_DE_PLANTILLA as Array<{ estado: string }>) fijar(f, estado, 'APPROVED');
  return f;
}
/** Los datos con las plantillas aprobadas. */
function datosAprobados(): { configBase: Record<string, unknown> } {
  const d = copia(DATOS_VERSIONADOS);
  d.configBase['avisoComprobanteEstado'] = 'APPROVED';
  d.configBase['avisoConsultaEstado'] = 'APPROVED';
  if (typeof d.configBase['telefonosDePrueba'] === 'string' && !/\d/.test(d.configBase['telefonosDePrueba'])) d.configBase['telefonosDePrueba'] = '59100000042';
  return d;
}
const hallazgos = (flujo: Flujo, datos = datosAprobados()): string[] => guardiaDePublicacion({ flujo, datos }) as string[];

describe('guardia de publicación: la ruta feliz y el JSON versionado de hoy', () => {
  it('con todo sustituido y las plantillas APPROVED (Config base y datos) no hay hallazgos, en producción y en la prueba', () => {
    expect(hallazgos(publicable(PRODUCCION))).toEqual([]);
    expect(hallazgos(publicable(PRUEBA))).toEqual([]);
  });

  it('el JSON versionado de hoy NO es publicable: solo por los marcadores que faltan (las plantillas ya están aprobadas)', () => {
    const h = guardiaDePublicacion({ flujo: PRODUCCION, datos: DATOS_VERSIONADOS }) as string[];
    expect(h.filter((x) => /marcador sin sustituir/.test(x)).length).toBeGreaterThan(0);
    expect(h.join('|')).not.toMatch(/APPROVED|plantilla/i);
  });

  it('los datos versionados traen las dos plantillas en APPROVED (Meta las aprobó el 19/10/2026)', () => {
    expect(DATOS_VERSIONADOS.configBase['avisoComprobanteEstado']).toBe('APPROVED');
    expect(DATOS_VERSIONADOS.configBase['avisoConsultaEstado']).toBe('APPROVED');
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
      const ya = JSON.parse(JSON.stringify(PRODUCCION).replace(MARCADORES, (m) => (m === marcador ? m : (m === 'REEMPLAZAR_TELEFONOS_DE_PRUEBA' ? '59100000042' : 'valorsustituido')))) as Flujo;
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

  it('el mensaje no muestra NADA del valor del estado (solo «distinto de APPROVED»)', () => {
    const f = publicable(PRODUCCION);
    fijar(f, 'avisoConsultaEstado', 'SECRETO-' + 'X'.repeat(200));
    const t = hallazgos(f).join('|');
    expect(t).not.toContain('SECRETO');
    expect(t).not.toContain('XX');
    expect(t).toContain('(distinto de APPROVED)');
  });
});

describe('guardia de publicación: marcadores en cualquier parte del flujo y en cualquier grafía', () => {
  it('un marcador en pinData o en staticData se niega y se atribuye al campo', () => {
    const f = publicable(PRODUCCION) as unknown as Record<string, unknown>;
    f['pinData'] = { Nodo: [{ json: { x: 'REEMPLAZAR_EN_PIN' } }] };
    f['staticData'] = { global: { y: 'REEMPLAZAR_EN_STATIC' } };
    const t = hallazgos(f as unknown as Flujo).join('|');
    expect(t).toContain('REEMPLAZAR_EN_PIN (pinData)');
    expect(t).toContain('REEMPLAZAR_EN_STATIC (staticData)');
  });
  it('un marcador en settings, connections o el nivel superior también se niega', () => {
    const f = publicable(PRODUCCION) as unknown as Record<string, unknown>;
    f['settings'] = { a: 'REEMPLAZAR_EN_SETTINGS' };
    f['connections'] = { 'REEMPLAZAR_EN_CONEXION': {} };
    f['meta'] = 'REEMPLAZAR_ARRIBA';
    const t = hallazgos(f as unknown as Flujo).join('|');
    expect(t).toContain('REEMPLAZAR_EN_SETTINGS');
    expect(t).toContain('REEMPLAZAR_EN_CONEXION');
    expect(t).toContain('REEMPLAZAR_ARRIBA');
  });
  for (const raro of ['REEMPLAZAR_ruben', 'reemplazar_x', 'REEMPLAZAR_-X', 'Reemplazar_Mixto']) {
    it(`«${raro}» es un marcador: se niega en un nodo y como nombre de plantilla`, () => {
      const f = publicable(PRODUCCION);
      (f.nodes[0] as unknown as { notes: string }).notes = raro;
      expect(hallazgos(f).join('|')).toContain(raro);
      const g = publicable(PRODUCCION);
      fijar(g, 'avisoComprobantePlantilla', raro);
      expect(hallazgos(g).join('|')).toContain('falta el nombre de la plantilla (avisoComprobantePlantilla)');
    });
  }
  it('los comentarios «REEMPLAZAR_*» y «REEMPLAZAR_…» siguen sin ser marcadores', () => {
    const f = publicable(PRODUCCION);
    (f.nodes[0] as unknown as { notes: string }).notes = 'texto REEMPLAZAR_* y REEMPLAZAR_… de comentario';
    expect(hallazgos(f)).toEqual([]);
  });
});

describe('construir.mjs --publicable: la línea de comandos', () => {
  const correr = (...args: string[]) => spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--publicable', ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
  const dir = mkdtempSync(join(tmpdir(), 'rroca-pub-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sobre el JSON versionado sale en 1 y nombra los marcadores, ya no las plantillas', () => {
    const r = correr();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stderr).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
    expect(r.stderr).not.toMatch(/APPROVED|plantilla/i);
  });

  it('con un flujo sustituido pero unos datos en PENDING (fabricados) sigue negado (los datos cuentan)', () => {
    const ruta = join(dir, 'sustituido.json');
    writeFileSync(ruta, JSON.stringify(publicable(PRODUCCION)));
    const rutaPend = join(dir, 'datos-pendientes.json');
    const pend = copia(DATOS_VERSIONADOS);
    pend.configBase['avisoComprobanteEstado'] = 'PENDING';
    pend.configBase['avisoConsultaEstado'] = 'PENDING';
    writeFileSync(rutaPend, JSON.stringify({ ...JSON.parse(leer(ARCHIVO_DE_DATOS)), configBase: pend.configBase }));
    const r = correr('--flujo', ruta, '--datos', rutaPend);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/datos: avisoComprobanteEstado es \(distinto de APPROVED\)/);
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

  it('un JSON inválido no filtra su contenido en el mensaje de error', () => {
    const ruta = join(dir, 'roto.json');
    writeFileSync(ruta, '{"token": "CONTENIDO-SECRETO-123" ,,, }');
    const r = correr('--flujo', ruta);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/JSON inválido/);
    expect(r.stderr + r.stdout).not.toMatch(/SECRETO|token|position|Unexpected/);
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

  it('con --aplicar y el JSON versionado (marcadores) se NIEGA antes de leer el .env o hablar con n8n', () => {
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

describe('publicar-flujo.sh: la guardia mira también el flujo VIVO (destino) y --encender', () => {
  const SCRIPT = join(REPO, 'scripts/publicar-flujo.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rroca-vivo-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  // Un `curl` de juguete: escribe el flujo vivo simulado en el -o y responde 200. Nada sale a la red.
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "$*" >> "$LOG_CURL"\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) O="$2"; shift 2;; -X) M="$2"; shift 2;; *) shift;; esac; done\n'
    + '[[ -n "$O" ]] && cp "$VIVO_SIMULADO" "$O"\nprintf 200\n');
  chmodSync(join(bin, 'curl'), 0o755);
  const envRel = join(dir, 'env');
  writeFileSync(envRel, 'N8N_API_KEY=clave-de-juguete\nN8N_WORKFLOW_ID=1\nN8N_BASE_URL=http://n8n.invalido\n');
  const vivoRuben = join(dir, 'vivo-ruben.json');
  writeFileSync(vivoRuben, JSON.stringify({ name: 'NovuChat — Venta digital de Rubén (rroca-ruben)', active: false, nodes: [] }));
  const vivoOtro = join(dir, 'vivo-otro.json');
  writeFileSync(vivoOtro, JSON.stringify({ name: 'Otro cliente', active: false, nodes: [] }));
  const otroArchivo = join(dir, 'cualquier-cosa.json');
  writeFileSync(otroArchivo, JSON.stringify({ name: 'Otro cliente', nodes: [{ name: 'X', type: 'n8n-nodes-base.set', parameters: { v: 'REEMPLAZAR_ALGO' } }] }));
  const log = join(dir, 'curl.log');
  const correr = (args: string[], vivo: string) => {
    writeFileSync(log, '');
    return spawnSync('bash', [SCRIPT, ...args, '--env', relative(REPO, envRel)], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivo, LOG_CURL: log }),
    });
  };
  const escribio = (): boolean => /POST|PUT|PATCH|activate/.test(leer(log));

  it('otro archivo + --forzar + --aplicar contra un flujo vivo de Rubén: se NIEGA por la guardia y no escribe', () => {
    const r = correr(['--flujo', otroArchivo, '--forzar', '--aplicar', '--confirmo-ruben'], vivoRuben);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(r.stdout + r.stderr).toMatch(/flujo vivo de destino/);
    expect(escribio()).toBe(false);
  });
  it('con la guardia en verde pero sin terminal ni --confirmo-ruben, el destino de Rubén también se NIEGA', () => {
    const buena = join(dir, 'buena.json');
    writeFileSync(buena, JSON.stringify(publicable(PRODUCCION)));
    const datos = join(dir, 'datos-ok.json');
    writeFileSync(datos, JSON.stringify({ ...JSON.parse(leer(ARCHIVO_DE_DATOS)), configBase: datosAprobados().configBase }));
    // La guardia lee los datos versionados (PENDING): sigue negada; se prueba que ni con otro nombre se esquiva.
    const r = correr(['--flujo', buena, '--forzar', '--aplicar'], vivoRuben);
    expect(r.status).toBe(1);
    expect(escribio()).toBe(false);
  });
  it('un flujo vivo de otro cliente NO activa la guardia de Rubén (nada cambia para los demás)', () => {
    const r = correr(['--flujo', otroArchivo], vivoOtro);
    expect(r.stdout + r.stderr).not.toMatch(/Flujo de Rubén/);
  });
  it('--encender --aplicar --confirmo-ruben sobre el flujo vivo de Rubén NO activa si la guardia lo niega (marcadores o plantillas sin aprobar en el flujo VIVO)', () => {
    const r = correr(['--encender', '--aplicar', '--confirmo-ruben'], vivoRuben);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(r.stdout + r.stderr).toMatch(/encender el flujo vivo/);
    expect(escribio()).toBe(false);
  });
  // Una copia del script con una guardia de juguete que aprueba: se llega al paso de activar sin depender de que el JSON real esté listo.
  function raizConGuardia(codigoSalida: number): string {
    const raiz = join(dir, `raiz-${codigoSalida}`);
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos/experimental/rroca-ruben'), { recursive: true });
    copyFileSync(SCRIPT, join(raiz, 'scripts/publicar-flujo.sh'));
    writeFileSync(join(raiz, 'Flujos/experimental/rroca-ruben/construir.mjs'), `process.exit(${codigoSalida});\n`);
    writeFileSync(join(raiz, 'Flujos/demo-a-agendamiento.json'), JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
    return raiz;
  }
  const correrEn = (raiz: string, args: string[], vivo: string) => {
    writeFileSync(log, '');
    return spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), ...args, '--env', relative(raiz, envRel)], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivo, LOG_CURL: log }),
    });
  };
  it('--encender --aplicar sobre el flujo vivo de Rubén sin confirmación se NIEGA y no activa (con la guardia en verde)', () => {
    const r = correrEn(raizConGuardia(0), ['--encender', '--aplicar'], vivoRuben);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/solo se publica con --confirmo-ruben/);
    expect(escribio()).toBe(false);
  });
  it('--encender --aplicar --confirmo-ruben sobre el flujo vivo de Rubén sí activa cuando la guardia aprueba el flujo vivo', () => {
    const r = correrEn(raizConGuardia(0), ['--encender', '--aplicar', '--confirmo-ruben'], vivoRuben);
    expect(r.status, r.stderr).toBe(0);
    expect(escribio()).toBe(true);
  });
  it('--encender --aplicar sobre el flujo vivo de Rubén: con la guardia en rojo se niega aunque lleve --confirmo-ruben (y la guardia se corre sobre el VIVO)', () => {
    const r = correrEn(raizConGuardia(1), ['--encender', '--aplicar', '--confirmo-ruben'], vivoRuben);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(escribio()).toBe(false);
  });
  it('--encender en seco no pide confirmación ni escribe', () => {
    const r = correr(['--encender'], vivoRuben);
    expect(r.status, r.stderr).toBe(0);
    expect(escribio()).toBe(false);
  });
  it('--apagar --aplicar sobre el flujo vivo de Rubén NO necesita confirmación (es seguro)', () => {
    const r = correr(['--apagar', '--aplicar'], vivoRuben);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/NEGADO/);
    expect(leer(log)).toMatch(/deactivate/);
  });
  it('--encender --aplicar sobre un flujo de otro cliente no pide confirmación de Rubén', () => {
    const r = correr(['--encender', '--aplicar'], vivoOtro);
    expect(r.status, r.stderr).toBe(0);
  });
  it('el archivo de origen se reconoce sin distinguir mayúsculas', () => {
    const mayus = join(dir, 'RROCA-Ruben-x.json');
    writeFileSync(mayus, JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    const r = correr(['--flujo', mayus, '--aplicar'], vivoOtro);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/archivo de origen/);
  });
  // Otro flujo del tenant (p. ej. el de rescate del PR-4): no lleva «Config base» con plantillas, así que NO pasa por `--publicable`; solo exige la confirmación.
  const rescate = join(dir, 'rroca-ruben-rescate.json');
  writeFileSync(rescate, JSON.stringify({ name: 'NovuChat — Rescate de pagos (rroca-ruben)', nodes: [] }));
  it('otro flujo del tenant exige SOLO la confirmación: sin ella se niega, con ella no corre la guardia estricta', () => {
    const sin = correr(['--flujo', rescate, '--aplicar'], vivoOtro);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-ruben/);
    expect(sin.stdout + sin.stderr).not.toMatch(/marcador sin sustituir|NO se puede publicar todavía|guardia de publicación/);
    expect(escribio()).toBe(false);
    const con = correr(['--flujo', rescate, '--aplicar', '--confirmo-ruben'], vivoOtro);
    expect(con.stdout + con.stderr).not.toMatch(/NEGADO|NO se puede publicar todavía/);
  });
  it('el flujo CONVERSACIONAL sigue bloqueado por la guardia aunque lleve --confirmo-ruben', () => {
    const r = correr(['--flujo', join(RROCA, 'rroca-ruben.json'), '--aplicar', '--confirmo-ruben'], vivoOtro);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Rubén no se publica/);
  });
  it('un flujo vivo de rescate (no conversacional) como destino exige la confirmación pero no la guardia estricta', () => {
    const vivoRescate = join(dir, 'vivo-rescate.json');
    writeFileSync(vivoRescate, JSON.stringify({ name: 'NovuChat — Rescate de pagos (rroca-ruben)', active: false, nodes: [] }));
    const sin = correr(['--flujo', otroArchivo, '--forzar', '--aplicar'], vivoRescate);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-ruben/);
    expect(sin.stdout + sin.stderr).not.toMatch(/NO se puede publicar todavía/);
  });
  it('con --crear el flujo vivo es la REFERENCIA de credenciales, no el destino: no se evalúa como destino (sin --crear sí)', () => {
    const conCrear = correr(['--flujo', otroArchivo, '--crear', '--forzar'], vivoRuben);
    expect(conCrear.stdout + conCrear.stderr).not.toMatch(/flujo vivo de destino|Flujo de Rubén/);
    const sinCrear = correr(['--flujo', otroArchivo, '--forzar'], vivoRuben);
    expect(sinCrear.stdout + sinCrear.stderr).toMatch(/flujo vivo de destino/);
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

describe('guardia de apertura (20/10/2026): abrir al PÚBLICO exige audio, imagen y documento; la publicación de PRUEBA con lista restringida sí se permite', () => {
  const TRES = 'audio,imagen,documento';
  const conBase = (cambios: Record<string, unknown>, quitar: string[] = []): Flujo => {
    const f = publicable(PRODUCCION);
    for (const q of quitar) { const lista = asignaciones(f); lista.splice(lista.findIndex((a) => a.name === q), 1); }
    for (const [k, v] of Object.entries(cambios)) {
      const a = asignaciones(f).find((x) => x.name === k);
      if (a) a.value = v; else asignaciones(f).push({ name: k, value: v } as Asignacion);
    }
    return f;
  };
  const datosCon = (cambios: Record<string, unknown>): { configBase: Record<string, unknown> } => { const d = datosAprobados(); Object.assign(d.configBase, cambios); return d; };
  const apertura = (h: string[]): string[] => h.filter((x) => /abrir al PÚBLICO/.test(x));

  const SOLO_COMPROBANTES = 'imagen_comprobante,pdf_comprobante';
  it('los medios que se exigen son exactamente audio, imagen y documento; los datos y el flujo los declaran (más los dos comprobantes)', () => {
    expect(MEDIOS_PARA_ABRIR).toEqual(['audio', 'imagen', 'documento']);
    for (const declarados of [String(DATOS_VERSIONADOS.configBase['mediosHabilitados']), String(asignaciones(PRODUCCION).find((a) => a.name === 'mediosHabilitados')!.value), String(asignaciones(PRUEBA).find((a) => a.name === 'mediosHabilitados')!.value)]) {
      const lista = declarados.split(',');
      for (const m of [...MEDIOS_PARA_ABRIR, 'imagen_comprobante', 'pdf_comprobante']) expect(lista, m).toContain(m);
    }
  });

  // EQUIVALENTE DE `capacidades-comunes` PARA RUBÉN: declarar los tres medios no basta; el flujo tiene que TENERLOS (nodos conectados, tope en los datos, textos fijos y documento).
  it('el flujo TIENE los tres medios: audio (transcribe y prepara), imagen (la mira) y documento (texto fijo sin descargar), en producción y en la prueba', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const nombres = f.nodes.map((n) => n.name);
      for (const n of ['¿Es audio?', 'Transcribir audio', 'Preparar transcripción', '¿Es comprobante?', 'Ver imagen']) expect(nombres, n).toContain(n);
      const destinos = (de: string, i = 0): string[] => (((f.connections as unknown as Record<string, { main: Array<Array<{ node: string }>> }>)[de]?.main ?? [])[i] ?? []).map((x) => x.node);
      expect(destinos('¿Es audio?', 0)).toEqual(['Transcribir audio']);
      expect(destinos('Transcribir audio')).toEqual(['Preparar transcripción']);
      expect(destinos('Preparar transcripción')).toEqual(['Decidir turno']);
      expect(destinos('¿Es comprobante?', 1)).toEqual(['Ver imagen']);
      const decidir = String((f.nodes.find((n) => n.name === 'Decidir turno')!.parameters as { jsCode: string }).jsCode);
      expect(decidir).toMatch(/t\.tipo === 'document'/);
      expect(decidir).toMatch(/rrAudioDelTurno/);
      expect(decidir).toMatch(/rrLecturaImagen/);
    }
  });

  it('el flujo vivo (publicado en prueba, con lista de teléfonos) SIGUE siendo publicable en prueba y la salida lo declara', () => {
    const f = publicable(PRODUCCION);
    expect(hallazgos(f)).toEqual([]);
    expect(modoDePublicacion({ flujo: f, datos: datosAprobados() })).toBe('prueba');
    const ruta = join(mkdtempSync(join(tmpdir(), 'rroca-apertura-')), 'vivo.json');
    writeFileSync(ruta, JSON.stringify(f));
    const r = spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--publicable', '--flujo', ruta], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Publicación de PRUEBA con lista restringida/);
    expect(r.stdout).toMatch(/NO se abre al público/);
    rmSync(dirname(ruta), { recursive: true, force: true });
  });

  it('NEGANDO: lista de teléfonos vacía, ausente o SIN NINGÚN DÍGITO («,», « , ; ») = abrir al público: se rechaza mientras no estén los tres medios', () => {
    for (const f of [conBase({ telefonosDePrueba: '', mediosHabilitados: SOLO_COMPROBANTES }), conBase({ telefonosDePrueba: '   ', mediosHabilitados: SOLO_COMPROBANTES }), conBase({ mediosHabilitados: SOLO_COMPROBANTES }, ['telefonosDePrueba']),
      conBase({ telefonosDePrueba: ',', mediosHabilitados: SOLO_COMPROBANTES }), conBase({ telefonosDePrueba: ' , ; ', mediosHabilitados: SOLO_COMPROBANTES })]) {
      expect(apertura(hallazgos(f)).length).toBe(1);
      expect(apertura(hallazgos(f))[0]).toMatch(/faltan: audio, imagen, documento/);
      expect(modoDePublicacion({ flujo: f, datos: datosAprobados() })).toBe('publico');
    }
    const ruta = join(mkdtempSync(join(tmpdir(), 'rroca-apertura-')), 'abierto.json');
    writeFileSync(ruta, JSON.stringify(conBase({ telefonosDePrueba: ',', mediosHabilitados: SOLO_COMPROBANTES })));
    const r = spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--publicable', '--flujo', ruta], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/abrir al PÚBLICO exige los tres medios/);
    rmSync(dirname(ruta), { recursive: true, force: true });
  });

  it('NEGANDO: `modoApertura` distinto de «prueba» (público, abierto, cualquier otro valor) se trata como apertura al público aunque haya lista', () => {
    for (const modo of ['publico', 'abierto', 'PUBLICO', 'x']) expect(apertura(hallazgos(conBase({ modoApertura: modo, mediosHabilitados: SOLO_COMPROBANTES }))).length, modo).toBe(1);
    expect(apertura(hallazgos(conBase({ modoApertura: 'prueba', mediosHabilitados: SOLO_COMPROBANTES })))).toEqual([]);
  });

  it('NEGANDO: abrir con CADA medio faltante se rechaza y nombra el que falta; los comprobantes (imagen_comprobante, pdf_comprobante) no cuentan como medios', () => {
    for (const medio of MEDIOS_PARA_ABRIR as string[]) {
      const otros = (MEDIOS_PARA_ABRIR as string[]).filter((x) => x !== medio).join(',');
      const h = apertura(hallazgos(conBase({ telefonosDePrueba: '', mediosHabilitados: otros })));
      expect(h.length, medio).toBe(1);
      expect(h[0]).toContain(`faltan: ${medio}`);
    }
    expect(apertura(hallazgos(conBase({ telefonosDePrueba: '', mediosHabilitados: 'imagen_comprobante,pdf_comprobante' }))).length).toBe(1);
    expect(apertura(hallazgos(conBase({ telefonosDePrueba: '' }, ['mediosHabilitados']))).length).toBe(1);
  });

  it('con solo DOS de los tres medios (cualquier par) abrir al público se rechaza, aunque el tercero sea un comprobante', () => {
    for (const par of ['audio,imagen', 'audio,documento', 'imagen,documento', 'audio,imagen_comprobante,documento_comprobante']) {
      expect(apertura(hallazgos(conBase({ telefonosDePrueba: ',', mediosHabilitados: par }))).length, par).toBe(1);
    }
  });

  it('con los tres medios habilitados la apertura al público no la frena esta guardia (y la salida lo declara)', () => {
    const f = conBase({ telefonosDePrueba: '', mediosHabilitados: TRES });
    expect(apertura(hallazgos(f, datosCon({ mediosHabilitados: TRES, modoApertura: 'publico' })))).toEqual([]);
    expect(hallazgos(f, datosCon({ mediosHabilitados: TRES, modoApertura: 'publico' }))).toEqual([]);
  });

  it('los datos también cuentan: datos que abren al público sin los tres medios niegan aunque el flujo tenga lista', () => {
    const h = apertura(hallazgos(publicable(PRODUCCION), datosCon({ modoApertura: 'publico', mediosHabilitados: SOLO_COMPROBANTES })));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatch(/^datos:/);
  });

  it('`mediosHabilitados` y `modoApertura` tienen forma validada en los datos', () => {
    const ruta = join(mkdtempSync(join(tmpdir(), 'rroca-apertura-')), 'datos.json');
    for (const [campo, valor] of [['mediosHabilitados', 'Audio, Imagen'], ['modoApertura', 'abierto']] as const) {
      const d = JSON.parse(leer(ARCHIVO_DE_DATOS)) as { configBase: Record<string, unknown> };
      d.configBase[campo] = valor;
      writeFileSync(ruta, JSON.stringify(d));
      expect(() => cargarDatos(ruta), campo).toThrow(new RegExp(`configBase\\.${campo}: forma no válida`));
    }
    rmSync(dirname(ruta), { recursive: true, force: true });
  });
});
