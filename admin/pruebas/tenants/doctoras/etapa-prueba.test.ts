/**
 * LAS DOCTORAS — EL MODO PRUEBA (`etapaPrueba = si` en «Config base»), sobre los JSON VERSIONADOS y con el n8n de mentira.
 *
 * Con la etapa encendida el flujo VIVO solo atiende a `telefonosDePrueba`: cualquier otro número sale por la ruta `fuera_de_prueba` (cero mensajes, cero aviso, cero modelo) y la recepción de la Consola se IGNORA
 * (el aviso nunca llega a la recepción real de la doctora). La guardia tiene su etapa `prueba`: tolera la plantilla sin APPROVED y exige `etapaPrueba = si`, teléfonos de prueba válidos y la recepción dentro de ellos;
 * la etapa completa (`encender`) rechaza `etapaPrueba = si`. Se escribe NEGANDO. Sin teléfonos reales: los números son los ficticios de `mundo.ts` o se arman al vuelo.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { guardiaDePublicacion } from '../../../../Flujos/experimental/doctoras/construir.mjs';
import { ANA, BETO, REC, TENANTS, crear, datosDe, flujoDe, hablar, mTexto, negocioDe, type Tenant } from './mundo';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONSTRUIR = join(REPO, 'Flujos/experimental/doctoras/construir.mjs');
const AJENO = ['591', '7', '7', '7', '1', '2', '3', '4', '5'].join('');
const OTRA_RECEPCION = ['591', '6', '6', '6', '1', '2', '3', '4', '5'].join('');
const MARCADORES = /REEMPLAZAR_[A-Z0-9][A-Z0-9_]*/g;
const AP = { avisoSolicitudEstado: 'APPROVED' };

// ------------------------------------------------------------------ en ejecución
describe('la puerta en modo prueba: solo pasan los teléfonos de prueba', () => {
  const enPrueba = (o: { telefonos?: string; base?: Record<string, unknown> } = {}) =>
    crear({ telefonosDePrueba: o.telefonos ?? `${ANA},${BETO}`, base: { ...AP, etapaPrueba: 'si', ...(o.base ?? {}) } });

  it('un teléfono AJENO no recibe nada: ruta `fuera_de_prueba`, 0 mensajes, 0 avisos, 0 modelo, 0 plantilla', () => {
    const w = enPrueba();
    for (const msg of [mTexto('hola'), mTexto('quiero agendar mi valoración'), { type: 'sticker', sticker: { id: 's' } } as J]) {
      const t = hablar(w, AJENO, msg);
      expect(t.porNodo['Puerta del turno']![0]!['ruta']).toBe('fuera_de_prueba');
      expect(t.mensajes).toHaveLength(0);
      expect(t.avisos).toHaveLength(0);
      expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
      expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
      expect(t.ejecutados.has('Enviar aviso')).toBe(false);
    }
  });
  it('un ajeno tampoco recibe el texto de «comercio suspendido» ni el de uso extendido: la etapa de prueba se mira PRIMERO', () => {
    const suspendido = enPrueba();
    suspendido.dobles['Traer configuración'] = () => ({ statusCode: 409, body: { mensajeCortesia: 'Texto de cortesía' } });
    expect(hablar(suspendido, AJENO, mTexto('hola')).mensajes).toHaveLength(0);
    const usoExtendido = crear({ telefonosDePrueba: ANA, base: { ...AP, etapaPrueba: 'si' }, ingesta: { ok: true, atencion: { estado: 'operador', avisarRecepcion: 'operador', respuestasEnVentana: 99 } } });
    expect(hablar(usoExtendido, AJENO, mTexto('hola')).mensajes).toHaveLength(0);
  });
  it('un teléfono de prueba SÍ recibe respuesta (la etapa no apaga el flujo para los de prueba)', () => {
    const w = enPrueba();
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.porNodo['Puerta del turno']![0]!['ruta']).toBe('sigue');
    expect(t.mensajes.length).toBeGreaterThan(0);
    expect(t.mensajes.every((m) => (m.payload as J)['to'] === ANA)).toBe(true);
  });
  it('con la lista vacía o con el marcador sin llenar, NADIE pasa en la etapa de prueba (niega por defecto)', () => {
    for (const lista of ['', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA']) {
      const w = enPrueba({ telefonos: lista });
      for (const quien of [ANA, AJENO]) {
        const t = hablar(w, quien, mTexto('hola'));
        expect(t.mensajes).toHaveLength(0);
        expect(t.porNodo['Puerta del turno']![0]!['ruta']).toBe('fuera_de_prueba');
      }
    }
  });
  it('SIN `etapaPrueba` (ausente, vacía, marcador o cualquier otro valor) todo queda como antes: un número fuera de la lista recibe respuesta', () => {
    for (const valor of [undefined, '', 'REEMPLAZAR_ETAPA_PRUEBA', 'no', 'valorsustituido']) {
      const w = crear({ telefonosDePrueba: `${ANA},${BETO}`, base: { ...AP, ...(valor === undefined ? {} : { etapaPrueba: valor }) } });
      const t = hablar(w, AJENO, mTexto('hola'));
      expect(t.porNodo['Puerta del turno']![0]!['ruta']).toBe('sigue');
      expect(t.mensajes.length).toBeGreaterThan(0);
      expect(t.porNodo['Config del negocio']![0]!['etapaPrueba']).toBe(false);
    }
  });
});

describe('la recepción en modo prueba: la de la Consola se IGNORA', () => {
  const recepcion = (base: Record<string, unknown>): unknown => {
    const w = crear({ base: { ...AP, numeroRecepcion: OTRA_RECEPCION, ...base } });   // la Consola (panelOk) trae REC
    return hablar(w, ANA, mTexto('hola')).porNodo['Config del negocio']![0]!['numeroRecepcion'];
  };
  it('con `etapaPrueba = si`, `numeroRecepcion` es el de «Config base», no el de la Consola', () => {
    expect(recepcion({ etapaPrueba: 'si' })).toBe(OTRA_RECEPCION);
    expect(recepcion({ etapaPrueba: 'si' })).not.toBe(REC);
  });
  it('sin `etapaPrueba`, la Consola sigue mandando (comportamiento de hoy)', () => {
    expect(recepcion({})).toBe(REC);
    expect(recepcion({ etapaPrueba: '' })).toBe(REC);
  });
  it('con la Consola caída y `etapaPrueba = si`, sigue siendo el de «Config base»', () => {
    const w = crear({ panel: 'cae', base: { ...AP, numeroRecepcion: OTRA_RECEPCION, etapaPrueba: 'si' } });
    expect(hablar(w, ANA, mTexto('hola')).porNodo['Config del negocio']![0]!['numeroRecepcion']).toBe(OTRA_RECEPCION);
  });
});

// ------------------------------------------------------------------ la guardia
type Asig = { name: string; value: unknown };
type Datos = { configBase: Record<string, unknown>; doctora: Record<string, unknown> };
type Armado = { flujo: Flujo; datos: Datos; negocio: Record<string, unknown> };
const asignaciones = (f: Flujo): Asig[] => (f.nodes.find((n) => n.name === 'Config base')!.parameters as { assignments: { assignments: Asig[] } }).assignments.assignments;
const poner = (x: Armado, c: string, v: string): void => {
  const lista = asignaciones(x.flujo); const a = lista.find((q) => q.name === c);
  if (a) a.value = v; else lista.push({ name: c, value: v });
  x.datos.configBase[c] = v;
};
/** Todo sustituido, la plantilla SIN aprobar (la etapa prueba la tolera) y la prueba bien armada: teléfonos de prueba y la recepción dentro de ellos. */
function pruebaLista(t: Tenant): Armado {
  const flujo = JSON.parse(JSON.stringify(flujoDe(t)).replace(MARCADORES, 'valorsustituido')) as Flujo;
  const datos = JSON.parse(JSON.stringify(datosDe(t)).replace(MARCADORES, 'valorsustituido')) as Datos;
  const negocio = JSON.parse(JSON.stringify({ negocio: negocioDe(t) }).replace(MARCADORES, 'dato-real')) as Record<string, unknown>;
  const x: Armado = { flujo, datos, negocio };
  poner(x, 'avisoSolicitudEstado', 'PENDING');
  poner(x, 'etapaPrueba', 'si');
  poner(x, 'telefonosDePrueba', `${ANA},${REC}`);
  poner(x, 'numeroRecepcion', REC);
  return x;
}
const etapa = (x: Armado, e: string): string[] => guardiaDePublicacion({ ...x, etapa: e }) as string[];

describe('la guardia: la etapa «prueba»', () => {
  for (const t of TENANTS) {
    it(`${t}: bien armada (etapaPrueba = si, teléfonos válidos, recepción dentro) y con la plantilla PENDING, la etapa prueba PASA`, () => {
      expect(etapa(pruebaLista(t), 'prueba')).toEqual([]);
    });
    it(`${t}: la etapa completa RECHAZA ese mismo flujo (plantilla sin APPROVED y etapaPrueba = si)`, () => {
      const h = etapa(pruebaLista(t), 'encender').join('|');
      expect(h).toMatch(/avisoSolicitudEstado/);
      expect(h).toMatch(/etapaPrueba es «si»/);
    });
    it(`${t}: con la plantilla APPROVED, la completa sigue rechazando \`etapaPrueba = si\` y la acepta sin él`, () => {
      const x = pruebaLista(t); poner(x, 'avisoSolicitudEstado', 'APPROVED');
      expect(etapa(x, 'encender').some((q) => /etapaPrueba es «si»/.test(q))).toBe(true);
      poner(x, 'etapaPrueba', '');
      expect(etapa(x, 'encender')).toEqual([]);
    });
    it(`${t}: SIN teléfonos de prueba (vacío, marcador, letras, uno inválido) NO enciende en prueba`, () => {
      for (const lista of ['', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA', 'abc', `${ANA},12`, `${ANA},,${REC}`]) {
        const x = pruebaLista(t); poner(x, 'telefonosDePrueba', lista);
        expect(etapa(x, 'prueba').length, lista).toBeGreaterThan(0);
      }
    });
    it(`${t}: con la recepción FUERA de los teléfonos de prueba NO enciende (el aviso iría a la recepción real)`, () => {
      const x = pruebaLista(t); poner(x, 'numeroRecepcion', OTRA_RECEPCION);
      expect(etapa(x, 'prueba')).toEqual(['Config base: la etapa prueba exige que numeroRecepcion esté dentro de telefonosDePrueba']);
      const vacio = pruebaLista(t); poner(vacio, 'numeroRecepcion', '');
      expect(etapa(vacio, 'prueba').length).toBeGreaterThan(0);
    });
    it(`${t}: con un marcador sin resolver NO enciende en prueba`, () => {
      const x = pruebaLista(t); poner(x, 'telefonosDePrueba', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA');
      expect(etapa(x, 'prueba').join('|')).toMatch(/marcador sin sustituir: REEMPLAZAR_TELEFONOS_DE_PRUEBA/);
      const y = pruebaLista(t); (y.flujo.nodes[0] as unknown as Record<string, unknown>)['notes'] = 'REEMPLAZAR_OTRO';
      expect(etapa(y, 'prueba').join('|')).toMatch(/marcador sin sustituir: REEMPLAZAR_OTRO/);
      const z = pruebaLista(t); poner(z, 'etapaPrueba', 'REEMPLAZAR_ETAPA_PRUEBA');
      expect(etapa(z, 'prueba').join('|')).toMatch(/etapaPrueba igual a «si»/);
    });
    it(`${t}: sin \`etapaPrueba = si\` (vacío u otro valor) NO enciende en prueba`, () => {
      for (const v of ['', 'no']) {
        const x = pruebaLista(t); poner(x, 'etapaPrueba', v);
        expect(etapa(x, 'prueba')).toEqual(['Config base: la etapa prueba exige etapaPrueba igual a «si»']);
      }
    });
    it(`${t}: la etapa prueba NO tolera lo que crear tampoco: identidad cruzada o medio faltante`, () => {
      const x = pruebaLista(t); x.flujo.name = 'Otro flujo';
      expect(etapa(x, 'prueba').join('|')).toMatch(/nombre del flujo/);
      const y = pruebaLista(t); y.flujo.nodes = y.flujo.nodes.filter((n) => n.name !== 'Describir imagen');
      expect(etapa(y, 'prueba').join('|')).toMatch(/Describir imagen/);
    });
  }
  it('lo versionado de hoy NO es publicable en la etapa prueba (marcadores): sale 1, no 2; una etapa inventada sale 2', () => {
    const r = spawnSync(process.execPath, [CONSTRUIR, '--publicable', '--etapa', 'prueba', '--tenant', 'rroca-evy'], { encoding: 'utf8', env: entornoDelEmulador({}) });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toMatch(/etapa prueba/);
    const q = spawnSync(process.execPath, [CONSTRUIR, '--publicable', '--etapa', 'pruebas'], { encoding: 'utf8', env: entornoDelEmulador({}) });
    expect(q.status).toBe(2);
  });
  it('el dato de Evy trae `etapaPrueba` como marcador (apagada hasta que se resuelva); Emma no cambia', () => {
    expect(datosDe('rroca-evy')['configBase']).toHaveProperty('etapaPrueba', 'REEMPLAZAR_ETAPA_PRUEBA');
    expect(datosDe('rroca-emma')['configBase']).not.toHaveProperty('etapaPrueba');
  });
});

// ------------------------------------------------------------------ el publicador
describe('publicar-flujo.sh: `--encender --etapa-prueba` pide la etapa prueba; la completa no cambia', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doctoras-etapa-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  // Un curl de juguete en el PATH: nunca sale a la red.
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "$*" >> "$LOG_CURL"\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) O="$2"; shift 2;; *) shift;; esac; done\n[[ -n "$O" ]] && cp "$VIVO_SIMULADO" "$O"\nprintf 200\n');
  chmodSync(join(bin, 'curl'), 0o755);
  const envRel = join(dir, 'env');
  writeFileSync(envRel, 'N8N_API_KEY=clave-de-juguete\nN8N_WORKFLOW_ID=1\nN8N_BASE_URL=http://n8n.invalido\n');
  const vivoEvy = join(dir, 'vivo-evy.json');
  writeFileSync(vivoEvy, JSON.stringify({ name: 'NovuChat — Dra. Evy Karina (rroca-evy)', active: false, nodes: [] }));
  const log = join(dir, 'curl.log');
  // Una copia del script con un construir.mjs de juguete que SOLO aprueba la etapa `prueba`: prueba qué etapa pide el publicador.
  const raiz = join(dir, 'raiz');
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  mkdirSync(join(raiz, 'Flujos/experimental/doctoras'), { recursive: true });
  copyFileSync(join(REPO, 'scripts/publicar-flujo.sh'), join(raiz, 'scripts/publicar-flujo.sh'));
  chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
  writeFileSync(join(raiz, 'Flujos/experimental/doctoras/construir.mjs'), "process.exit(process.argv.join(' ').includes('--etapa prueba') ? 0 : 1);\n");
  writeFileSync(join(raiz, 'Flujos/experimental/doctoras/doctoras.rroca-evy.json'), JSON.stringify({ name: 'doctoras', nodes: [] }));
  const correr = (args: string[]) => {
    writeFileSync(log, '');
    return spawnSync('bash', [join(raiz, 'scripts/publicar-flujo.sh'), ...args, '--env', relative(raiz, envRel)], {
      cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH'] ?? ''}`, VIVO_SIMULADO: vivoEvy, LOG_CURL: log }),
    });
  };
  const REL = 'Flujos/experimental/doctoras/doctoras.rroca-evy.json';
  it('--encender --etapa-prueba pide la etapa prueba (pasa la guardia); sin --etapa-prueba pide la completa y se NIEGA', () => {
    const ok = correr(['--flujo', REL, '--encender', '--etapa-prueba', '--aplicar', '--confirmo-doctoras']);
    expect(ok.stdout).toMatch(/etapa prueba/);
    expect(ok.stderr).not.toMatch(/NEGADO/);
    const completa = correr(['--flujo', REL, '--encender', '--aplicar', '--confirmo-doctoras']);
    expect(completa.status).toBe(1);
    expect(completa.stdout).toMatch(/etapa encender/);
    expect(completa.stderr).toMatch(/NEGADO/);
  });
  it('--etapa-prueba solo va con --encender: sola o con --crear se rechaza (2) y no habla con n8n', () => {
    for (const args of [['--flujo', REL, '--etapa-prueba', '--aplicar', '--confirmo-doctoras'], ['--flujo', REL, '--crear', '--etapa-prueba', '--aplicar', '--confirmo-doctoras']]) {
      const r = correr(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--etapa-prueba solo va con --encender/);
    }
  });
});
