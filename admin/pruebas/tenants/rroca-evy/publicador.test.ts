/**
 * EL PUBLICADOR (`scripts/publicar-flujo.sh`) y el flujo NUEVO de Evy. El flujo nuevo conserva el nombre y el id vivo del viejo (el de las doctoras): se distingue por su CONTENIDO (el nodo «Armar previos»), no
 * por el nombre. Con --aplicar se NIEGA si `rroca-evy/construir.mjs --publicable` no lo aprueba (etapa prueba con --etapa-prueba, completa sin ella, crear con --crear), y pide PUBLICAR EVY (o --confirmo-evy).
 * El cambio es ADITIVO: contra el script de origin/main, el flujo viejo de Evy, el de Emma y cualquier otro se comportan igual (salida, error, código y llamadas a n8n). Curl de juguete: nunca sale a la red.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const NOMBRE = 'NovuChat — Dra. Evy Karina (rroca-evy)';
const dir = mkdtempSync(join(tmpdir(), 'evy-publicador-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const bin = join(dir, 'bin'); mkdirSync(bin);
writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "$*" >> "$LOG_CURL"\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) O="$2"; shift 2;; *) shift;; esac; done\n[[ -n "$O" ]] && cp "$VIVO_SIMULADO" "$O"\nprintf 200\n');
chmodSync(join(bin, 'curl'), 0o755);
const envRel = join(dir, 'env');
writeFileSync(envRel, 'N8N_API_KEY=clave-de-juguete\nN8N_WORKFLOW_ID=1\nN8N_BASE_URL=http://n8n.invalido\n');
const nuevo = { name: NOMBRE, nodes: [{ name: 'Armar previos' }, { name: 'Config base' }] };
const viejo = { name: NOMBRE, active: false, nodes: [{ name: 'Armar avisos' }] };
const vivoNuevo = join(dir, 'vivo-nuevo.json'); writeFileSync(vivoNuevo, JSON.stringify({ ...nuevo, active: false }));
const vivoViejo = join(dir, 'vivo-viejo.json'); writeFileSync(vivoViejo, JSON.stringify(viejo));
const vivoOtro = join(dir, 'vivo-otro.json'); writeFileSync(vivoOtro, JSON.stringify({ name: 'Otro cliente', active: false, nodes: [] }));
const REL_NUEVO = 'Flujos/experimental/rroca-evy/rroca-evy.json';
const REL_VIEJO = 'Flujos/experimental/doctoras/doctoras.rroca-evy.json';
const REL_EMMA = 'Flujos/experimental/doctoras/doctoras.rroca-emma.json';
const REL_RENOMBRADO = 'Flujos/experimental/rroca-evy/flujo-renombrado.json';
const REL_COMO_EMMA = 'Flujos/experimental/rroca-evy/rroca-emma.json';

/** Una raíz de juguete: el script bajo prueba y construir.mjs de juguete (el del flujo nuevo aprueba SOLO la etapa indicada; el de las doctoras aprueba según `doctoras`). Cada uno deja su rastro. */
function raizCon(nombre: string, script: string, o: { evy?: string; doctoras?: number } = {}): string {
  const raiz = join(dir, nombre);
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  mkdirSync(join(raiz, 'Flujos/experimental/doctoras'), { recursive: true });
  mkdirSync(join(raiz, 'Flujos/experimental/rroca-evy'), { recursive: true });
  writeFileSync(join(raiz, 'scripts/publicar-flujo.sh'), script); chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
  writeFileSync(join(raiz, 'Flujos/experimental/doctoras/construir.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.LOG_GUARDIAS, 'doctoras ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(${o.doctoras ?? 0});\n`);
  writeFileSync(join(raiz, 'Flujos/experimental/rroca-evy/construir.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.LOG_GUARDIAS, 'evy ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(process.argv.join(' ').includes('--etapa ${o.evy ?? 'prueba'}') ? 0 : 1);\n`);
  writeFileSync(join(raiz, REL_NUEVO), JSON.stringify(nuevo));
  writeFileSync(join(raiz, REL_VIEJO), JSON.stringify({ name: 'doctoras', nodes: [] }));
  writeFileSync(join(raiz, REL_EMMA), JSON.stringify({ name: 'doctoras emma rroca-emma', nodes: [] }));
  writeFileSync(join(raiz, REL_RENOMBRADO), JSON.stringify({ name: 'Otro nombre cualquiera', nodes: [{ name: 'Armar previos' }] }));
  writeFileSync(join(raiz, REL_COMO_EMMA), JSON.stringify({ name: 'NovuChat — Dra. Emma (rroca-emma)', nodes: [{ name: 'Armar previos' }] }));
  return raiz;
}
const correrEn = (raiz: string, args: string[], vivo: string) => {
  const log = join(raiz, 'curl.log'); writeFileSync(log, '');
  const guardias = join(raiz, 'guardias.log'); writeFileSync(guardias, '');
  const r = spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), ...args, '--env', relative(raiz, envRel)], {
    cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivo, LOG_CURL: log, LOG_GUARDIAS: guardias }),
  });
  const sinRaiz = (t: string): string => t.split(raiz).join('<raiz>').replace(/\/tmp\/tmp\.[A-Za-z0-9]+/g, '<tmp>');
  return { status: r.status, stdout: sinRaiz(r.stdout), stderr: sinRaiz(r.stderr), curl: sinRaiz(readFileSync(log, 'utf8')), guardias: sinRaiz(readFileSync(guardias, 'utf8')) };
};
const propio = readFileSync(join(REPO, 'scripts/publicar-flujo.sh'), 'utf8');

describe('el flujo nuevo de Evy tiene su guardia, distinta de la de las doctoras', () => {
  const raiz = raizCon('nuevo', propio, { evy: 'prueba' });
  it('actualizar en su lugar con --etapa-prueba pide la etapa prueba de la guardia NUEVA y no toca la de las doctoras (aunque el flujo vivo sea el viejo)', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--etapa-prueba', '--aplicar', '--confirmo-evy'], vivoViejo);
    expect(r.stdout).toMatch(/Flujo nuevo de Evy \(rroca-evy\): se revisa la guardia de publicación \(archivo de origen; etapa prueba\)/);
    expect(r.guardias).toMatch(/^evy .*--etapa prueba/m);
    expect(r.guardias).not.toMatch(/doctoras/);
    expect(r.stderr).not.toMatch(/NEGADO/);
    expect(r.curl).toMatch(/workflows\/1/);
  });
  it('sin --etapa-prueba pide la completa y se NIEGA (código 1, sin escribir en n8n)', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--confirmo-evy'], vivoViejo);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/etapa encender/);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Evy/);
    expect(r.curl).not.toMatch(/-X (PUT|POST)/);
  });
  it('--forzar no salta la guardia', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--forzar', '--aplicar', '--confirmo-evy'], vivoViejo);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
  });
  it('en seco informa y sigue; sin terminal ni --confirmo-evy se NIEGA con --aplicar', () => {
    const seco = correrEn(raiz, ['--flujo', REL_NUEVO], vivoViejo);
    expect(seco.stdout).toMatch(/etapa encender/);
    expect(seco.stdout).toMatch(/en seco se sigue/);
    const sin = correrEn(raiz, ['--flujo', REL_NUEVO, '--etapa-prueba', '--aplicar'], vivoViejo);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-evy/);
  });
  it('--crear sin --activar usa la etapa crear; --crear --activar la completa', () => {
    const c = raizCon('crear', propio, { evy: 'crear' });
    expect(correrEn(c, ['--flujo', REL_NUEVO, '--crear', '--aplicar', '--confirmo-evy'], vivoViejo).stdout).toMatch(/etapa crear/);
    const a = correrEn(c, ['--flujo', REL_NUEVO, '--crear', '--activar', '--aplicar', '--confirmo-evy'], vivoViejo);
    expect(a.stdout).toMatch(/etapa encender/);
    expect(a.status).toBe(1);
  });
  it('--encender revisa el flujo VIVO: si es el nuevo, con la guardia nueva (--etapa-prueba la prueba); si es el viejo, con la de las doctoras', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--encender', '--etapa-prueba', '--aplicar', '--confirmo-evy'], vivoNuevo);
    expect(r.guardias).toMatch(/^evy .*--etapa prueba/m);
    expect(r.guardias).not.toMatch(/doctoras/);
    expect(r.stderr).not.toMatch(/NEGADO/);
    const completa = correrEn(raiz, ['--flujo', REL_NUEVO, '--encender', '--aplicar', '--confirmo-evy'], vivoNuevo);
    expect(completa.status).toBe(1);
    expect(completa.stdout).toMatch(/etapa encender/);
    const viejoVivo = correrEn(raiz, ['--flujo', REL_VIEJO, '--encender', '--etapa-prueba', '--aplicar', '--confirmo-doctoras'], vivoViejo);
    expect(viejoVivo.guardias).toMatch(/^doctoras .*--etapa prueba/m);
    expect(viejoVivo.guardias).not.toMatch(/^evy/m);
  });
  it('--etapa-prueba con --crear, --activar o --apagar se rechaza (2) y no habla con n8n', () => {
    for (const extra of [['--crear'], ['--apagar'], ['--activar']]) {
      const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--etapa-prueba', ...extra, '--aplicar', '--confirmo-evy'], vivoViejo);
      expect(r.status, extra.join(' ')).toBe(2);
      expect(r.curl).toBe('');
    }
  });
  it('restaurar el flujo VIEJO sobre el vivo nuevo pide la confirmación de Evy y deja pasar la guardia de las doctoras sin cambios', () => {
    const sin = correrEn(raiz, ['--flujo', REL_VIEJO, '--aplicar', '--confirmo-doctoras'], vivoNuevo);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/--confirmo-evy/);
    const con = correrEn(raiz, ['--flujo', REL_VIEJO, '--aplicar', '--confirmo-doctoras', '--confirmo-evy'], vivoNuevo);
    expect(con.stderr).not.toMatch(/NEGADO/);
    expect(con.guardias).toMatch(/^doctoras /m);
  });
  it('el flujo nuevo RENOMBRADO (sin «rroca-evy») no se escapa: se reconoce por el nodo y pasa por la guardia nueva en seco, con --aplicar y con --crear', () => {
    const mala = raizCon('renombrado', propio, { evy: 'ninguna' });
    const aplicar = correrEn(mala, ['--flujo', REL_RENOMBRADO, '--aplicar', '--confirmo-evy'], vivoViejo);
    expect(aplicar.status).toBe(1);
    expect(aplicar.stderr).toMatch(/NEGADO: el flujo de Evy/);
    expect(aplicar.curl).not.toMatch(/-X (PUT|POST)/);
    const crear = correrEn(mala, ['--flujo', REL_RENOMBRADO, '--crear', '--aplicar', '--confirmo-evy'], vivoViejo);
    expect(crear.status).toBe(1);
    expect(crear.guardias).toMatch(/^evy .*--etapa crear/m);
    const buena = raizCon('renombrado-ok', propio, { evy: 'prueba' });
    expect(correrEn(buena, ['--flujo', REL_RENOMBRADO, '--etapa-prueba', '--aplicar', '--confirmo-evy'], vivoViejo).guardias).toMatch(/^evy .*--etapa prueba/m);
  });
  it('el flujo vivo que es el nuevo (aunque se llame distinto) NO deja pasar un archivo cualquiera sin la confirmación', () => {
    const vivoRenombrado = join(dir, 'vivo-renombrado.json'); writeFileSync(vivoRenombrado, JSON.stringify({ name: 'Otro nombre cualquiera', active: false, nodes: [{ name: 'Armar previos' }] }));
    const sin = correrEn(raiz, ['--flujo', REL_VIEJO, '--aplicar', '--confirmo-doctoras'], vivoRenombrado);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/--confirmo-evy/);
  });
  it('el flujo nuevo con el nombre de Emma se NIEGA (archivo y vivo), sin tocar n8n', () => {
    const r = correrEn(raiz, ['--flujo', REL_COMO_EMMA, '--aplicar', '--confirmo-evy', '--confirmo-doctoras'], vivoViejo);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/otra doctora \(rroca-emma\)/);
    expect(r.curl).toBe('');
    const vivoEmma = join(dir, 'vivo-emma.json'); writeFileSync(vivoEmma, JSON.stringify({ name: 'NovuChat — Dra. Emma (rroca-emma)', active: false, nodes: [{ name: 'Armar previos' }] }));
    const v = correrEn(raiz, ['--flujo', REL_VIEJO, '--aplicar', '--confirmo-doctoras', '--confirmo-evy'], vivoEmma);
    expect(v.status).toBe(1);
    expect(v.stderr).toMatch(/otra doctora/);
  });
  it('REL_NUEVO sobre el vivo Emma viejo con --forzar: se NIEGA (código 1), sin tocar n8n; sobre el vivo viejo de Evy no', () => {
    const vivoEmmaViejo = join(dir, 'vivo-emma-viejo.json');
    writeFileSync(vivoEmmaViejo, JSON.stringify({ name: 'NovuChat — Dra. Emma (rroca-emma)', active: false, nodes: [{ name: 'Armar avisos' }] }));
    for (const extra of [[], ['--forzar']]) {
      const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-evy', ...extra], vivoEmmaViejo);
      expect(r.status, extra.join(' ')).toBe(1);
      expect(r.stderr, extra.join(' ')).toMatch(/NEGADO: el flujo nuevo de Evy no puede reemplazar un flujo vivo que no es de Evy \(vivo: rroca-emma\)/);
      expect(r.curl, extra.join(' ')).not.toMatch(/-X (PUT|POST)/);
    }
    // Un vivo de OTRO cliente (nombre cualquiera) o Emma renombrada: tampoco, ni con --forzar.
    for (const [nombre, vivo] of [['otro-cliente', { name: "NovuChat — Q'Taco (qtaco)", active: true, nodes: [{ name: 'Armar avisos' }] }], ['emma-renombrada', { name: 'Dra. E. R.', active: false, nodes: [{ name: 'Armar avisos' }] }], ['vacio', { name: 'x', nodes: [] }], ['otro-con-nombre-de-evy', { name: NOMBRE, active: true, nodes: [{ name: 'Otro nodo' }] }]] as const) {
      const archivo = join(dir, `vivo-${nombre}.json`); writeFileSync(archivo, JSON.stringify(vivo));
      for (const extra of [[], ['--forzar']]) {
        const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-evy', ...extra], archivo);
        expect(r.status, `${nombre} ${extra.join(' ')}`).toBe(1);
        expect(r.stderr, nombre).toMatch(/NEGADO: el flujo nuevo de Evy no puede reemplazar un flujo vivo que no es de Evy/);
        expect(r.curl, nombre).not.toMatch(/-X (PUT|POST)/);
      }
    }
    // Sobre el vivo de Evy (viejo o nuevo) sí se puede.
    for (const vivo of [vivoViejo, vivoNuevo]) {
      const sobreEvy = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-evy', '--forzar'], vivo);
      expect(sobreEvy.stderr).not.toMatch(/no puede reemplazar un flujo vivo que no es de Evy/);
    }
  });
  it('el flujo de Emma y el viejo de Evy siguen con la guardia de las doctoras', () => {
    for (const rel of [REL_VIEJO, REL_EMMA]) {
      const r = correrEn(raiz, ['--flujo', rel, '--aplicar', '--confirmo-doctoras'], vivoOtro);
      expect(r.guardias, rel).toMatch(/^doctoras /m);
      expect(r.guardias, rel).not.toMatch(/^evy/m);
    }
  });
});

describe('ADITIVO: contra el script de origin/main, todo lo que no es el flujo nuevo de Evy se comporta igual', () => {
  const base = ['origin/main', 'main'].map((r) => spawnSync('git', ['show', `${r}:scripts/publicar-flujo.sh`], { cwd: REPO, encoding: 'utf8' })).find((r) => r.status === 0);
  const CASOS: string[][] = [
    ['--flujo', REL_VIEJO, '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_VIEJO, '--aplicar'], ['--flujo', REL_VIEJO], ['--flujo', REL_VIEJO, '--etapa-prueba', '--aplicar', '--confirmo-doctoras'],
    ['--flujo', REL_VIEJO, '--forzar', '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_VIEJO, '--encender', '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_VIEJO, '--encender', '--etapa-prueba', '--aplicar', '--confirmo-doctoras'],
    ['--encender', '--aplicar', '--confirmo-doctoras'], ['--apagar', '--aplicar'], ['--flujo', REL_VIEJO, '--crear', '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_VIEJO, '--crear', '--activar', '--aplicar', '--confirmo-doctoras'],
    ['--flujo', REL_EMMA, '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_EMMA], ['--flujo', REL_EMMA, '--etapa-prueba', '--aplicar', '--confirmo-doctoras'],
  ];
  it.skipIf(!base)('actualizar en su lugar, encender, apagar y crear con el flujo viejo, el de Emma y otro cliente: misma salida, error, código, llamadas y guardias que origin/main', () => {
    for (const doctoras of [0, 1]) {
      const a = raizCon(`propio-${doctoras}`, propio, { doctoras });
      const b = raizCon(`origen-${doctoras}`, base!.stdout, { doctoras });
      for (const vivo of [vivoViejo, vivoOtro]) {
        for (const args of CASOS) expect(correrEn(a, args, vivo), `doctoras ${doctoras}: ${args.join(' ')}`).toEqual(correrEn(b, args, vivo));
      }
    }
  }, 240_000);
});

describe('el script real contra la guardia real', () => {
  it('el archivo NUEVO versionado (con marcadores) se NIEGA con --aplicar y nombra la causa', () => {
    const raiz = join(dir, 'real'); mkdirSync(join(raiz, 'scripts'), { recursive: true });
    copyFileSync(join(REPO, 'scripts/publicar-flujo.sh'), join(raiz, 'scripts/publicar-flujo.sh'));
    const r = spawnSync('bash', [join(REPO, 'scripts/publicar-flujo.sh'), '--flujo', REL_NUEVO, '--aplicar', '--confirmo-evy', '--env', relative(REPO, envRel)], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivoViejo, LOG_CURL: join(dir, 'real.log') }),
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/marcador sin sustituir/);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Evy/);
  });
});
