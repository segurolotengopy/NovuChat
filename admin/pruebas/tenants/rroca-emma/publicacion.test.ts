/**
 * LA GUARDIA DE PUBLICACIÓN del flujo de Emma (`construir.mjs --publicable`). El flujo NO se publica con marcadores `REEMPLAZAR_*` (rutas, ids de Meta, recepción, ids de las tres imágenes), con la plantilla de aviso
 * sin APPROVED (etapa completa), con la etapa de prueba mal armada, ni sin audio, imagen y documento declarados. Hoy sale 1 sobre lo versionado. Los mensajes nombran claves, nunca valores.
 * También el MODO PRUEBA de «Entrada de prueba» (la variante de prueba): va al teléfono de prueba y no se reporta.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { ARCHIVO_DE_DATOS, ARCHIVO_DE_NEGOCIO, guardiaDePublicacion } from '../../../../Flujos/experimental/rroca-emma/construir.mjs';
import { ANA, AJENO, BETO, IDS, PRODUCCION, PRUEBA, REC, crear, entrega, mTexto, valorMeta } from './mundo';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONSTRUIR = join(REPO, 'Flujos/experimental/rroca-emma/construir.mjs');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const MARCADORES = /REEMPLAZAR_[A-Z0-9][A-Z0-9_]*/g;
type Asignacion = { name: string; value: unknown };
const asignaciones = (f: Flujo): Asignacion[] => (f.nodes.find((n) => n.name === 'Config base')!.parameters as { assignments: { assignments: Asignacion[] } }).assignments.assignments;
const datosV = (): { configBase: Record<string, unknown> } & J => JSON.parse(readFileSync(ARCHIVO_DE_DATOS, 'utf8')) as { configBase: Record<string, unknown> } & J;
const negocioV = (): J => JSON.parse(readFileSync(ARCHIVO_DE_NEGOCIO, 'utf8')) as J;

/** El flujo, los datos y el negocio como quedarían con todos los marcadores sustituidos (ids de imagen y recepción reales, plantilla aprobada). */
function listo(prueba = false): { flujo: Flujo; datos: ReturnType<typeof datosV>; negocio: J } {
  const llenar = (s: string): string => s.replace(MARCADORES, (m) => (/MEDIA_ID_ARTE_COMPARATIVO/.test(m) ? m : /MEDIA_ID_ARTE_ANTES/.test(m) ? IDS.antes_despues : /MEDIA_ID_ARTE_AUTORIDAD/.test(m) ? IDS.autoridad : /ETAPA_PRUEBA/.test(m) ? '' : /RECEPCION/.test(m) ? REC : /TELEFONOS/.test(m) ? `${ANA},${BETO}` : /PHONE_NUMBER_ID|WABA_ID/.test(m) ? REC : 'valorsustituido'));
  const flujo = JSON.parse(llenar(JSON.stringify(prueba ? PRUEBA : PRODUCCION))) as Flujo;
  const datos = datosV(); datos.configBase = JSON.parse(llenar(JSON.stringify(datos.configBase))) as Record<string, unknown>;
  const negocio = JSON.parse(JSON.stringify(negocioV()).replace(MARCADORES, 'dato-real')) as J;
  return { flujo, datos, negocio };
}
const hallazgos = (x: { flujo: Flujo; datos: J; negocio: J }, etapa = 'encender'): string[] => guardiaDePublicacion({ ...x, etapa }) as string[];
const poner = (f: Flujo, nombre: string, valor: unknown): void => { asignaciones(f).find((a) => a.name === nombre)!.value = valor; };
const tmp = mkdtempSync(join(tmpdir(), 'emma-pub-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const cli = (...args: string[]): { status: number | null; out: string } => {
  const r = spawnSync(process.execPath, [CONSTRUIR, ...args], { encoding: 'utf8', env: entornoDelEmulador({}) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('la guardia: la ruta feliz y lo versionado de hoy', () => {
  it('con todo sustituido y la plantilla aprobada no hay hallazgos (producción y prueba)', () => {
    expect(hallazgos(listo())).toEqual([]);
    expect(hallazgos(listo(true))).toEqual([]);
  });
  it('lo versionado de hoy NO se puede publicar (sale 1 y nombra los marcadores, nunca valores)', () => {
    const r = cli('--publicable');
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/marcador sin sustituir: REEMPLAZAR_MEDIA_ID_ARTE_ANTES_DESPUES/);
    expect(r.out).toMatch(/arteAutoridadMediaId no está resuelto/);
    expect(r.out).toMatch(/REEMPLAZAR_RUTA_RECEPTOR_RROCA_EMMA/);
  });
  it('el CLI acepta un flujo, unos datos y un negocio ya sustituidos', () => {
    const { flujo, datos, negocio } = listo();
    const f = join(tmp, 'flujo.json'); const d = join(tmp, 'datos.json'); const n = join(tmp, 'negocio.json');
    writeFileSync(f, JSON.stringify(flujo)); writeFileSync(d, JSON.stringify(datos)); writeFileSync(n, JSON.stringify(negocio));
    const r = cli('--publicable', '--flujo', f, '--datos', d, '--negocio', n);
    expect(r.out).toMatch(/se puede publicar/);
    expect(r.status).toBe(0);
  });
  it('argumentos mal formados salen 2', () => {
    expect(cli('--publicable', '--etapa', 'inventada').status).toBe(2);
    expect(cli('--publicable', '--flujo').status).toBe(2);
    expect(cli('--publicable', '--verificar').status).toBe(2);
  });
});

describe('datos versionados = marcadores permitidos; flujo publicado = nada sin resolver', () => {
  const enPrueba = (): ReturnType<typeof listo> => { const x = listo(); poner(x.flujo, 'etapaPrueba', 'si'); poner(x.flujo, 'telefonosDePrueba', `${ANA},${BETO}`); poner(x.flujo, 'numeroRecepcion', BETO); return x; };
  it('(a) flujo resuelto + datos VERSIONADOS (con marcadores de ids de medio) pasa en la etapa prueba y en la completa', () => {
    const x = enPrueba();
    expect(hallazgos({ flujo: x.flujo, datos: datosV(), negocio: x.negocio }, 'prueba')).toEqual([]);
    const y = listo();
    expect(hallazgos({ flujo: y.flujo, datos: datosV(), negocio: y.negocio })).toEqual([]);
  });
  it('(a) por el CLI: flujo y negocio resueltos, sin --datos (los versionados), se puede publicar en la etapa prueba', () => {
    const { flujo, negocio } = enPrueba();
    const f = join(tmp, 'flujo-prueba.json'); const n = join(tmp, 'negocio-versionado-resuelto.json');
    writeFileSync(f, JSON.stringify(flujo)); writeFileSync(n, JSON.stringify(negocio));
    const r = cli('--publicable', '--flujo', f, '--negocio', n, '--etapa', 'prueba');
    expect(r.out).toMatch(/✓ Emma: etapa prueba/);
    expect(r.status).toBe(0);
  });
  it('(b) un id sin resolver en el FLUJO se niega (nombra «Config base», no los datos)', () => {
    const x = enPrueba(); poner(x.flujo, 'arteAutoridadMediaId', 'REEMPLAZAR_MEDIA_ID_ARTE_AUTORIDAD');
    const h = hallazgos({ flujo: x.flujo, datos: datosV(), negocio: x.negocio }, 'prueba').join(' ');
    expect(h).toMatch(/Config base: arteAutoridadMediaId no está resuelto/);
    expect(h).not.toMatch(/datos: arte/);
  });
  it('(c) un id (de una imagen activa) que no son dígitos se niega en el flujo, y en los datos si ni es dígitos ni marcador', () => {
    const x = enPrueba(); poner(x.flujo, 'arteAutoridadMediaId', 'abc123');
    expect(hallazgos({ flujo: x.flujo, datos: datosV(), negocio: x.negocio }, 'prueba').join(' ')).toMatch(/Config base: arteAutoridadMediaId no está resuelto/);
    const y = enPrueba(); const d = datosV(); d.configBase['arteAutoridadMediaId'] = 'abc123';
    expect(hallazgos({ flujo: y.flujo, datos: d, negocio: y.negocio }, 'prueba').join(' ')).toMatch(/datos: arteAutoridadMediaId no está resuelto/);
  });
});

describe('cada defecto se niega por separado', () => {
  it('un marcador sin sustituir en cualquier parte del flujo', () => {
    const x = listo(); x.flujo.nodes.find((n) => n.name === 'Armar mensajes')!.notes = 'REEMPLAZAR_RUTA_X';
    expect(hallazgos(x).join(' ')).toMatch(/marcador sin sustituir: REEMPLAZAR_RUTA_X/);
  });
  for (const c of ['arteAntesDespuesMediaId', 'arteAutoridadMediaId']) {
    it(`el id de la imagen sin resolver (${c})`, () => {
      const x = listo(); poner(x.flujo, c, 'REEMPLAZAR_MEDIA_ID_ARTE_X');
      const h = hallazgos(x).join(' ');
      expect(h).toMatch(new RegExp(`${c} no está resuelto`));
    });
  }
  it('la comparativa «¿Sculptra® o Radiesse®?» no existe como archivo: su id puede quedar como marcador, con o sin usarMarcas (imagen INACTIVA)', () => {
    const x = listo();
    expect(asignaciones(x.flujo).find((a) => a.name === 'arteComparativoMediaId')!.value).toBe('REEMPLAZAR_MEDIA_ID_ARTE_COMPARATIVO');
    expect(hallazgos(x)).toEqual([]);
    poner(x.flujo, 'usarMarcas', ''); x.datos.configBase['usarMarcas'] = '';
    expect(hallazgos(x)).toEqual([]);
  });
  it('un tenantId repetido en «Config base» se niega (falla cerrado)', () => {
    const x = listo(); asignaciones(x.flujo).push({ name: 'tenantId', value: 'rroca-evy' });
    expect(hallazgos(x).join(' ')).toMatch(/tenantId tiene que aparecer exactamente una vez/);
    const y = listo(); asignaciones(y.flujo).splice(asignaciones(y.flujo).findIndex((a) => a.name === 'tenantId'), 1);
    expect(hallazgos(y).join(' ')).toMatch(/tenantId tiene que aparecer exactamente una vez/);
  });
  it('la plantilla sin APPROVED (etapa completa) y sin nombre o idioma', () => {
    const x = listo(); poner(x.flujo, 'avisoSolicitudEstado', 'PENDING'); x.datos.configBase['avisoSolicitudEstado'] = 'PENDING';
    expect(hallazgos(x).join(' ')).toMatch(/avisoSolicitudEstado .* APPROVED/);
    expect(hallazgos(x, 'crear')).toEqual([]);
    expect(hallazgos(x, 'prueba').join(' ')).not.toMatch(/APPROVED/);
    const y = listo(); poner(y.flujo, 'avisoPlantillaIdioma', '');
    expect(hallazgos(y, 'crear').join(' ')).toMatch(/idioma/);
  });
  it('audio, imagen y documento declarados', () => {
    for (const faltante of ['audio', 'imagen', 'documento']) {
      const x = listo(); const v = 'audio,imagen,documento'.split(',').filter((m) => m !== faltante).join(',');
      poner(x.flujo, 'mediosHabilitados', v); x.datos.configBase['mediosHabilitados'] = v;
      expect(hallazgos(x).join(' ')).toMatch(new RegExp(`faltan: ${faltante}`));
    }
  });
  it('la rama de medios incompleta: sin nodo, sin arista, con el módulo común editado y sin credencial de Gemini', () => {
    const a = listo(); a.flujo.nodes = a.flujo.nodes.filter((n) => n.name !== 'Ver imagen');
    expect(hallazgos(a).join(' ')).toMatch(/falta el nodo «Ver imagen»/);
    const b = listo(); b.flujo.connections['¿Es audio?'] = { main: [[{ node: 'Transcribir audio', type: 'main', index: 0 }], []] };
    expect(hallazgos(b).join(' ')).toMatch(/«¿Es audio\?» no está conectado a «Ver imagen»/);
    const c = listo(); (c.flujo.nodes.find((n) => n.name === 'Preparar transcripción')!.parameters as J)['jsCode'] = 'return [];';
    expect(hallazgos(c).join(' ')).toMatch(/módulo común/);
    const d = listo(); delete (c.flujo.nodes.find((n) => n.name === 'Transcribir audio') as J)['credentials']; d.flujo.nodes.find((n) => n.name === 'Ver imagen')!.credentials = {};
    expect(hallazgos(d).join(' ')).toMatch(/Ver imagen» no lleva credencial/);
  });
  it('el flujo de otro negocio o con datos de otro: no coincide con los datos', () => {
    const x = listo(); x.flujo.name = 'Otro flujo';
    expect(hallazgos(x).join(' ')).toMatch(/nombre del flujo no es el de Emma/);
    const y = listo(); poner(y.flujo, 'nombreNegocio', 'Otra doctora');
    expect(hallazgos(y).join(' ')).toMatch(/nombreNegocio no coincide/);
  });
  it('el negocio sin dirección o con un marcador (el horario no se exige: turno partido, texto libre de la Consola)', () => {
    const x = listo(); ((x.negocio['negocio'] as J)['direccion']) = '';
    expect(hallazgos(x).join(' ')).toMatch(/falta la dirección/);
    // Emma: el horario es de turno partido y lo lee de la Consola como texto libre: el archivo del negocio NO lleva `horarios` y eso no es un hallazgo.
    const y = listo(); delete (y.negocio['negocio'] as J)['horarios'];
    expect(hallazgos(y).join(' ')).not.toMatch(/horarios/);
    const z = listo(); (z.negocio as J)['x'] = 'REEMPLAZAR_OTRO';
    expect(hallazgos(z).join(' ')).toMatch(/marcador sin sustituir: REEMPLAZAR_OTRO/);
  });
});

describe('la etapa prueba y la completa', () => {
  const enPrueba = (): ReturnType<typeof listo> => { const x = listo(); poner(x.flujo, 'etapaPrueba', 'si'); poner(x.flujo, 'telefonosDePrueba', `${ANA},${BETO}`); poner(x.flujo, 'numeroRecepcion', BETO); Object.assign(x.datos.configBase, { etapaPrueba: 'REEMPLAZAR_ETAPA_PRUEBA', numeroRecepcion: 'REEMPLAZAR_NUMERO_RECEPCION_RROCA_EMMA', telefonosDePrueba: 'REEMPLAZAR_TELEFONOS_DE_PRUEBA' }); return x; };
  it('la etapa prueba con todo en regla pasa; la completa la RECHAZA', () => {
    expect(hallazgos(enPrueba(), 'prueba')).toEqual([]);
    expect(hallazgos(enPrueba(), 'encender').join(' ')).toMatch(/la etapa completa no lo admite/);
  });
  it('la etapa prueba exige etapaPrueba = si', () => {
    const x = listo(); expect(hallazgos(x, 'prueba').join(' ')).toMatch(/exige etapaPrueba igual a «si»/);
  });
  it('la etapa prueba exige teléfonos de prueba válidos con prefijo y la recepción DENTRO de ellos', () => {
    const a = enPrueba(); poner(a.flujo, 'telefonosDePrueba', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA');
    expect(hallazgos(a, 'prueba').join(' ')).toMatch(/telefonosDePrueba lleno y válido/);
    const b = enPrueba(); poner(b.flujo, 'numeroRecepcion', REC);
    expect(hallazgos(b, 'prueba').join(' ')).toMatch(/numeroRecepcion esté dentro de telefonosDePrueba/);
    const c = enPrueba(); poner(c.flujo, 'telefonosDePrueba', `${ANA},${BETO},${['44', '7', '1234567'].join('')}`);
    expect(hallazgos(c, 'prueba').join(' ')).toMatch(/empiece con uno de los prefijosPermitidos/);
    const d = enPrueba(); poner(d.flujo, 'prefijosPermitidos', '591'); poner(d.flujo, 'numeroRecepcion', ['44', '7', '1234567'].join('')); poner(d.flujo, 'telefonosDePrueba', `${ANA},${['44', '7', '1234567'].join('')}`);
    expect(hallazgos(d, 'prueba').join(' ')).toMatch(/numeroRecepcion empiece con/);
  });
});

describe('el modo prueba de «Entrada de prueba» (variante de prueba)', () => {
  const cuerpoPrueba = (extra: J): J => ({ body: { ...valorMeta(mTexto('quiero información'), ANA), ...extra } });
  it('con enviarDeVerdad falso no envía nada y no reporta a la ingesta; responde el resumen', () => {
    const m = crear({ flujo: PRUEBA, base: { telefonosDePrueba: `${ANA},${BETO}` } });
    const t = m.turno(cuerpoPrueba({ modoPrueba: true, telefonoDePrueba: ANA, enviarDeVerdad: false }), { via: 'Entrada de prueba' });
    expect(t.mensajes.length).toBe(0);
    expect(t.llamadas.ingesta.length).toBe(0);
    expect(t.resumen!['ok']).toBe(true);
    expect((t.resumen!['mensajes'] as J[]).length).toBe(1);
  });
  it('con enviarDeVerdad va al teléfono de prueba permitido, nunca a otro', () => {
    const m = crear({ flujo: PRUEBA, base: { telefonosDePrueba: `${ANA},${BETO}` } });
    const t = m.turno(cuerpoPrueba({ modoPrueba: true, telefonoDePrueba: BETO, enviarDeVerdad: true }), { via: 'Entrada de prueba' });
    expect(t.mensajes.map((e) => e.a)).toEqual([BETO]);
    const n = crear({ flujo: PRUEBA, base: { telefonosDePrueba: `${ANA},${BETO}` } });
    const u = n.turno(cuerpoPrueba({ modoPrueba: true, telefonoDePrueba: AJENO, enviarDeVerdad: true }), { via: 'Entrada de prueba' });
    expect(u.mensajes.length).toBe(0);
  });
  it('una carga de WhatsApp con «modoPrueba» adentro no activa el modo prueba en producción', () => {
    const m = crear();
    const v = valorMeta(mTexto('hola'), ANA) as J; v['modoPrueba'] = true;
    const t = m.turno(entrega(v));
    expect(t.mensajes.length).toBe(1);
    expect(t.mensajes[0]!.a).toBe(ANA);
  });
});
