/**
 * LAS DOCTORAS — PR-C, LA GUARDIA DE PUBLICACIÓN (`construir.mjs --publicable`).
 *
 * El flujo NO se publica ni se importa a n8n con marcadores `REEMPLAZAR_*`, con la plantilla de aviso sin `APPROVED`, sin la dirección o el horario de la doctora, con la rama de medios incompleta ni sin el aviso a
 * recepción. Esta suite NIEGA: hoy `--publicable` sale 1 sobre lo versionado de las dos doctoras, y cada defecto de la ruta feliz se niega por separado. Los mensajes nombran claves y marcadores, nunca valores.
 * También prueba `scripts/publicar-flujo.sh`: se niega con --aplicar/--crear/--encender si la guardia falla, pide `PUBLICAR DOCTORAS` (o --confirmo-doctoras sin terminal), `--forzar` no la salta y `--apagar` no la pide.
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

/** El mismo cambio en la asignación `doctora` de «Config base» (lo que arma el construir.mjs al cambiar el dato). */
function confirmarEnFlujo(flujo: Flujo): void {
  const a = asignaciones(flujo).find((x) => x.name === 'doctora')!;
  const d = JSON.parse(String(a.value)) as Record<string, unknown>; d['horarioPorConfirmar'] = false; a.value = JSON.stringify(d);
}
/** El flujo, los datos y el negocio tal como quedarían con todos los marcadores sustituidos y la plantilla aprobada. */
function listo(t: Tenant): { flujo: Flujo; datos: Datos; negocio: Record<string, unknown> } {
  const flujo = JSON.parse(JSON.stringify(flujoDe(t)).replace(MARCADORES, 'valorsustituido')) as Flujo;
  asignaciones(flujo).find((a) => a.name === 'avisoSolicitudEstado')!.value = 'APPROVED';
  const datos = JSON.parse(JSON.stringify(datosDe(t)).replace(MARCADORES, 'valorsustituido')) as Datos;
  datos.configBase['avisoSolicitudEstado'] = 'APPROVED';
  // Emma: la doctora ya confirmó su horario (el indicador pasa a false en los datos Y en lo que se arma).
  if (datos.doctora['horarioPorConfirmar'] === true) { datos.doctora['horarioPorConfirmar'] = false; confirmarEnFlujo(flujo); }
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
      if (datosDe(t).doctora['horarioPorConfirmar'] === true) confirmarEnFlujo(p.flujo);
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
  it('el horario de Evy sale de la CONSOLA (negocio.horarios): su dato ya no lo trae; sin horario en la consola ni respaldo, la etapa completa falla', () => {
    expect(datosDe('rroca-evy').doctora).not.toHaveProperty('horario');
    expect(datosDe('rroca-evy').doctora).not.toHaveProperty('direccion');
    expect(JSON.stringify(negocioDe('rroca-evy'))).not.toMatch(/REEMPLAZAR_HORARIO/);
    const h = hallazgos({ flujo: flujoDe('rroca-evy'), datos: datosDe('rroca-evy'), negocio: negocioDe('rroca-evy') });
    expect(h.join('|')).not.toMatch(/horario/i);
    // Negada: sin `negocio.horarios` (y sin respaldo) no se publica; con un día vacío tampoco cuenta como horario.
    const x = listo('rroca-evy'); delete (x.negocio['negocio'] as Record<string, unknown>)['horarios'];
    expect(hallazgos(x)).toContain('datos: doctora.horario está vacío o es un marcador');
    const y = listo('rroca-evy'); (y.negocio['negocio'] as Record<string, unknown>)['horarios'] = { lun: '', mar: '  ' };
    expect(hallazgos(y)).toContain('datos: doctora.horario está vacío o es un marcador');
  });
  it('el horario de Emma está confirmado (22/10): horarioPorConfirmar es false; con true la etapa completa FALLA', () => {
    expect(datosDe('rroca-emma').doctora['horarioPorConfirmar']).toBe(false);
    expect(datosDe('rroca-emma').doctora['horario']).toMatch(/lunes a viernes de 09:00 a 12:00 y de 14:00 a 18:00.*sábados de 09:00 a 12:00/);
    const h = hallazgos({ flujo: flujoDe('rroca-emma'), datos: datosDe('rroca-emma'), negocio: negocioDe('rroca-emma') });
    expect(h.join('|')).not.toMatch(/horario/i);
    const x = listo('rroca-emma'); x.datos.doctora['horarioPorConfirmar'] = true;
    const lista = asignaciones(x.flujo).find((q) => q.name === 'doctora')!;
    lista.value = JSON.stringify({ ...(JSON.parse(String(lista.value)) as object), horarioPorConfirmar: true });
    expect(hallazgos(x)).toEqual(['datos: doctora.horarioPorConfirmar es true: el horario aún no lo confirmó la doctora']);
    expect(hallazgos(listo('rroca-emma'))).toEqual([]);
  });
  it('M1: el flujo de una doctora con los datos de la otra NO pasa (nombre, bloque `doctora` y configBase)', () => {
    const a = listo('rroca-emma'); const e = listo('rroca-evy');
    const mezcla = hallazgos({ flujo: a.flujo, datos: e.datos, negocio: e.negocio });
    expect(mezcla).toContain('el nombre del flujo no es el de esta doctora (nombreFlujo ni nombreFlujoPrueba de los datos)');
    expect(mezcla).toContain('Config base: la asignación `doctora` no coincide con el bloque `doctora` de los datos de esta doctora');
    expect(mezcla.join('|')).toMatch(/Config base: (nombreNegocio|phoneNumberIdEsperado|numeroRecepcion|telefonosDePrueba) no coincide/);
    // Solo el nombre: el flujo de Emma con el nombre de un flujo ajeno.
    const n = listo('rroca-emma'); n.flujo.name = 'Otro flujo';
    expect(hallazgos(n)).toEqual(['el nombre del flujo no es el de esta doctora (nombreFlujo ni nombreFlujoPrueba de los datos)']);
    // Solo la asignación `doctora`: un texto distinto en el bloque.
    const d = listo('rroca-emma'); const as = asignaciones(d.flujo).find((q) => q.name === 'doctora')!;
    as.value = JSON.stringify({ ...(JSON.parse(String(as.value)) as object), direccion: 'otra dirección' });
    expect(hallazgos(d)).toEqual(['Config base: la asignación `doctora` no coincide con el bloque `doctora` de los datos de esta doctora']);
    // Solo un valor de configBase (no marcador).
    const c = listo('rroca-emma'); asignaciones(c.flujo).find((q) => q.name === 'nombreNegocio')!.value = 'Otro negocio';
    expect(hallazgos(c)).toEqual(['Config base: nombreNegocio no coincide con los datos de esta doctora']);
    expect(hallazgos(c).join('')).not.toContain('Otro negocio');
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
  it('el nombre o la clínica de la doctora vacíos; el negocio sin dirección o con un marcador distinto del número de recepción', () => {
    for (const campo of ['clinica', 'nombreCorto', 'horario']) {
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
    const x = listo('rroca-emma'); x.datos.doctora['clinica'] = '';
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

describe('la etapa «crear» (flujo INACTIVO para dar la URL de entrada): tolera solo la plantilla sin APPROVED y el horario pendiente', () => {
  const HORARIO_EVY = 'REEMPLAZAR_HORARIO_RROCA_EVY';
  /** Todo sustituido, plantilla PENDING y horario pendiente (Emma: por confirmar; Evy no tiene horario pendiente: sale de la consola). */
  function pendiente(t: Tenant): { flujo: Flujo; datos: Datos; negocio: Record<string, unknown> } {
    const x = listo(t);
    const estadoDelFlujo = asignaciones(x.flujo).find((a) => a.name === 'avisoSolicitudEstado')!;
    estadoDelFlujo.value = 'PENDING'; x.datos.configBase['avisoSolicitudEstado'] = 'PENDING';
    if (t === 'rroca-emma') {
      x.datos.doctora['horarioPorConfirmar'] = true;
      const a = asignaciones(x.flujo).find((y) => y.name === 'doctora')!;
      const d = JSON.parse(String(a.value)) as Record<string, unknown>; d['horarioPorConfirmar'] = true; a.value = JSON.stringify(d);
    }
    return x;
  }
  const crear = (x: { flujo: Flujo; datos: Datos; negocio: Record<string, unknown> }): string[] => guardiaDePublicacion({ ...x, etapa: 'crear' }) as string[];
  for (const t of TENANTS) {
    it(`${t}: con plantilla PENDING y horario pendiente, la etapa crear PASA y la completa (encender) NIEGA, también sin etapa`, () => {
      const x = pendiente(t);
      expect(crear(x)).toEqual([]);
      const completa = hallazgos(x).join('|');
      expect(completa).toMatch(/avisoSolicitudEstado/);
      if (t === 'rroca-emma') expect(completa).toMatch(/horarioPorConfirmar/);
      expect((guardiaDePublicacion({ ...x, etapa: 'encender' }) as string[]).length).toBeGreaterThan(0);
    });
    it(`${t}: cada defecto por separado se NIEGA en la etapa crear: marcador distinto del horario, medio faltante, sin credencial, identidad cruzada`, () => {
      const m = pendiente(t); asignaciones(m.flujo).find((a) => a.name === 'phoneNumberIdEsperado')!.value = 'REEMPLAZAR_PHONE_ID';
      expect(crear(m).join('|')).toMatch(/marcador sin sustituir: REEMPLAZAR_PHONE_ID/);
      const n = pendiente(t); n.negocio['otro'] = 'REEMPLAZAR_OTRO';
      expect(crear(n).join('|')).toMatch(/marcador sin sustituir: REEMPLAZAR_OTRO/);
      const f = pendiente(t); f.flujo.nodes = f.flujo.nodes.filter((y) => y.name !== 'Describir imagen');
      expect(crear(f).join('|')).toMatch(/medios: falta el nodo «Describir imagen»/);
      const c = pendiente(t); delete (c.flujo.nodes.find((y) => y.name === 'Transcribir audio') as { credentials?: unknown }).credentials;
      expect(crear(c).join('|')).toMatch(/«Transcribir audio» no lleva credencial de Gemini/);
      const o = TENANTS.find((y) => y !== t)!;
      const i = pendiente(t); i.datos = pendiente(o).datos;
      expect(crear(i).join('|')).toMatch(/no es el de esta doctora|no coincide con/);
    });
  }
  it('ya NO hay marcador de horario tolerado: ni en Evy (su horario sale de la consola) ni en la etapa crear', () => {
    const ne = pendiente('rroca-evy'); ne.negocio['horario'] = HORARIO_EVY;
    expect(crear(ne).join('|')).toMatch(/negocio: marcador sin sustituir: REEMPLAZAR_HORARIO_RROCA_EVY/);
    const nm = pendiente('rroca-emma'); nm.negocio['horario'] = HORARIO_EVY;
    expect(crear(nm).join('|')).toMatch(/negocio: marcador sin sustituir: REEMPLAZAR_HORARIO_RROCA_EVY/);
    const m = pendiente('rroca-emma'); m.datos.doctora['horario'] = HORARIO_EVY;
    expect(crear(m).join('|')).toMatch(/horario|no coincide|marcador/);
  });
  it('una etapa desconocida no pasa; por la línea de comandos sale 2', () => {
    expect(guardiaDePublicacion({ ...pendiente('rroca-evy'), etapa: 'x' }).length).toBeGreaterThan(0);
    expect(cli('--publicable', '--etapa', 'x').status).toBe(2);
    expect(cli('--publicable', '--etapa').status).toBe(2);
  });
  it('por la línea de comandos, lo versionado de hoy NO pasa la etapa crear (marcadores de ids), ni sin etapa', () => {
    for (const t of TENANTS) {
      const c = cli('--publicable', '--etapa', 'crear', '--tenant', t);
      expect(c.status).toBe(1);
      expect(c.out).toMatch(/marcador sin sustituir/);
      expect(c.out).not.toMatch(/avisoSolicitudEstado|horarioPorConfirmar/);
      expect(cli('--publicable', '--tenant', t).status).toBe(1);
      expect(cli('--publicable', '--tenant', t).out).not.toMatch(/horario/i);
    }
  });
});

describe('publicar-flujo.sh: la guardia y la confirmación de los flujos de las doctoras', () => {
  const SCRIPT = join(REPO, 'scripts/publicar-flujo.sh');
  const dir = mkdtempSync(join(tmpdir(), 'doctoras-sh-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const EVY = join(REPO, 'Flujos/experimental/doctoras/doctoras.rroca-evy.json');
  const bin = join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), '#!/usr/bin/env bash\necho "$*" >> "$LOG_CURL"\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) O="$2"; shift 2;; -X) M="$2"; shift 2;; *) shift;; esac; done\n[[ -n "$O" ]] && cp "$VIVO_SIMULADO" "$O"\nprintf 200\n');
  chmodSync(join(bin, 'curl'), 0o755);
  const envRel = join(dir, 'env');
  writeFileSync(envRel, 'N8N_API_KEY=clave-de-juguete\nN8N_WORKFLOW_ID=1\nN8N_BASE_URL=http://n8n.invalido\n');
  const vivoEvy = join(dir, 'vivo-evy.json');
  writeFileSync(vivoEvy, JSON.stringify({ name: 'NovuChat — Dra. Evy Karina (rroca-evy)', active: false, nodes: [] }));
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
  // Una copia del script con un construir.mjs de juguete (sale con el código dado): se llega a la confirmación sin depender de que el JSON real esté listo.
  function raizConGuardia(codigoSalida: number): string {
    const raiz = join(dir, `raiz-${codigoSalida}`);
    mkdirSync(join(raiz, 'scripts'), { recursive: true });
    mkdirSync(join(raiz, 'Flujos/experimental/doctoras'), { recursive: true });
    copyFileSync(SCRIPT, join(raiz, 'scripts/publicar-flujo.sh'));
    writeFileSync(join(raiz, 'Flujos/experimental/doctoras/construir.mjs'), `process.exit(${codigoSalida});\n`);
    writeFileSync(join(raiz, 'Flujos/experimental/doctoras/doctoras.rroca-evy.json'), JSON.stringify({ name: 'doctoras', nodes: [] }));
    writeFileSync(join(raiz, 'Flujos/demo-a-agendamiento.json'), JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    chmodSync(join(raiz, 'scripts/publicar-flujo.sh'), 0o755);
    return raiz;
  }
  const REL = 'Flujos/experimental/doctoras/doctoras.rroca-evy.json';

  it('con --aplicar y el JSON versionado (marcadores) se NIEGA antes de leer el .env o hablar con n8n; --forzar y la confirmación no lo salvan', () => {
    for (const extra of [[], ['--forzar', '--confirmo-doctoras']]) {
      const r = correr(['--flujo', EVY, '--aplicar', ...extra]);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/NEGADO: el flujo de las doctoras no se publica/);
      expect(r.stderr).not.toMatch(/Falta /);
    }
    expect(escribio()).toBe(false);
  });
  it('otro nombre de archivo (copia .local, nombre cualquiera con el nombre del flujo, mayúsculas) también se NIEGA', () => {
    const otro = join(dir, 'x.json');
    writeFileSync(otro, JSON.stringify({ name: 'NovuChat — Dra. Emma (rroca-emma)', nodes: [] }));
    const r = correr(['--flujo', otro, '--aplicar', '--confirmo-doctoras']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/rroca-emma/);
    expect(r.stderr).toMatch(/NEGADO/);
    const mayus = join(dir, 'DOCTORAS.RROCA-EVY-x.json');
    writeFileSync(mayus, JSON.stringify({ name: 'Otro cliente', nodes: [] }));
    expect(correr(['--flujo', mayus, '--aplicar', '--confirmo-doctoras']).stdout).toMatch(/archivo de origen/);
    const ambos = join(dir, 'ambos.json');
    writeFileSync(ambos, JSON.stringify({ name: 'rroca-evy rroca-emma', nodes: [] }));
    expect(correr(['--flujo', ambos, '--aplicar', '--confirmo-doctoras']).status).toBe(1);
  });
  it('en seco informa lo que falta y SIGUE', () => {
    const r = correr(['--flujo', EVY]);
    expect(r.stdout + r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stdout).toMatch(/en seco se sigue/);
    expect(r.stdout + r.stderr).not.toMatch(/NEGADO/);
  });
  it('un flujo de otro cliente NO pasa por la guardia de las doctoras', () => {
    const r = correr(['--flujo', join(REPO, 'Flujos/demo-a-agendamiento.json'), '--aplicar']);
    expect(r.stdout + r.stderr).not.toMatch(/Flujo de las doctoras|NEGADO/);
  });
  it('--forzar contra el flujo VIVO de una doctora con un archivo de otro nombre vuelve a correr la guardia: sale 1 y no escribe', () => {
    const v = correr(['--flujo', otroArchivo, '--forzar', '--aplicar', '--confirmo-doctoras'], vivoEvy);
    expect(v.status).toBe(1);
    expect(v.stdout + v.stderr).toMatch(/flujo vivo de destino/);
    expect(escribio()).toBe(false);
  });
  it('con la guardia en verde y sin terminal, --aplicar SIN --confirmo-doctoras se NIEGA; con él sigue al .env', () => {
    const raiz = raizConGuardia(0);
    const sin = correrEn(raiz, ['--flujo', REL, '--aplicar'], vivoOtro);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publican con --confirmo-doctoras/);
    expect(correrEn(raiz, ['--flujo', REL, '--aplicar', '--confirmo-doctoras'], vivoOtro).stderr).not.toMatch(/NEGADO/);
  });
  it('--crear: la guardia del archivo de origen rige (sin confirmación y con la guardia en rojo se niega)', () => {
    const sin = correrEn(raizConGuardia(0), ['--flujo', REL, '--crear', '--aplicar'], vivoOtro);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publican con --confirmo-doctoras/);
    const r = correrEn(raizConGuardia(1), ['--flujo', REL, '--crear', '--aplicar', '--confirmo-doctoras'], vivoOtro);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO: el flujo de las doctoras no se publica/);
    expect(escribio()).toBe(false);
  });
  // Una copia del script con un construir.mjs de juguete que SOLO aprueba la etapa `crear`: prueba qué etapa pide el publicador.
  function raizSoloCrear(): string {
    const raiz = raizConGuardia(1);
    writeFileSync(join(raiz, 'Flujos/experimental/doctoras/construir.mjs'), "process.exit(process.argv.join(' ').includes('--etapa crear') ? 0 : 1);\n");
    return raiz;
  }
  it('--crear SIN activar pide la etapa crear (pasa la guardia); --crear --activar, --encender y --aplicar sobre un flujo activo exigen la completa y se NIEGAN; --forzar no salta nada', () => {
    const raiz = raizSoloCrear();
    const ok = correrEn(raiz, ['--flujo', REL, '--crear', '--aplicar', '--confirmo-doctoras'], vivoOtro);
    expect(ok.stdout).toMatch(/etapa crear/);
    expect(ok.stderr).not.toMatch(/NEGADO/);
    const sinConfirmar = correrEn(raiz, ['--flujo', REL, '--crear', '--aplicar'], vivoOtro);
    expect(sinConfirmar.status).toBe(1);
    expect(sinConfirmar.stderr).toMatch(/solo se publican con --confirmo-doctoras/);
    for (const args of [['--flujo', REL, '--crear', '--activar', '--aplicar', '--confirmo-doctoras'], ['--flujo', REL, '--crear', '--activar', '--forzar', '--aplicar', '--confirmo-doctoras'],
      ['--flujo', REL, '--aplicar', '--confirmo-doctoras'], ['--flujo', REL, '--forzar', '--aplicar', '--confirmo-doctoras']]) {
      const r = correrEn(raiz, args, vivoEvy);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stdout).toMatch(/etapa encender/);
      expect(r.stderr).toMatch(/NEGADO/);
      expect(escribio()).toBe(false);
    }
    const e = correrEn(raiz, ['--encender', '--aplicar', '--confirmo-doctoras'], vivoEvy);
    expect(e.status).toBe(1);
    expect(e.stdout).toMatch(/etapa encender/);
    expect(escribio()).toBe(false);
  });
  it('--crear sin activar con el construir.mjs REAL sobre lo versionado se NIEGA (marcadores de ids) y no escribe; un flujo de otro cliente no pasa por la guardia', () => {
    const r = correr(['--flujo', EVY, '--crear', '--aplicar', '--confirmo-doctoras', '--forzar']);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/etapa crear/);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(escribio()).toBe(false);
    const o = correr(['--flujo', join(REPO, 'Flujos/demo-a-agendamiento.json'), '--crear', '--aplicar']);
    expect(o.stdout + o.stderr).not.toMatch(/Flujo de las doctoras|NEGADO/);
  });
  it('--encender --aplicar sobre el flujo vivo de una doctora: sin confirmación se niega; con la guardia en rojo se niega aunque lleve --confirmo-doctoras; con todo en verde activa', () => {
    const sin = correrEn(raizConGuardia(0), ['--encender', '--aplicar'], vivoEvy);
    expect(sin.status).toBe(1);
    expect(sin.stderr).toMatch(/solo se publican con --confirmo-doctoras/);
    expect(escribio()).toBe(false);
    const rojo = correrEn(raizConGuardia(1), ['--encender', '--aplicar', '--confirmo-doctoras'], vivoEvy);
    expect(rojo.status).toBe(1);
    expect(rojo.stdout + rojo.stderr).toMatch(/encender el flujo vivo/);
    expect(escribio()).toBe(false);
    const verde = correrEn(raizConGuardia(0), ['--encender', '--aplicar', '--confirmo-doctoras'], vivoEvy);
    expect(verde.status, verde.stderr).toBe(0);
    expect(escribio()).toBe(true);
  });
  it('--encender con el construir.mjs REAL sobre el vivo (sin datos ni nombre válidos) se NIEGA aunque lleve --confirmo-doctoras', () => {
    const r = correr(['--encender', '--aplicar', '--confirmo-doctoras'], vivoEvy);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NEGADO/);
    expect(escribio()).toBe(false);
  });
  it('--encender en seco no pide confirmación; --apagar --aplicar tampoco', () => {
    expect(correr(['--encender'], vivoEvy).status).toBe(0);
    expect(escribio()).toBe(false);
    const r = correr(['--apagar', '--aplicar'], vivoEvy);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toMatch(/NEGADO/);
    expect(leer(log)).toMatch(/deactivate/);
  });
  it('un flujo vivo de otro cliente no activa nada de las doctoras', () => {
    const r = correr(['--encender', '--aplicar'], vivoOtro);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/Flujo de las doctoras|NEGADO/);
  });
  it('la confirmación de Antonio o de Rubén no vale para las doctoras', () => {
    const o = correrEn(raizConGuardia(0), ['--flujo', REL, '--aplicar', '--confirmo-antonio', '--confirmo-ruben'], vivoOtro);
    expect(o.status).toBe(1);
    expect(o.stderr).toMatch(/solo se publican con --confirmo-doctoras/);
  });
});
