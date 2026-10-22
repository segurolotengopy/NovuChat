/**
 * LAS DOCTORAS — PR-C, LA GUARDIA DE PUBLICACIÓN (`construir.mjs --publicable`).
 *
 * El flujo NO se publica ni se importa a n8n con marcadores `REEMPLAZAR_*`, con la plantilla de aviso sin `APPROVED`, sin la dirección o el horario de la doctora, con la rama de medios incompleta ni sin el aviso a
 * recepción. Esta suite NIEGA: hoy `--publicable` sale 1 sobre lo versionado de las dos doctoras, y cada defecto de la ruta feliz se niega por separado. Los mensajes nombran claves y marcadores, nunca valores.
 * (El bloque de `scripts/publicar-flujo.sh` y su confirmación son de Core/DevOps y van en un PR aparte con revisión de `seguridad`: no se tocan aquí.)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { ARISTAS_DE_MEDIOS, NODOS_DE_MEDIOS, archivoDeDatos, archivoDeNegocio, guardiaDePublicacion } from '../../../../Flujos/experimental/doctoras/construir.mjs';
import { TENANTS, flujoDe, type Tenant } from './mundo';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CONSTRUIR = join(REPO, 'Flujos/experimental/doctoras/construir.mjs');
const leer = (r: string): string => readFileSync(r, 'utf8');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Datos = { configBase: Record<string, unknown>; doctora: Record<string, unknown> };
const MARCADORES = /REEMPLAZAR_[A-Z0-9][A-Z0-9_]*/g;
const datosDe = (t: Tenant): Datos => JSON.parse(leer(archivoDeDatos(t))) as Datos;
const negocioDe = (t: Tenant): Record<string, unknown> => JSON.parse(leer(archivoDeNegocio(t))) as Record<string, unknown>;
type Asignacion = { name: string; value: unknown };
const asignaciones = (f: Flujo): Asignacion[] => (f.nodes.find((n) => n.name === 'Config base')!.parameters as { assignments: { assignments: Asignacion[] } }).assignments.assignments;

/** El flujo, los datos y el negocio tal como quedarían con todos los marcadores sustituidos y la plantilla aprobada. */
function listo(t: Tenant): { flujo: Flujo; datos: Datos; negocio: Record<string, unknown> } {
  const flujo = JSON.parse(JSON.stringify(flujoDe(t)).replace(MARCADORES, 'valorsustituido')) as Flujo;
  asignaciones(flujo).find((a) => a.name === 'avisoSolicitudEstado')!.value = 'APPROVED';
  const datos = JSON.parse(JSON.stringify(datosDe(t)).replace(MARCADORES, 'valorsustituido')) as Datos;
  datos.configBase['avisoSolicitudEstado'] = 'APPROVED';
  const negocio = JSON.parse(JSON.stringify(negocioDe(t)).replace(MARCADORES, 'dato-real')) as Record<string, unknown>;
  return { flujo, datos, negocio };
}
const hallazgos = (x: { flujo: Flujo; datos: Datos; negocio: Record<string, unknown> }): string[] => guardiaDePublicacion(x) as string[];
const cli = (...args: string[]): { status: number | null; out: string } => {
  const r = spawnSync(process.execPath, [CONSTRUIR, ...args], { encoding: 'utf8', env: entornoDelEmulador({}) });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('la guardia de publicación: la ruta feliz y lo versionado de hoy', () => {
  for (const t of TENANTS) {
    it(`${t}: con todo sustituido, la plantilla APPROVED, la dirección y el horario, no hay hallazgos`, () => {
      expect(hallazgos(listo(t))).toEqual([]);
      const p = listo(t); p.flujo = JSON.parse(JSON.stringify(flujoDe(t, true)).replace(MARCADORES, 'valorsustituido')) as Flujo;
      asignaciones(p.flujo).find((a) => a.name === 'avisoSolicitudEstado')!.value = 'APPROVED';
      expect(hallazgos(p)).toEqual([]);
    });
    it(`${t}: lo versionado de hoy NO es publicable: marcadores y plantilla PENDING`, () => {
      const h = hallazgos({ flujo: flujoDe(t), datos: datosDe(t), negocio: negocioDe(t) });
      expect(h.some((x) => /marcador sin sustituir/.test(x))).toBe(true);
      expect(h.join('|')).toMatch(/avisoSolicitudEstado/);
    });
  }
  it('los literales de comentario y de expresión regular de los módulos copiados NO cuentan como marcador (pero un marcador real, sí)', () => {
    expect(JSON.stringify(flujoDe('rroca-evy'))).toMatch(/\^REEMPLAZAR_|reemplazar_\/i|`REEMPLAZAR_`/);
    expect(hallazgos(listo('rroca-evy'))).toEqual([]);
  });
  it('el horario vacío de Evy (aún no lo dio) bloquea la publicación, con su campo nombrado', () => {
    const h = hallazgos({ flujo: flujoDe('rroca-evy'), datos: datosDe('rroca-evy'), negocio: negocioDe('rroca-evy') });
    expect(h).toContain('datos: doctora.horario está vacío o es un marcador');
    expect(h).toContain('marcador sin sustituir: REEMPLAZAR_HORARIO_RROCA_EVY');
    expect(hallazgos({ flujo: flujoDe('rroca-emma'), datos: datosDe('rroca-emma'), negocio: negocioDe('rroca-emma') }).join('|')).not.toMatch(/horario/);
  });
});

describe('la guardia de publicación: cada defecto se niega', () => {
  it('un marcador en cualquier parte del JSON completo (nodo, conexiones, ajustes, nivel superior), en cualquier grafía y con NFKC', () => {
    for (const grafia of ['REEMPLAZAR_X', 'reemplazar_x', 'Reemplazar_Mixto', 'ＲＥＥＭＰＬＡＺＡＲ_ancho', 'REEMPLAZAR_-X']) {
      for (const donde of ['nodo', 'ajustes', 'superior', 'conexiones']) {
        const x = listo('rroca-emma'); const f = x.flujo as unknown as Record<string, any>;
        if (donde === 'nodo') f['nodes'][0]['notes'] = grafia;
        if (donde === 'ajustes') f['settings']['x'] = grafia;
        if (donde === 'superior') f['pinData'] = { a: grafia };
        if (donde === 'conexiones') f['connections']['zzz'] = { main: [[{ node: grafia }]] };
        expect(hallazgos(x).some((h) => /marcador sin sustituir/.test(h)), `${grafia} ${donde}`).toBe(true);
      }
    }
  });
  it('la plantilla del aviso: sin APPROVED (ausente, PENDING, REJECTED, PAUSED, con espacio), en «Config base» o en los datos; sin nombre o sin idioma', () => {
    for (const estado of [undefined, 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'approved', 'APPROVED ', '']) {
      const a = listo('rroca-emma'); asignaciones(a.flujo).find((x) => x.name === 'avisoSolicitudEstado')!.value = estado;
      expect(hallazgos(a).join('|'), `flujo ${String(estado)}`).toMatch(/Config base: avisoSolicitudEstado/);
      const b = listo('rroca-emma'); if (estado === undefined) delete b.datos.configBase['avisoSolicitudEstado']; else b.datos.configBase['avisoSolicitudEstado'] = estado;
      expect(hallazgos(b).join('|'), `datos ${String(estado)}`).toMatch(/datos: avisoSolicitudEstado/);
    }
    for (const clave of ['avisoSolicitudPlantilla', 'avisoPlantillaIdioma']) {
      const a = listo('rroca-emma'); asignaciones(a.flujo).find((x) => x.name === clave)!.value = '';
      expect(hallazgos(a).join('|'), clave).toMatch(new RegExp(`falta el nombre|falta el idioma`));
    }
  });
  it('la dirección o el nombre de la doctora vacíos; el negocio sin dirección o con un marcador distinto del número de recepción', () => {
    for (const campo of ['direccion', 'clinica', 'nombreCorto', 'horario']) {
      const a = listo('rroca-emma'); a.datos.doctora[campo] = '';
      expect(hallazgos(a).join('|'), campo).toContain(`datos: doctora.${campo} está vacío o es un marcador`);
    }
    const b = listo('rroca-emma'); delete (b.negocio['negocio'] as Record<string, unknown>)['direccion'];
    expect(hallazgos(b)).toContain('negocio: falta la dirección');
    const c = listo('rroca-emma'); (c.negocio['negocio'] as Record<string, unknown>)['nombreNegocio'] = 'REEMPLAZAR_NOMBRE';
    expect(hallazgos(c)).toContain('negocio: marcador sin sustituir: REEMPLAZAR_NOMBRE');
    const d = listo('rroca-emma'); (d.negocio['negocio'] as Record<string, unknown>)['numeroRecepcionMarcador'] = 'REEMPLAZAR_NUMERO_RECEPCION_RROCA_EMMA';
    expect(hallazgos(d)).toEqual([]);   // el número de recepción es el ÚNICO marcador tolerado en el negocio (lo resuelve la tabla local al cargar)
  });
  it('la rama de medios: falta un nodo, una arista, el código de un módulo común o la credencial de Gemini', () => {
    for (const n of NODOS_DE_MEDIOS as string[]) {
      const a = listo('rroca-emma'); a.flujo.nodes = a.flujo.nodes.filter((x) => x.name !== n);
      expect(hallazgos(a).join('|'), n).toContain(`medios: falta el nodo «${n}»`);
    }
    for (const [de, para] of ARISTAS_DE_MEDIOS as Array<[string, string]>) {
      const a = listo('rroca-emma'); const c = a.flujo.connections as Record<string, { main: Array<Array<{ node: string }>> }>;
      c[de]!.main = c[de]!.main.map((s) => s.filter((x) => x.node !== para));
      expect(hallazgos(a).join('|'), `${de}→${para}`).toContain(`medios: «${de}» no está conectado a «${para}»`);
    }
    for (const n of ['Preparar transcripción', 'Preparar imagen', 'Medio no aceptado']) {
      const a = listo('rroca-emma'); const nodo = a.flujo.nodes.find((x) => x.name === n)!; nodo.parameters['jsCode'] = '// una copia editada\n' + String(nodo.parameters['jsCode']).slice(40);
      expect(hallazgos(a).join('|'), n).toContain(`medios: el código de «${n}» no es el del módulo común`);
    }
    for (const n of ['Transcribir audio', 'Describir documento', 'Describir imagen']) {
      const a = listo('rroca-emma'); delete a.flujo.nodes.find((x) => x.name === n)!.credentials;
      expect(hallazgos(a).join('|'), n).toContain(`medios: «${n}» no lleva credencial de Gemini`);
    }
  });
  it('la conversación incompleta (sin el modelo o sin el aviso a recepción) no se publica', () => {
    for (const n of ['Armar avisos', '¿Hay avisos?', 'Enviar aviso', 'Conversar con el modelo']) {
      const a = listo('rroca-evy'); a.flujo.nodes = a.flujo.nodes.filter((x) => x.name !== n);
      expect(hallazgos(a).join('|'), n).toContain(`conversación: falta el nodo «${n}»`);
    }
  });
  it('los mensajes nombran claves y marcadores, NUNCA valores (ni de los datos ni del flujo)', () => {
    const x = listo('rroca-emma'); x.datos.doctora['direccion'] = '';
    (x.flujo.nodes.find((n) => n.name === 'Config base')!.parameters as J2).assignments.assignments.find((a: Asignacion) => a.name === 'numeroRecepcion').value = 'valor-secreto-5917';
    expect(hallazgos(x).join('\n')).not.toMatch(/valor-secreto|5917/);
  });
});
type J2 = { assignments: { assignments: Asignacion[] & { find: (f: (a: Asignacion) => boolean) => any } } };

describe('la línea de comandos: `--publicable` sale 1 hoy, nunca imprime valores y rechaza los argumentos mal formados', () => {
  it('sin argumentos más revisa a las dos doctoras: sale 1 y nombra a cada una', () => {
    const r = cli('--publicable');
    expect(r.status).toBe(1);
    expect(r.out).toContain('El flujo de rroca-evy NO se puede publicar todavía');
    expect(r.out).toContain('El flujo de rroca-emma NO se puede publicar todavía');
    expect(r.out).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
  });
  it('--tenant revisa solo a esa doctora; un tenant que no existe falla (1) y uno con forma inválida, también', () => {
    expect(cli('--publicable', '--tenant', 'rroca-emma').out).not.toContain('rroca-evy');
    expect(cli('--publicable', '--tenant', 'rroca-nadie').status).toBe(1);
    expect(cli('--publicable', '--tenant', '../../etc').status).toBe(1);
  });
  it('argumentos mal formados: 2 (opción sin valor, --flujo sin --tenant, otra bandera, mezclar con --verificar)', () => {
    for (const args of [['--publicable', '--tenant'], ['--publicable', '--flujo', 'x.json'], ['--publicable', '--otra'], ['--publicable', '--verificar']]) expect(cli(...args).status, args.join(' ')).toBe(2);
    expect(cli('--ayuda').status).toBe(2);
  });
  it('con un archivo ilegible el mensaje es fijo: no cita fragmentos del archivo', () => {
    const r = cli('--publicable', '--tenant', 'rroca-emma', '--flujo', join(REPO, 'admin/pruebas/tenants/doctoras/mundo.ts'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('JSON inválido en el flujo de rroca-emma');
    expect(r.out).not.toContain('crearMundo');
  });
});
