/**
 * LAS EXCEPCIONES DE LA MIGRACIÓN DE FLUJOS (etapa 0, 12/11/2026): lista CERRADA que solo puede bajar.
 *
 * La etapa 0 NO arregla ningún flujo. Lo que hoy no cumple una regla común de invariantes entra aquí, con dueño, fecha de alta y
 * vencimiento, y cada prueba común exige que (a) toda violación de hoy tenga su excepción y (b) toda excepción siga siendo una
 * violación (una que ya se cumple SOBRA y hace fallar la prueba: hay que borrarla). Patrón copiado de `core/entregas.test.ts`
 * (`ALTA_DE_EXCEPCIONES`, `TOPE_DE_EXCEPCIONES`).
 *
 * CLAVE: `<json>#<regla>#<nodo>`. `<json>` es la ruta relativa a `Flujos/` (la identidad no depende de si el flujo vive en `experimental/`
 * o en `clientes/`: ver `idDeFlujo`); `<regla>` es una de `REGLAS`; `<nodo>` es el nodo (o el elemento) que no cumple.
 *
 * ATENCIÓN: cambiar `ALTA`, `TOPE`, `VENCE` o cualquier `vence` EXIGE pasar por el agente `seguridad`: son los topes que impiden que
 * este mapa sea un cheque en blanco. `TOPE` es la cuenta MEDIDA corriendo las pruebas el 12/11/2026, no un número escrito a mano:
 * una excepción nueva exige bajar otra, o un PR que cambie el tope y lo justifique.
 */
import { idDeFlujo } from './comprobaciones';

/** Las reglas comunes que reconocen excepciones (la 1.ª es M4, la 2.ª es M5, el resto son las pruebas comunes de invariantes). */
export const REGLAS = [
  'nucleo-comun', 'niega-ia', 'error-workflow-por-nombre', 'ux-derivacion', 'capacidades-comunes', 'flujos-origen', 'entregas', 'expresiones-n8n',
] as const;
export type Regla = (typeof REGLAS)[number];

export interface Excepcion { dueno: string; vence: string; motivo: string; desde: string }

/** Fecha de alta del mapa: ninguna excepción vence más de 90 días después (2026-11-12 + 90 = 2027-02-10). */
export const ALTA = '2026-11-12';
/** Cuántas excepciones hay hoy, medidas con las pruebas el 12/11/2026 (88 tras cerrar la de la redirección, aplicar el contrato sin agente y declarar dos expresiones de NIEGA_IA el 13/11/2026). SOLO BAJA. */
export const TOPE = 88;
/** El mismo tope desglosado por regla (la suma es `TOPE`). Cada cuenta es la medida el 12/11/2026. SOLO BAJA. */
export const TOPE_POR_REGLA: Record<Regla, number> = {
  'nucleo-comun': 54, 'niega-ia': 4, 'error-workflow-por-nombre': 16, 'ux-derivacion': 4, 'capacidades-comunes': 10, 'flujos-origen': 0, entregas: 0, 'expresiones-n8n': 0,
};

const DUENO = 'por asignar (Principal)';
const VENCE = '2027-01-31';

type Tabla = Record<string, string[]>;
/** Expande una tabla `json → nodos` a claves explícitas con el mismo dueño, fechas y motivo. */
function porRegla(regla: Regla, motivo: string, tabla: Tabla): Record<string, Excepcion> {
  const salida: Record<string, Excepcion> = {};
  for (const [json, nodos] of Object.entries(tabla)) {
    for (const nodo of nodos) salida[clave(json, regla, nodo)] = { dueno: DUENO, vence: VENCE, motivo, desde: ALTA };
  }
  return salida;
}

export const clave = (json: string, regla: string, nodo: string): string => `${json}#${regla}#${nodo}`;

/** Separa una clave en `[json, regla, nodo]` (el nodo puede contener `#`). */
export function partesDeClave(k: string): [string, string, string] {
  const [json = '', regla = '', ...resto] = k.split('#');
  return [json, regla, resto.join('#')];
}

// Los 13 flujos de producción que atienden a un cliente SIN el agente de n8n (el agente es código propio del flujo): decisión D2 de Andres, 12/11/2026.
const SIN_AGENTE_QUE_ATIENDEN = [
  'experimental/agenda-minima/agenda-minima.v0.json', 'experimental/captacion-minima/captacion-minima.novuchat.json',
  'experimental/casa-bermejo/casa-bermejo.json', 'experimental/chat-novuchat/chat-novuchat.novuchat.json',
  'experimental/doctoras/doctoras.rroca-emma.json', 'experimental/doctoras/doctoras.rroca-evy.json',
  'experimental/rroca-antonio/rroca-antonio.json', 'experimental/rroca-emma/rroca-emma.json', 'experimental/rroca-evy/rroca-evy.json',
  'experimental/rroca-ruben/rroca-ruben.json', 'experimental/venta-minima/venta-minima.qtaco-3727.json',
  'experimental/venta-minima/venta-minima.qtaco.json', 'experimental/walisuma/walisuma.json',
];
const RAIZ_QUE_ATIENDEN = ['bellido-agendamiento.json', 'demo-a-agendamiento.json', 'demo-b-venta-cobro.json', 'novuchat-onboarding.json'];
const unNodo = (lista: string[], nodo: string): Tabla => Object.fromEntries(lista.map((j) => [j, [nodo]]));

export const EXCEPCIONES: Record<string, Excepcion> = {
  // M4 (`core/nucleo-comun.test.ts`): nodos comunes que no incluyen una variante declarada de core. 32 + 22.
  ...porRegla('nucleo-comun', 'El flujo lleva una versión propia del nodo, distinta de las variantes declaradas de core (VARIANTES.md); se unifica con core en la etapa 1, no en la 0', {
    'clientes/qtaco-redireccion/qtaco-redireccion.qtaco-ruta-nueva.json': ['Config del negocio'],
    'clientes/qtaco-redireccion/qtaco-redireccion.qtaco.json': ['Config del negocio'],
    'experimental/agenda-minima/agenda-minima.v0.json': ['Normalizar entrada', 'Config del negocio', 'Uso extendido', 'Comercio no operativo'],
    'experimental/captacion-minima/captacion-minima.novuchat.json': ['Config del negocio', 'Uso extendido', 'Comercio no operativo'],
    'experimental/casa-bermejo/casa-bermejo.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/chat-novuchat/chat-novuchat.novuchat.json': ['Config del negocio'],
    'experimental/doctoras/doctoras.rroca-emma.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/doctoras/doctoras.rroca-evy.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/rroca-antonio/rroca-antonio.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/rroca-emma/rroca-emma.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/rroca-evy/rroca-evy.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/rroca-ruben/rroca-ruben.json': ['Normalizar entrada', 'Config del negocio'],
    'experimental/venta-minima/venta-minima.qtaco-3727.json': ['Config del negocio', 'Uso extendido', 'Comercio no operativo'],
    'experimental/venta-minima/venta-minima.qtaco.json': ['Config del negocio', 'Uso extendido', 'Comercio no operativo'],
    'experimental/walisuma/walisuma.json': ['Normalizar entrada', 'Config del negocio'],
  }),
  ...porRegla('nucleo-comun', 'capa común experimental, sube a core en la etapa 1', {
    'experimental/agenda-minima/agenda-minima.v0.json': ['Carga de entrada'],
    'experimental/captacion-minima/captacion-minima.novuchat.json': ['Carga de entrada'],
    'experimental/casa-bermejo/casa-bermejo.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/chat-novuchat/chat-novuchat.novuchat.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/doctoras/doctoras.rroca-emma.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/doctoras/doctoras.rroca-evy.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/rroca-antonio/rroca-antonio.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/rroca-emma/rroca-emma.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/rroca-evy/rroca-evy.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/rroca-ruben/rroca-ruben.json': ['Carga de entrada', 'Puerta del turno'],
    'experimental/venta-minima/venta-minima.qtaco-3727.json': ['Carga de entrada'],
    'experimental/venta-minima/venta-minima.qtaco.json': ['Carga de entrada'],
    'experimental/walisuma/walisuma.json': ['Carga de entrada', 'Puerta del turno'],
  }),
  // M5 (`core/niega-ia.test.ts`): la red NIEGA_IA no sale de core. 4. Las 9 copias renombradas de la expresión sobre texto normalizado ya cumplen: core declara DOS expresiones (13/11/2026).
  ...porRegla('niega-ia', 'No declara ninguna expresión NIEGA_IA en su código (búsqueda por la constante; no se descartó otro mecanismo); se avisa a la sesión dueña, y no se arregla en la etapa 0', unNodo([
    'experimental/agenda-minima/agenda-minima.v0.json', 'experimental/captacion-minima/captacion-minima.novuchat.json',
    'experimental/venta-minima/venta-minima.qtaco-3727.json', 'experimental/venta-minima/venta-minima.qtaco.json',
  ], 'NIEGA_IA')),
  // errorWorkflow por nombre (`core/error-workflow-por-nombre.test.ts`): solo Emma lleva el marcador. 16.
  ...porRegla('error-workflow-por-nombre', 'Sin settings.errorWorkflow con el marcador de la alerta de envío incierto; se asigna al adoptar la alerta, no en la etapa 0', unNodo([
    ...RAIZ_QUE_ATIENDEN, ...SIN_AGENTE_QUE_ATIENDEN.filter((j) => !j.includes('rroca-emma/')),
  ], 'settings.errorWorkflow')),
  // Derivación (`core/ux-derivacion.test.ts`): flujos fuera del registro por carpeta, sin tabla de derivación. 4.
  ...porRegla('ux-derivacion', 'Flujo de la raíz de Flujos/ sin tabla de derivación propia (el registro es por carpeta de experimental/); no se arregla en la etapa 0', unNodo(RAIZ_QUE_ATIENDEN, 'tabla de derivación')),
  // Capacidades comunes (D2; etapa 1): el contrato para flujos sin agente (`faltantesDeMediosSinAgente`) lo cumplen agenda mínima y las dos doctoras; el resto conserva su excepción, con lo que le falta. 10.
  ...porRegla('capacidades-comunes', 'Flujo sin agente: «¿Es audio?» bifurca además a «Guardar comprobante» (POST con el binario, sin pasar por un «Preparar …») y «Interpretar lectura» vuelve a otro destino que los terminales de la rama; el contrato sin agente no admite esa extensión de Cobros (hace falta decidir si se admite como declarada)', unNodo([
    'experimental/casa-bermejo/casa-bermejo.json', 'experimental/rroca-antonio/rroca-antonio.json', 'experimental/rroca-ruben/rroca-ruben.json', 'experimental/walisuma/walisuma.json',
  ], 'rama de medios')),
  ...porRegla('capacidades-comunes', 'Flujo sin agente con rama de medios incompleta: le faltan los nodos «Preparar transcripción», «Preparar imagen» y «Medio no aceptado»', unNodo([
    'experimental/captacion-minima/captacion-minima.novuchat.json', 'experimental/chat-novuchat/chat-novuchat.novuchat.json',
  ], 'rama de medios')),
  ...porRegla('capacidades-comunes', 'Flujo sin agente con rama de medios solo de audio: le faltan «¿Es un documento?», «Describir imagen», «Describir documento», «Preparar imagen» y «Medio no aceptado»', unNodo([
    'experimental/rroca-emma/rroca-emma.json', 'experimental/rroca-evy/rroca-evy.json',
  ], 'rama de medios')),
  ...porRegla('capacidades-comunes', 'Flujo sin agente con rama de medios solo de audio: le faltan «¿Es un documento?», «Describir imagen», «Describir documento», «Preparar transcripción», «Preparar imagen» y «Medio no aceptado»', unNodo([
    'experimental/venta-minima/venta-minima.qtaco-3727.json', 'experimental/venta-minima/venta-minima.qtaco.json',
  ], 'rama de medios')),
};

// ---------------------------------------------------------------------------
// Verificación: la usan las pruebas de cada regla y `excepciones.test.ts`
// ---------------------------------------------------------------------------

/** Las excepciones de una regla: `[json, nodo]`. */
export function excepcionesDe(regla: string, excepciones: Record<string, Excepcion> = EXCEPCIONES): [string, string][] {
  return Object.keys(excepciones).map(partesDeClave).filter(([, r]) => r === regla).map(([j, , n]) => [j, n]);
}

/**
 * Cruza las violaciones de hoy de una regla con sus excepciones. `hoy`: flujo (ruta relativa a `Flujos/`) → nodos que no cumplen; TODO flujo
 * analizado debe estar como clave (con lista vacía si cumple), para distinguir «cumple» de «no existe». Devuelve los problemas:
 * violación sin excepción, excepción que sobra (ya se cumple) y excepción sobre un flujo que no existe.
 */
export function problemasDeRegla(regla: string, hoy: Map<string, string[]>, excepciones: Record<string, Excepcion> = EXCEPCIONES): string[] {
  const problemas: string[] = [];
  const porId = new Map([...hoy].map(([j, nodos]) => [idDeFlujo(j), nodos]));
  const cubiertas = new Set<string>();
  for (const [json, nodo] of excepcionesDe(regla, excepciones)) {
    const nodos = porId.get(idDeFlujo(json));
    if (!nodos) { problemas.push(`${json}#${regla}#${nodo}: nombra un flujo que no existe`); continue; }
    if (!nodos.includes(nodo)) { problemas.push(`${json}#${regla}#${nodo}: SOBRA, el flujo ya lo cumple; hay que borrarla`); continue; }
    cubiertas.add(`${idDeFlujo(json)}#${nodo}`);
  }
  for (const [json, nodos] of hoy) {
    for (const nodo of nodos) {
      if (!cubiertas.has(`${idDeFlujo(json)}#${nodo}`)) problemas.push(`${json}#${regla}#${nodo}: viola la regla y no tiene excepción declarada`);
    }
  }
  return problemas;
}

/** `problemasDeRegla` para UN solo flujo: solo se miran las excepciones que nombran a ese flujo (la usa `migrado.ts` en M4 y M5). */
export function problemasDeFlujo(
  regla: string, ruta: string, nodos: string[], excepciones: Record<string, Excepcion> = EXCEPCIONES,
): string[] {
  const propias = Object.fromEntries(Object.entries(excepciones).filter(([k]) => idDeFlujo(partesDeClave(k)[0]) === idDeFlujo(ruta)));
  return problemasDeRegla(regla, new Map([[ruta, nodos]]), propias);
}

const AAAA_MM_DD =/^\d{4}-\d{2}-\d{2}$/;
const instante = (f: string): number => (AAAA_MM_DD.test(f) ? new Date(`${f}T00:00:00Z`).getTime() : NaN);

/** La forma del mapa: dueño, motivo, fechas, vencimiento a no más de 90 días del alta y no vencido, regla conocida. */
export function problemasDeForma(
  excepciones: Record<string, Excepcion> = EXCEPCIONES, alta: string = ALTA, ahora: Date = new Date(),
): string[] {
  const p: string[] = [];
  const limite = instante(alta) + 90 * 86_400_000;
  for (const [k, e] of Object.entries(excepciones)) {
    const [json, regla, nodo] = partesDeClave(k);
    if (!json || !regla || !nodo) p.push(`${k}: la clave no es <json>#<regla>#<nodo>`);
    if (!(REGLAS as readonly string[]).includes(regla)) p.push(`${k}: la regla «${regla}» no es una de las conocidas`);
    if (!e.dueno.trim()) p.push(`${k}: sin dueño`);
    if (!e.motivo.trim()) p.push(`${k}: sin motivo`);
    if (Number.isNaN(instante(e.desde))) p.push(`${k}: «desde» no es una fecha AAAA-MM-DD`);
    const t = instante(e.vence);
    if (Number.isNaN(t)) p.push(`${k}: «vence» no es una fecha AAAA-MM-DD`);
    else if (t > limite) p.push(`${k}: vence ${e.vence}, a más de 90 días del alta (${alta})`);
    else if (ahora.getTime() > t) p.push(`${k}: VENCIÓ el ${e.vence}: o se cierra, o se renueva con una decisión de Andres`);
  }
  return p;
}
