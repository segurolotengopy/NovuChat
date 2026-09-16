/**
 * `scripts/cargar-negocio.mjs` — LA CONFIGURACIÓN DE UN COMERCIO, CONTRA EL EMULADOR.
 *
 * El script escribe con el SDK Admin, que se salta las reglas: lo único que
 * impide cargar un horario mal formado, un calendario de 63 hexadecimales o una
 * agenda con un servicio que no existe es su propia validación. Por eso se
 * prueba ejecutándolo de verdad, como proceso, y se escribe negando: lo que no
 * debe entrar, no entra. El caso feliz usa el archivo REAL de Clínica Platinum
 * con una tabla local temporal que trae los marcadores de prueba.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'cargar-negocio.mjs');
const PLATINUM = join(aqui, '..', 'scripts', 'datos', 'negocio-platinum.json');
const PROYECTO = 'demo-novuchat-pruebas';
const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'negocio') ?? initializeApp({ projectId: PROYECTO }, 'negocio');
const db = getFirestore(app);

// Identificadores propios de esta suite, para no pisar a ninguna otra.
const T = 'neg-platinum';
const SIN_AGENDA = 'neg-sin-agenda';
const SUSPENDIDO = 'neg-suspendido';

// Datos de prueba con la forma que exige el repositorio público: teléfono con
// seis ceros seguidos, calendario generado y no escrito.
const RECEPCION = '59170000001';
const CALENDARIO_1 = 'a'.repeat(64) + '@group.calendar.google.com';
const CALENDARIO_2 = 'b'.repeat(64) + '@group.calendar.google.com';

const tmp = mkdtempSync(join(tmpdir(), 'cargar-negocio-'));
const base = JSON.parse(readFileSync(PLATINUM, 'utf8'));
// La tabla local temporal, con el MISMO formato de fila que CONFIGURACION.local.md.
const LOCAL = join(tmp, 'CONFIGURACION.local.md');
writeFileSync(LOCAL, [
  '# Tabla de prueba', '', '| Marcador | Valor | Qué es |', '|---|---|---|',
  `| \`REEMPLAZAR_NUMERO_RECEPCION_PLATINUM\` | ${RECEPCION} | recepción de prueba |`,
  `| \`REEMPLAZAR_CALENDARIO_PLATINUM_1\` | \`${CALENDARIO_1}\` | agenda 1 de prueba |`,
  `| \`REEMPLAZAR_CALENDARIO_PLATINUM_2\` | ${CALENDARIO_2} | agenda 2 de prueba |`,
  '| `REEMPLAZAR_CALENDARIO_PENDIENTE` | pendiente | todavía no |', '',
].join('\n'));
const LOCAL_VACIA = join(tmp, 'vacia.md');
writeFileSync(LOCAL_VACIA, '# sin marcadores\n');

function archivo(nombre: string, datos: unknown) {
  const ruta = join(tmp, `${nombre}.json`);
  writeFileSync(ruta, JSON.stringify(datos));
  return ruta;
}
function correr(tenant: string, ruta: string, ...extra: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', tenant, '--archivo', ruta, '--local', LOCAL, ...extra], {
    env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8',
  });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}
/** Copia profunda del archivo real con un retoque. */
const con = (retoque: (d: any) => void) => { const d = structuredClone(base); retoque(d); return d; };
const doc = async (ruta: string) => (await db.doc(`tenants/${ruta}`).get()).data();

beforeAll(async () => {
  for (const t of [T, SIN_AGENDA, SUSPENDIDO]) {
    for (const d of ['config/negocio', 'config/agendamiento']) await db.doc(`tenants/${t}/${d}`).delete();
    for (const col of ['catalogo', 'funcionarios', 'auditoria']) {
      for (const x of (await db.collection(`tenants/${t}/${col}`).get()).docs) await x.ref.delete();
    }
  }
  // Como deja alta-comercio.mjs: la ficha, un config/negocio mínimo y el documento del flujo vacío.
  await db.doc(`tenants/${T}`).set({ nombre: 'Clínica Platinum', estado: 'activo', vertical: 'agendamiento', flujos: ['agendamiento'] });
  await db.doc(`tenants/${T}/config/negocio`).set({ nombreNegocio: 'Clínica Platinum', zonaHoraria: 'America/La_Paz', moneda: 'BOB', paleta: 'vino' });
  await db.doc(`tenants/${T}/config/agendamiento`).set({ actualizadoPor: 'alta-comercio' });
  await db.doc(`tenants/${SIN_AGENDA}`).set({ nombre: 'Tienda', estado: 'activo', vertical: 'venta', flujos: ['venta'] });
  await db.doc(`tenants/${SUSPENDIDO}`).set({ nombre: 'Susp', estado: 'suspendido', vertical: 'agendamiento', flujos: ['agendamiento'] });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('cargar-negocio.mjs', () => {
  it('sin los argumentos no hace nada', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toMatch(/--tenant inválido/);
  });

  it('el JSON de PLATINUM cumple el contrato, y en seco no escribe nada ni muestra identificadores', async () => {
    const r = correr(T, PLATINUM);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Seco: no se escribió nada/);
    expect(r.salida).toMatch(/config\/negocio:/);
    expect(r.salida).toMatch(/igual\s+nombreNegocio\s+«Clínica Platinum»/);
    expect(r.salida).toMatch(/nuevo\s+tratamiento\s+usted/);
    expect(r.salida).toMatch(/nuevo\s+horarios\s+lun 09:00-19:00 .* sab 09:00-13:00 · dom cerrado/);
    expect(r.salida).toMatch(/numeroRecepcion\s+termina en …0001/);
    expect(r.salida).toMatch(/catalogo \(3 ítem\(s\)\)/);
    expect(r.salida).toMatch(/nuevo\s+blanqueamiento-dental-profesional\s+odontologia · 500 BOB · 60 min · activo/);
    expect(r.salida).toMatch(/nuevo\s+valoracion-clinica\s+odontologia · a consultar · 30 min/);
    expect(r.salida).toMatch(/funcionarios \(2 agenda\(s\)\)/);
    expect(r.salida).toMatch(/christyan-sandoval .*calendario termina en …aaaa · 3 servicio\(s\)/);
    // Conteos y nombres, no los textos largos ni los identificadores enteros.
    expect(r.salida).toMatch(/instruccionesExtra\s+\d+ caracteres/);
    expect(r.salida).not.toContain('CAMPAÑA VIGENTE');
    expect(r.salida).not.toContain('Nataniel Aguirre');
    expect(r.salida).not.toContain(RECEPCION);
    expect(r.salida).not.toContain(CALENDARIO_1);
    // Nada escrito.
    expect((await doc(`${T}/config/negocio`))?.['tratamiento']).toBeUndefined();
    expect((await doc(`${T}/config/agendamiento`))?.['duracionPorDefectoMin']).toBeUndefined();
    expect((await db.collection(`tenants/${T}/catalogo`).get()).size).toBe(0);
    expect((await db.collection(`tenants/${T}/funcionarios`).get()).size).toBe(0);
  });

  it('con un marcador que falta en la tabla local: en seco avisa y sigue; con --aplicar se niega', async () => {
    const seco = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T, '--archivo', PLATINUM, '--local', LOCAL_VACIA],
      { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
    const salidaSeco = `${seco.stdout}${seco.stderr}`;
    expect(seco.status, salidaSeco).toBe(0);
    expect(salidaSeco).toMatch(/sin resolver.*negocio\.numeroRecepcion: el marcador REEMPLAZAR_NUMERO_RECEPCION_PLATINUM no está/);
    expect(salidaSeco).toMatch(/funcionarios\/odontologo-2\.calendarioId: el marcador REEMPLAZAR_CALENDARIO_PLATINUM_2 no está/);
    expect(salidaSeco).toMatch(/Seco: no se escribió nada/);

    const aplicar = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T, '--archivo', PLATINUM, '--local', LOCAL_VACIA, '--aplicar'],
      { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
    expect(aplicar.status).toBe(2);
    expect(`${aplicar.stdout}${aplicar.stderr}`).toMatch(/NEGADO.*todos los marcadores tienen que estar/);
    expect((await db.collection(`tenants/${T}/funcionarios`).get()).size).toBe(0);
  });

  it('NO acepta un horario mal formado ni un día que falta', () => {
    const r = correr(T, archivo('horario', con((d) => { d.negocio.horarios.lun = '9 a 7'; d.negocio.horarios.mar = '19:00-09:00'; delete d.negocio.horarios.dom; })), '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/negocio\.horarios\.lun: «cerrado» o HH:MM-HH:MM/);
    expect(r.salida).toMatch(/negocio\.horarios\.mar: «cerrado» o HH:MM-HH:MM con inicio antes que fin/);
    expect(r.salida).toMatch(/negocio\.horarios\.dom: falta/);
    expect(r.salida).toMatch(/No se escribió nada/);
  });

  it('NO acepta un tratamiento fuera del enumerado', () => {
    const r = correr(T, archivo('trato', con((d) => { d.negocio.tratamiento = 'che'; d.negocio.estiloEmojis = 'todos'; })), '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/negocio\.tratamiento: uno de usted, tu, vos, neutro/);
    expect(r.salida).toMatch(/negocio\.estiloEmojis: uno de ninguno, pocos, muchos/);
  });

  it('NO acepta instruccionesExtra de 1.501 caracteres (y sí de 1.500)', () => {
    const largo = correr(T, archivo('largo', con((d) => { d.negocio.instruccionesExtra = 'x'.repeat(1501); })), '--aplicar');
    expect(largo.codigo).toBe(2);
    expect(largo.salida).toMatch(/negocio\.instruccionesExtra: texto de hasta 1500 caracteres \(tiene 1501\)/);
    const justo = correr(T, archivo('justo', con((d) => { d.negocio.instruccionesExtra = 'x'.repeat(1500); })));
    expect(justo.codigo, justo.salida).toBe(0);
  });

  it('NO acepta un calendario de 63 hexadecimales, ni en el archivo ni en la tabla local', () => {
    const enArchivo = correr(T, archivo('cal63', con((d) => {
      delete d.funcionarios[0].calendarioMarcador;
      d.funcionarios[0].calendarioId = 'c'.repeat(63) + '@group.calendar.google.com';
    })), '--aplicar');
    expect(enArchivo.codigo).toBe(2);
    expect(enArchivo.salida).toMatch(/funcionarios\[0\]\.calendarioId: 64 hexadecimales/);

    const tabla = join(tmp, 'tabla-63.md');
    writeFileSync(tabla, [
      '| Marcador | Valor |', '|---|---|',
      `| \`REEMPLAZAR_NUMERO_RECEPCION_PLATINUM\` | ${RECEPCION} |`,
      `| \`REEMPLAZAR_CALENDARIO_PLATINUM_1\` | ${'d'.repeat(63)}@group.calendar.google.com |`,
      `| \`REEMPLAZAR_CALENDARIO_PLATINUM_2\` | ${CALENDARIO_2} |`, '',
    ].join('\n'));
    const enTabla = spawnSync(process.execPath, [SCRIPT, '--proyecto', PROYECTO, '--tenant', T, '--archivo', PLATINUM, '--local', tabla, '--aplicar'],
      { env: { ...process.env, FIRESTORE_EMULATOR_HOST: HOST }, encoding: 'utf8' });
    expect(enTabla.status).toBe(2);
    expect(`${enTabla.stdout}${enTabla.stderr}`).toMatch(/calendarioId \(resuelto\): 64 hexadecimales exactos/);
  });

  it('NO acepta claves fuera del contrato, ni el sello, ni una sección desconocida', () => {
    const r = correr(T, archivo('claves', con((d) => {
      d.negocio.estadoComercio = 'activo';          // derivado: las reglas lo rechazan por lista blanca
      d.negocio.actualizadoPor = 'yo';               // el sello lo pone el script
      d.agendamiento.costoDelivery = 7;              // es de venta, no de agendamiento
      d.catalogo[0].stock = 3;                       // no lo toca ninguna carga
      d.funcionarios[0].telefono = RECEPCION;        // va en /privado, nunca acá
      d.cuenta = { plan: 'pro' };
    })), '--aplicar');
    expect(r.codigo).toBe(2);
    for (const m of [/negocio: clave desconocida «estadoComercio»/, /negocio: clave desconocida «actualizadoPor»/,
      /agendamiento: clave desconocida «costoDelivery»/, /catalogo\[0\]: clave desconocida «stock»/,
      /funcionarios\[0\]: clave desconocida «telefono»/, /sección desconocida: «cuenta»/]) {
      expect(r.salida).toMatch(m);
    }
  });

  it('NO acepta un funcionario con un servicio que no está en el catálogo del archivo', () => {
    const r = correr(T, archivo('servicio', con((d) => { d.funcionarios[1].servicios.push('implantes'); })), '--aplicar');
    expect(r.codigo).toBe(2);
    expect(r.salida).toMatch(/funcionarios\[1\]\.servicios: «implantes» no está en el catálogo de este archivo/);
  });

  it('NO acepta tamaños ni valores fuera de las reglas en agendamiento y catálogo', () => {
    const r = correr(T, archivo('varios', con((d) => {
      d.agendamiento.duracionPorDefectoMin = 481;
      d.agendamiento.horasRecordatorio = -1;
      d.catalogo[0].precio = -5;
      d.catalogo[1].duracionMin = 50;                // no es múltiplo de 15
      d.catalogo[2].nombre = 'x'.repeat(81);
      d.negocio.numeroRecepcionMarcador = '+591 700';
    })), '--aplicar');
    expect(r.codigo).toBe(2);
    for (const m of [/agendamiento\.duracionPorDefectoMin: entero de 1 a 480/, /agendamiento\.horasRecordatorio: entero de 0 a 168/,
      /catalogo\[0\]\.precio: ausente \(a consultar\) o número de 0 a 1000000/, /catalogo\[1\]\.duracionMin: .*múltiplo de 15/,
      /catalogo\[2\]\.nombre: texto de 1 a 80/, /negocio\.numeroRecepcionMarcador: un marcador REEMPLAZAR_/]) {
      expect(r.salida).toMatch(m);
    }
  });

  it('NO carga agendamiento ni funcionarios en un comercio sin el flujo agendamiento', async () => {
    const r = correr(SIN_AGENDA, PLATINUM, '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/no tiene el flujo agendamiento/);
    expect(await doc(`${SIN_AGENDA}/config/negocio`)).toBeUndefined();
    expect(await doc(`${SIN_AGENDA}/config/agendamiento`)).toBeUndefined();
    expect((await db.collection(`tenants/${SIN_AGENDA}/catalogo`).get()).size).toBe(0);
  });

  it('NO reconfigura un comercio suspendido ni uno que no existe', async () => {
    const s = correr(SUSPENDIDO, PLATINUM, '--aplicar');
    expect(s.codigo).toBe(1);
    expect(s.salida).toMatch(/está suspendido: no se reconfigura/);
    expect(await doc(`${SUSPENDIDO}/config/negocio`)).toBeUndefined();
    const r = correr('neg-no-existe', PLATINUM, '--aplicar');
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/No existe el comercio/);
    expect(await doc('neg-no-existe/config/negocio')).toBeUndefined();
  });

  it('con --aplicar deja negocio, agendamiento, catálogo y agendas con los campos esperados, y la auditoría', async () => {
    const r = correr(T, PLATINUM, '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/✓ Verificación: releídos config\/negocio \(\d+ campos\) · config\/agendamiento \(6 campos\) · 3 ítem\(s\) del catálogo · 2 agenda\(s\)/);

    const negocio = (await doc(`${T}/config/negocio`)) ?? {};
    expect(negocio).toMatchObject({
      nombreNegocio: 'Clínica Platinum', tratamiento: 'usted', estiloEmojis: 'pocos', nombreAsistente: '',
      zonaHoraria: 'America/La_Paz', moneda: 'BOB', prefijosPermitidos: ['591'],
      numeroRecepcion: RECEPCION, calendarioId: CALENDARIO_1,
      horarios: { lun: '09:00-19:00', mar: '09:00-19:00', mie: '09:00-19:00', jue: '09:00-19:00', vie: '09:00-19:00', sab: '09:00-13:00', dom: 'cerrado' },
      descripcion: base.negocio.descripcion, instruccionesExtra: base.negocio.instruccionesExtra,
      politicaCancelacion: base.negocio.politicaCancelacion, datosQueNoTenemos: base.negocio.datosQueNoTenemos,
      actualizadoPor: 'cargar-negocio',
      // Lo que el archivo no trae queda como estaba.
      paleta: 'vino',
    });
    // Las notas y los marcadores no se escriben; el horario va sin la nota.
    expect(negocio['horarios']['_nota']).toBeUndefined();
    expect(negocio['numeroRecepcionMarcador']).toBeUndefined();
    expect(negocio['calendarioMarcador']).toBeUndefined();
    expect(negocio['actualizadoEn']).toBeDefined();

    const agend = (await doc(`${T}/config/agendamiento`)) ?? {};
    expect(agend).toMatchObject({ ...base.agendamiento, actualizadoPor: 'cargar-negocio' });

    const blanq = (await doc(`${T}/catalogo/blanqueamiento-dental-profesional`)) ?? {};
    expect(blanq).toMatchObject({ nombre: 'Blanqueamiento dental profesional', area: 'odontologia', precio: 500, moneda: 'BOB', duracionMin: 60, activo: true, actualizadoPor: 'cargar-negocio' });
    expect(blanq['descripcion']).toMatch(/precio regular 600/);
    const valoracion = (await doc(`${T}/catalogo/valoracion-clinica`)) ?? {};
    expect(valoracion).toMatchObject({ nombre: 'Valoración clínica', duracionMin: 30, activo: true });
    expect(valoracion['precio']).toBeUndefined();
    expect(await doc(`${T}/catalogo/estetica-facial`)).toMatchObject({ area: 'estetica', activo: true });

    const f1 = (await doc(`${T}/funcionarios/christyan-sandoval`)) ?? {};
    expect(f1).toMatchObject({
      nombre: 'Dr. Christyan Sandoval', calendarioId: CALENDARIO_1, activo: true, actualizadoPor: 'cargar-negocio',
      servicios: ['blanqueamiento-dental-profesional', 'valoracion-clinica', 'estetica-facial'],
      horarioTrabajo: { lun: '09:00-19:00', sab: '09:00-13:00', dom: 'cerrado' },
    });
    expect(f1['horarioTrabajo']['_nota']).toBeUndefined();
    expect(f1['id']).toBeUndefined();
    expect(f1['calendarioMarcador']).toBeUndefined();
    const f2 = (await doc(`${T}/funcionarios/odontologo-2`)) ?? {};
    expect(f2).toMatchObject({ calendarioId: CALENDARIO_2, servicios: ['blanqueamiento-dental-profesional', 'valoracion-clinica'] });

    const auditoria = await db.collection(`tenants/${T}/auditoria`).where('accion', '==', 'cargar_negocio').get();
    expect(auditoria.size).toBe(1);
    expect(auditoria.docs[0]!.get('conteos')).toEqual({ catalogo: 3, funcionarios: 2 });
    expect(auditoria.docs[0]!.get('secciones')).toEqual(['negocio', 'agendamiento', 'catalogo', 'funcionarios']);
  });

  it('repetir la misma carga no cambia el contenido', () => {
    const r = correr(T, PLATINUM);
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/Sin cambios de contenido/);
    expect(r.salida).toMatch(/igual\s+christyan-sandoval/);
  });

  it('un precio que el archivo ya no trae se borra (ausente = a consultar), y lo ajeno se informa sin tocarse', async () => {
    await db.doc(`tenants/${T}/catalogo/ortodoncia`).set({ nombre: 'Ortodoncia', activo: true });
    const r = correr(T, archivo('sin-precio', con((d) => { delete d.catalogo[0].precio; delete d.catalogo[0].moneda; })), '--aplicar');
    expect(r.codigo, r.salida).toBe(0);
    expect(r.salida).toMatch(/cambia\s+blanqueamiento-dental-profesional\s+odontologia · a consultar/);
    expect(r.salida).toMatch(/1 ítem\(s\) existente\(s\) que el archivo no nombra quedan como están: ortodoncia/);
    const blanq = (await doc(`${T}/catalogo/blanqueamiento-dental-profesional`)) ?? {};
    expect(blanq['precio']).toBeUndefined();
    expect(blanq['moneda']).toBeUndefined();
    expect(await doc(`${T}/catalogo/ortodoncia`)).toEqual({ nombre: 'Ortodoncia', activo: true });
  });
});
