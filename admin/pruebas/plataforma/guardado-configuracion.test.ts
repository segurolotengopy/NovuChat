/**
 * EL GUARDADO COMPLETO DE «CONFIGURACIÓN», PROBADO COMO LO HACE LA CONSOLA.
 *
 * Criterio de Andres: ninguna función de la consola se entrega sin probarse
 * completa. «Guardar» en Configuración hace UN `updateDoc` con el formulario
 * entero a `tenants/{t}/config/negocio`; Firestore evalúa las reglas sobre el
 * documento RESULTANTE (el guardado más lo que ya había: mensajes fijos, listas,
 * lo que escribe el servidor), y una petición que gasta más de 1.000 expresiones
 * se rechaza («El servidor rechazó el cambio. Revise los datos.»).
 *
 * Esta prueba arma lo que manda la pantalla con las MISMAS funciones que la
 * pantalla (`datosDeNegocio` y `payloadNegocio`, ver `guardado-configuracion-lib.ts`)
 * y lo manda con el SDK de cliente como administrador de un comercio de venta
 * con la forma de Q'Taco (`flujos: ['venta']`, sin `modulos`):
 *
 *  · POSITIVOS: el documento completo —el de la siembra del repositorio y el
 *    «tope» con todo lo que admite— con 6 y 7 días de horario (un rango por día),
 *    el catálogo web apagado→apagado (guardar SIN CAMBIAR NADA), encendiéndolo y ya
 *    encendido, con y sin ubicación, calendario vacío, de grupo y de correo, y una
 *    ficha con solo `vertical`. Todos tienen que pasar con las reglas de ahora.
 *  · DEMOSTRACIÓN: el documento de 7 días tiene que FALLAR con las reglas de
 *    la etiqueta v0.13.2 (producción hoy) y con las de main justo antes del recorte:
 *    así queda demostrado que antes no se podía guardar. Las dos son fixtures de
 *    texto congeladas (`firestore-base-v0.13.2.rules.txt` y
 *    `firestore-base-previa-config-negocio.rules.txt`), que se retiran cuando el
 *    recorte lleve una versión en producción.
 *  · NEGATIVOS: el mismo guardado con un defecto —horarios inválidos, enlace de mapa
 *    que no es https o de otro dominio, `ubicacion` con tres claves,
 *    `catalogoWebActivo: 'false'`, un comercio sin flujo de venta que enciende el
 *    catálogo web— se rechaza con las reglas de ahora, y el mismo guardado SIN el
 *    defecto pasa (no se rechaza por otra causa).
 *
 * La prueba de NAVEGADOR (que la pantalla guarda y muestra «Guardado.») es de la
 * suite de navegador de la Operadora: el caso está en la descripción del PR.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentoAlmacenado, horarioDe, payloadDeLaConsola, type Calendario, type Forma } from './guardado-configuracion-lib.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8');
const PRODUCCION = readFileSync(join(aqui, 'firestore-base-v0.13.2.rules.txt'), 'utf8');
const MAIN_ANTES = readFileSync(join(aqui, 'firestore-base-previa-config-negocio.rules.txt'), 'utf8');
const PUERTO = Number(process.env['FIRESTORE_EMULATOR_PORT'] ?? 8231);
const TS = Timestamp.fromMillis(1_700_000_000_000);
const UID = 'u-admin-q';

const comun = { creadoEn: TS, creadoPor: 'u-x', estado: 'activo', plan: 'crecimiento', waPhoneNumberId: 'pn', waWabaId: 'wb', nombre: 'Q' };
const FICHAS = {
  venta: { ...comun, flujos: ['venta'], vertical: 'venta' },
  soloVertical: { ...comun, vertical: 'venta' },
  agenda: { ...comun, flujos: ['agendamiento'], vertical: 'agendamiento' },
} as const;

type Resultado = 'P' | 'N' | 'LIMITE';
type Fila = {
  id: string; forma: Forma; dias: number; ubicacion: boolean; calendario?: Calendario;
  /** 'apagado': guardar sin cambiar (apagado→apagado); 'enciende'; 'ya': ya estaba encendido. */
  catalogo: 'apagado' | 'enciende' | 'ya';
  ficha?: keyof typeof FICHAS;
  /** El defecto que se le mete al payload, si es un negativo. */
  defecto?: (p: Record<string, unknown>) => void;
};

const filaPositiva = (forma: Forma, dias: number, catalogo: Fila['catalogo'], ubicacion: boolean, extra: Partial<Fila> = {}): Fila => ({
  id: `${forma}, ${dias} días, catálogo web ${{ apagado: 'apagado (sin cambios)', enciende: 'SE ENCIENDE', ya: 'ya encendido' }[catalogo]}, ${ubicacion ? 'con' : 'sin'} ubicación${extra.calendario ? `, calendario ${extra.calendario}` : ''}${extra.ficha ? `, ficha ${extra.ficha}` : ''}`,
  forma, dias, ubicacion, catalogo, ...extra,
});

const POSITIVAS: Fila[] = [];
for (const forma of ['sembrado', 'tope'] as const) {
  for (const dias of [6, 7]) {
    for (const catalogo of ['apagado', 'enciende', 'ya'] as const) {
      for (const ubicacion of [true, false]) POSITIVAS.push(filaPositiva(forma, dias, catalogo, ubicacion));
    }
  }
}
for (const calendario of ['vacio', 'correo'] as const) POSITIVAS.push(filaPositiva('tope', 7, 'enciende', true, { calendario }));
POSITIVAS.push(filaPositiva('tope', 7, 'enciende', true, { ficha: 'soloVertical' }));
POSITIVAS.push(filaPositiva('sembrado', 7, 'enciende', true, { ficha: 'soloVertical' }));

/** El negativo parte del peor documento (7 días, tope, catálogo web, ubicación) y de la siembra. */
const NEGATIVAS: Fila[] = [];
const defectos: [string, (p: Record<string, unknown>) => void, Partial<Fila>?][] = [
  ['horario 10:00-09:59 (invertido por un minuto)', (p) => { (p['horarios'] as Record<string, string>)['mie'] = '10:00-09:59'; }],
  ['horario 25:00-26:00 (horas imposibles)', (p) => { (p['horarios'] as Record<string, string>)['vie'] = '25:00-26:00'; }],
  ['horario con formato roto (9 a 7)', (p) => { (p['horarios'] as Record<string, string>)['lun'] = '9 a 7'; }],
  ['horario con formato roto (sin cero)', (p) => { (p['horarios'] as Record<string, string>)['dom'] = '9:00-18:00'; }],
  ['horario: un día que no existe', (p) => { (p['horarios'] as Record<string, string>)['feriado'] = 'cerrado'; }],
  ['direccionMaps con http', (p) => { p['direccionMaps'] = 'http://maps.app.goo.gl/AbCdEfGh12'; }],
  ['direccionMaps de un dominio ajeno', (p) => { p['direccionMaps'] = 'https://evil.com/maps'; }],
  ['direccionMaps de un subdominio engañoso', (p) => { p['direccionMaps'] = 'https://maps.app.goo.gl.evil.com/x'; }],
  ['ubicacion con tres claves', (p) => { p['ubicacion'] = { lat: -17.8, lng: -63.2, alt: 3600 }; }],
  ['ubicacion con la latitud fuera de rango', (p) => { p['ubicacion'] = { lat: 91, lng: -63.2 }; }],
  ["catalogoWebActivo como texto 'false'", (p) => { p['catalogoWebActivo'] = 'false'; }],
  ['un comercio SIN flujo de venta que enciende el catálogo web', () => undefined, { ficha: 'agenda' }],
];
for (const forma of ['tope', 'sembrado'] as const) {
  for (const [nombre, defecto, extra] of defectos) {
    NEGATIVAS.push({ id: `${forma}, 7 días: ${nombre}`, forma, dias: 7, ubicacion: true, catalogo: 'enciende', defecto, ...extra });
  }
}

/**
 * DIAGNÓSTICO. La siembra del repositorio (`scripts/sembrar.mjs`) deja `calendarioId: '<id>@group.calendar.google.com'`,
 * que NO es un ID de grupo válido (64 hexadecimales): guardar ese documento SIN CAMBIAR NADA se rechaza con cualquier
 * presupuesto, y el emulador además rotula la denegación con «maximum of 1000 expressions» porque al denegar reevalúa
 * las demás ramas con el presupuesto ya gastado. Mirando solo el texto del error, un rechazo de validez se confunde con
 * uno de presupuesto: lo que distingue es que el MISMO documento con un calendario válido pasa (filas `sembrado` de
 * arriba) y que un documento válido nunca falla con las reglas de ahora.
 */
const DIAGNOSTICO: Fila[] = [6, 7].map((dias) => filaPositiva('sembrado', dias, 'apagado', false, { calendario: 'invalido' }));

let entorno: RulesTestEnvironment | undefined;
const iniciar = async (reglas: string): Promise<RulesTestEnvironment> => {
  if (entorno) await entorno.cleanup();
  entorno = await initializeTestEnvironment({ projectId: 'demo-novuchat-pruebas', firestore: { rules: reglas, host: '127.0.0.1', port: PUERTO } });
  return entorno;
};

async function guardar(reglas: string, filas: Fila[]): Promise<Map<string, Resultado>> {
  const e = await iniciar(reglas);
  const fs = e.authenticatedContext(UID, {
    nc: { t: { q: 'admin' }, v: 1 }, firebase: { sign_in_provider: 'password', identities: {} }, email_verified: true,
  }).firestore();
  const salida = new Map<string, Resultado>();
  for (const f of filas) {
    await e.clearFirestore();
    const almacenado = documentoAlmacenado(f.forma, {
      dias: f.dias, ubicacion: f.ubicacion, ...(f.calendario ? { calendario: f.calendario } : {}), catalogoWebGuardado: f.catalogo === 'ya',
    });
    await e.withSecurityRulesDisabled(async (cx) => {
      await setDoc(doc(cx.firestore(), 'tenants/q'), FICHAS[f.ficha ?? 'venta']);
      await setDoc(doc(cx.firestore(), 'tenants/q/config/negocio'), almacenado);
    });
    // Lo que manda la pantalla: la casilla del catálogo web va en `true` si se enciende o ya estaba encendido.
    const payload = payloadDeLaConsola(almacenado, UID, f.catalogo === 'apagado' ? false : true);
    f.defecto?.(payload);
    let r: Resultado = 'P';
    try { await updateDoc(doc(fs, 'tenants/q/config/negocio'), payload); } catch (x) {
      const m = String((x as { message?: string }).message ?? x);
      r = m.includes('maximum of 1000') ? 'LIMITE' : 'N';
    }
    salida.set(f.id, r);
  }
  return salida;
}

let ahora: Map<string, Resultado>;
let produccion: Map<string, Resultado>;
let mainAntes: Map<string, Resultado>;

describe('el guardado completo de Configuración, como lo hace la consola', () => {
  beforeAll(async () => {
    ahora = await guardar(AHORA, [...POSITIVAS, ...NEGATIVAS, ...DIAGNOSTICO]);
    produccion = await guardar(PRODUCCION, [...POSITIVAS, ...DIAGNOSTICO]);
    mainAntes = await guardar(MAIN_ANTES, [...POSITIVAS, ...DIAGNOSTICO]);
    const tabla = [...POSITIVAS, ...DIAGNOSTICO].map((f) => `${f.id} | v0.13.2 ${produccion.get(f.id)} | main antes ${mainAntes.get(f.id)} | ahora ${ahora.get(f.id)}`);
    console.log(`GUARDADO COMPLETO (P = guarda; LIMITE = «maximum of 1000 expressions»; N = rechazo de una regla)\n${tabla.join('\n')}`);
  }, 900_000);
  afterAll(async () => { await entorno?.cleanup(); });

  it('con las reglas de ahora, TODOS los guardados completos pasan (6 y 7 días, sin cambios, enciende y ya encendido)', () => {
    const fallan = POSITIVAS.filter((f) => ahora.get(f.id) !== 'P').map((f) => `${f.id}: ${ahora.get(f.id)}`);
    expect(fallan).toEqual([]);
  });

  it('con las reglas de v0.13.2 (producción) y las de main antes del recorte, el guardado con catálogo web y ubicación FALLA por presupuesto', () => {
    for (const forma of ['sembrado', 'tope'] as const) {
      for (const dias of [6, 7]) {
        for (const catalogo of ['enciende', 'ya'] as const) {
          const id = filaPositiva(forma, dias, catalogo, true).id;
          expect(produccion.get(id), `v0.13.2: ${id}`).toBe('LIMITE');
          expect(mainAntes.get(id), `main antes: ${id}`).toBe('LIMITE');
        }
      }
    }
  });

  it('MEDIDO: guardar SIN CAMBIAR NADA con el catálogo web apagado ya cabía (no evalúa `tieneFlujo`); lo que no cabía es lo que lo evalúa', () => {
    // Si esto cambiara, la descripción del PR (y el diagnóstico de abajo) habría que revisarlos.
    for (const forma of ['sembrado', 'tope'] as const) {
      for (const dias of [6, 7]) {
        for (const ubicacion of [true, false]) {
          const id = filaPositiva(forma, dias, 'apagado', ubicacion).id;
          expect(produccion.get(id), `v0.13.2: ${id}`).toBe('P');
          expect(mainAntes.get(id), `main antes: ${id}`).toBe('P');
        }
      }
    }
  });

  it('DIAGNÓSTICO: el documento de la siembra, con su calendario inválido, se rechaza con todas las reglas (no es presupuesto)', () => {
    for (const f of DIAGNOSTICO) {
      expect(ahora.get(f.id), `ahora: ${f.id}`).toBe('N');
      // Con las reglas anteriores el emulador lo rotula «maximum of 1000» aunque el motivo es la validez del calendario.
      expect(produccion.get(f.id), `v0.13.2: ${f.id}`).not.toBe('P');
      expect(mainAntes.get(f.id), `main antes: ${f.id}`).not.toBe('P');
    }
  });

  it('el peor documento (7 días, tope, catálogo web, ubicación) falla antes y pasa ahora: la fila del encargo', () => {
    const id = filaPositiva('tope', 7, 'enciende', true).id;
    expect([produccion.get(id), mainAntes.get(id), ahora.get(id)]).toEqual(['LIMITE', 'LIMITE', 'P']);
  });

  it('cada defecto se rechaza con las reglas de ahora, y el mismo guardado sin el defecto pasa', () => {
    for (const f of NEGATIVAS) expect(ahora.get(f.id), f.id).toBe('N');
    // La base de los negativos pasa (el rechazo es del defecto, no de otra cosa).
    for (const forma of ['tope', 'sembrado'] as const) {
      expect(ahora.get(filaPositiva(forma, 7, 'enciende', true).id), `${forma}: base de los negativos`).toBe('P');
    }
    expect(NEGATIVAS.length).toBe(defectos.length * 2);
  });

  it('control: los guardados usan siete días de verdad y el payload es el de la consola', () => {
    expect(Object.keys(horarioDe(7))).toHaveLength(7);
    const almacenado = documentoAlmacenado('tope', { dias: 7 });
    const p = payloadDeLaConsola(almacenado, UID, true);
    // Lo que manda la pantalla y lo que NO.
    expect(p['catalogoWebActivo']).toBe(true);
    expect(p['zonaHoraria']).toBe('America/La_Paz');
    expect(p['actualizadoPor']).toBe(UID);
    expect(p).not.toHaveProperty('instruccionesVigentes');
    expect(p).not.toHaveProperty('instruccionesRevision');
    expect(p).not.toHaveProperty('mensajes');
  });
});
