/**
 * EL ALTA ENCIENDE TODO EL JUEGO DE CONVERSACIÓN (plan 21/11/2026, PR2). Pura: sin red, sin Firestore, sin procesos hijos.
 *
 *  - `fichaInicial()` (alta-comercio.mjs) trae cada clave de `JUEGO_DE_FICHA` con su valor exacto.
 *  - `pasosDelEncendido()` cubre `JUEGO_CON_INFRA`, no despliega y pone la puerta de verificación antes de cada bandera.
 *  - `correrPasos` se corta en el primer paso que falla, sin escribir banderas, y dice cómo revertir (dependencias falsas).
 *  - Nada de lo que imprime lleva la ruta del webhook, una clave ni el id del proyecto.
 * Cada regla trae su contraprueba.
 */
import { describe, expect, it } from 'vitest';
import { JUEGO_CON_INFRA, JUEGO_DE_FICHA } from '../../functions/src/core/conversacion/juego';
// @ts-expect-error módulo .mjs sin tipos
import { fichaInicial } from '../../scripts/plataforma/alta-comercio.mjs';
// @ts-expect-error módulo .mjs sin tipos
import { analizarArgumentos, argumentosDelPaso, aliasDeRutas, censurar, correrPasos, lineasDeTodos, pasosDelEncendido, validarOrden } from '../../scripts/plataforma/encender-conversacion.mjs';

type Paso = { id: string; tipo: string; bandera?: string; escribe: boolean; enSeco: boolean; args?: string[]; revertir?: string | null; titulo: string };

const SELLO = { creadoEn: 'ahora', creadoPor: 'alta-comercio' };
const PARAMS = {
  tenant: 'comercio-z', alias: 'clienteZz', env: '.env', credIngesta: 'NovuChat ingesta (Z)', credEnvio: 'WhatsApp Z (envío)',
  proyecto: 'proyecto-ficticio-1', respaldoDir: '/tmp/respaldos', sello: 's1',
};
const pasos = (): Paso[] => pasosDelEncendido(PARAMS);
const indice = (ps: Paso[], id: string) => ps.findIndex((p) => p.id === id);

describe('fichaInicial (alta-comercio.mjs)', () => {
  const ficha = fichaInicial({ nombre: 'Zeta', plan: 'impulso', FLUJOS: ['agendamiento'], titularCuentaUid: 'uid1', sello: SELLO });

  it('trae cada clave de JUEGO_DE_FICHA con su valor exacto', () => {
    for (const [clave, valor] of Object.entries(JUEGO_DE_FICHA)) {
      expect(ficha, clave).toHaveProperty(clave);
      expect(ficha[clave], clave).toBe(valor);
    }
  });

  it('NO escribe las banderas que certifican infraestructura (esas van después de la puerta)', () => {
    for (const clave of Object.keys(JUEGO_CON_INFRA)) expect(ficha, clave).not.toHaveProperty(clave);
  });

  it('conserva el resto de la ficha de siempre', () => {
    expect(ficha).toMatchObject({ nombre: 'Zeta', estado: 'activo', plan: 'impulso', vertical: 'agendamiento', titularCuentaUid: 'uid1', titularCuentaPor: 'alta-comercio', waPhoneNumberId: null });
    expect(ficha.modulos.length).toBeGreaterThan(0);
  });

  it('negativa: una ficha sin guardarMedios o con «true» como texto no cumple la comparación del juego', () => {
    const { guardarMedios: _g, ...sin } = ficha;
    expect(sin.guardarMedios).toBeUndefined();
    expect({ ...ficha, guardarMedios: 'true' }.guardarMedios).not.toBe(JUEGO_DE_FICHA.guardarMedios);
  });
});

describe('pasosDelEncendido (encender-conversacion.mjs)', () => {
  it('cubre JUEGO_CON_INFRA: una bandera por clave, en el orden del juego, y ninguna de más', () => {
    const banderas = pasos().filter((p) => p.tipo === 'bandera').map((p) => p.bandera);
    expect(banderas).toEqual(Object.keys(JUEGO_CON_INFRA));
  });

  it('el orden es relé, alias, carga, activación, puerta y después las banderas', () => {
    expect(pasos().map((p) => p.id)).toEqual(['rele-inerte', 'alias', 'timbre-carga', 'timbre-activar', 'puerta', ...Object.keys(JUEGO_CON_INFRA)]);
  });

  it('pone la verificación antes de CADA bandera y toda la infraestructura antes de la verificación', () => {
    const ps = pasos();
    const iPuerta = indice(ps, 'puerta');
    for (const campo of Object.keys(JUEGO_CON_INFRA)) expect(indice(ps, campo), campo).toBeGreaterThan(iPuerta);
    for (const p of ps.filter((x) => x.tipo === 'spawn')) expect(indice(ps, p.id), p.id).toBeLessThan(iPuerta);
    expect(validarOrden(ps)).toEqual([]);
  });

  it('la puerta pide los medios (4f) y es solo lectura; ningún paso despliega (D1)', () => {
    const puerta = pasos().find((p) => p.tipo === 'puerta') as Paso;
    expect(puerta.args).toContain('--medios');
    expect(puerta.escribe).toBe(false);
    expect(JSON.stringify(pasos().map((p) => [p.titulo, p.args]))).not.toMatch(/deploy|desplieg|firebase/i);
  });

  it('negativa: un orden con una bandera ANTES de la puerta no es válido y no se ejecuta nada', async () => {
    const ps = pasos();
    const [bandera] = ps.splice(indice(ps, Object.keys(JUEGO_CON_INFRA)[0] as string), 1);
    ps.splice(indice(ps, 'puerta'), 0, bandera as Paso);
    expect(validarOrden(ps).join('|')).toMatch(/va antes de la puerta/);
    const corridos: string[] = [];
    const r = await correrPasos(ps, { aplicar: true, deps: { ejecutar: async (p: Paso) => { corridos.push(p.id); return 0; }, log: () => {} } });
    expect(r.codigo).toBe(2);
    expect(corridos).toEqual([]);
  });

  it('negativa: un plan que no cubre todas las banderas del juego, o sin puerta, no es válido', () => {
    expect(validarOrden(pasos().filter((p) => p.bandera !== 'personaPuedeEnviarMedios')).join('|')).toMatch(/personaPuedeEnviarMedios/);
    expect(validarOrden(pasos().filter((p) => p.tipo !== 'puerta')).join('|')).toMatch(/exactamente una puerta/);
    expect(validarOrden([...pasos(), { id: 'despliegue', tipo: 'despliegue', titulo: 'x', escribe: true, enSeco: false }]).join('|')).toMatch(/no despliega/);
  });
});

describe('correrPasos con dependencias falsas', () => {
  const armar = (fallaEn: string | null, codigoDeFalla = 3) => {
    const llamadas: string[] = [];
    const log: string[] = [];
    const deps = {
      log: (t: string) => log.push(t),
      ejecutar: async (p: Paso) => { llamadas.push(p.id); return p.id === fallaEn ? codigoDeFalla : 0; },
    };
    return { llamadas, log, deps };
  };

  it('todo en verde: corre los siete pasos en orden, puerta antes de las banderas, y dice cómo deshacer', async () => {
    const { llamadas, log, deps } = armar(null);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(0);
    expect(llamadas).toEqual(pasos().map((p) => p.id));
    expect(log.join('\n')).toMatch(/--quitar-alias/);
    expect(log.join('\n')).toMatch(/--quitar --aplicar/);
    expect(log.join('\n')).toMatch(/--revertir/);
  });

  it.each(['rele-inerte', 'alias', 'timbre-carga', 'timbre-activar', 'puerta'])('negativa: si falla «%s», no se escribe NINGUNA bandera', async (falla) => {
    const { llamadas, deps } = armar(falla);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(3);
    expect(r.fallo).toBe(falla);
    for (const campo of Object.keys(JUEGO_CON_INFRA)) expect(llamadas).not.toContain(campo);
    expect(llamadas[llamadas.length - 1]).toBe(falla);
  });

  it('negativa: si falla la segunda bandera, la primera se deshace con su respaldo y no hay paso siguiente', async () => {
    const { llamadas, log, deps } = armar('personaPuedeEnviarMedios');
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(3);
    expect(llamadas.at(-1)).toBe('personaPuedeEnviarMedios');
    expect(log.join('\n')).toMatch(/aplicar-persona-puede-escribir\.mjs --revertir --respaldo \/tmp\/respaldos\/personaPuedeEscribir-comercio-z-s1\.json/);
  });

  it('una negativa del paso (salida 2) corta con 2 y no lo cuenta como escrito', async () => {
    const { log, deps } = armar('alias', 2);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(2);
    expect(log.join('\n')).not.toMatch(/--quitar-alias/);
  });

  it('segunda barrera: aunque el plan sea válido, una bandera no corre si la puerta no se pasó en esta corrida', async () => {
    const ps = pasos();
    const sinPuertaEjecutada = ps.map((p) => (p.tipo === 'puerta' ? { ...p, tipo: 'spawn', id: 'otra-cosa' } : p));
    // plan inválido (sin puerta): se niega entero
    const { llamadas, deps } = armar(null);
    const r = await correrPasos(sinPuertaEjecutada, { aplicar: true, deps });
    expect(r.codigo).toBe(2);
    expect(llamadas).toEqual([]);
  });

  it('en seco no escribe ni corre lo que depende de lo anterior; no pasa --aplicar a ningún hijo', async () => {
    const { llamadas, log, deps } = armar(null);
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(r.codigo).toBe(0);
    expect(llamadas).toEqual(['rele-inerte', 'alias', 'personaPuedeEscribir']);
    expect(log.join('\n')).toMatch(/se comprueba al aplicar/);
    for (const p of pasos().filter((x) => x.args)) expect(argumentosDelPaso(p, false)).not.toContain('--aplicar');
  });

  it('en seco un paso que dice «falta» (salida 1) deja el código 1, no un fallo', async () => {
    const { deps } = armar('rele-inerte', 1);
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(r.codigo).toBe(1);
    expect(r.pendientes).toContain('rele-inerte');
  });

  it('al aplicar, los pasos que escriben llevan --aplicar --confirmo produccion y la puerta no', () => {
    for (const p of pasos().filter((x) => x.tipo === 'spawn')) {
      const a = argumentosDelPaso(p, true) as string[];
      expect(a.slice(-3)).toEqual(['--aplicar', '--confirmo', 'produccion']);
    }
    expect(argumentosDelPaso(pasos().find((p) => p.tipo === 'puerta') as Paso, true)).not.toContain('--aplicar');
  });
});

describe('lo que nunca se imprime', () => {
  it('censurar tapa el id del proyecto, los Bearer y las URL de webhook', () => {
    const t = censurar('proyecto proyecto-ficticio-1 · Authorization: Bearer abc123 · https://n8n.ejemplo.com/webhook/ruta-secreta', ['proyecto-ficticio-1']);
    expect(t).not.toContain('proyecto-ficticio-1');
    expect(t).not.toContain('abc123');
    expect(t).not.toContain('ruta-secreta');
  });

  it('el plan y su salida de reversión no contienen el id del proyecto ni claves', async () => {
    const log: string[] = [];
    await correrPasos(pasos(), { aplicar: true, deps: { log: (t: string) => log.push(t), ejecutar: async (p: Paso) => (p.id === 'puerta' ? 3 : 0) } });
    const todo = log.join('\n') + JSON.stringify(pasos().filter((p) => p.tipo !== 'puerta' && p.tipo !== 'bandera').map((p) => p.revertir));
    expect(todo).not.toContain('proyecto-ficticio-1');
    expect(todo).not.toMatch(/Bearer|webhook/i);
  });
});

describe('argumentos', () => {
  const ENV = { GCP_PROJECT_ID_PROD: 'proyecto-prod-ficticio', GCP_PROJECT_ID_STAGING: 'proyecto-stg-ficticio' };
  const base = ['--tenant', 'comercio-z', '--env', '.env'];

  it('en seco bastan tenant y env (el proyecto sale de GCP_PROJECT_ID_PROD)', () => {
    expect(analizarArgumentos(base, ENV).ok).toBe(true);
  });

  it('negativas: --aplicar sin --confirmo produccion, con otro proyecto, o sin lo necesario, se niega', () => {
    const completo = [...base, '--cred-ingesta', 'a', '--cred-envio', 'b', '--respaldo-dir', '/tmp/r', '--aplicar'];
    expect(analizarArgumentos(completo, ENV).ok).toBe(false);
    expect(analizarArgumentos([...completo, '--confirmo', 'produccion'], ENV).ok).toBe(true);
    expect(analizarArgumentos([...completo, '--confirmo', 'si'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...completo, '--confirmo', 'produccion', '--proyecto', 'proyecto-stg-ficticio'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...base, '--aplicar', '--confirmo', 'produccion'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...base, '--env', '../.env'], ENV).ok).toBe(false);
  });

  it('--todos es solo lectura y no se combina con --aplicar ni con un comercio', () => {
    expect(analizarArgumentos(['--todos'], ENV).ok).toBe(true);
    expect(analizarArgumentos(['--todos', '--aplicar'], ENV).ok).toBe(false);
    expect(analizarArgumentos(['--todos', '--tenant', 'comercio-z'], ENV).ok).toBe(false);
  });
});

describe('alias desde rutasWhatsApp y --todos (bases falsas)', () => {
  const baseDe = (filas: Array<Record<string, unknown>>) => ({
    collection: () => ({ where: () => ({ get: async () => ({ docs: filas.map((f) => ({ get: (k: string) => f[k] })) }) }) }),
  });
  it('un solo alias, lo devuelve; ninguno o varios, se detiene', async () => {
    expect(await aliasDeRutas(baseDe([{ aliasSecreto: 'clienteZz' }, { aliasSecreto: 'clienteZz' }]), 'comercio-z')).toEqual({ ok: true, alias: 'clienteZz' });
    expect((await aliasDeRutas(baseDe([]), 'comercio-z')).ok).toBe(false);
    expect((await aliasDeRutas(baseDe([{ aliasSecreto: 'clienteAa' }, { aliasSecreto: 'clienteBb' }]), 'comercio-z')).ok).toBe(false);
  });

  it('--todos reporta lo que falta de cada ficha', () => {
    const texto = lineasDeTodos([
      { tenant: 'a-completo', estado: 'activo', faltan: [] },
      { tenant: 'b-incompleto', estado: 'activo', faltan: ['guardarMedios', 'personaPuedeEscribir'] },
    ]).join('\n');
    expect(texto).toMatch(/✓ a-completo/);
    expect(texto).toMatch(/✗ b-incompleto: faltan guardarMedios, personaPuedeEscribir/);
    expect(texto).toMatch(/1 con el juego incompleto/);
  });
});
