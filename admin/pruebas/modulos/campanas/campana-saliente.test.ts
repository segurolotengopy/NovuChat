/**
 * `scripts/modulos/campanas/campana-saliente.mjs` (PR-C): crea la campaña, AUTORIZA una tanda por botón, cierra, pausa e informa.
 * Contra el emulador de Firestore (proyecto `demo-*`) y con dobles para el miniCRM y para `leerConfigCampana`. Nada contra n8n ni producción.
 *
 * El script NO escribe mensajes: la cola la materializa el servidor (`salidaCampana.ts`, otro bloque). Aquí se prueba lo del script:
 * los argumentos (un botón por tanda), la lista, lo que escribe y lo que se niega a escribir. Teléfonos y ids ficticios.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;
const PROYECTO = 'demo-novuchat-pruebas';

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'campana-saliente') ?? initializeApp({ projectId: PROYECTO }, 'campana-saliente');
const db = getFirestore(app);

type Cfg = Record<string, unknown>;
const S = await import('../../../scripts/modulos/campanas/campana-saliente.mjs') as unknown as {
  USO: string;
  analizarArgumentos: (argv: string[], env?: Record<string, string>) => { ok: boolean; codigo?: number; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  motivoDeRechazoDeTanda: (p: Record<string, unknown>) => { codigo: number; motivo: string } | null;
};

const CONFIG = { porTanda: 45, porDia: 200, porReclamo: 3, ventanaDias: 60, pausaErroresPct: 10, pausaMinimoEnviados: 10, pausaNoPct: 25 };
/** Doble de `leerConfigCampana` (la real se compila de `functions/src`): enteros positivos o `null`. */
const leerConfigCampana = (d: Record<string, unknown> | undefined) => {
  if (!d) return null;
  const claves = Object.keys(CONFIG) as Array<keyof typeof CONFIG>;
  return claves.every((k) => Number.isInteger(d[k]) && (d[k] as number) >= 1) ? Object.fromEntries(claves.map((k) => [k, d[k]])) : null;
};

const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
const MAPA = fileURLToPath(new URL('../../../scripts/datos/chat-novuchat/novuchat.json', import.meta.url));
const FLUJO = fileURLToPath(new URL('../../../../Flujos/clientes/novuchat/chat-novuchat.novuchat.json', import.meta.url));
const AHORA = Date.now();
const diaLaPaz = (ms: number) => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
const TEL = (n: number) => `5917100${String(n).padStart(4, '0')}`;
const PLANTILLA = { nombre: 'plantilla_ficticia', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 0, cabecera: 'ninguna', botones: 2 };

let k = 0;
interface Montaje { tenant: string; numero: string; linea: string }
async function montar(o: { plantilla?: Record<string, unknown> | null; config?: Record<string, unknown> | null; telefonos?: number[]; ruta?: Record<string, unknown> } = {}): Promise<Montaje> {
  k += 1;
  const tenant = `t-camp-${Date.now()}-${k}`;
  const numero = `5917${String(Date.now()).slice(-5)}${String(k).padStart(3, '0')}`;
  await db.doc(`rutasWhatsApp/${numero}`).set({ tenantId: tenant, estado: 'activo', ...(o.plantilla === null ? {} : { plantillas: { campana: o.plantilla ?? PLANTILLA } }), ...o.ruta });
  if (o.config !== null) await db.doc(`tenants/${tenant}/config/campanaSaliente`).set(o.config ?? CONFIG);
  for (const n of o.telefonos ?? [1, 2, 3, 4, 5]) {
    await db.doc(`tenants/${tenant}/conversaciones/wa_${TEL(n)}`).set({ phoneNumberId: numero, ultimoEntranteEn: Timestamp.fromMillis(AHORA - 72 * 3_600_000) });
  }
  return { tenant, numero, linea: numero.slice(-4) };
}
const filasDe = (ns: number[]) => ns.map((n) => ({ telefono: TEL(n), fecha: diaLaPaz(AHORA - 5 * 86_400_000), etapa: 'Nuevo' }));

const base = (m: Montaje, sub: string, extra: string[] = []) => [sub, '--proyecto', PROYECTO, '--tenant', m.tenant, '--linea', m.linea, ...extra];
async function correr(argv: string[], o: { env?: Record<string, string>; filas?: ReturnType<typeof filasDe>; deps?: Record<string, unknown> } = {}) {
  const r = S.analizarArgumentos(argv, { ...ENV_EMU, ...o.env });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const salida: string[] = [];
  const codigo = await S.ejecutar(r.cfg as Cfg, {
    db, Timestamp, FieldValue, log: (t: string) => salida.push(t), ahoraMs: () => AHORA, leerConfigCampana, leerFilasDelMiniCrm: async () => o.filas ?? filasDe([1, 2, 3, 4, 5]), ...o.deps,
  });
  return { codigo, texto: salida.join('\n') };
}
const problemas = (argv: string[], env: Record<string, string> = {}) => {
  const r = S.analizarArgumentos(argv, { ...ENV_EMU, ...env });
  expect(r.ok, 'tenía que rechazarse').toBe(false);
  expect(r.codigo).toBe(2);
  return (r.problemas ?? []).join(' | ');
};
const crearArgs = (m: Montaje, campana: string, extra: string[] = []) => base(m, 'crear', ['--campana', campana, '--mapa-crm', MAPA, '--flujo-versionado', FLUJO, ...extra]);
const autorizarArgs = (m: Montaje, campana: string, tanda: string, extra: string[] = []) => base(m, 'autorizar-tanda', ['--campana', campana, '--tanda', tanda, '--cupo', '10', '--calidad', 'VERDE', ...extra]);
const refC = (m: Montaje, c: string) => db.doc(`tenants/${m.tenant}/campanasSalientes/${c}`);
const rutaDe = async (m: Montaje) => (await db.doc(`rutasWhatsApp/${m.numero}`).get()).data() ?? {};
const crearReal = async (m: Montaje, c: string) => { const r = await correr(crearArgs(m, c, ['--aplicar'])); expect(r.codigo, r.texto).toBe(0); };
/** Una foto de todo lo que el script podría escribir: campañas, destinatarios y la ruta. */
async function foto(m: Montaje) {
  const cs = await db.collection(`tenants/${m.tenant}/campanasSalientes`).get();
  const partes: unknown[] = [(await rutaDe(m))];
  for (const c of cs.docs) {
    partes.push(c.id, c.data());
    for (const d of (await c.ref.collection('destinatarios').get()).docs) partes.push(d.id, d.data());
  }
  return JSON.stringify(partes);
}
const ENV_PRUEBA = { TELEFONOS_DE_PRUEBA: `${TEL(9001)},${TEL(9002)}` };

describe('argumentos (puros): un botón por tanda', () => {
  const m = { tenant: 't-uno', numero: 'x', linea: '1234' };
  it('autorizar-tanda sin --tanda, sin --cupo o sin --calidad sale con 2', () => {
    const a = autorizarArgs(m, 'cmp-uno', 't1');
    const sin = (opcion: string) => { const x = [...a]; x.splice(x.indexOf(opcion), 2); return x; };
    expect(problemas(sin('--tanda'))).toContain('falta --tanda');
    expect(problemas(sin('--cupo'))).toContain('falta --cupo');
    expect(problemas(sin('--calidad'))).toContain('falta --calidad');
  });
  it('NEGATIVA: calidad distinta de VERDE, cupo 0, cupo no entero y tanda con mayúsculas se rechazan', () => {
    expect(problemas(autorizarArgs(m, 'cmp-uno', 't1').map((x) => (x === 'VERDE' ? 'AMARILLA' : x)))).toContain('VERDE');
    expect(problemas(autorizarArgs(m, 'cmp-uno', 't1').map((x) => (x === '10' ? '0' : x)))).toContain('--cupo');
    expect(problemas(autorizarArgs(m, 'cmp-uno', 't1').map((x) => (x === '10' ? '4.5' : x)))).toContain('--cupo');
    expect(problemas(autorizarArgs(m, 'cmp-uno', 'T1'))).toContain('--tanda inválida');
  });
  it('NEGATIVA: --tanda, --cupo o --calidad fuera de autorizar-tanda no se admiten', () => {
    expect(problemas(base(m, 'pausar', ['--campana', 'cmp-uno', '--cupo', '5']))).toContain('no admite --cupo');
    expect(problemas(base(m, 'estado', ['--campana', 'cmp-uno', '--calidad', 'VERDE']))).toContain('no admite --calidad');
  });
  it('NEGATIVA: sin --linea, con una línea de 3 dígitos o sin --tenant no corre; el comercio excluido tampoco', () => {
    expect(problemas(['estado', '--proyecto', PROYECTO, '--tenant', 't-uno', '--campana', 'cmp-uno'])).toContain('falta --linea');
    expect(problemas(base({ ...m, linea: '123' }, 'estado', ['--campana', 'cmp-uno']))).toContain('4 dígitos');
    expect(problemas(['estado', '--proyecto', PROYECTO, '--linea', '1234', '--campana', 'cmp-uno'])).toContain('falta --tenant');
    expect(problemas(base(m, 'estado', ['--campana', 'cmp-uno']), { NOVUCHAT_TENANTS_EXCLUIDOS: 't-uno' })).toContain('EXCLUIDO');
  });
  it('NEGATIVA: --aplicar en simular o estado no se admite; sin --campana no corre (salvo simular)', () => {
    expect(problemas(crearArgs(m, 'cmp-uno').map((x) => (x === 'crear' ? 'simular' : x)).concat('--aplicar'))).toContain('no admite --aplicar');
    expect(problemas(base(m, 'estado', ['--aplicar', '--campana', 'cmp-uno']))).toContain('no admite --aplicar');
    expect(problemas(base(m, 'pausar'))).toContain('falta --campana');
  });
  it('NEGATIVA: contra producción, --aplicar sin --confirmo-produccion <tenant> sale con 2; con otro valor, también', () => {
    const prod = (extra: string[]) => base(m, 'pausar', ['--campana', 'cmp-uno', '--aplicar', ...extra]).map((x) => (x === PROYECTO ? 'proyecto-ficticio-prod' : x));
    const p = (extra: string[]) => S.analizarArgumentos(prod(extra), ENV_REAL);
    expect(p([]).ok).toBe(false);
    expect(p(['--confirmo-produccion', 'otro']).ok).toBe(false);
    expect(p(['--confirmo-produccion', 't-uno']).ok).toBe(true);
    expect(p([]).problemas?.join(' ')).toContain('--confirmo-produccion');
  });
  it('--proyecto prod toma el id de las credenciales de gcloud (como respuesta-libre.mjs) (con las salvaguardas de respuesta-libre.mjs)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gcloud-ficticio-'));
    writeFileSync(join(dir, 'application_default_credentials.json'), JSON.stringify({ quota_project_id: 'proyecto-ficticio-prod' }));
    const env = { ...ENV_REAL, CLOUDSDK_CONFIG: dir };
    const argv = (extra: string[]) => ['pausar', '--proyecto', 'prod', '--tenant', 't-uno', '--linea', '1234', '--campana', 'cmp-uno', ...extra];
    const r = S.analizarArgumentos(argv(['--aplicar', '--confirmo-produccion', 't-uno']), env);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.cfg).toMatchObject({ proyecto: 'proyecto-ficticio-prod', entorno: 'produccion', dirCredenciales: dir });
    // NEGATIVAS: sin la confirmación no se aplica; sin credenciales, o con GOOGLE_APPLICATION_CREDENTIALS puesto, no se resuelve.
    expect(S.analizarArgumentos(argv(['--aplicar']), env).ok).toBe(false);
    expect(S.analizarArgumentos(argv([]), { ...ENV_REAL, CLOUDSDK_CONFIG: join(dir, 'no-existe') }).ok).toBe(false);
    expect(S.analizarArgumentos(argv([]), { ...env, GOOGLE_APPLICATION_CREDENTIALS: '/x.json' }).ok).toBe(false);
    expect(S.analizarArgumentos(argv([]), { ...ENV_REAL, GCP_PROJECT_ID_PROD: 'otro-proyecto-prod', CLOUDSDK_CONFIG: dir }).ok).toBe(false);
  });
  it('la ayuda aclara que --confirmo-produccion es el COMERCIO aquí y otra cosa en registrar-plantilla.mjs', async () => {
    expect(S.USO).toContain('--confirmo-produccion es el id del COMERCIO');
    const R = await import('../../../scripts/plataforma/registrar-plantilla.mjs') as unknown as { USO: string };
    expect(R.USO).toContain('es la línea de 4 dígitos');
  });
  it('NEGATIVA: --mapa-crm solo bajo scripts/datos y --flujo-versionado solo bajo Flujos/clientes (y .json)', () => {
    expect(problemas(crearArgs(m, 'cmp-uno').map((x) => (x === MAPA ? '/etc/passwd' : x)))).toContain('--mapa-crm');
    expect(problemas(crearArgs(m, 'cmp-uno').map((x) => (x === MAPA ? `${MAPA}/../../../package.json` : x)))).toContain('--mapa-crm');
    expect(problemas(crearArgs(m, 'cmp-uno').map((x) => (x === FLUJO ? MAPA : x)))).toContain('--flujo-versionado');
    expect(problemas(base(m, 'simular', ['--mapa-crm', MAPA]))).toContain('falta --flujo-versionado');
  });
  it('NEGATIVA: el script ya no admite --numero ni --workflow (las rutas de un comercio no viven en el código)', () => {
    expect(problemas(crearArgs(m, 'cmp-uno', ['--numero', '123456']))).toContain('opción desconocida');
    expect(problemas(crearArgs(m, 'cmp-uno', ['--workflow', 'abc']))).toContain('opción desconocida');
  });
});

describe('--solo-prueba: la prueba va SOLO a UN teléfono (instrucción de Andres, 27/11)', () => {
  const m = { tenant: 't-uno', numero: 'x', linea: '1234' };
  const conFiltro = (f: string | null) => crearArgs(m, 'cmp-prueba', ['--solo-prueba', ...(f === null ? [] : ['--telefono-prueba', f])]).filter((x) => x !== MAPA && x !== FLUJO && x !== '--mapa-crm' && x !== '--flujo-versionado');
  it('con 2 teléfonos de prueba y el filtro, la lista queda con exactamente 1', () => {
    const r = S.analizarArgumentos(conFiltro('9002'), { ...ENV_EMU, ...ENV_PRUEBA });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect([...(r.cfg?.['telefonoPrueba'] as Set<string>)]).toEqual([TEL(9002)]);
  });
  it('NEGATIVA: sin --telefono-prueba sale con 2 (nunca se envía a la lista de prueba completa)', () => {
    expect(problemas(conFiltro(null), ENV_PRUEBA)).toContain('--telefono-prueba');
  });
  it('NEGATIVA: un filtro que coincide con 2 teléfonos sale con 2', () => {
    const dos = { TELEFONOS_DE_PRUEBA: `${TEL(9001)},59172009001` };
    expect(problemas(conFiltro('9001'), dos)).toContain('exactamente 1');
  });
  it('NEGATIVA: un filtro que no coincide con ninguno sale con 2', () => {
    expect(problemas(conFiltro('0000'), ENV_PRUEBA)).toContain('exactamente 1');
  });
  it('NEGATIVA: sin TELEFONOS_DE_PRUEBA en el entorno sale con 2; un filtro de 3 dígitos también', () => {
    expect(problemas(conFiltro('9002'))).toContain('exactamente 1');
    expect(problemas(conFiltro('902'), ENV_PRUEBA)).toContain('4 dígitos');
  });
  it('NEGATIVA: los mensajes de rechazo no repiten el filtro ni un teléfono', () => {
    for (const [f, env] of [['0000', ENV_PRUEBA], ['9002', {}]] as const) {
      const t = problemas(conFiltro(f), env);
      expect(t).not.toContain(f);
      expect(t).not.toMatch(/\d{7,}/);
    }
  });
  it('NEGATIVA: --telefono-prueba sin --solo-prueba, y --solo-prueba fuera de crear, no se admiten', () => {
    expect(problemas(crearArgs(m, 'cmp-prueba', ['--telefono-prueba', '9002']), ENV_PRUEBA)).toContain('solo vale con crear --solo-prueba');
    expect(problemas(base(m, 'pausar', ['--campana', 'cmp-prueba', '--solo-prueba']))).toContain('solo vale con crear');
  });
});

describe('simular: solo conteos, sin escribir', () => {
  it('imprime conteos, tandas y días; ninguna línea trae 7 o más dígitos; 0 escrituras; la suma de motivos y destinatarios da el total', async () => {
    const m = await montar();
    await db.doc(`tenants/${m.tenant}/bajas/wa_${TEL(2)}`).set({ canal: 'x' });
    const antes = await foto(m);
    const filas = [...filasDe([1, 2, 3, 4, 5]), ...filasDe([3]), { telefono: '70000001', fecha: '2026-11-01', etapa: 'Nuevo' }, { telefono: TEL(6), fecha: '2026-11-01', etapa: 'Ganado' }];
    const r = await correr(base(m, 'simular', ['--mapa-crm', MAPA, '--flujo-versionado', FLUJO]), { filas });
    expect(r.codigo, r.texto).toBe(0);
    for (const linea of r.texto.split('\n')) expect(linea, linea).not.toMatch(/\d{7,}/);
    const n = (rotulo: string) => Number(new RegExp(`${rotulo}\\s+(\\d+)`).exec(r.texto)?.[1]);
    expect(n('excluidos: con baja')).toBe(1);
    expect(n('excluidos: teléfono inválido')).toBe(1);
    expect(n('excluidos: Ganado o Perdido')).toBe(1);
    expect(n('DESTINATARIOS')).toBe(4);
    const motivos = ['teléfono inválido', 'Ganado o Perdido', 'fecha ilegible', 'teléfono de prueba', 'con baja', 'bloqueada', 'no contactar', 'con marca de riesgo', 'fuera de la ventana de días', 'sin conversación', 'conversación de otra línea', 'escribió en las últimas 24 h'];
    const suma = motivos.reduce((a, t) => a + Number(new RegExp(`excluidos: ${t}\\s+(\\d+)`).exec(r.texto)?.[1] ?? 0), 0) + n('DESTINATARIOS');
    expect(suma).toBe(n('teléfonos distintos'));
    expect(r.texto).toMatch(/tandas\s+1 \(de hasta 45\)/);
    expect(await foto(m)).toBe(antes);
  });
  it('NEGATIVA: sin config/campanaSaliente (o ilegible) no hay simulacro: sale con 2', async () => {
    for (const config of [null, { ...CONFIG, porReclamo: 0 }, { ...CONFIG, porTanda: '45' }]) {
      const m = await montar({ config });
      const r = await correr(base(m, 'simular', ['--mapa-crm', MAPA, '--flujo-versionado', FLUJO]));
      expect(r.codigo, r.texto).toBe(2);
    }
  });
  it('NEGATIVA: con 0 o 2 rutas activas que terminan en esa línea, sale con 2', async () => {
    const m = await montar();
    const sinRuta = await correr(base({ ...m, linea: '0000' === m.linea ? '0001' : '0000' }, 'simular', ['--mapa-crm', MAPA, '--flujo-versionado', FLUJO]));
    expect(sinRuta.codigo).toBe(2);
    const gemela = `5918999${m.linea}`;
    await db.doc(`rutasWhatsApp/${gemela}`).set({ tenantId: m.tenant, estado: 'activo' });
    const dos = await correr(base(m, 'simular', ['--mapa-crm', MAPA, '--flujo-versionado', FLUJO]));
    expect(dos.codigo, dos.texto).toBe(2);
    expect(dos.texto).toContain('hay 2');
  });
});

describe('crear', () => {
  it('en seco no escribe (sale con 1); con --aplicar crea la campaña `creada` y los destinatarios `pendiente`, sin tanda ni puntero', async () => {
    const m = await montar();
    const antes = await foto(m);
    const seco = await correr(crearArgs(m, 'cmp-uno'));
    expect(seco.codigo, seco.texto).toBe(1);
    for (const l of seco.texto.split('\n')) expect(l).not.toMatch(/\d{7,}/);
    expect(await foto(m)).toBe(antes);
    await crearReal(m, 'cmp-uno');
    const c = (await refC(m, 'cmp-uno').get()).data() as Record<string, unknown>;
    expect(c).toMatchObject({ estado: 'creada', phoneNumberId: m.numero, prueba: false, total: 5, tanda: null, tandasHechas: [], materializados: 0, aceptados: 0, rechazados: 0, inciertos: 0, plantilla: { nombre: 'plantilla_ficticia', idioma: 'es', categoria: 'UTILITY' } });
    expect(c['conteos']).toMatchObject({ destinatarios: 5 });
    const d = await refC(m, 'cmp-uno').collection('destinatarios').get();
    expect(d.docs.map((x) => x.id).sort()).toEqual([1, 2, 3, 4, 5].map((n) => `wa_${TEL(n)}`));
    for (const x of d.docs) expect(x.data()).toEqual({ estado: 'pendiente' });
    expect(await rutaDe(m)).not.toHaveProperty('campanaSalienteEnCurso');
  });
  it('NEGATIVA: crear solo no autoriza ninguna tanda: sin tanda ni puntero el servidor no materializa nada', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    expect((await refC(m, 'cmp-uno').get()).get('tanda')).toBeNull();
    expect((await refC(m, 'cmp-uno').get()).get('estado')).toBe('creada');
    expect(await rutaDe(m)).not.toHaveProperty('campanaSalienteEnCurso');
  });
  it('NEGATIVA: un id de campaña repetido no se pisa (2) y la plantilla ausente, inválida o MARKETING con variables no crean nada', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    const otra = await correr(crearArgs(m, 'cmp-uno', ['--aplicar']));
    expect(otra.codigo).toBe(2);
    for (const plantilla of [null, { ...PLANTILLA, variables: 1 }, { ...PLANTILLA, botones: 3 }, { ...PLANTILLA, estado: 'PAUSED' }, { ...PLANTILLA, cabecera: 'imagen' }]) {
      const mm = await montar({ plantilla });
      const r = await correr(crearArgs(mm, 'cmp-dos', ['--aplicar']));
      expect(r.codigo, JSON.stringify(plantilla)).toBe(2);
      expect((await refC(mm, 'cmp-dos').get()).exists).toBe(false);
    }
  });
  it('NEGATIVA: sin config o con config ilegible no se crea la campaña', async () => {
    const m = await montar({ config: { ...CONFIG, pausaNoPct: 101.5 } });
    const r = await correr(crearArgs(m, 'cmp-uno', ['--aplicar']));
    expect(r.codigo).toBe(2);
    expect((await refC(m, 'cmp-uno').get()).exists).toBe(false);
  });
  it('NEGATIVA: bajas, marcas, otra línea y las últimas 24 h (por la clave wa_<dígitos>) no entran a los destinatarios', async () => {
    const m = await montar({ telefonos: [1, 2, 3, 4, 5, 6, 7] });
    await db.doc(`tenants/${m.tenant}/bajas/wa_${TEL(1)}`).set({ canal: 'x' });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(2)}`).update({ bloqueada: true });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(3)}`).update({ riesgoEn: Timestamp.fromMillis(AHORA) });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(4)}`).update({ phoneNumberId: 'otra-linea' });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(5)}`).update({ ultimoEntranteEn: Timestamp.fromMillis(AHORA - 3_600_000) });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(6)}`).update({ noContactar: true });
    const r = await correr(crearArgs(m, 'cmp-uno', ['--aplicar']), { filas: filasDe([1, 2, 3, 4, 5, 6, 7]) });
    expect(r.codigo, r.texto).toBe(0);
    const d = await refC(m, 'cmp-uno').collection('destinatarios').get();
    expect(d.docs.map((x) => x.id)).toEqual([`wa_${TEL(7)}`]);
  });
  it('NEGATIVA: los TELEFONOS_DE_PRUEBA no entran a la campaña real (motivo prueba)', async () => {
    const m = await montar({ telefonos: [1, 2, 3] });
    const r = await correr(crearArgs(m, 'cmp-uno', ['--aplicar']), { env: { TELEFONOS_DE_PRUEBA: TEL(2) }, filas: filasDe([1, 2, 3]) });
    expect(r.codigo, r.texto).toBe(0);
    const d = await refC(m, 'cmp-uno').collection('destinatarios').get();
    expect(d.docs.map((x) => x.id).sort()).toEqual([`wa_${TEL(1)}`, `wa_${TEL(3)}`]);
  });

  it('--solo-prueba con el filtro: UN destinatario, prueba:true, sin leer el miniCRM, y la salida no trae ni el número ni los 4 dígitos', async () => {
    const m = await montar({ telefonos: [9001, 9002] });
    let leyoElCrm = false;
    const argv = base(m, 'crear', ['--campana', 'cmp-prueba', '--solo-prueba', '--telefono-prueba', '9002', '--aplicar']);
    const r = await correr(argv, { env: ENV_PRUEBA, deps: { leerFilasDelMiniCrm: async () => { leyoElCrm = true; return []; } } });
    expect(r.codigo, r.texto).toBe(0);
    expect(leyoElCrm).toBe(false);
    const c = (await refC(m, 'cmp-prueba').get()).data() as Record<string, unknown>;
    expect(c).toMatchObject({ prueba: true, total: 1, estado: 'creada' });
    const d = await refC(m, 'cmp-prueba').collection('destinatarios').get();
    expect(d.docs.map((x) => x.id)).toEqual([`wa_${TEL(9002)}`]);
    expect(r.texto).not.toContain(TEL(9002));
    expect(r.texto).not.toContain('9002');
    expect(r.texto).not.toContain(TEL(9001));
    expect(r.texto).not.toMatch(/\d{7,}/);
  });
  it('NEGATIVA: la prueba pasa por las mismas exclusiones de Firestore: con baja o escribió hace menos de 24 h no se crea', async () => {
    const m = await montar({ telefonos: [9002] });
    await db.doc(`tenants/${m.tenant}/bajas/wa_${TEL(9002)}`).set({ canal: 'x' });
    const argv = base(m, 'crear', ['--campana', 'cmp-prueba', '--solo-prueba', '--telefono-prueba', '9002', '--aplicar']);
    const r = await correr(argv, { env: ENV_PRUEBA });
    expect(r.codigo).toBe(2);
    expect((await refC(m, 'cmp-prueba').get()).exists).toBe(false);
  });
});

describe('autorizar-tanda: una tanda por botón', () => {
  it('en seco no escribe (1); con --aplicar escribe la tanda y el puntero, y la campaña queda enCurso', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    const antes = await foto(m);
    const seco = await correr(autorizarArgs(m, 'cmp-uno', 't1'));
    expect(seco.codigo, seco.texto).toBe(1);
    expect(await foto(m)).toBe(antes);
    const r = await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']));
    expect(r.codigo, r.texto).toBe(0);
    const c = (await refC(m, 'cmp-uno').get()).data() as Record<string, unknown>;
    expect(c['estado']).toBe('enCurso');
    expect(c['tanda']).toMatchObject({ id: 't1', cupo: 10, usados: 0, calidad: 'VERDE' });
    expect((await rutaDe(m))['campanaSalienteEnCurso']).toBe('cmp-uno');
    expect(await rutaDe(m)).toMatchObject({ plantillas: { campana: PLANTILLA } });
  });
  it('NEGATIVA: un cupo mayor que porTanda de la config sale con 2 y no escribe; porTanda se lee de la config, no del código', async () => {
    const m = await montar({ config: { ...CONFIG, porTanda: 8 } });
    await crearReal(m, 'cmp-uno');
    const antes = await foto(m);
    const r = await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']));
    expect(r.codigo).toBe(2);
    expect(r.texto).toContain('porTanda');
    expect(await foto(m)).toBe(antes);
    await db.doc(`tenants/${m.tenant}/config/campanaSaliente`).set({ ...CONFIG, porTanda: 10 });
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(0);
  });
  it('NEGATIVA: con la tanda anterior sin cerrar no se autoriza otra (2)', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(0);
    const r = await correr(autorizarArgs(m, 'cmp-uno', 't2', ['--aplicar']));
    expect(r.codigo).toBe(2);
    expect(r.texto).toContain('no se cerró');
    expect((await refC(m, 'cmp-uno').get()).get('tanda.id')).toBe('t1');
  });
  it('NEGATIVA: una tanda ya hecha no se repite (2), con la tanda guardada como objeto o como texto', async () => {
    for (const hecha of [{ id: 't1', cupo: 10, usados: 10 }, 't1']) {
      const m = await montar();
      await crearReal(m, 'cmp-uno');
      await refC(m, 'cmp-uno').update({ tandasHechas: [hecha], estado: 'enCurso' });
      const r = await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']));
      expect(r.codigo, r.texto).toBe(2);
      expect(r.texto).toContain('ya se hizo');
    }
  });
  it('NEGATIVA: una campaña pausada, terminada, inexistente o de otra línea no autoriza', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    for (const estado of ['pausada', 'terminada']) {
      await refC(m, 'cmp-uno').update({ estado });
      expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo, estado).toBe(2);
    }
    expect((await correr(autorizarArgs(m, 'cmp-no-existe', 't1', ['--aplicar']))).codigo).toBe(2);
    await refC(m, 'cmp-uno').update({ estado: 'creada', phoneNumberId: 'otra-linea' });
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(2);
    expect(await rutaDe(m)).not.toHaveProperty('campanaSalienteEnCurso');
  });
  it('NEGATIVA: otra campaña en curso en el mismo número (puntero) lo impide: una sola campaña por número', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    await crearReal(m, 'cmp-dos');
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(0);
    const r = await correr(autorizarArgs(m, 'cmp-dos', 't1', ['--aplicar']));
    expect(r.codigo).toBe(2);
    expect(r.texto).toContain('otra campaña');
    expect((await rutaDe(m))['campanaSalienteEnCurso']).toBe('cmp-uno');
  });
  it('NEGATIVA: sin plantilla válida en la ruta, sin pendientes, o con destinatarios de menos, no autoriza', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    await db.doc(`rutasWhatsApp/${m.numero}`).update({ 'plantillas.campana.estado': 'PAUSED' });
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(2);
    await db.doc(`rutasWhatsApp/${m.numero}`).update({ 'plantillas.campana.estado': 'APPROVED' });
    await refC(m, 'cmp-uno').collection('destinatarios').doc(`wa_${TEL(1)}`).delete();
    const incompleta = await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']));
    expect(incompleta.codigo).toBe(2);
    expect(incompleta.texto).toContain('incompleta');
    const mm = await montar();
    await crearReal(mm, 'cmp-uno');
    for (const d of (await refC(mm, 'cmp-uno').collection('destinatarios').get()).docs) await d.ref.update({ estado: 'enviado' });
    const sin = await correr(autorizarArgs(mm, 'cmp-uno', 't1', ['--aplicar']));
    expect(sin.codigo).toBe(2);
    expect(sin.texto).toContain('pendientes');
  });
  it('NEGATIVA: «No» por encima de pausaNoPct de la tanda anterior sale con 4 y no escribe; exactamente el 25 % deja pasar', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    await refC(m, 'cmp-uno').update({ estado: 'enCurso', tandasHechas: [{ id: 't1' }], materializados: 8, aceptados: 8 });
    const responder = async (n: number) => {
      for (let i = 1; i <= 5; i++) await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(i)}`).update({ campanaRespuesta: i <= n ? { campanaId: 'cmp-uno', respuesta: 'no' } : FieldValue.delete() });
    };
    await responder(3); // 3 de 8 = 37,5 %
    const antes = await foto(m);
    const r = await correr(autorizarArgs(m, 'cmp-uno', 't2', ['--aplicar']));
    expect(r.codigo, r.texto).toBe(4);
    expect(await foto(m)).toBe(antes);
    await responder(2); // 2 de 8 = 25 %: no supera
    const ok = await correr(autorizarArgs(m, 'cmp-uno', 't2', ['--aplicar']));
    expect(ok.codigo, ok.texto).toBe(0);
  });
  it('NEGATIVA: la proporción de «No» de OTRA campaña no cuenta', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    await refC(m, 'cmp-uno').update({ estado: 'enCurso', tandasHechas: [{ id: 't1' }], materializados: 8, aceptados: 8 });
    for (let i = 1; i <= 5; i++) await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(i)}`).update({ campanaRespuesta: { campanaId: 'cmp-otra', respuesta: 'no' } });
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't2', ['--aplicar']))).codigo).toBe(0);
  });
  it('el rechazo es puro y no imprime teléfonos', () => {
    const camp = { exists: false, get: () => undefined };
    expect(S.motivoDeRechazoDeTanda({ camp, numero: 'x', ruta: camp, cfg: { campana: 'c', tanda: 't', cupo: 1 }, config: CONFIG, pendientes: 0, destinatariosTotal: 0, no: 0 })).toMatchObject({ codigo: 2 });
  });
});

describe('cerrar-tanda y pausar', () => {
  async function enCurso() {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(0);
    return m;
  }
  const cerrar = (m: Montaje, extra: string[] = []) => base(m, 'cerrar-tanda', ['--campana', 'cmp-uno', '--tanda', 't1', ...extra]);
  it('cierra: la tanda pasa a tandasHechas, tanda queda null y el puntero se borra; con pendientes la campaña sigue enCurso', async () => {
    const m = await enCurso();
    const seco = await correr(cerrar(m));
    expect(seco.codigo).toBe(1);
    expect((await refC(m, 'cmp-uno').get()).get('tanda.id')).toBe('t1');
    const r = await correr(cerrar(m, ['--aplicar']));
    expect(r.codigo, r.texto).toBe(0);
    const c = (await refC(m, 'cmp-uno').get()).data() as { tanda: unknown; tandasHechas: Array<{ id: string }>; estado: string };
    expect(c.tanda).toBeNull();
    expect(c.tandasHechas.map((t) => t.id)).toEqual(['t1']);
    expect(c.estado).toBe('enCurso');
    expect(await rutaDe(m)).not.toHaveProperty('campanaSalienteEnCurso');
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't1', ['--aplicar']))).codigo).toBe(2); // repetida
    expect((await correr(autorizarArgs(m, 'cmp-uno', 't2', ['--aplicar']))).codigo).toBe(0);
  });
  it('si ya no quedan pendientes, la campaña queda terminada', async () => {
    const m = await enCurso();
    for (const d of (await refC(m, 'cmp-uno').collection('destinatarios').get()).docs) await d.ref.update({ estado: 'enviado' });
    expect((await correr(cerrar(m, ['--aplicar']))).codigo).toBe(0);
    expect((await refC(m, 'cmp-uno').get()).get('estado')).toBe('terminada');
  });
  it('NEGATIVA: con mensajes en vuelo, otra tanda o sin tanda abierta no se cierra (2) y no escribe', async () => {
    const m = await enCurso();
    await refC(m, 'cmp-uno').update({ materializados: 3, aceptados: 1 });
    const antes = await foto(m);
    const vuelo = await correr(cerrar(m, ['--aplicar']));
    expect(vuelo.codigo).toBe(2);
    expect(vuelo.texto).toContain('en vuelo');
    expect((await correr(base(m, 'cerrar-tanda', ['--campana', 'cmp-uno', '--tanda', 't9', '--aplicar']))).codigo).toBe(2);
    expect(await foto(m)).toBe(antes);
    await refC(m, 'cmp-uno').update({ aceptados: 3 });
    expect((await correr(cerrar(m, ['--aplicar']))).codigo).toBe(0);
    expect((await correr(cerrar(m, ['--aplicar']))).codigo).toBe(2); // ya cerrada
  });
  it('pausar: estado pausada con motivo manual y puntero borrado; idempotente; en seco no escribe', async () => {
    const m = await enCurso();
    const antes = await foto(m);
    expect((await correr(base(m, 'pausar', ['--campana', 'cmp-uno']))).codigo).toBe(1);
    expect(await foto(m)).toBe(antes);
    const r = await correr(base(m, 'pausar', ['--campana', 'cmp-uno', '--aplicar']));
    expect(r.codigo, r.texto).toBe(0);
    expect((await refC(m, 'cmp-uno').get()).data()).toMatchObject({ estado: 'pausada', motivoPausa: 'manual' });
    expect(await rutaDe(m)).not.toHaveProperty('campanaSalienteEnCurso');
    expect((await correr(base(m, 'pausar', ['--campana', 'cmp-uno', '--aplicar']))).codigo).toBe(0);
  });
  it('pausar quita el puntero aunque el servidor ya hubiera pausado la campaña (por errores)', async () => {
    const m = await enCurso();
    await refC(m, 'cmp-uno').update({ estado: 'pausada', motivoPausa: 'errores' });
    expect((await correr(base(m, 'pausar', ['--campana', 'cmp-uno', '--aplicar']))).codigo).toBe(0);
    expect(await rutaDe(m)).not.toHaveProperty('campanaSalienteEnCurso');
    expect((await refC(m, 'cmp-uno').get()).get('motivoPausa')).toBe('errores');
  });
  it('NEGATIVA: no se pausa una campaña terminada, inexistente o de otra línea', async () => {
    const m = await enCurso();
    await refC(m, 'cmp-uno').update({ estado: 'terminada' });
    expect((await correr(base(m, 'pausar', ['--campana', 'cmp-uno', '--aplicar']))).codigo).toBe(2);
    expect((await correr(base(m, 'pausar', ['--campana', 'cmp-nada', '--aplicar']))).codigo).toBe(2);
    await refC(m, 'cmp-uno').update({ estado: 'enCurso', phoneNumberId: 'otra-linea' });
    expect((await correr(base(m, 'pausar', ['--campana', 'cmp-uno', '--aplicar']))).codigo).toBe(2);
  });
});

describe('estado', () => {
  it('imprime la línea plantillasCampana, la categoría y el costo (UTILITY: entregas × 0,0113), la conciliación y ningún teléfono', async () => {
    const m = await montar();
    await crearReal(m, 'cmp-uno');
    await refC(m, 'cmp-uno').update({ materializados: 10, aceptados: 8, inciertos: 2 });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(1)}`).update({ campanaRespuesta: { campanaId: 'cmp-uno', respuesta: 'si' } });
    await db.doc(`tenants/${m.tenant}/conversaciones/wa_${TEL(2)}`).update({ campanaRespuesta: { campanaId: 'cmp-uno', respuesta: 'no' } });
    const periodo = new Date(AHORA).toISOString().slice(0, 7);
    await db.doc(`tenants/${m.tenant}/metricas/${periodo}`).set({ plantillasCampana: 7 });
    const antes = await foto(m);
    const r = await correr(base(m, 'estado', ['--campana', 'cmp-uno']));
    expect(r.codigo, r.texto).toBe(0);
    expect(r.texto).toContain(`plantillasCampana del mes (${periodo}, UTC): 7`);
    expect(r.texto).toContain('UTILITY');
    expect(r.texto).toContain('10 × 0.0113 USD = 0.1130 USD');
    expect(r.texto).toContain('1 «Sí» · 1 «No»');
    for (const l of r.texto.split('\n')) expect(l).not.toMatch(/\d{7,}/);
    expect(await foto(m)).toBe(antes);
  });
  it('con MARKETING no estima el costo y lo dice; sin métricas del mes la línea dice 0', async () => {
    const m = await montar({ plantilla: { ...PLANTILLA, categoria: 'MARKETING' } });
    await crearReal(m, 'cmp-uno');
    const r = await correr(base(m, 'estado', ['--campana', 'cmp-uno']));
    expect(r.texto).toMatch(/plantillasCampana del mes \(\d{4}-\d{2}, UTC\): 0/);
    expect(r.texto).toContain('MARKETING');
    expect(r.texto).not.toContain('USD =');
  });
  it('NEGATIVA: una campaña inexistente o de otra línea sale con 2', async () => {
    const m = await montar();
    expect((await correr(base(m, 'estado', ['--campana', 'cmp-nada']))).codigo).toBe(2);
    await crearReal(m, 'cmp-uno');
    await refC(m, 'cmp-uno').update({ phoneNumberId: 'otra-linea' });
    expect((await correr(base(m, 'estado', ['--campana', 'cmp-uno']))).codigo).toBe(2);
  });
});
