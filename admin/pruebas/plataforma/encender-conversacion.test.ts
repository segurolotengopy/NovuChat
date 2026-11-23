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
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error módulo .mjs sin tipos
import { COMERCIOS_NO_TOCADOS } from '../../scripts/plataforma/comercios-no-tocados.mjs';
import { JUEGO_CON_INFRA, JUEGO_DE_FICHA } from '../../functions/src/core/conversacion/juego';
// @ts-expect-error módulo .mjs sin tipos
import { fichaInicial } from '../../scripts/plataforma/alta-comercio.mjs';
// @ts-expect-error módulo .mjs sin tipos
import { chequeoSecreto } from '../../scripts/plataforma/verificar-salida-persona.mjs';
// @ts-expect-error módulo .mjs sin tipos
import { analizarArgumentos, argumentosDelPaso, aliasDeRutas, comprobarCanal, esComercioNoTocado, repasarTodos, censurar, correrPasos, lineasDeTodos, pasosDelEncendido, validarOrden } from '../../scripts/plataforma/encender-conversacion.mjs';

type Paso = { id: string; tipo: string; bandera?: string; escribe: boolean; enSeco: boolean; args?: string[]; revertir?: string | null; titulo: string; sondeo?: { args: string[] } };

const SELLO = { creadoEn: 'ahora', creadoPor: 'alta-comercio' };
const PARAMS = {
  tenant: 'comercio-z', alias: 'clienteZz', env: '.env', credIngesta: 'NovuChat ingesta (Z)', credEnvio: 'WhatsApp Z (envío)',
  proyecto: 'proyecto-ficticio-1', respaldoDir: '/tmp/respaldos', sello: 's1',
};
// Retomar va al final del juego aunque core todavía no la liste en JUEGO_CON_INFRA (validarOrden admite ambos casos).
const CAMPOS = [...Object.keys(JUEGO_CON_INFRA), ...('personaPuedeRetomar' in JUEGO_CON_INFRA ? [] : ['personaPuedeRetomar'])];
const pasos = (): Paso[] => pasosDelEncendido(PARAMS);
const indice = (ps: Paso[], id: string) => ps.findIndex((p) => p.id === id);

describe('fichaInicial (alta-comercio.mjs)', () => {
  const ficha = fichaInicial({ nombre: 'Zeta', plan: 'impulso', FLUJOS: ['agendamiento'], sello: SELLO });

  it('trae cada clave de JUEGO_DE_FICHA con su valor exacto', () => {
    for (const [clave, valor] of Object.entries(JUEGO_DE_FICHA)) {
      expect(ficha, clave).toHaveProperty(clave);
      expect(ficha[clave], clave).toBe(valor);
    }
  });

  it('NO escribe las banderas que certifican infraestructura (esas van después de la puerta)', () => {
    for (const clave of CAMPOS) expect(ficha, clave).not.toHaveProperty(clave);
  });

  it('conserva el resto de la ficha de siempre', () => {
    expect(ficha).toMatchObject({ nombre: 'Zeta', estado: 'activo', plan: 'impulso', vertical: 'agendamiento', waPhoneNumberId: null });
    expect(ficha.modulos.length).toBeGreaterThan(0);
  });
});

describe('pasosDelEncendido (encender-conversacion.mjs)', () => {
  it('cubre JUEGO_CON_INFRA: una bandera por clave, en el orden del juego, y ninguna de más', () => {
    const banderas = pasos().filter((p) => p.tipo === 'bandera').map((p) => p.bandera);
    expect(banderas).toEqual(CAMPOS);
  });

  it('el orden es relé, alias, carga, activación, puerta y después las banderas', () => {
    expect(pasos().map((p) => p.id)).toEqual(['rele-inerte', 'alias', 'timbre-carga', 'timbre-activar', 'puerta', ...CAMPOS]);
  });

  it('pone la verificación antes de CADA bandera y toda la infraestructura antes de la verificación', () => {
    const ps = pasos();
    const iPuerta = indice(ps, 'puerta');
    for (const campo of CAMPOS) expect(indice(ps, campo), campo).toBeGreaterThan(iPuerta);
    for (const p of ps.filter((x) => x.tipo === 'spawn')) expect(indice(ps, p.id), p.id).toBeLessThan(iPuerta);
    expect(validarOrden(ps)).toEqual([]);
  });

  it('la puerta pide los medios (4f) y acepta el alias en latest (D1); es solo lectura y ningún paso despliega', () => {
    const puerta = pasos().find((p) => p.tipo === 'puerta') as Paso;
    expect(puerta.args).toContain('--medios');
    expect(puerta.args).toContain('--sin-redespliegue');
    expect(puerta.escribe).toBe(false);
    expect(JSON.stringify(pasos().map((p) => [p.titulo, p.args])).replace('--sin-redespliegue', '')).not.toMatch(/deploy|desplieg|firebase/i);
  });

  it('negativa: un orden con una bandera ANTES de la puerta no es válido y no se ejecuta nada', async () => {
    const ps = pasos();
    const [bandera] = ps.splice(indice(ps, CAMPOS[0] as string), 1);
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
  type Sondeo = { codigo: number; salida: string };
  // Por omisión NADA está hecho: relé y flujo ausentes, alias ausente del mapa.
  const NADA: Record<string, Sondeo> = {
    'rele-inerte': { codigo: 1, salida: '' }, alias: { codigo: 1, salida: 'el alias pedido está ausente' },
    'timbre-carga': { codigo: 2, salida: '' }, 'timbre-activar': { codigo: 2, salida: '' },
  };
  const armar = (fallaEn: string | null, codigoDeFalla = 3, sondeos: Record<string, Sondeo> = NADA) => {
    const llamadas: string[] = [];
    const sondeadas: string[] = [];
    const log: string[] = [];
    const deps = {
      log: (t: string) => log.push(t),
      ejecutar: async (p: Paso) => { llamadas.push(p.id); return p.id === fallaEn ? codigoDeFalla : 0; },
      // Un paso ya ejecutado en esta corrida queda hecho para el sondeo siguiente (como en la realidad).
      sondear: async (p: Paso) => {
        sondeadas.push(p.id);
        if (llamadas.includes(p.id)) return p.id === 'alias' ? { codigo: 3, salida: 'el alias pedido está presente' } : { codigo: 0, salida: '' };
        return sondeos[p.id] ?? { codigo: 2, salida: '' };
      },
    };
    return { llamadas, sondeadas, log, deps };
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
    for (const campo of CAMPOS) expect(llamadas).not.toContain(campo);
    expect(llamadas[llamadas.length - 1]).toBe(falla);
  });

  it('negativa: si falla la segunda bandera, la primera se deshace con su respaldo y no hay paso siguiente', async () => {
    const { llamadas, log, deps } = armar('personaPuedeEnviarMedios');
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(3);
    expect(llamadas.at(-1)).toBe('personaPuedeEnviarMedios');
    expect(log.join('\n')).toMatch(/aplicar-persona-puede-escribir\.mjs --revertir --respaldo \/tmp\/respaldos\/personaPuedeEscribir-comercio-z-s1\.json/);
  });

  it('salida 4 (cerrojo del mapa tomado): no se escribió nada, no se imprime --quitar-alias y se pide esperar', async () => {
    const { log, deps } = armar('alias', 4);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(2);
    expect(log.join('\n')).not.toMatch(/--quitar-alias/);
    expect(log.join('\n')).toMatch(/espere a que termine la otra corrida/);
  });

  it('una negativa del paso (salida 2) corta con 2 y no lo cuenta como escrito', async () => {
    const { log, deps } = armar('alias', 2);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(2);
    expect(log.join('\n')).not.toMatch(/--quitar-alias/);
  });

  it('segunda barrera (puertaOk): un plan SIN puerta que se salta validarOrden no escribe ninguna bandera', async () => {
    const sinPuerta = pasos().filter((p) => p.tipo !== 'puerta');
    const { llamadas, deps } = armar(null);
    const r = await correrPasos(sinPuerta, { aplicar: true, deps, validar: () => [] });
    expect(r.codigo).toBe(2);
    for (const campo of CAMPOS) expect(llamadas).not.toContain(campo);
  });

  it('segunda barrera: la puerta llega y FALLA (el plan sí pasa validarOrden): ninguna bandera corre y no se escribe nada más', async () => {
    expect(validarOrden(pasos())).toEqual([]);
    const { llamadas, deps } = armar('puerta', 1);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(3);
    expect(r.fallo).toBe('puerta');
    expect(llamadas.at(-1)).toBe('puerta');
    for (const campo of CAMPOS) expect(llamadas).not.toContain(campo);
  });

  it('en seco no escribe: sondea, no corre pasos de infraestructura ni la puerta, y deja el código 1 con lo que falta', async () => {
    const { llamadas, log, deps } = armar(null);
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(r.codigo).toBe(1);
    // la primera bandera ya está en true (0) en este simulacro, así que el seco también mira la segunda
    expect(llamadas).toEqual(['personaPuedeEscribir', 'personaPuedeEnviarMedios', 'personaPuedeRetomar']);
    expect(r.pendientes).toEqual(expect.arrayContaining(['rele-inerte', 'alias', 'timbre-carga', 'timbre-activar']));
    expect(log.join('\n')).toMatch(/se comprueba al aplicar/);
    for (const p of pasos().filter((x) => x.args)) expect(argumentosDelPaso(p, false)).not.toContain('--aplicar');
    for (const p of pasos().filter((x) => x.sondeo)) expect(p.sondeo?.args).not.toContain('--aplicar');
  });

  const HECHO_TODO: Record<string, Sondeo> = {
    'rele-inerte': { codigo: 0, salida: '' }, alias: { codigo: 3, salida: 'el alias pedido está presente' },
    'timbre-carga': { codigo: 0, salida: '' }, 'timbre-activar': { codigo: 0, salida: '' },
  };

  it('reanudar: con relé, alias y flujo cargado y activo, al aplicar se saltan los pasos 1 a 4 y solo corren puerta y banderas', async () => {
    const { llamadas, log, deps } = armar(null, 3, HECHO_TODO);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(0);
    expect(llamadas).toEqual(['puerta', ...CAMPOS]);
    expect(log.join('\n')).toMatch(/ya está hecho/);
    // lo saltado no se «deshace»: solo lo que esta corrida escribió
    expect(log.join('\n')).not.toMatch(/--quitar-alias|--quitar --aplicar/);
  });

  it('reanudar a medias: flujo cargado pero inactivo (falta solo activar) corre únicamente la activación', async () => {
    const { llamadas, deps } = armar(null, 3, { ...HECHO_TODO, 'timbre-activar': { codigo: 1, salida: '' } });
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(0);
    expect(llamadas).toEqual(['timbre-activar', 'puerta', ...CAMPOS]);
  });

  it('reanudar: un flujo ya cargado implica relé y alias hechos (un comercio con relé propio no crea el inerte)', async () => {
    const { llamadas, deps } = armar(null, 3, { ...NADA, 'timbre-carga': { codigo: 1, salida: '' } });
    await correrPasos(pasos(), { aplicar: true, deps });
    expect(llamadas).not.toContain('rele-inerte');
    expect(llamadas).not.toContain('alias');
    expect(llamadas).not.toContain('timbre-carga');
    expect(llamadas[0]).toBe('timbre-activar');
  });

  it('seco de un comercio encendido a medias (Walisuma, Casa Bermejo): limpio, corre la puerta y dice qué falta', async () => {
    const { llamadas, log, deps } = armar(null, 3, HECHO_TODO);
    const ejecutar = deps.ejecutar;
    // escribir ya está en true (0); enviar medios todavía no (1)
    deps.ejecutar = async (p: Paso) => { await ejecutar(p); return p.id === 'personaPuedeEnviarMedios' ? 1 : 0; };
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(llamadas).toEqual(['puerta', 'personaPuedeEscribir', 'personaPuedeEnviarMedios', 'personaPuedeRetomar']);
    expect(r.codigo).toBe(1);
    expect(r.pendientes).toEqual(['personaPuedeEnviarMedios']);
    expect(log.join('\n')).toMatch(/Falta: personaPuedeEnviarMedios/);
  });

  it('seco con todo hecho y las dos banderas en true: nada que hacer, código 0', async () => {
    const { deps } = armar(null, 3, HECHO_TODO);
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(r.codigo).toBe(0);
    expect(r.pendientes).toEqual([]);
  });

  it('seco: un sondeo que revienta cuenta como «no hecho», nunca como hecho', async () => {
    const { deps } = armar(null);
    deps.sondear = async () => { throw new Error('red'); };
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(r.pendientes).toContain('timbre-carga');
  });

  it('el mapa se relee antes de CADA bandera: si el alias desapareció, se corta y no se escribe esa bandera', async () => {
    const { llamadas, deps } = armar(null, 3, HECHO_TODO);
    let sondeosDelAlias = 0;
    const sondear = deps.sondear;
    deps.sondear = async (p: Paso) => (p.id === 'alias' && ++sondeosDelAlias > 1 ? { codigo: 1, salida: 'el alias pedido está ausente' } : sondear(p));
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(3);
    expect(llamadas).toEqual(['puerta']);
    for (const campo of CAMPOS) expect(llamadas).not.toContain(campo);
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
  const RESPALDOS = mkdtempSync(join(tmpdir(), 'respaldos-enc-')); // 0700, del usuario, bajo /tmp
  const base = ['--tenant', 'comercio-z', '--env', '.env', '--cred-ingesta', 'a', '--cred-envio', 'b'];

  it('en seco bastan tenant, env y los nombres de las credenciales (el proyecto sale de GCP_PROJECT_ID_PROD)', () => {
    expect(analizarArgumentos(base, ENV).ok).toBe(true);
    expect(analizarArgumentos(['--tenant', 'comercio-z', '--env', '.env'], ENV).ok).toBe(false);
  });

  it('negativas: --aplicar sin --confirmo produccion, con otro proyecto, o sin lo necesario, se niega', () => {
    const completo = [...base, '--respaldo-dir', RESPALDOS, '--aplicar'];
    expect(analizarArgumentos(completo, ENV).ok).toBe(false);
    expect(analizarArgumentos([...completo, '--confirmo', 'produccion'], ENV).ok).toBe(false); // sin --v1-verificado (D1 sin verificar)
    expect(analizarArgumentos([...completo, '--v1-verificado', '--confirmo', 'produccion'], ENV).ok).toBe(true);
    expect(analizarArgumentos([...completo, '--confirmo', 'si'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...completo, '--confirmo', 'produccion', '--proyecto', 'proyecto-stg-ficticio'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...base, '--aplicar', '--confirmo', 'produccion'], ENV).ok).toBe(false);
    expect(analizarArgumentos([...base, '--env', '../.env'], ENV).ok).toBe(false);
  });

  it('negativa: un comercio de COMERCIOS_NO_TOCADOS se rechaza por inclusión, sin tildes ni mayúsculas', () => {
    const no = (COMERCIOS_NO_TOCADOS as string[])[0] as string;
    const t = (id: string) => ['--tenant', id, '--env', '.env', '--cred-ingesta', 'a', '--cred-envio', 'b'];
    expect(analizarArgumentos(t(no), ENV).ok).toBe(false);
    expect(analizarArgumentos(t(`clinica-${no}-sa`), ENV).ok).toBe(false);
    expect(esComercioNoTocado(`Clínica ${no.toUpperCase()}`)).toBe(true);
    expect(esComercioNoTocado(`CLÍNICA ${no}`)).toBe(true);
    expect(esComercioNoTocado('comercio-z')).toBe(false);
  });

  it('--respaldo-dir se valida con comprobarRespaldo: relativa, bajo ~/ o con «..» se rechaza; una carpeta 0700 bajo /tmp pasa', () => {
    const con = (d: string) => analizarArgumentos([...base, '--respaldo-dir', d], ENV);
    expect(con('relativa/dir').ok).toBe(false);
    expect(con(join(homedir(), 'respaldos-enc')).ok).toBe(false);
    expect(con(`${RESPALDOS}/../x`).ok).toBe(false);
    expect(con(RESPALDOS).ok).toBe(true);
  });

  it('--todos es solo lectura y no se combina con --aplicar ni con un comercio', () => {
    expect(analizarArgumentos(['--todos'], ENV).ok).toBe(true);
    expect(analizarArgumentos(['--todos', '--aplicar'], ENV).ok).toBe(false);
    expect(analizarArgumentos(['--todos', '--tenant', 'comercio-z'], ENV).ok).toBe(false);
  });
});

describe('canal de salida y --todos con bases falsas', () => {
  const baseDe = (filas: Array<Record<string, unknown>>) => ({
    collection: () => ({ where: () => ({ get: async () => ({ docs: filas.map((f) => ({ get: (k: string) => f[k] })) }) }) }),
  });
  it('canalSalida «rele» o sin ruta: se niega; graph o ausente: pasa', async () => {
    expect((await comprobarCanal(baseDe([{ canalSalida: 'rele' }]), 'comercio-z')).ok).toBe(false);
    expect((await comprobarCanal(baseDe([{ canalSalida: 'graph' }, { canalSalida: 'rele' }]), 'comercio-z')).ok).toBe(false);
    expect((await comprobarCanal(baseDe([]), 'comercio-z')).ok).toBe(false);
    expect((await comprobarCanal(baseDe([{ canalSalida: 'graph' }]), 'comercio-z')).ok).toBe(true);
    expect((await comprobarCanal(baseDe([{}]), 'comercio-z')).ok).toBe(true);
  });

  it('--todos salta los comercios de COMERCIOS_NO_TOCADOS (por id y por nombre)', async () => {
    const no = (COMERCIOS_NO_TOCADOS as string[])[0] as string;
    const docs = [['a-ok', 'Uno'], [`${no}-x`, 'Otro'], ['c-ok', `Clínica ${no}`]].map(([id, nombre]) => ({ id, get: (k: string) => (k === 'nombre' ? nombre : k === 'estado' ? 'activo' : undefined), data: () => ({}) }));
    const filas = await repasarTodos({ collection: () => ({ get: async () => ({ docs }) }) });
    expect(filas.map((f: { tenant: string }) => f.tenant)).toEqual(['a-ok']);
  });
});

describe('la puerta con D1 (verificar-salida-persona.mjs, --sin-redespliegue)', () => {
  const CLAVE = 'clave-de-prueba-x';
  const mapa = (conAlias: boolean) => JSON.stringify(conAlias ? { clienteZz: { ruta: 'https://n8n.ejemplo.com/webhook/x', clave: CLAVE } } : {});
  const depsDe = (fijada: boolean, latest: boolean) => ({
    gcloud: (args: string[]) => ({ code: 0, stdout: args.includes('latest') ? mapa(latest) : mapa(fijada) }),
  });
  const cfg = (sinRedespliegue: boolean) => ({ proyecto: 'p', alias: 'clienteZz', sinRedespliegue });
  const BASE = 'https://n8n.ejemplo.com';

  it('con la bandera, si SOLO falta en la versión fijada y está en latest: OK con el aviso en voz alta', () => {
    const r = chequeoSecreto(cfg(true), depsDe(false, true), '3', BASE);
    expect(r.resultado.estado).toBe('OK');
    expect(r.resultado.aviso).toMatch(/el timbre llega con la próxima etiqueta; mientras tanto, el barrido/);
    expect(r.ruta).toContain('/webhook/');
  });

  it('negativas: sin la bandera sigue FALLA; si tampoco está en latest, FALLA; con el alias en la fijada no cambia nada', () => {
    expect(chequeoSecreto(cfg(false), depsDe(false, true), '3', BASE).resultado.estado).toBe('FALLA');
    expect(chequeoSecreto(cfg(true), depsDe(false, false), '3', BASE).resultado.estado).toBe('FALLA');
    expect(chequeoSecreto(cfg(true), depsDe(true, true), '3', BASE).resultado.estado).toBe('OK');
  });

  it('negativa: otra falla del secreto (clave corta, host ajeno) sigue cortando aunque esté la bandera', () => {
    const corta = { gcloud: (args: string[]) => ({ code: 0, stdout: args.includes('latest') ? JSON.stringify({ clienteZz: { ruta: 'https://n8n.ejemplo.com/webhook/x', clave: 'corta' } }) : '{}' }) };
    expect(chequeoSecreto(cfg(true), corta, '3', BASE).resultado.estado).toBe('FALLA');
    expect(chequeoSecreto(cfg(true), depsDe(false, true), '3', 'https://otro.ejemplo.com').resultado.estado).toBe('FALLA');
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

describe('Retomar en el orquestador (personaPuedeRetomar)', () => {
  const HECHO = (id: string) => (id === 'alias' ? { codigo: 3, salida: 'el alias pedido está presente' } : { codigo: 0, salida: '' });
  const armar = (retomarCodigo: number) => {
    const llamadas: string[] = [];
    const log: string[] = [];
    const deps = {
      log: (t: string) => log.push(t),
      ejecutar: async (p: Paso) => { llamadas.push(p.id); return p.id === 'personaPuedeRetomar' ? retomarCodigo : 0; },
      sondear: async (p: Paso) => HECHO(p.id),
    };
    return { llamadas, log, deps };
  };

  it('el paso va DESPUÉS de personaPuedeEscribir, y validarOrden lo admite esté o no en JUEGO_CON_INFRA', () => {
    const ps = pasos();
    expect(indice(ps, 'personaPuedeRetomar')).toBeGreaterThan(indice(ps, 'personaPuedeEscribir'));
    expect(indice(ps, 'personaPuedeRetomar')).toBeGreaterThan(indice(ps, 'puerta'));
    expect(validarOrden(ps)).toEqual([]);
    expect(validarOrden(ps.filter((p) => p.bandera !== 'personaPuedeRetomar'))).toEqual([]);   // sin el paso, también válido
    expect(validarOrden([...ps, ...ps.filter((p) => p.bandera === 'personaPuedeRetomar')]).join('|')).toMatch(/personaPuedeRetomar/);
  });

  it('el paso lleva alias y env para que verifique la salida con --plantillas', () => {
    const p = pasos().find((x) => x.bandera === 'personaPuedeRetomar') as Paso & { verificacion?: { alias: string; env: string } };
    expect(p.verificacion).toEqual({ alias: 'clienteZz', env: '.env' });
  });

  it('negativa: sin plantilla (salida 5) NO corta: no cuenta como hecho, no pide deshacerlo y la corrida termina en 5', async () => {
    const { llamadas, log, deps } = armar(5);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(llamadas).toContain('personaPuedeEscribir');
    expect(llamadas).toContain('personaPuedeEnviarMedios');
    expect(llamadas).toContain('personaPuedeRetomar');
    expect(r.codigo).toBe(5);
    expect(r.fallo).toBeNull();
    expect(r.pendientesMeta).toEqual(['personaPuedeRetomar']);
    expect(r.hechos.map((p: Paso) => p.id)).not.toContain('personaPuedeRetomar');
    expect(log.join('\n')).toMatch(/PENDIENTE DE META/);
    expect(log.join('\n')).not.toMatch(/aplicar-persona-puede-retomar\.mjs --revertir/);
    expect(log.join('\n')).toMatch(/aplicar-persona-puede-enviar-medios\.mjs --revertir/);
  });

  it('el 5 no corta el resto aunque Retomar no fuera la última bandera', async () => {
    const ps = pasos();
    const [r] = ps.splice(indice(ps, 'personaPuedeRetomar'), 1);
    ps.splice(indice(ps, 'personaPuedeEnviarMedios'), 0, r as Paso);   // Retomar antes que medios (como si core la lista así)
    const { llamadas, deps } = armar(5);
    const res = await correrPasos(ps, { aplicar: true, deps });
    expect(llamadas.indexOf('personaPuedeEnviarMedios')).toBeGreaterThan(llamadas.indexOf('personaPuedeRetomar'));
    expect(res.codigo).toBe(5);
  });

  it('contraprueba: otra salida distinta de 5 (2 o 3) SÍ corta y es un fallo', async () => {
    for (const c of [2, 3]) {
      const { deps } = armar(c);
      const r = await correrPasos(pasos(), { aplicar: true, deps });
      expect(r.codigo, String(c)).toBe(c === 2 ? 2 : 3);
      expect(r.fallo).toBe('personaPuedeRetomar');
    }
  });

  it('el 5 de un paso que NO es una bandera (la puerta) sigue siendo un fallo y no escribe nada', async () => {
    const llamadas: string[] = [];
    const deps = { log: () => {}, sondear: async (p: Paso) => HECHO(p.id), ejecutar: async (p: Paso) => { llamadas.push(p.id); return p.id === 'puerta' ? 5 : 0; } };
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(3);
    expect(llamadas).not.toContain('personaPuedeEscribir');
  });

  it('en seco, el 5 se informa como pendiente (código 1) y no escribe nada', async () => {
    const { log, deps } = armar(5);
    const r = await correrPasos(pasos(), { aplicar: false, deps });
    expect(r.codigo).toBe(1);
    expect(r.pendientes).toContain('personaPuedeRetomar');
    expect(log.join('\n')).toMatch(/PENDIENTE DE META/);
  });

  it('todo bien (0): termina en 0 y Retomar queda entre lo que se deshace', async () => {
    const { log, deps } = armar(0);
    const r = await correrPasos(pasos(), { aplicar: true, deps });
    expect(r.codigo).toBe(0);
    expect(log.join('\n')).toMatch(/aplicar-persona-puede-retomar\.mjs --revertir/);
  });
});
