/**
 * EL PUBLICADOR (`scripts/publicar-flujo.sh`) y el flujo NUEVO de Emma. El flujo nuevo de Emma conserva el nombre y el id vivo del flujo viejo de las doctoras (el de Emma): se distingue por su CONTENIDO (el nodo
 * «Armar previos» y un «Config base» con tenantId rroca-emma), no por el nombre. Con --aplicar se NIEGA si `rroca-emma/construir.mjs --publicable` no lo aprueba (etapa prueba con --etapa-prueba, completa sin ella,
 * crear con --crear) y pide PUBLICAR EMMA (o --confirmo-emma). SOLO puede reemplazar al flujo vivo de Emma; al de Evy o al de cualquier otro cliente, NUNCA, ni con --forzar; y el de Evy nunca puede pisar el de Emma.
 * El cambio es ADITIVO: contra el script de origin/main, el flujo viejo de Emma, el de Evy y cualquier otro se comportan igual. Curl de juguete: nunca sale a la red.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const NOMBRE = 'NovuChat — Dra. Emma (rroca-emma)';
const NOMBRE_EVY = 'NovuChat — Dra. Evy Karina (rroca-evy)';
const dir = mkdtempSync(join(tmpdir(), 'emma-publicador-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const bin = join(dir, 'bin'); mkdirSync(bin);
writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "$*" >> "$LOG_CURL"\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) O="$2"; shift 2;; *) shift;; esac; done\n[[ -n "$O" ]] && cp "$VIVO_SIMULADO" "$O"\nprintf 200\n');
chmodSync(join(bin, 'curl'), 0o755);
const envRel = join(dir, 'env');
writeFileSync(envRel, 'N8N_API_KEY=clave-de-juguete\nN8N_WORKFLOW_ID=1\nN8N_BASE_URL=http://n8n.invalido\n');

// Teléfonos ficticios armados en la ejecución (el repo público no admite números largos escritos): el phone id de Emma, el de Evy y uno ajeno.
const PHONE_EMMA = ['5917', '1', '2345', '6'].join('');
const PHONE_EVY = ['5917', '1', '9876', '5'].join('');
const PHONE_AJENO = ['5917', '1', '5555', '5'].join('');
const par = (name: string, value: string) => ({ name, value });
/** «Config base» como lo arma el construir NUEVO: tenantId + phoneNumberIdEsperado. */
const configBase = (tenant: string, phone: string = PHONE_EMMA) => ({ name: 'Config base', parameters: { assignments: { assignments: [par('tenantId', tenant), par('phoneNumberIdEsperado', phone)] } } });
/** «Config base» del flujo VIEJO de las doctoras, con la forma REAL del vivo de Emma: SIN tenantId y con estas claves exactas (valores sintéticos). */
const configBaseViejo = (phone: string = PHONE_EMMA, extra: Array<{ name: string; value: string }> = []) => ({ name: 'Config base', parameters: { assignments: { assignments: [
  par('waGraphVersion', 'v26.0'), par('phoneNumberIdEsperado', phone), par('numeroRecepcion', 'x'), par('nombreNegocio', 'Dra. X'), par('mensajeComercioSuspendido', 'x'), par('prefijosPermitidos', '591'),
  par('telefonosDePrueba', 'x'), par('modelo', 'gemini'), par('temperatura', '0.3'), par('avisoSolicitudPlantilla', 'x'), par('avisoSolicitudEstado', 'APPROVED'), par('avisoPlantillaIdioma', 'es'), par('doctora', '{}'), ...extra] } } });
const nuevoDe = (nombre: string, tenant: string, phone: string = PHONE_EMMA) => ({ name: nombre, nodes: [{ name: 'Armar previos' }, configBase(tenant, phone)], connections: {}, settings: {} });
/** El flujo viejo de las doctoras (nodo «Armar avisos»). Evy lleva su tenantId; el de Emma, como el real, no. */
const viejoDe = (nombre: string, tenant: string, phone: string = PHONE_EMMA) => ({ name: nombre, active: false, connections: {}, settings: {}, nodes: [{ name: 'Armar avisos' }, tenant === 'rroca-emma' ? configBaseViejo(phone) : configBase(tenant, phone)] });
const escribir = (nombre: string, json: unknown): string => { const a = join(dir, nombre); writeFileSync(a, JSON.stringify(json)); return a; };

const vivoEmmaNuevo = escribir('vivo-emma-nuevo.json', { ...nuevoDe(NOMBRE, 'rroca-emma'), active: false });
const vivoEmmaViejo = escribir('vivo-emma-viejo.json', viejoDe(NOMBRE, 'rroca-emma'));
const vivoEvyNuevo = escribir('vivo-evy-nuevo.json', { ...nuevoDe(NOMBRE_EVY, 'rroca-evy', PHONE_EVY), active: false });
const vivoEvyViejo = escribir('vivo-evy-viejo.json', viejoDe(NOMBRE_EVY, 'rroca-evy', PHONE_EVY));
const vivoOtro = escribir('vivo-otro.json', { name: 'Otro cliente', active: false, nodes: [] });

const REL_NUEVO = 'Flujos/experimental/rroca-emma/rroca-emma.json';
const REL_EVY_NUEVO = 'Flujos/experimental/rroca-evy/rroca-evy.json';
const REL_EMMA_VIEJO = 'Flujos/experimental/doctoras/doctoras.rroca-emma.json';
const REL_EVY_VIEJO = 'Flujos/experimental/doctoras/doctoras.rroca-evy.json';
const REL_RENOMBRADO = 'Flujos/experimental/rroca-emma/flujo-renombrado.json';
const REL_CON_TENANT_DE_EVY = 'Flujos/experimental/rroca-emma/con-tenant-de-evy.json';

/** Una raíz de juguete: el script bajo prueba y los construir.mjs de juguete. El de Emma aprueba SOLO la etapa indicada; el de Evy y el de las doctoras dejan su rastro (no deben llamarse para un flujo de Emma). */
function raizCon(nombre: string, script: string, o: { emma?: string; evy?: string; doctoras?: number } = {}): string {
  const raiz = join(dir, nombre);
  for (const d of ['scripts', 'Flujos/experimental/doctoras', 'Flujos/experimental/rroca-evy', 'Flujos/experimental/rroca-emma']) mkdirSync(join(raiz, d), { recursive: true });
  writeFileSync(join(raiz, 'scripts/publicar-flujo.sh'), script); chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
  writeFileSync(join(raiz, 'Flujos/experimental/doctoras/construir.mjs'), `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.LOG_GUARDIAS, 'doctoras ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(${o.doctoras ?? 0});\n`);
  const guardia = (tenant: string, etapa: string): string => `import { appendFileSync } from 'node:fs'; appendFileSync(process.env.LOG_GUARDIAS, '${tenant} ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(process.argv.join(' ').includes('--etapa ${etapa}') ? 0 : 1);\n`;
  writeFileSync(join(raiz, 'Flujos/experimental/rroca-emma/construir.mjs'), guardia('emma', o.emma ?? 'prueba'));
  writeFileSync(join(raiz, 'Flujos/experimental/rroca-evy/construir.mjs'), guardia('evy', o.evy ?? 'prueba'));
  writeFileSync(join(raiz, REL_NUEVO), JSON.stringify(nuevoDe(NOMBRE, 'rroca-emma')));
  writeFileSync(join(raiz, REL_EVY_NUEVO), JSON.stringify(nuevoDe(NOMBRE_EVY, 'rroca-evy', PHONE_EVY)));
  writeFileSync(join(raiz, REL_EMMA_VIEJO), JSON.stringify(viejoDe(NOMBRE, 'rroca-emma')));
  writeFileSync(join(raiz, REL_EVY_VIEJO), JSON.stringify(viejoDe(NOMBRE_EVY, 'rroca-evy', PHONE_EVY)));
  writeFileSync(join(raiz, REL_RENOMBRADO), JSON.stringify(nuevoDe('Otro nombre cualquiera', 'rroca-emma')));
  writeFileSync(join(raiz, REL_CON_TENANT_DE_EVY), JSON.stringify(nuevoDe(NOMBRE, 'rroca-evy')));
  return raiz;
}
const correrEn = (raiz: string, args: string[], vivo: string) => {
  const log = join(raiz, 'curl.log'); writeFileSync(log, '');
  const guardias = join(raiz, 'guardias.log'); writeFileSync(guardias, '');
  const r = spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), ...args, '--env', relative(raiz, envRel)], {
    cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivo, LOG_CURL: log, LOG_GUARDIAS: guardias }),
  });
  const sinRaiz = (t: string): string => t.split(raiz).join('<raiz>').replace(/\/tmp\/tmp\.[A-Za-z0-9]+/g, '<tmp>').replace(/(respaldo-[^-\s]*-)\d{8}-\d{6}/g, '$1<fecha>');
  return { status: r.status, stdout: sinRaiz(r.stdout), stderr: sinRaiz(r.stderr), curl: sinRaiz(readFileSync(log, 'utf8')), guardias: sinRaiz(readFileSync(guardias, 'utf8')) };
};
const propio = readFileSync(join(REPO, 'scripts/publicar-flujo.sh'), 'utf8');
const sinEscritura = (curl: string): void => { expect(curl).not.toMatch(/-X (PUT|POST)/); };

describe('el flujo nuevo de Emma tiene su guardia, distinta de la de Evy y la de las doctoras', () => {
  const raiz = raizCon('nuevo', propio, { emma: 'prueba' });
  it('actualizar en su lugar con --etapa-prueba pide la etapa prueba de la guardia de EMMA y no toca la de Evy ni la de las doctoras (el vivo es el viejo de Emma)', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--etapa-prueba', '--aplicar', '--confirmo-emma'], vivoEmmaViejo);
    expect(r.status).toBe(0);
    expect(r.guardias).toMatch(/^emma .*--etapa prueba/m);
    expect(r.guardias).not.toMatch(/^evy/m);
    expect(r.guardias).not.toMatch(/^doctoras/m);
    expect(r.curl).toMatch(/-X PUT/);
  });
  it('también sobre el vivo que ya es el nuevo de Emma', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--etapa-prueba', '--aplicar', '--confirmo-emma'], vivoEmmaNuevo);
    expect(r.status).toBe(0);
    expect(r.curl).toMatch(/-X PUT/);
  });
  it('sin --etapa-prueba pide la completa y se NIEGA (código 1, sin escribir en n8n)', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--confirmo-emma'], vivoEmmaViejo);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Emma/);
    expect(r.guardias).toMatch(/^emma .*--etapa encender/m);
    sinEscritura(r.curl);
  });
  it('--forzar no salta la guardia', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--forzar', '--aplicar', '--confirmo-emma'], vivoEmmaViejo);
    expect(r.status).toBe(1);
    sinEscritura(r.curl);
  });
  it('en seco informa y sigue; sin terminal ni --confirmo-emma se NIEGA con --aplicar', () => {
    const seco = correrEn(raiz, ['--flujo', REL_NUEVO], vivoEmmaViejo);
    expect(seco.status).toBe(0);
    expect(seco.stdout).toMatch(/Flujo nuevo de Emma/);
    sinEscritura(seco.curl);
    const sin = correrEn(raiz, ['--flujo', REL_NUEVO, '--etapa-prueba', '--aplicar'], vivoEmmaViejo);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publica con --confirmo-emma/);
    sinEscritura(sin.curl);
  });
  it('--crear sin --activar usa la etapa crear; --crear --activar la completa', () => {
    const c = raizCon('crear', propio, { emma: 'crear' });
    expect(correrEn(c, ['--flujo', REL_NUEVO, '--crear', '--aplicar', '--confirmo-emma'], vivoEmmaViejo).stdout).toMatch(/etapa crear/);
    const a = correrEn(c, ['--flujo', REL_NUEVO, '--crear', '--activar', '--aplicar', '--confirmo-emma'], vivoEmmaViejo);
    expect(a.status).toBe(1);
    expect(a.guardias).toMatch(/^emma .*--etapa encender/m);
  });
  it('el flujo nuevo RENOMBRADO se reconoce por su contenido (tenantId rroca-emma) y pasa por la guardia de Emma', () => {
    const mala = raizCon('renombrado', propio, { emma: 'ninguna' });
    const r = correrEn(mala, ['--flujo', REL_RENOMBRADO, '--aplicar', '--confirmo-emma'], vivoEmmaViejo);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Emma/);
    expect(r.guardias).toMatch(/^emma /m);
    expect(r.guardias).not.toMatch(/^evy/m);
    sinEscritura(r.curl);
  });
  it('--encender sobre el vivo que es el nuevo de Emma lo revisa con la guardia de Emma; restaurar el viejo sobre él pide la confirmación de Emma', () => {
    const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--encender', '--etapa-prueba', '--aplicar', '--confirmo-emma'], vivoEmmaNuevo);
    expect(r.guardias).toMatch(/^emma .*--etapa prueba/m);
    expect(r.guardias).not.toMatch(/^evy/m);
    const sin = correrEn(raiz, ['--flujo', REL_EMMA_VIEJO, '--aplicar', '--confirmo-doctoras'], vivoEmmaNuevo);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/--confirmo-emma/);
  });
});

describe('NEGADAS: el flujo nuevo de Emma NUNCA reemplaza un flujo vivo que no es de Emma (ni con --forzar)', () => {
  const raiz = raizCon('negadas', propio, { emma: 'prueba', evy: 'prueba' });
  const vivos: Array<[string, string]> = [
    ['el flujo NUEVO de Evy', vivoEvyNuevo],
    ['el flujo VIEJO de Evy', vivoEvyViejo],
    ['otro cliente (nombre cualquiera)', escribir('vivo-qtaco.json', { name: "NovuChat — Q'Taco (qtaco)", active: true, nodes: [{ name: 'Armar avisos' }] })],
    ['un vivo vacío', escribir('vivo-vacio.json', { name: 'x', nodes: [] })],
    ['el nuevo de Evy RENOMBRADO (sin rroca-evy en el nombre)', escribir('vivo-evy-renombrado.json', { ...nuevoDe('Dra. E. K.', 'rroca-evy', PHONE_EVY), active: false })],
    ['el viejo de Evy con el nombre de Emma (el tenant de su Config base lo delata)', escribir('vivo-evy-con-nombre-de-emma.json', viejoDe(NOMBRE, 'rroca-evy', PHONE_EVY))],
    ['el viejo de Emma RENOMBRADO (conservador: sin el nombre no se reconoce)', escribir('vivo-emma-renombrado.json', viejoDe('Dra. E. A.', 'rroca-emma'))],
    ['el viejo de Emma con OTRO phone id (otro número: no es el de este archivo)', escribir('vivo-emma-otro-phone.json', viejoDe(NOMBRE, 'rroca-emma', PHONE_AJENO))],
    ['el viejo de Emma que menciona rroca-evy en un parámetro', escribir('vivo-emma-con-evy.json', { ...viejoDe(NOMBRE, 'rroca-emma'), nodes: [{ name: 'Armar avisos' }, configBaseViejo(PHONE_EMMA, [par('nota', 'copiado de rroca-evy')])] })],
    ['un viejo de Emma con DOS nodos «Config base»', escribir('vivo-emma-dos-config.json', { ...viejoDe(NOMBRE, 'rroca-emma'), nodes: [{ name: 'Armar avisos' }, configBaseViejo(PHONE_EMMA), configBaseViejo(PHONE_EMMA)] })],
    ['un viejo de Emma con el phone id vacío', escribir('vivo-emma-phone-vacio.json', viejoDe(NOMBRE, 'rroca-emma', ''))],
    ['un viejo de Emma con un phone id que no son dígitos (marcador)', escribir('vivo-emma-phone-marcador.json', viejoDe(NOMBRE, 'rroca-emma', 'REEMPLAZAR_PHONE_NUMBER_ID_RROCA_EMMA'))],
    ['un flujo con el nombre de Emma pero sin su huella', escribir('vivo-nombre-de-emma.json', { name: NOMBRE, active: false, nodes: [{ name: 'Otro nodo' }] })],
  ];
  for (const [que, vivo] of vivos) {
    it(`sobre ${que}`, () => {
      for (const extra of [[], ['--forzar']]) {
        const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-emma', ...extra], vivo);
        expect(r.status, `${que} ${extra.join(' ')}`).toBe(1);
        expect(r.stderr, que).toMatch(/NEGADO: el flujo nuevo de Emma no puede reemplazar un flujo vivo que no es de Emma/);
        sinEscritura(r.curl);
      }
    });
  }
  it('SEGURIDAD: un tenantId repetido en el archivo o en el vivo se NIEGA (falla cerrado), también con --forzar; y un flujo de otro cliente con las tres condiciones débiles del viejo de Emma NO se reconoce', () => {
    const repetido = (n: string, t1: string, t2: string) => ({ ...nuevoDe(n, t1), nodes: [{ name: 'Armar previos' }, { name: 'Config base', parameters: { assignments: { assignments: [{ name: 'tenantId', value: t1 }, { name: 'tenantId', value: t2 }] } } }] });
    const archivoRepetido = join(raiz, 'Flujos/experimental/rroca-emma/repetido.json'); writeFileSync(archivoRepetido, JSON.stringify(repetido(NOMBRE, 'rroca-emma', 'rroca-evy')));
    const vivoRepetido = escribir('vivo-repetido.json', repetido(NOMBRE, 'rroca-emma', 'rroca-emma'));
    for (const extra of [[], ['--forzar']]) {
      const a = correrEn(raiz, ['--flujo', 'Flujos/experimental/rroca-emma/repetido.json', '--aplicar', '--etapa-prueba', '--confirmo-emma', ...extra], vivoEmmaViejo);
      expect(a.status, 'archivo repetido').toBe(1); expect(a.stderr).toMatch(/NEGADO: el archivo trae el tenantId repetido/); sinEscritura(a.curl);
      const v = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-emma', ...extra], vivoRepetido);
      expect(v.status, 'vivo repetido').toBe(1); expect(v.stderr).toMatch(/NEGADO: el flujo vivo trae el tenantId repetido/); sinEscritura(v.curl);
    }
    // otro cliente: nombre con rroca-emma + nodo «Armar avisos» + «rroca-emma» mencionado en un parámetro de «Config base», pero su tenantId es otro
    const debil = escribir('vivo-debil.json', { name: NOMBRE, active: false, connections: {}, settings: {}, nodes: [{ name: 'Armar avisos' }, { name: 'Config base', parameters: { assignments: { assignments: [{ name: 'tenantId', value: 'qtaco' }, { name: 'nota', value: 'copiado de rroca-emma' }] } } }] });
    for (const extra of [[], ['--forzar']]) {
      const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-emma', ...extra], debil);
      expect(r.status, extra.join(' ')).toBe(1);
      expect(r.stderr).toMatch(/NEGADO: el flujo nuevo de Emma no puede reemplazar un flujo vivo que no es de Emma/);
      sinEscritura(r.curl);
    }
  });
  it('un archivo con el nombre de Emma pero el tenant de EVY en su «Config base» NO es de Emma: va por la guardia de Evy y nunca por la de Emma', () => {
    const r = correrEn(raiz, ['--flujo', REL_CON_TENANT_DE_EVY, '--aplicar', '--etapa-prueba', '--confirmo-evy', '--confirmo-emma'], vivoEmmaViejo);
    expect(r.guardias).not.toMatch(/^emma/m);
    expect(r.curl).not.toMatch(/-X PUT/);
  });
  it('el flujo nuevo de EVY tampoco puede pisar el nuevo de Emma, ni renombrado, ni con --forzar', () => {
    const emmaRenombrado = escribir('vivo-emma-nuevo-renombrado.json', { ...nuevoDe('Dra. E. A.', 'rroca-emma'), active: false });
    for (const vivo of [vivoEmmaNuevo, emmaRenombrado, vivoEmmaViejo]) {
      for (const extra of [[], ['--forzar']]) {
        const r = correrEn(raiz, ['--flujo', REL_EVY_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-evy', ...extra], vivo);
        expect(r.status, `${vivo} ${extra.join(' ')}`).toBe(1);
        sinEscritura(r.curl);
      }
    }
  });
  it('sobre el vivo de Emma (viejo o nuevo) SÍ llega al PUT, también con --forzar', () => {
    for (const vivo of [vivoEmmaViejo, vivoEmmaNuevo]) {
      const r = correrEn(raiz, ['--flujo', REL_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-emma', '--forzar'], vivo);
      expect(r.status).toBe(0);
      expect(r.curl).toMatch(/-X PUT/);
    }
  });
  it('el flujo de Evy sobre el vivo de Evy sigue llegando al PUT con su propia guardia (el cambio es aditivo)', () => {
    for (const vivo of [vivoEvyViejo, vivoEvyNuevo]) {
      const r = correrEn(raiz, ['--flujo', REL_EVY_NUEVO, '--aplicar', '--etapa-prueba', '--confirmo-evy'], vivo);
      expect(r.status).toBe(0);
      expect(r.guardias).toMatch(/^evy /m);
      expect(r.guardias).not.toMatch(/^emma/m);
      expect(r.curl).toMatch(/-X PUT/);
    }
  });
  it('el flujo viejo de Emma y el viejo de Evy siguen con la guardia de las doctoras', () => {
    for (const rel of [REL_EMMA_VIEJO, REL_EVY_VIEJO]) {
      const r = correrEn(raiz, ['--flujo', rel, '--aplicar', '--confirmo-doctoras'], vivoOtro);
      expect(r.guardias, rel).toMatch(/^doctoras /m);
      expect(r.guardias, rel).not.toMatch(/^emma/m);
      expect(r.guardias, rel).not.toMatch(/^evy/m);
    }
  });
});

describe('ADITIVO: contra el script de origin/main, todo lo que no es el flujo nuevo de Emma se comporta igual', () => {
  const base = ['origin/main', 'main'].map((r) => spawnSync('git', ['show', `${r}:scripts/publicar-flujo.sh`], { cwd: REPO, encoding: 'utf8' })).find((r) => r.status === 0);
  const CASOS: string[][] = [
    ['--flujo', REL_EMMA_VIEJO, '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_EMMA_VIEJO], ['--flujo', REL_EVY_VIEJO, '--aplicar', '--confirmo-doctoras'], ['--flujo', REL_EMMA_VIEJO, '--forzar', '--aplicar', '--confirmo-doctoras'],
    ['--flujo', REL_EMMA_VIEJO, '--encender', '--aplicar', '--confirmo-doctoras'], ['--encender', '--aplicar', '--confirmo-doctoras'], ['--apagar', '--aplicar'],
    ['--flujo', REL_EMMA_VIEJO, '--crear', '--aplicar', '--confirmo-doctoras'],
    ['--flujo', REL_EVY_NUEVO, '--etapa-prueba', '--aplicar', '--confirmo-evy'], ['--flujo', REL_EVY_NUEVO, '--aplicar', '--confirmo-evy'], ['--flujo', REL_EVY_NUEVO, '--forzar', '--aplicar', '--confirmo-evy'],
    ['--flujo', REL_EVY_NUEVO], ['--flujo', REL_EVY_NUEVO, '--crear', '--aplicar', '--confirmo-evy'], ['--flujo', REL_EVY_NUEVO, '--encender', '--etapa-prueba', '--aplicar', '--confirmo-evy'],
  ];
  it.skipIf(!base)('actualizar en su lugar, encender, apagar y crear con los flujos de las doctoras, el de Evy y otro cliente: misma salida, error, código, llamadas y guardias que origin/main', () => {
    const a = raizCon('aditivo-propio', propio, { emma: 'prueba', evy: 'prueba' });
    const b = raizCon('aditivo-origen', base!.stdout, { emma: 'prueba', evy: 'prueba' });
    // Los vivos de Evy y de otro cliente: el cambio no debe notarse. (Los vivos de Emma son justo lo que cambia y se prueban arriba.)
    for (const vivo of [vivoEvyViejo, vivoEvyNuevo, vivoOtro]) {
      for (const args of CASOS) expect(correrEn(a, args, vivo), `${args.join(' ')}`).toEqual(correrEn(b, args, vivo));
    }
  }, 480_000);
});

describe('el script real contra la guardia real', () => {
  it('el archivo NUEVO versionado (con marcadores) se NIEGA con --aplicar, nombra la causa y NO usa la guardia de Evy', () => {
    const r = spawnSync('bash', [join(REPO, 'scripts/publicar-flujo.sh'), '--flujo', REL_NUEVO, '--aplicar', '--confirmo-emma', '--env', relative(REPO, envRel)], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivoEmmaViejo, LOG_CURL: join(dir, 'real.log') }),
    });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/marcador sin sustituir/);
    expect(r.stderr).toMatch(/NEGADO: el flujo de Emma/);
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/Flujo nuevo de Evy/);
  });
  it('el JSON versionado de Emma es de Emma y solo de Emma: tenantId rroca-emma y ninguna mención de Evy', () => {
    const texto = readFileSync(join(REPO, REL_NUEVO), 'utf8');
    expect(texto).toMatch(/"name": "tenantId",\s*"type": "string",\s*"value": "rroca-emma"/);
    expect(texto).not.toMatch(/rroca-evy/i);
  });
});
