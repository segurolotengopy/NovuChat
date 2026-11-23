/**
 * `scripts/plataforma/aplicar-persona-puede-retomar.mjs` — ENCIENDE O APAGA `tenants/{id}.personaPuedeRetomar` (C2).
 * Contra el emulador de Firestore (proyecto `demo-*`), con `ejecutar` en proceso y la verificación de la salida
 * (`verificar-salida-persona --plantillas`) inyectada: aquí no hay n8n.
 *
 * Se niega (negando): encender con una ruta activa sin plantilla (5, «pendiente de Meta»), con una plantilla
 * MARKETING / PAUSED / de 2 variables, con UNA mala entre varias rutas, sin ninguna ruta activa (2), sin
 * `personaPuedeEscribir === true`, con la salida sin cabecera de plantillas (2) o sin poder verificarla (2), sin
 * `--alias` y `--env`; y una bandera ya en `true` con la plantilla hoy rota NO se «perdona». Se afirma: ninguna de esas
 * escribe la ficha ni audita; una ruta inactiva no cuenta; con todo bien escribe SOLO el campo y UNA auditoría;
 * apagar no exige nada; revertir a `true` repite las mismas comprobaciones.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const HOST = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8281'}`;
process.env['FIRESTORE_EMULATOR_HOST'] = HOST;
const PROYECTO = 'demo-novuchat-pruebas';

const { initializeApp, getApps } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
const app = getApps().find((a) => a.name === 'persona-puede-retomar') ?? initializeApp({ projectId: PROYECTO }, 'persona-puede-retomar');
const db = getFirestore(app);

type Cfg = Record<string, unknown>;
const mod = await import('../../scripts/plataforma/aplicar-persona-puede-retomar.mjs') as unknown as {
  analizarArgumentos: (argv: string[], env?: Record<string, string>, op?: Record<string, unknown>) => { ok: boolean; problemas?: string[]; cfg?: Cfg };
  ejecutar: (cfg: Cfg, deps: Record<string, unknown>) => Promise<number>;
  rutasSinPlantilla: (r: Array<{ id: string; plantilla: unknown }>) => unknown[];
  CODIGO_PENDIENTE_DE_META: number;
};

const dirs: string[] = [];
const rutaRespaldo = () => { const d = mkdtempSync(join('/tmp', 'persona-ret-')); chmodSync(d, 0o700); dirs.push(d); return join(d, 'respaldo.json'); };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const ENV_EMU = { FIRESTORE_EMULATOR_HOST: HOST };
const BUENA = { nombre: 'retomar_consulta', idioma: 'es', categoria: 'UTILITY', estado: 'APPROVED', variables: 1 };
const FICHA = { nombre: 'Tienda Sintetica', estado: 'activo', consolaConversaciones: 'nueva', plan: 'impulso', personaPuedeEscribir: true };

let contador = 0;
const nuevoTenant = () => `ret-${Date.now().toString(36)}-${contador++}`;
const nuevoNumero = () => `5917${String(Date.now()).slice(-6)}${String(contador++).padStart(3, '0')}`;
const ficha = async (t: string, o: Record<string, unknown> = {}) => { await db.doc(`tenants/${t}`).set({ ...FICHA, ...o }); };
const ruta = async (t: string, o: Record<string, unknown> = {}) => { const n = nuevoNumero(); await db.doc(`rutasWhatsApp/${n}`).set({ tenantId: t, flujo: 'agendamiento', aliasSecreto: 'clienteZz', estado: 'activo', ...o }); return n; };
const rutaOk = (t: string, o: Record<string, unknown> = {}) => ruta(t, { plantillas: { retomar: { ...BUENA, registradaEn: new Date() } }, ...o });
const hoy = async (t: string) => (await db.doc(`tenants/${t}`).get());
const hora = async (t: string) => (await hoy(t)).updateTime?.toMillis();
const auditorias = async (t: string) => (await db.collection(`tenants/${t}/auditoria`).get()).docs.map((d) => d.data());

const argv = (t: string, valor: string, extra: string[] = []) => ['--proyecto', PROYECTO, '--tenant', t, '--valor', valor, ...extra];
const VERIF = ['--alias', 'clienteZz', '--env', '.env'];
const cfgDe = (a: string[]) => {
  const r = mod.analizarArgumentos(a, ENV_EMU);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.cfg as Cfg;
};
type Verif = (cfg: Cfg) => Promise<{ ok: boolean }>;
const corre = async (a: string[], verificarSalida?: Verif | null) => {
  const salida: string[] = [];
  const llamadas: Cfg[] = [];
  const v: Verif | undefined = verificarSalida === null ? undefined : (verificarSalida ?? (async () => ({ ok: true })));
  const deps: Record<string, unknown> = { db, FieldValue, log: (x: string) => salida.push(x), env: ENV_EMU };
  if (v) deps['verificarSalida'] = async (c: Cfg) => { llamadas.push(c); return v(c); };
  const codigo = await mod.ejecutar(cfgDe(a), deps);
  return { codigo, texto: salida.join('\n'), llamadas };
};
const encender = (t: string, extra: string[] = []) => argv(t, 'true', [...VERIF, ...extra]);

describe('argumentos (puros)', () => {
  const problemas = (a: string[]) => { const r = mod.analizarArgumentos(a, ENV_EMU); expect(r.ok, JSON.stringify(r)).toBe(false); return (r.problemas ?? []).join(' | '); };

  it('encender exige --alias y --env (la verificación de la salida los necesita); apagar no', () => {
    expect(problemas(argv('tienda-prueba', 'true'))).toContain('--alias y --env son obligatorios');
    expect(mod.analizarArgumentos(argv('tienda-prueba', 'false'), ENV_EMU).ok).toBe(true);
    expect(mod.analizarArgumentos(encender('tienda-prueba'), ENV_EMU).ok).toBe(true);
  });

  it('--alias y --env van juntos, y se validan', () => {
    expect(problemas(argv('tienda-prueba', 'false', ['--alias', 'clienteZz']))).toContain('van juntos');
    expect(problemas(argv('tienda-prueba', 'false', ['--alias', '1malo', '--env', '.env']))).toContain('--alias inválido');
    expect(problemas(argv('tienda-prueba', 'false', ['--alias', 'clienteZz', '--env', '../.env']))).toContain('--env tiene que ser');
  });

  it('valor solo true/false; producción exige --confirmo-produccion', () => {
    expect(problemas(argv('tienda-prueba', 'si', VERIF))).toContain('exactamente true o false');
    const ENV_REAL = { GCP_PROJECT_ID_STAGING: 'proyecto-ficticio-staging', GCP_PROJECT_ID_PROD: 'proyecto-ficticio-prod' };
    const r = mod.analizarArgumentos(['--proyecto', 'proyecto-ficticio-prod', '--tenant', 'tienda-prueba', '--valor', 'false', '--aplicar', '--respaldo', rutaRespaldo()], ENV_REAL);
    expect(r.ok).toBe(false);
    expect((r.problemas ?? []).join(' ')).toContain('--confirmo-produccion');
  });

  it('el código de «pendiente de Meta» es 5 y el de «pendiente de republicar la salida» es 6', () => {
    expect(mod.CODIGO_PENDIENTE_DE_META).toBe(5);
    expect((mod as unknown as Record<string, number>)['CODIGO_PENDIENTE_DE_SALIDA']).toBe(6);
  });
});

describe('C1 en las rutas (puro)', () => {
  it('rutasSinPlantilla devuelve las que no cumplen C1 exacto', () => {
    const malas = mod.rutasSinPlantilla([
      { id: '1', plantilla: BUENA }, { id: '2', plantilla: undefined }, { id: '3', plantilla: { ...BUENA, categoria: 'MARKETING' } },
      { id: '4', plantilla: { ...BUENA, estado: 'PAUSED' } }, { id: '5', plantilla: { ...BUENA, variables: 2 } },
    ]) as Array<{ id: string }>;
    expect(malas.map((r) => r.id)).toEqual(['2', '3', '4', '5']);
  });
});

describe('encender: NEGATIVAS (nada se escribe, ni auditoría)', () => {
  const sinEscribir = async (t: string, h0: number | undefined) => {
    expect(await hora(t)).toBe(h0);
    expect((await hoy(t)).data()).not.toHaveProperty('personaPuedeRetomar');
    expect(await auditorias(t)).toHaveLength(0);
  };

  it('ruta activa SIN plantilla: salida 5 (pendiente de Meta), no verifica la salida ni escribe', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await ruta(t);
    const h0 = await hora(t);
    const r = await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.codigo).toBe(5);
    expect(r.texto).toContain('PENDIENTE DE META');
    expect(r.llamadas).toHaveLength(0);
    await sinEscribir(t, h0);
  });

  it.each([
    ['MARKETING', { ...BUENA, categoria: 'MARKETING' }],
    ['PAUSED', { ...BUENA, estado: 'PAUSED' }],
    ['PENDING', { ...BUENA, estado: 'PENDING' }],
    ['2 variables', { ...BUENA, variables: 2 }],
    ['idioma malo', { ...BUENA, idioma: 'ES' }],
    ['nombre malo', { ...BUENA, nombre: 'Retomar Consulta' }],
  ])('plantilla %s: salida 5 y no escribe', async (_n, p) => {
    const t = nuevoTenant();
    await ficha(t);
    await ruta(t, { plantillas: { retomar: p } });
    const h0 = await hora(t);
    expect((await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]))).codigo).toBe(5);
    await sinEscribir(t, h0);
  });

  it('con varias rutas activas, UNA sin plantilla basta para 5 (y el seco también lo dice)', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    await ruta(t);
    const h0 = await hora(t);
    const seco = await corre(encender(t));
    expect(seco.codigo).toBe(5);
    expect(seco.texto).toContain('1 de 2');
    expect((await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]))).codigo).toBe(5);
    await sinEscribir(t, h0);
  });

  it('sin ninguna ruta activa (ninguna, o solo suspendidas): salida 2', async () => {
    const t = nuevoTenant();
    await ficha(t);
    expect((await corre(encender(t))).codigo).toBe(2);
    await rutaOk(t, { estado: 'suspendido' });
    const h0 = await hora(t);
    expect((await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]))).codigo).toBe(2);
    await sinEscribir(t, h0);
  });

  it('personaPuedeEscribir ausente, "true", 1 o false: salida 2 antes de mirar plantillas', async () => {
    for (const previa of [undefined, 'true', 1, false]) {
      const t = nuevoTenant();
      const { personaPuedeEscribir: _p, ...sin } = FICHA;
      await db.doc(`tenants/${t}`).set(previa === undefined ? sin : { ...sin, personaPuedeEscribir: previa });
      await rutaOk(t);
      const h0 = await hora(t);
      const r = await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]));
      expect(r.codigo, String(previa)).toBe(2);
      expect(r.texto).toContain('personaPuedeEscribir === true');
      expect(r.llamadas).toHaveLength(0);
      await sinEscribir(t, h0);
    }
  });

  it('consola clásica o comercio suspendido: salida 2', async () => {
    for (const o of [{ consolaConversaciones: 'clasica' }, { estado: 'suspendido' }]) {
      const t = nuevoTenant();
      await ficha(t, o);
      await rutaOk(t);
      const h0 = await hora(t);
      expect((await corre(encender(t))).codigo).toBe(2);
      await sinEscribir(t, h0);
    }
  });

  it('plantilla bien pero la salida publicada NO admite plantillas (sin la cabecera): salida 6 (pendiente de republicar) y no escribe', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    const h0 = await hora(t);
    const r = await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]), async () => ({ ok: false }));
    expect(r.codigo).toBe(6);
    expect(r.llamadas).toHaveLength(1);
    expect(r.llamadas[0]).toMatchObject({ alias: 'clienteZz', envArchivo: '.env', tenant: t });
    expect(r.texto).toContain('PENDIENTE DE REPUBLICAR LA SALIDA');
    await sinEscribir(t, h0);
  });

  it('dos rutas con C1 válido y alias distintos, y solo UNA salida con la cabecera: salida 6, verifica las dos y no escribe', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t, { aliasSecreto: 'clienteAa' });
    await rutaOk(t, { aliasSecreto: 'clienteBb' });
    const h0 = await hora(t);
    const r = await corre(['--proyecto', PROYECTO, '--tenant', t, '--valor', 'true', '--alias', 'clienteAa', '--env', '.env', '--aplicar', '--respaldo', rutaRespaldo()],
      async (c) => ({ ok: c['alias'] === 'clienteAa' }));
    expect(r.codigo).toBe(6);
    expect(r.llamadas.map((c) => c['alias']).sort()).toEqual(['clienteAa', 'clienteBb']);
    await sinEscribir(t, h0);
  });

  it('dos rutas con alias distintos y las dos salidas con la cabecera: enciende (verificó cada alias)', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t, { aliasSecreto: 'clienteAa' });
    await rutaOk(t, { aliasSecreto: 'clienteBb' });
    const r = await corre(['--proyecto', PROYECTO, '--tenant', t, '--valor', 'true', '--alias', 'clienteBb', '--env', '.env', '--aplicar', '--respaldo', rutaRespaldo()]);
    expect(r.codigo, r.texto).toBe(0);
    expect(r.llamadas.map((c) => c['alias']).sort()).toEqual(['clienteAa', 'clienteBb']);
  });

  it('NEGATIVA: --alias que no es el de ninguna ruta activa: salida 2, sin verificar ni escribir', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    const h0 = await hora(t);
    const r = await corre(['--proyecto', PROYECTO, '--tenant', t, '--valor', 'true', '--alias', 'clienteOtro', '--env', '.env', '--aplicar', '--respaldo', rutaRespaldo()]);
    expect(r.codigo).toBe(2);
    expect(r.llamadas).toHaveLength(0);
    await sinEscribir(t, h0);
  });

  it('NEGATIVA: una ruta activa sin alias: salida 2', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t, { aliasSecreto: '' });
    expect((await corre(encender(t))).codigo).toBe(2);
  });

  it('sin poder verificar la salida (no hay función de verificación): salida 2, nunca se escribe a ciegas', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    const h0 = await hora(t);
    expect((await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]), null)).codigo).toBe(2);
    await sinEscribir(t, h0);
  });

  it('tenant desconocido: 2 y no se crea', async () => {
    const t = nuevoTenant();
    expect((await corre(encender(t))).codigo).toBe(2);
    expect((await hoy(t)).exists).toBe(false);
  });

  it('con la bandera YA en true y la plantilla hoy rota, encender no se «perdona»: 5', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeRetomar: true });
    await ruta(t, { plantillas: { retomar: { ...BUENA, estado: 'PAUSED' } } });
    expect((await corre(encender(t))).codigo).toBe(5);
  });
});

describe('encender: el camino bueno', () => {
  it('seco no escribe y sale 1; aplicar escribe SOLO el campo, con UNA auditoría; idempotente; ninguna otra clave cambia', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    const h0 = await hora(t);
    const seco = await corre(encender(t));
    expect(seco.codigo).toBe(1);
    expect(seco.llamadas).toHaveLength(1);
    expect(await hora(t)).toBe(h0);

    const ap = await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(ap.codigo, ap.texto).toBe(0);
    expect((await hoy(t)).data()).toEqual({ ...FICHA, personaPuedeRetomar: true });
    const a = await auditorias(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ accion: 'persona_puede_retomar_cambiada', campo: 'personaPuedeRetomar', anterior: null, nuevo: true, origen: 'script', entorno: 'emulador' });
    expect(JSON.stringify(a)).not.toMatch(/5917|clienteZz|demo-novuchat/);

    const otra = await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(otra.codigo).toBe(0);
    expect(await auditorias(t)).toHaveLength(1);
  });

  it('una ruta suspendida sin plantilla no cuenta: con la activa bien, enciende', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    await ruta(t, { estado: 'suspendido' });
    const r = await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]));
    expect(r.codigo, r.texto).toBe(0);
    expect((await hoy(t)).get('personaPuedeRetomar')).toBe(true);
  });

  it('varias rutas activas, todas con C1: enciende', async () => {
    const t = nuevoTenant();
    await ficha(t);
    await rutaOk(t);
    await rutaOk(t);
    expect((await corre(encender(t, ['--aplicar', '--respaldo', rutaRespaldo()]))).codigo).toBe(0);
  });
});

describe('apagar y revertir', () => {
  it('apagar NO exige plantillas, rutas, ni verificación ni personaPuedeEscribir (es la dirección segura)', async () => {
    const t = nuevoTenant();
    await db.doc(`tenants/${t}`).set({ nombre: 'Tienda Sintetica', estado: 'suspendido', consolaConversaciones: 'clasica', personaPuedeRetomar: true });
    const r = await corre(argv(t, 'false', ['--aplicar', '--respaldo', rutaRespaldo()]), null);
    expect(r.codigo, r.texto).toBe(0);
    expect((await hoy(t)).get('personaPuedeRetomar')).toBe(false);
    expect((await auditorias(t))[0]).toMatchObject({ anterior: true, nuevo: false });
  });

  it('revertir a «ausente» elimina el campo; revertir a true repite las comprobaciones (5 si la plantilla ya no sirve)', async () => {
    const t = nuevoTenant();
    await ficha(t, { personaPuedeRetomar: true });
    await rutaOk(t);
    const ruta1 = rutaRespaldo();
    expect((await corre(argv(t, 'false', ['--aplicar', '--respaldo', ruta1]))).codigo).toBe(0);
    // la plantilla se pausa mientras tanto
    const rutas = await db.collection('rutasWhatsApp').where('tenantId', '==', t).get();
    for (const d of rutas.docs) await d.ref.update({ 'plantillas.retomar.estado': 'PAUSED' });
    const h0 = await hora(t);
    const rev = await corre(['--revertir', '--respaldo', ruta1, '--tenant', t, '--proyecto', PROYECTO, ...VERIF, '--aplicar']);
    expect(rev.codigo).toBe(5);
    expect(await hora(t)).toBe(h0);
    expect((await hoy(t)).get('personaPuedeRetomar')).toBe(false);

    // y un respaldo cuyo previo era «ausente» elimina el campo
    const t2 = nuevoTenant();
    await ficha(t2);
    await rutaOk(t2);
    const ruta2 = rutaRespaldo();
    expect((await corre(encender(t2, ['--aplicar', '--respaldo', ruta2]))).codigo).toBe(0);
    const r2 = await corre(['--revertir', '--respaldo', ruta2, '--tenant', t2, '--proyecto', PROYECTO, '--aplicar']);
    expect(r2.codigo, r2.texto).toBe(0);
    expect((await hoy(t2)).data()).not.toHaveProperty('personaPuedeRetomar');
  });
});
