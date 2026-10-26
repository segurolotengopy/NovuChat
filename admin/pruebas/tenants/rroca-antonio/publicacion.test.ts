/**
 * «EL PUENTE DE ANTONIO» (tenant rroca-antonio) — PR-C, LA GUARDIA DE PUBLICACIÓN.
 *
 * El flujo NO se publica ni se importa a n8n con marcadores `REEMPLAZAR_*`, con plantillas de aviso que Meta no aprobó, ni con el catálogo del negocio
 * sin cargar. Esta suite NIEGA: hoy `--publicable` sale 1 sobre lo versionado. También prueba `publicar-flujo.sh`: se niega con --aplicar/--crear/--encender si la guardia falla, pide la
 * confirmación explícita (PUBLICAR ANTONIO, o --confirmo-antonio sin terminal), `--forzar` no la salta, `--apagar` no la pide y nada cambia para los demás flujos (ni para el de Rubén).
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
import { AQUI, ARCHIVO_DE_DATOS, ARCHIVO_DE_NEGOCIO, CLAVES_DE_PLANTILLA, IDS_DEL_CATALOGO, ARISTAS_DE_MEDIOS, NODOS_DE_MEDIOS, cargarDatos, guardiaDePublicacion } from '../../../../Flujos/experimental/rroca-antonio/construir.mjs';

const RA: string = AQUI;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const leer = (r: string): string => readFileSync(r, 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Datos = { configBase: Record<string, unknown> };
const DATOS = JSON.parse(leer(ARCHIVO_DE_DATOS)) as Datos;
const NEGOCIO = JSON.parse(leer(ARCHIVO_DE_NEGOCIO)) as Record<string, unknown>;
const PRODUCCION = JSON.parse(leer(join(RA, 'rroca-antonio.json'))) as Flujo;
const PRUEBA = JSON.parse(leer(join(RA, 'rroca-antonio.prueba.json'))) as Flujo;
const MARCADORES = /REEMPLAZAR_[A-Z0-9][A-Z0-9_]*/g;

type Asignacion = { name: string; value: unknown };
const asignaciones = (f: Flujo): Asignacion[] => (f.nodes.find((n) => n.name === 'Config base')!.parameters as { assignments: { assignments: Asignacion[] } }).assignments.assignments;
const fijar = (f: Flujo, nombre: string, valor: unknown): void => { asignaciones(f).find((a) => a.name === nombre)!.value = valor; };

/** El flujo tal como quedaría con todos los marcadores sustituidos y las plantillas aprobadas. */
function publicable(base: Flujo = PRODUCCION): Flujo {
  const f = JSON.parse(JSON.stringify(base).replace(MARCADORES, 'valorsustituido')) as Flujo;
  for (const { estado } of CLAVES_DE_PLANTILLA as Array<{ estado: string }>) fijar(f, estado, 'APPROVED');
  return f;
}
function datosListos(): Datos {
  const d = copia(DATOS);
  d.configBase['avisoComprobanteEstado'] = 'APPROVED';
  d.configBase['avisoConsultaEstado'] = 'APPROVED';
  return d;
}
function negocioListo(): Record<string, unknown> { return JSON.parse(JSON.stringify(NEGOCIO).replace(MARCADORES, 'dato-real')) as Record<string, unknown>; }
const hallazgos = (flujo: Flujo, datos: Datos = datosListos(), negocio: Record<string, unknown> = negocioListo()): string[] => guardiaDePublicacion({ flujo, datos, negocio }) as string[];

describe('guardia de publicación de Antonio: la ruta feliz y lo versionado de hoy', () => {
  it('con todo sustituido, las plantillas APPROVED y el catálogo, no hay hallazgos (producción y prueba)', () => {
    expect(hallazgos(publicable(PRODUCCION))).toEqual([]);
    expect(hallazgos(publicable(PRUEBA))).toEqual([]);
  });
  it('lo versionado de hoy NO es publicable: marcadores y negocio sin datos (las plantillas ya están APPROVED y no hay línea de protección)', () => {
    const h = guardiaDePublicacion({ flujo: PRODUCCION, datos: DATOS, negocio: NEGOCIO }) as string[];
    expect(h.some((x) => /marcador sin sustituir/.test(x))).toBe(true);
    expect(h.join('|')).not.toMatch(/avisoComprobanteEstado|avisoConsultaEstado|lineaProteccion/);
    expect(h.join('|')).not.toMatch(/negocio: marcador/);
  });
  it('los literales de comentario y de expresión regular de los módulos copiados NO cuentan como marcador (pero un marcador real, sí)', () => {
    const f = publicable(PRODUCCION);
    expect(JSON.stringify(PRODUCCION)).toMatch(/\^REEMPLAZAR_|reemplazar_\/i|`REEMPLAZAR_`/);
    expect(hallazgos(f)).toEqual([]);
  });
});

describe('guardia de publicación de Antonio: cada defecto se niega', () => {
  it('un marcador en cualquier parte del JSON completo (nodo, conexiones, ajustes, nivel superior), en cualquier grafía y con NFKC', () => {
    for (const grafia of ['REEMPLAZAR_X', 'reemplazar_x', 'Reemplazar_Mixto', 'ＲＥＥＭＰＬＡＺＡＲ_ancho', 'REEMPLAZAR_-X']) {
      for (const donde of ['nodo', 'ajustes', 'superior', 'conexiones']) {
        const f = publicable(PRODUCCION) as unknown as Record<string, any>;
        if (donde === 'nodo') f['nodes'][0]['notes'] = grafia;
        if (donde === 'ajustes') f['settings']['x'] = grafia;
        if (donde === 'superior') f['pinData'] = { a: grafia };
        if (donde === 'conexiones') f['connections']['zzz'] = { main: [[{ node: grafia }]] };
        expect(hallazgos(f as unknown as Flujo).some((x) => /marcador sin sustituir/.test(x)), `${grafia} ${donde}`).toBe(true);
      }
    }
  });
  for (const { estado, nombre } of CLAVES_DE_PLANTILLA as Array<{ estado: string; nombre: string }>) {
    for (const mala of ['PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', '', 'approved']) {
      it(`${estado} = «${mala}» se niega, en «Config base» y en los datos`, () => {
        const f = publicable(PRODUCCION); fijar(f, estado, mala);
        expect(hallazgos(f).join('|')).toContain(`Config base: ${estado}`);
        const d = datosListos(); d.configBase[estado] = mala;
        expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain(`datos: ${estado}`);
      });
    }
    it(`${nombre} vacío, ausente o con marcador se niega`, () => {
      for (const v of ['', '   ', 'REEMPLAZAR_NOMBRE']) {
        const d = datosListos(); d.configBase[nombre] = v;
        expect(hallazgos(publicable(PRODUCCION), d).join('|'), v).toContain(`falta el nombre de la plantilla (${nombre})`);
      }
      const d = datosListos(); delete d.configBase[nombre];
      expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain(nombre);
    });
  }
  it('el idioma de las plantillas vacío o ausente se niega', () => {
    for (const v of ['', ' ']) { const d = datosListos(); d.configBase['avisoPlantillaIdioma'] = v; expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain('avisoPlantillaIdioma'); }
    const d = datosListos(); delete d.configBase['avisoPlantillaIdioma'];
    expect(hallazgos(publicable(PRODUCCION), d).join('|')).toContain('avisoPlantillaIdioma');
  });
  it('un flujo sin nodos o sin «Config base» se niega', () => {
    expect(hallazgos({ nodes: [] } as unknown as Flujo).join('|')).toMatch(/no trae nodos/);
    const f = publicable(PRODUCCION); f.nodes = f.nodes.filter((n) => n.name !== 'Config base');
    expect(hallazgos(f).join('|')).toMatch(/no trae «Config base»/);
  });
  it('el catálogo sin cargar, sin un id, inactivo o sin precio válido, y un marcador en el negocio se niegan', () => {
    expect(hallazgos(publicable(PRODUCCION), datosListos(), {}).join('|')).toMatch(/catálogo no está cargado/);
    for (const id of IDS_DEL_CATALOGO as string[]) {
      const n = negocioListo() as { catalogo: Array<{ nombre: string; activo: boolean; precio: unknown }> };
      const idDe = (x: string): string => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      n.catalogo = n.catalogo.filter((it) => idDe(it.nombre) !== id);
      expect(hallazgos(publicable(PRODUCCION), datosListos(), n as unknown as Record<string, unknown>).join('|'), id).toContain(`falta el producto con id «${id}»`);
    }
    const a = negocioListo() as { catalogo: Array<{ activo: boolean; precio: unknown }> };
    a.catalogo[0]!.activo = false;
    expect(hallazgos(publicable(PRODUCCION), datosListos(), a as unknown as Record<string, unknown>).join('|')).toMatch(/no está activo/);
    const b = negocioListo() as { catalogo: Array<{ activo: boolean; precio: unknown }> };
    b.catalogo[1]!.precio = 0;
    expect(hallazgos(publicable(PRODUCCION), datosListos(), b as unknown as Record<string, unknown>).join('|')).toMatch(/precio válido/);
    const c = negocioListo() as { _pendiente: Record<string, string> };
    c._pendiente['razonComercial'] = 'REEMPLAZAR_RAZON';
    expect(hallazgos(publicable(PRODUCCION), datosListos(), c as unknown as Record<string, unknown>).join('|')).toMatch(/negocio: marcador sin sustituir: REEMPLAZAR_RAZON/);
  });
  it('el `numeroRecepcionMarcador` del negocio es el único marcador tolerado (lo resuelve la tabla local)', () => {
    const n = JSON.parse(JSON.stringify(NEGOCIO).replace(/REEMPLAZAR_(RAZON|HORARIO)[A-Z_]*/g, 'dato-real')) as Record<string, unknown>;
    expect(hallazgos(publicable(PRODUCCION), datosListos(), n)).toEqual([]);
  });
});

describe('construir.mjs --publicable: la línea de comandos', () => {
  const correr = (...args: string[]) => spawnSync(process.execPath, [join(RA, 'construir.mjs'), '--publicable', ...args], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
  const dir = mkdtempSync(join(tmpdir(), 'rroca-ant-pub-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('HOY sobre lo versionado sale en 1 y nombra marcadores y el negocio sin datos, sin imprimir valores', () => {
    const r = correr();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stderr).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
    expect(r.stderr).not.toMatch(/lineaProteccion/);
    expect(r.stderr).not.toMatch(/\d{9,}/);
  });
  it('ruta feliz: flujo, datos y negocio listos salen en 0', () => {
    const f = join(dir, 'f.json'); const d = join(dir, 'd.json'); const n = join(dir, 'n.json');
    writeFileSync(f, JSON.stringify(publicable(PRODUCCION)));
    writeFileSync(d, JSON.stringify({ ...JSON.parse(leer(ARCHIVO_DE_DATOS)), configBase: datosListos().configBase }));
    writeFileSync(n, JSON.stringify(negocioListo()));
    const r = correr('--flujo', f, '--datos', d, '--negocio', n);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/se puede publicar/);
  });
  it('un JSON inválido no filtra su contenido; un archivo ausente o un argumento sobrante salen en error', () => {
    const ruta = join(dir, 'roto.json');
    writeFileSync(ruta, '{"token": "CONTENIDO-SECRETO-123" ,,, }');
    const r = correr('--flujo', ruta);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).not.toMatch(/SECRETO|token|Unexpected/);
    expect(correr('--flujo', join(dir, 'no-existe.json')).status).toBe(1);
    expect(correr('--flujo').status).toBe(2);
    expect(correr('sobrante').status).toBe(2);
    expect(spawnSync(process.execPath, [join(RA, 'construir.mjs'), '--publicable', '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) }).status).toBe(2);
  });
  it('el armado no cambia: --verificar sigue en 0', () => {
    expect(spawnSync(process.execPath, [join(RA, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) }).status).toBe(0);
  });
  it('los datos versionados se cargan (la guardia no toca el formato)', () => {
    expect(() => cargarDatos()).not.toThrow();
  });
});

describe('publicar-flujo.sh: la guardia y la confirmación del flujo de Antonio', () => {
  const SCRIPT = join(REPO, 'scripts/publicar-flujo.sh');
  const dir = mkdtempSync(join(tmpdir(), 'rroca-ant-sh-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const ANTONIO = join(RA, 'rroca-antonio.json');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "$*" >> "$LOG_CURL"\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) O="$2"; shift 2;; -X) M="$2"; shift 2;; *) shift;; esac; done\n'
    + '[[ -n "$O" ]] && cp "$VIVO_SIMULADO" "$O"\nprintf 200\n');
  chmodSync(join(bin, 'curl'), 0o755);
  const envRel = join(dir, 'env');
  writeFileSync(envRel, 'N8N_API_KEY=clave-de-juguete\nN8N_WORKFLOW_ID=1\nN8N_BASE_URL=http://n8n.invalido\n');
  const vivoAntonio = join(dir, 'vivo-antonio.json');
  writeFileSync(vivoAntonio, JSON.stringify({ name: 'NovuChat — El Puente de Antonio (rroca-antonio)', active: false, nodes: [] }));
  const vivoOtro = join(dir, 'vivo-otro.json');
  writeFileSync(vivoOtro, JSON.stringify({ name: 'Otro cliente', active: false, nodes: [] }));
  const otroArchivo = join(dir, 'cualquier-cosa.json');
  writeFileSync(otroArchivo, JSON.stringify({ name: 'Otro cliente', nodes: [{ name: 'X', type: 'n8n-nodes-base.set', parameters: {} }] }));
  const log = join(dir, 'curl.log');
  const correrEn = (raiz: string, args: string[], vivo: string) => {
    writeFileSync(log, '');
    return spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), ...args, '--env', relative(raiz, envRel)], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivo, LOG_CURL: log }),
    });
  };
  const correr = (args: string[], vivo = vivoOtro) => correrEn(REPO, args, vivo);
  const escribio = (): boolean => /POST|PUT|PATCH|activate/.test(leer(log));
  // Una copia del script con una guardia de juguete (sale con el código dado): se llega a la confirmación sin depender de que el JSON real esté listo.
  function raizConGuardia(codigoSalida: number): string {
    const raiz = join(dir, `raiz-${codigoSalida}`);
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos/experimental/rroca-antonio'), { recursive: true });
    copyFileSync(SCRIPT, join(raiz, 'scripts/publicar-flujo.sh'));
    writeFileSync(join(raiz, 'Flujos/experimental/rroca-antonio/construir.mjs'), `process.exit(${codigoSalida});\n`);
    writeFileSync(join(raiz, 'Flujos/experimental/rroca-antonio/rroca-antonio.json'), JSON.stringify({ name: 'rroca-antonio', nodes: [] }));
    writeFileSync(join(raiz, 'Flujos/demo-a-agendamiento.json'), JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
    return raiz;
  }
  const REL = 'Flujos/experimental/rroca-antonio/rroca-antonio.json';

  it('con --aplicar y el JSON versionado (marcadores) se NIEGA antes de leer el .env o hablar con n8n', () => {
    const r = correr(['--flujo', ANTONIO, '--aplicar']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Antonio no se publica/);
    expect(r.stderr).not.toMatch(/Falta /);
  });
  it('otro nombre de archivo (copia .local, nombre cualquiera con el nombre del flujo) también se NIEGA', () => {
    const local = join(dir, 'rroca-antonio.local.json');
    const f = publicable(PRODUCCION); (f.nodes[0] as unknown as { notes: string }).notes = 'REEMPLAZAR_SIN_VALOR';
    writeFileSync(local, JSON.stringify(f));
    expect(correr(['--flujo', local, '--aplicar']).status).toBe(1);
    const otro = join(dir, 'x.json');
    writeFileSync(otro, JSON.stringify({ name: 'NovuChat — El Puente de Antonio (rroca-antonio)', nodes: [] }));
    const r = correr(['--flujo', otro, '--aplicar']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    const mayus = join(dir, 'RROCA-Antonio-x.json');
    writeFileSync(mayus, JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    expect(correr(['--flujo', mayus, '--aplicar']).stdout).toMatch(/archivo de origen/);
  });
  it('en seco informa lo que falta y SIGUE', () => {
    const r = correr(['--flujo', ANTONIO]);
    expect(r.stdout + r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stdout).toMatch(/en seco se sigue/);
    expect(r.stdout + r.stderr).not.toMatch(/NEGADO/);
  });
  it('un flujo de otro cliente NO pasa por la guardia de Antonio', () => {
    const r = correr(['--flujo', join(REPO, 'Flujos/demo-a-agendamiento.json'), '--aplicar']);
    expect(r.stdout + r.stderr).not.toMatch(/Antonio|guardia de publicación|NEGADO: sin terminal/);
  });
  it('--forzar NO salta la guardia ni la confirmación', () => {
    const r = correr(['--flujo', ANTONIO, '--forzar', '--aplicar', '--confirmo-antonio']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Antonio no se publica/);
    const v = correr(['--flujo', otroArchivo, '--forzar', '--aplicar', '--confirmo-antonio'], vivoAntonio);
    expect(v.status).toBe(1);
    expect(v.stdout + v.stderr).toMatch(/flujo vivo de destino/);
    expect(escribio()).toBe(false);
  });
  it('NEGANDO: --forzar con un archivo de clase «confirmar» (rroca-antonio-rescate.json) contra el flujo VIVO de Antonio vuelve a correr la guardia estricta: sale 1 y no escribe', () => {
    const raiz = raizConGuardia(1);
    writeFileSync(join(raiz, 'Flujos/experimental/rroca-antonio/rroca-antonio-rescate.json'), JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    const r = correrEn(raiz, ['--flujo', 'Flujos/experimental/rroca-antonio/rroca-antonio-rescate.json', '--forzar', '--aplicar', '--confirmo-antonio'], vivoAntonio);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/flujo vivo de destino/);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(escribio()).toBe(false);
  });
  it('con la guardia en verde y sin terminal, --aplicar SIN --confirmo-antonio se NIEGA; con él sigue al .env', () => {
    const raiz = raizConGuardia(0);
    const sin = correrEn(raiz, ['--flujo', REL, '--aplicar'], vivoOtro);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-antonio/);
    const con = correrEn(raiz, ['--flujo', REL, '--aplicar', '--confirmo-antonio'], vivoOtro);
    expect(con.stderr).not.toMatch(/NEGADO/);
  });
  it('--crear: la guardia del archivo de origen rige (se niega sin confirmación y con la guardia en rojo)', () => {
    const verde = raizConGuardia(0);
    const sin = correrEn(verde, ['--flujo', REL, '--crear', '--aplicar'], vivoOtro);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-antonio/);
    const rojo = raizConGuardia(1);
    const r = correrEn(rojo, ['--flujo', REL, '--crear', '--aplicar', '--confirmo-antonio'], vivoOtro);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Antonio no se publica/);
    expect(escribio()).toBe(false);
  });
  it('--encender --aplicar sobre el flujo vivo de Antonio: sin confirmación se niega; con la guardia en rojo se niega aunque lleve --confirmo-antonio; con todo en verde activa', () => {
    const sin = correrEn(raizConGuardia(0), ['--encender', '--aplicar'], vivoAntonio);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-antonio/);
    expect(escribio()).toBe(false);
    const rojo = correrEn(raizConGuardia(1), ['--encender', '--aplicar', '--confirmo-antonio'], vivoAntonio);
    expect(rojo.status).toBe(1);
    expect(rojo.stdout + rojo.stderr).toMatch(/encender el flujo vivo/);
    expect(escribio()).toBe(false);
    const verde = correrEn(raizConGuardia(0), ['--encender', '--aplicar', '--confirmo-antonio'], vivoAntonio);
    expect(verde.status, verde.stderr).toBe(0);
    expect(escribio()).toBe(true);
  });
  it('--encender con el construir.mjs REAL sobre el vivo (sin marcadores ni plantillas) se NIEGA aunque lleve --confirmo-antonio', () => {
    const r = correr(['--encender', '--aplicar', '--confirmo-antonio'], vivoAntonio);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(escribio()).toBe(false);
  });
  it('--encender en seco no pide confirmación; --apagar --aplicar tampoco', () => {
    expect(correr(['--encender'], vivoAntonio).status).toBe(0);
    expect(escribio()).toBe(false);
    const r = correr(['--apagar', '--aplicar'], vivoAntonio);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/NEGADO/);
    expect(leer(log)).toMatch(/deactivate/);
  });
  it('un flujo vivo de otro cliente no activa nada de Antonio (ni de Rubén)', () => {
    const r = correr(['--encender', '--aplicar'], vivoOtro);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/Antonio|Rubén/);
  });
  it('otro flujo del tenant (no conversacional) exige SOLO la confirmación', () => {
    const rescate = join(dir, 'rroca-antonio-rescate.json');
    writeFileSync(rescate, JSON.stringify({ name: 'NovuChat — Rescate de pagos (rroca-antonio)', nodes: [] }));
    const sin = correr(['--flujo', rescate, '--aplicar']);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-antonio/);
    expect(sin.stdout + sin.stderr).not.toMatch(/NO se puede publicar todavía/);
    expect(correr(['--flujo', rescate, '--aplicar', '--confirmo-antonio']).stdout + '').not.toMatch(/NO se puede publicar todavía/);
  });
  it('la confirmación de Rubén no vale para Antonio ni al revés', () => {
    const r = correr(['--flujo', ANTONIO, '--aplicar', '--confirmo-ruben']);
    expect(r.status).toBe(1);
    const raiz = raizConGuardia(0);
    const o = correrEn(raiz, ['--flujo', REL, '--aplicar', '--confirmo-ruben'], vivoOtro);
    expect(o.stderr).toMatch(/solo se publica con --confirmo-antonio/);
  });
});

describe('guardia de publicación: la rama de medios (nodos, aristas, módulos comunes y credenciales)', () => {
  const dirM = mkdtempSync(join(tmpdir(), 'rroca-ant-med-'));
  afterAll(() => rmSync(dirM, { recursive: true, force: true }));
  /** Corre `--publicable` con el flujo dado y datos y negocio listos: solo la rama de medios puede dar hallazgo. */
  const salida = (f: Flujo) => {
    const a = join(dirM, 'f.json'); const d = join(dirM, 'd.json'); const n = join(dirM, 'n.json');
    writeFileSync(a, JSON.stringify(f));
    writeFileSync(d, JSON.stringify({ ...JSON.parse(leer(ARCHIVO_DE_DATOS)), configBase: datosListos().configBase }));
    writeFileSync(n, JSON.stringify(negocioListo()));
    return spawnSync(process.execPath, [join(RA, 'construir.mjs'), '--publicable', '--flujo', a, '--datos', d, '--negocio', n], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
  };
  it('el flujo completo no da hallazgos de medios', () => {
    expect((hallazgos(publicable(PRODUCCION)) as string[]).filter((x) => x.startsWith('medios:'))).toEqual([]);
    expect(salida(publicable(PRODUCCION)).status).toBe(0);
  });
  it('NEGANDO: quitar cada nodo de medios da un hallazgo que lo nombra y --publicable sale 1', () => {
    for (const nombre of NODOS_DE_MEDIOS as string[]) {
      const f = publicable(PRODUCCION); f.nodes = f.nodes.filter((n) => n.name !== nombre);
      expect(hallazgos(f).join('|'), nombre).toContain(`medios: falta el nodo «${nombre}»`);
      const r = salida(f); expect(r.status, nombre).toBe(1); expect(r.stderr).toContain(nombre);
    }
  });
  it('NEGANDO: cortar cada arista da un hallazgo que nombra el nodo y --publicable sale 1', () => {
    for (const [de, a] of ARISTAS_DE_MEDIOS as Array<[string, string]>) {
      const f = publicable(PRODUCCION) as unknown as { connections: Record<string, { main: Array<Array<{ node: string }>> }> };
      f.connections[de]!.main = f.connections[de]!.main.map((s) => s.filter((x) => x.node !== a));
      expect(hallazgos(f as unknown as Flujo).join('|'), `${de}→${a}`).toContain(`medios: «${de}» no está conectado a «${a}»`);
      const r = salida(f as unknown as Flujo); expect(r.status, `${de}→${a}`).toBe(1); expect(r.stderr).toContain(de);
    }
  });
  it('NEGANDO: alterar un byte de un módulo común o quitar la credencial de Gemini da hallazgo y --publicable sale 1', () => {
    for (const nombre of ['Preparar transcripción', 'Preparar imagen', 'Medio no aceptado']) {
      const f = publicable(PRODUCCION); const n = f.nodes.find((x) => x.name === nombre)!;
      n.parameters['jsCode'] = String(n.parameters['jsCode']).replace('const', 'cons7');
      expect(hallazgos(f).join('|'), nombre).toContain(`medios: el código de «${nombre}» no es el del módulo común`);
      expect(salida(f).status, nombre).toBe(1);
    }
    for (const nombre of ['Transcribir audio', 'Describir documento', 'Describir imagen']) {
      const f = publicable(PRODUCCION); delete (f.nodes.find((x) => x.name === nombre) as unknown as { credentials?: unknown }).credentials;
      expect(hallazgos(f).join('|'), nombre).toContain(`medios: «${nombre}» no lleva credencial de Gemini`);
      expect(salida(f).status, nombre).toBe(1);
    }
  });
});
