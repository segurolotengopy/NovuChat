/**
 * El estado de la conversación entre turnos (F3b, O2): el NÚCLEO PURO.
 *
 * Qué es: la lógica que no necesita Firestore ni Express para decidirse. Valida
 * la petición `sesion` que viaja en el cuerpo de `configuracionFlujo`, arma los
 * ids de documento, calcula los períodos de los cupos en La Paz, lee el
 * vencimiento y DECIDE un compromiso (repetido, conflicto de versión, cupo
 * negado o comprometido). La transacción que lo aplica y el despacho son de
 * otros PR (2a y 2b): acá nada lee ni escribe, y por eso cada regla se prueba
 * negando, sin emulador.
 *
 * Por qué puro: el tiempo entra SIEMPRE por parámetro (`ahoraMs`). Una función
 * que leyera el reloj o el entorno por su cuenta haría que las pruebas de
 * períodos cambiaran con el día en que corren.
 *
 * Seguridad: la clave de aislamiento es `tenantId` + `phoneNumberId` de la ruta
 * ya autenticada; nada de lo que sigue lee un tenant del cuerpo. Los ids nunca
 * admiten `/` ni `~` dentro de un componente, porque el `~` separa y la `/`
 * abriría otra ruta de Firestore. `espacio` es una partición lógica, no una
 * frontera.
 *
 * Zona Core: solo importa `node:crypto`. Contrato en `Analisis/41` y en el plan
 * de F3b (18/10/2026), §1.
 */
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------- constantes

export const VERSION_PROTOCOLO = 1;
export const MAX_ESTADO_BYTES = 16 * 1024;
export const MAX_PROFUNDIDAD = 20;
export const MAX_CUPOS = 5;
export const MAX_COMPROMISOS = 5;
/** Tope de servidor de un cupo: ningún cupo es un límite comercial. */
export const MAX_TOPE = 1000;
export const MAX_VENCE_MIN = 4320;
/** Entradas de `por` que se conservan en un cupo (las más recientes). */
export const MAX_POR = 50;

const MS_MIN = 60_000;
const MS_HORA = 3_600_000;
const MS_DIA = 24 * MS_HORA;
/** La Paz es UTC-4 fijo, sin horario de verano. */
const DESFASE_LA_PAZ_MS = 4 * MS_HORA;

const RE_PNID = /^[A-Za-z0-9_-]{1,64}$/;
const RE_TELEFONO = /^[0-9]{8,15}$/;
const RE_ESPACIO = /^[a-z][a-z0-9-]{0,31}$/;
const RE_EJECUCION = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * El id empieza con alfanumérico (excluye `__proto__` y afines) y no puede ser
 * un nombre de `Object.prototype` (`constructor`, `toString`, `hasOwnProperty`…):
 * el id se usa como clave de mapas y un nombre heredado leería basura.
 * Además, los mapas del núcleo no tienen prototipo y se leen con `Object.hasOwn`.
 */
const RE_COMPROMISO = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
const NOMBRES_HEREDADOS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));
const idCompromisoValido = (v: unknown): v is string =>
  typeof v === 'string' && RE_COMPROMISO.test(v) && !NOMBRES_HEREDADOS.has(v);

/** Mapa sin prototipo. */
function mapaVacio<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}
const propio = (o: object | undefined | null, k: string): boolean => !!o && Object.hasOwn(o, k);
const esEnteroNoNegativo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const consumoValido = (c: unknown): c is ConsumoDeCupo =>
  typeof c === 'object' && c !== null && esEnteroNoNegativo((c as ConsumoDeCupo).cantidad) &&
  Number.isFinite((c as ConsumoDeCupo).en);
/** Los wamid de Meta son ASCII imprimible: sin sustitutos sueltos que colisionarían al hashear. */
const RE_ID_MENSAJE = /^[\x21-\x7e]{1,256}$/;
const RE_CLAVE = /^[a-z][a-z0-9_-]{0,31}$/;

/** Errores fijos: el cuerpo nunca repite lo que mandó el flujo. */
export const ERRORES_SESION = {
  forma: 'sesion: forma invalida',
  version: 'sesion: version desconocida',
  telefono: 'sesion: requiere un telefono valido',
  grande: 'sesion: estado demasiado grande',
} as const;

// -------------------------------------------------------------------- tipos

export type AccionSesion = 'leer' | 'comprometer' | 'asentar';
export type AlcanceCupo = 'comercio' | 'contacto';
export type PeriodoCupo = 'dia' | 'hora';

export interface CupoPedido {
  clave: string;
  alcance: AlcanceCupo;
  periodo: PeriodoCupo;
  cantidad: number;
  /** Ausente equivale a 0: sin tope no se concede nada. */
  tope?: number;
}

export interface PeticionSesion {
  v: 1;
  accion: AccionSesion;
  espacio: string;
  canal: 'wa';
  ejecucion: string;
  idMensaje?: string;
  /** En `leer` es opcional y se IGNORA; en `asentar` también; `comprometer` la exige. */
  versionLeida?: number;
  idCompromiso?: string;
  /** Solo en `comprometer`/`asentar`; `undefined` = no vino. */
  estado?: Record<string, unknown> | null;
  venceEnMin?: number;
  cupos: CupoPedido[];
}

export type ResultadoValidacion =
  | { ok: true; peticion: PeticionSesion }
  | { ok: false; status: 400 | 413; error: string };

/** El documento de sesión tal como lo entiende el núcleo (tiempos en ms). */
export interface DocSesion {
  version: number;
  /** Cadena opaca: el servidor no interpreta el estado. */
  estadoJson: string | null;
  vence: number | null;
  actualizadoEn: number | null;
  compromisos: string[];
}

export interface Conversacion {
  version: number;
  estado: Record<string, unknown> | null;
  desde: number | null;
  vence: number | null;
  vencido: boolean;
}

/** Lo que un compromiso consumió de un cupo; `en` (ms) ordena la poda, no el orden de las claves. */
export interface ConsumoDeCupo {
  cantidad: number;
  en: number;
}

export interface DocCupo {
  usados: number;
  vence: number | null;
  por?: Record<string, ConsumoDeCupo>;
}

export interface CupoPlan {
  id: string;
  clave: string;
  alcance: AlcanceCupo;
  periodo: PeriodoCupo;
  cantidad: number;
  tope: number;
  vence: number;
}

export interface CupoEscrito {
  id: string;
  usados: number;
  tope: number;
  vence: number;
  por: Record<string, ConsumoDeCupo>;
}

export type DecisionCompromiso =
  | { resultado: 'repetido'; conversacion: Conversacion }
  | { resultado: 'conflicto_version'; conversacion: Conversacion }
  | { resultado: 'cupo_negado'; motivo: 'sin_tope' | 'agotado' | 'datos_invalidos'; clave: string; conversacion: Conversacion }
  | {
      resultado: 'comprometido';
      conversacion: Conversacion;
      version: number;
      estadoJson: string | null;
      vence: number;
      actualizadoEn: number;
      compromisos: string[];
      cupos: CupoEscrito[];
    };

// --------------------------------------------------------------- validación

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sinClavesAjenas(o: Record<string, unknown>, permitidas: readonly string[]): boolean {
  return Object.keys(o).every((k) => permitidas.includes(k));
}

/** Profundidad de un valor JSON; corta apenas pasa de `max` (sin recursión sin tope). */
function profundidadSupera(v: unknown, max: number, nivel = 0): boolean {
  if (typeof v !== 'object' || v === null) return false;
  if (nivel + 1 > max) return true;
  const hijos = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
  return hijos.some((h) => profundidadSupera(h, max, nivel + 1));
}

const forma = (): ResultadoValidacion => ({ ok: false, status: 400, error: ERRORES_SESION.forma });

function validarCupos(crudo: unknown): CupoPedido[] | null {
  if (!Array.isArray(crudo) || crudo.length > MAX_CUPOS) return null;
  const salida: CupoPedido[] = [];
  const vistos = new Set<string>();
  for (const c of crudo) {
    if (!esObjetoPlano(c) || !sinClavesAjenas(c, ['clave', 'alcance', 'periodo', 'cantidad', 'tope'])) return null;
    if (typeof c.clave !== 'string' || !RE_CLAVE.test(c.clave)) return null;
    if (c.alcance !== 'comercio' && c.alcance !== 'contacto') return null;
    if (c.periodo !== 'dia' && c.periodo !== 'hora') return null;
    if (!Number.isInteger(c.cantidad) || (c.cantidad as number) < 1 || (c.cantidad as number) > 20) return null;
    if (c.tope !== undefined && (!Number.isInteger(c.tope) || (c.tope as number) < 0 || (c.tope as number) > MAX_TOPE)) {
      return null;
    }
    // Dos pedidos sobre el mismo documento de cupo se pisarían: se rechazan.
    const llave = `${c.clave}|${c.alcance}|${c.periodo}`;
    if (vistos.has(llave)) return null;
    vistos.add(llave);
    salida.push({
      clave: c.clave,
      alcance: c.alcance,
      periodo: c.periodo,
      cantidad: c.cantidad as number,
      ...(c.tope === undefined ? {} : { tope: c.tope as number }),
    });
  }
  return salida;
}

/**
 * Valida la petición `sesion`. `telefono` es el ya validado del cuerpo (o `null`).
 * Orden fijo: forma -> `v` -> teléfono -> campos -> profundidad -> tamaño.
 */
export function validarSesion(sesion: unknown, telefono: string | null): ResultadoValidacion {
  if (!esObjetoPlano(sesion)) return forma();
  if (sesion.v !== VERSION_PROTOCOLO) {
    return { ok: false, status: 400, error: sesion.v === undefined ? ERRORES_SESION.forma : ERRORES_SESION.version };
  }
  if (telefono === null || !RE_TELEFONO.test(telefono)) {
    return { ok: false, status: 400, error: ERRORES_SESION.telefono };
  }
  if (
    !sinClavesAjenas(sesion, [
      'v', 'accion', 'espacio', 'canal', 'ejecucion', 'idMensaje', 'versionLeida',
      'idCompromiso', 'estado', 'venceEnMin', 'cupos',
    ])
  ) {
    return forma();
  }

  const accion = sesion.accion === undefined ? 'leer' : sesion.accion;
  if (accion !== 'leer' && accion !== 'comprometer' && accion !== 'asentar') return forma();
  if (typeof sesion.espacio !== 'string' || !RE_ESPACIO.test(sesion.espacio)) return forma();
  const canal = sesion.canal === undefined ? 'wa' : sesion.canal;
  if (canal !== 'wa') return forma();
  if (typeof sesion.ejecucion !== 'string' || !RE_EJECUCION.test(sesion.ejecucion)) return forma();

  let versionLeida: number | undefined;
  if (sesion.versionLeida !== undefined) {
    if (!Number.isInteger(sesion.versionLeida) || (sesion.versionLeida as number) < 0) return forma();
    versionLeida = sesion.versionLeida as number;
  }

  if (accion === 'leer') {
    // `leer` no lleva compromiso, estado, vencimiento ni cupos.
    if (
      sesion.idCompromiso !== undefined || sesion.estado !== undefined ||
      sesion.venceEnMin !== undefined || sesion.cupos !== undefined
    ) {
      return forma();
    }
    let idMensaje: string | undefined;
    if (sesion.idMensaje !== undefined) {
      if (typeof sesion.idMensaje !== 'string' || !RE_ID_MENSAJE.test(sesion.idMensaje)) {
        return forma();
      }
      idMensaje = sesion.idMensaje;
    }
    return {
      ok: true,
      peticion: {
        v: 1, accion, espacio: sesion.espacio, canal: 'wa', ejecucion: sesion.ejecucion,
        ...(idMensaje === undefined ? {} : { idMensaje }),
        ...(versionLeida === undefined ? {} : { versionLeida }),
        cupos: [],
      },
    };
  }

  // comprometer / asentar
  if (sesion.idMensaje !== undefined) return forma();
  if (!idCompromisoValido(sesion.idCompromiso)) return forma();

  if (accion === 'asentar') {
    // Devolver los cupos de un compromiso no lleva estado, vencimiento ni cupos
    // nuevos (no tendrían significado) y no depende de la versión: la
    // `versionLeida`, si viene, se valida como entero pero se IGNORA.
    if (sesion.estado !== undefined || sesion.venceEnMin !== undefined || sesion.cupos !== undefined) return forma();
    return {
      ok: true,
      peticion: {
        v: 1, accion, espacio: sesion.espacio, canal: 'wa', ejecucion: sesion.ejecucion,
        idCompromiso: sesion.idCompromiso, cupos: [],
      },
    };
  }

  if (versionLeida === undefined) return forma();
  const cupos = sesion.cupos === undefined ? [] : validarCupos(sesion.cupos);
  if (cupos === null) return forma();

  if (sesion.estado === undefined || sesion.venceEnMin === undefined) return forma();
  if (sesion.estado !== null && !esObjetoPlano(sesion.estado)) return forma();
  const estado = sesion.estado as Record<string, unknown> | null;
  if (
    !Number.isInteger(sesion.venceEnMin) || (sesion.venceEnMin as number) < 1 ||
    (sesion.venceEnMin as number) > MAX_VENCE_MIN
  ) {
    return forma();
  }
  const venceEnMin = sesion.venceEnMin as number;

  if (estado !== null) {
    // Primero una cota barata (un solo recorrido de `stringify`) y recién
    // después la profundidad: un objeto ancho y enorme no se recorre dos veces.
    // CUANDO SE SUPERAN LAS DOS GANA EL TAMAÑO (413), porque se mide primero.
    // Un anidado tan hondo que `stringify` no puede recorrerlo es forma inválida.
    let largo: number;
    try {
      largo = Buffer.byteLength(JSON.stringify(estado), 'utf8');
    } catch {
      return forma();
    }
    if (largo > MAX_ESTADO_BYTES) return { ok: false, status: 413, error: ERRORES_SESION.grande };
    if (profundidadSupera(estado, MAX_PROFUNDIDAD)) return forma();
  }

  return {
    ok: true,
    peticion: {
      v: 1, accion, espacio: sesion.espacio, canal: 'wa', ejecucion: sesion.ejecucion,
      versionLeida, idCompromiso: sesion.idCompromiso, estado, venceEnMin, cupos,
    },
  };
}

// ------------------------------------------------------------------- ids

function exigir(re: RegExp, valor: unknown, que: string): string {
  if (typeof valor !== 'string' || !re.test(valor)) throw new RangeError(`${que} invalido`);
  return valor;
}

/** `{pnid}~{espacio}~wa_{tel}` */
export function idSesion(pnid: string, espacio: string, telefono: string): string {
  return `${exigir(RE_PNID, pnid, 'pnid')}~${exigir(RE_ESPACIO, espacio, 'espacio')}~wa_${exigir(RE_TELEFONO, telefono, 'telefono')}`;
}

/**
 * sha256 hex de `pnid|idMensaje`. NO lleva `espacio` A PROPÓSITO: los vistos
 * son por número, y un mismo mensaje no puede ser «nuevo» en dos espacios del
 * mismo número. El id de Meta puede traer caracteres que Firestore no admite. */
export function idVisto(pnid: string, idMensaje: string): string {
  exigir(RE_PNID, pnid, 'pnid');
  if (typeof idMensaje !== 'string' || !RE_ID_MENSAJE.test(idMensaje)) {
    throw new RangeError('idMensaje invalido');
  }
  return createHash('sha256').update(`${pnid}|${idMensaje}`, 'utf8').digest('hex');
}

/**
 * `{pnid}~{clave}~{wa_tel|_}~{periodo}`. Sin `espacio` A PROPÓSITO: los cupos
 * son por número y contacto, y todos los espacios de un mismo número comparten
 * la clave (si no, un flujo esquivaría el tope cambiando de espacio).
 */
export function idCupo(
  pnid: string, clave: string, alcance: AlcanceCupo, telefono: string | null, periodo: string,
): string {
  exigir(RE_PNID, pnid, 'pnid');
  exigir(RE_CLAVE, clave, 'clave');
  exigir(/^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2})?$/, periodo, 'periodo');
  const quien = alcance === 'contacto' ? `wa_${exigir(RE_TELEFONO, telefono, 'telefono')}` : '_';
  return `${pnid}~${clave}~${quien}~${periodo}`;
}

// ---------------------------------------------------------------- períodos

function etiquetaLaPaz(ahoraMs: number, periodo: PeriodoCupo): string {
  // Desplazar el reloj -4 h y leer los campos UTC es leer la hora de La Paz.
  const iso = new Date(ahoraMs - DESFASE_LA_PAZ_MS).toISOString();
  return periodo === 'dia' ? iso.slice(0, 10) : iso.slice(0, 13);
}

/** `aaaa-mm-dd` o `aaaa-mm-ddThh`, en hora de La Paz. */
export function periodoDe(ahoraMs: number, periodo: PeriodoCupo): string {
  if (!Number.isFinite(ahoraMs)) throw new RangeError('ahoraMs invalido');
  return etiquetaLaPaz(ahoraMs, periodo);
}

/** Instante (ms UTC) en que termina el período que contiene a `ahoraMs`. */
export function finDelPeriodo(ahoraMs: number, periodo: PeriodoCupo): number {
  if (!Number.isFinite(ahoraMs)) throw new RangeError('ahoraMs invalido');
  const largo = periodo === 'dia' ? MS_DIA : MS_HORA;
  const local = ahoraMs - DESFASE_LA_PAZ_MS;
  return Math.floor(local / largo) * largo + largo + DESFASE_LA_PAZ_MS;
}

/** El cupo vence 24 h después de cerrar su período (para que el TTL no lo borre en uso). */
export function venceDeCupo(ahoraMs: number, periodo: PeriodoCupo): number {
  return finDelPeriodo(ahoraMs, periodo) + MS_DIA;
}

/** Vigencia de los marcadores de «visto»: 24 h. */
export function venceDeVisto(ahoraMs: number): number {
  return ahoraMs + MS_DIA;
}

/**
 * `leer` con un `idMensaje`: nuevo la primera vez; repetido si el visto existe y
 * no venció (el TTL borra con demora: un documento vencido aún presente no cuenta).
 */
export function decidirVisto(doc: { vence: number | null } | null, ahoraMs: number): 'nuevo' | 'repetido' {
  if (doc === null) return 'nuevo';
  return doc.vence !== null && doc.vence > ahoraMs ? 'repetido' : 'nuevo';
}

// -------------------------------------------------------------- vencimiento

function estadoDe(json: string | null): Record<string, unknown> | null {
  if (json === null) return null;
  try {
    const v: unknown = JSON.parse(json);
    return esObjetoPlano(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Lo que ve el flujo. Un `vence` pasado devuelve `estado: null, vencido: true`
 * SIN borrar ni reiniciar la versión: el compromiso siguiente sigue la real.
 * Documento ausente: versión 0.
 */
export function leerConversacion(doc: DocSesion | null, ahoraMs: number): Conversacion {
  if (doc === null) return { version: 0, estado: null, desde: null, vence: null, vencido: false };
  const vencido = doc.vence !== null && doc.vence <= ahoraMs;
  return {
    version: doc.version,
    estado: vencido ? null : estadoDe(doc.estadoJson),
    desde: doc.actualizadoEn,
    vence: doc.vence,
    vencido,
  };
}

// ----------------------------------------------------------------- cupos

/** Resuelve los ids y vencimientos de los cupos pedidos (necesita un teléfono si alguno es de contacto). */
export function planDeCupos(
  pnid: string, telefono: string | null, cupos: readonly CupoPedido[], ahoraMs: number,
): CupoPlan[] {
  return cupos.map((c) => ({
    id: idCupo(pnid, c.clave, c.alcance, telefono, periodoDe(ahoraMs, c.periodo)),
    clave: c.clave,
    alcance: c.alcance,
    periodo: c.periodo,
    cantidad: c.cantidad,
    tope: c.tope ?? 0,
    vence: venceDeCupo(ahoraMs, c.periodo),
  }));
}

// ------------------------------------------------------------- compromiso

export interface EntradaCompromiso {
  doc: DocSesion | null;
  ahoraMs: number;
  versionLeida: number;
  idCompromiso: string;
  estado: Record<string, unknown> | null;
  venceEnMin: number;
  /** Salida de `planDeCupos`. */
  cupos: readonly CupoPlan[];
  /** Cupos actuales por id; ausente = sin usar. */
  cuposActuales: Readonly<Record<string, DocCupo | undefined>>;
}

/**
 * La decisión, sin escribir. Orden: repetido -> conflicto -> cupos -> comprometido.
 * `repetido` va primero porque un reintento tras perder la respuesta trae una
 * `versionLeida` vieja y no debe verse como conflicto. En los tres casos
 * negativos la versión NO se mueve: no se devuelve nada que escribir.
 */
export function decidirCompromiso(e: EntradaCompromiso): DecisionCompromiso {
  if (!idCompromisoValido(e.idCompromiso)) throw new RangeError('idCompromiso invalido');
  const actual = leerConversacion(e.doc, e.ahoraMs);
  const previos = e.doc?.compromisos ?? [];
  if (previos.includes(e.idCompromiso)) return { resultado: 'repetido', conversacion: actual };
  if (e.versionLeida !== actual.version) return { resultado: 'conflicto_version', conversacion: actual };

  for (const c of e.cupos) {
    if (c.tope <= 0) return { resultado: 'cupo_negado', motivo: 'sin_tope', clave: c.clave, conversacion: actual };
    const doc = propio(e.cuposActuales, c.id) ? e.cuposActuales[c.id] : undefined;
    // Un cupo vencido todavía presente (el TTL borra con demora) cuenta como vacío.
    const vivoDoc = doc && (doc.vence === null || doc.vence > e.ahoraMs);
    // Datos corruptos (NaN, negativo, fraccionario): NUNCA se concede, porque
    // `NaN + cantidad > tope` es false y dejaría el cupo sin tope.
    if (vivoDoc && !esEnteroNoNegativo(doc.usados)) {
      return { resultado: 'cupo_negado', motivo: 'datos_invalidos', clave: c.clave, conversacion: actual };
    }
    const usados = vivoDoc ? doc.usados : 0;
    if (usados + c.cantidad > c.tope) {
      return { resultado: 'cupo_negado', motivo: 'agotado', clave: c.clave, conversacion: actual };
    }
  }

  const version = actual.version + 1;
  const vence = e.ahoraMs + e.venceEnMin * MS_MIN;
  const estadoJson = e.estado === null ? null : JSON.stringify(e.estado);
  const cupos: CupoEscrito[] = e.cupos.map((c) => {
    const doc = propio(e.cuposActuales, c.id) ? e.cuposActuales[c.id] : undefined;
    const vivo = doc && (doc.vence === null || doc.vence > e.ahoraMs) ? doc : undefined;
    const por = mapaVacio<ConsumoDeCupo>();
    // Solo se arrastran las entradas propias y bien formadas.
    if (vivo?.por && typeof vivo.por === 'object') {
      for (const [k, v] of Object.entries(vivo.por)) if (consumoValido(v)) por[k] = v;
    }
    por[e.idCompromiso] = { cantidad: c.cantidad, en: e.ahoraMs };
    const podado = podarPor(por);
    return { id: c.id, usados: (vivo?.usados ?? 0) + c.cantidad, tope: c.tope, vence: c.vence, por: podado };
  });
  return {
    resultado: 'comprometido',
    version,
    estadoJson,
    vence,
    actualizadoEn: e.ahoraMs,
    compromisos: [...previos, e.idCompromiso].slice(-MAX_COMPROMISOS),
    cupos,
    conversacion: { version, estado: e.estado, desde: e.ahoraMs, vence, vencido: false },
  };
}

/**
 * Deja en `por` las MAX_POR entradas con `en` más reciente. Se ordena por `en`
 * y NO por el orden de las claves: Firestore devuelve los mapas ordenados por
 * clave y `Object.keys` pone primero las claves enteras, así que «las primeras
 * en insertarse» no existe como concepto. Empates de `en`: la clave menor se
 * descarta primero, para que el resultado sea determinista.
 */
export function podarPor(por: Record<string, ConsumoDeCupo>): Record<string, ConsumoDeCupo> {
  const entradas = Object.entries(por);
  if (entradas.length <= MAX_POR) return por;
  entradas.sort((a, b) => b[1].en - a[1].en || (a[0] < b[0] ? 1 : -1));
  const salida = mapaVacio<ConsumoDeCupo>();
  for (const [k, v] of entradas.slice(0, MAX_POR)) salida[k] = v;
  return salida;
}

export type DecisionAsentar =
  | { resultado: 'nada_que_asentar' }
  | { resultado: 'asentado'; cupos: { id: string; usados: number; por: Record<string, ConsumoDeCupo> }[] };

/**
 * IMPORTANTE para la capa de E/S (PR-2a): pasarle SOLO cupos del mismo pnid y
 * del mismo teléfono (o de alcance número/comercio), y correr `asentar` en una
 * transacción que RELEA `por` (el mapa se decide sobre lo leído ahí).
 *
 * `asentar`: DEVUELVE los cupos que consumió ese compromiso (la entrega no se
 * hizo). Por cada cupo con `por[idCompromiso]`: `usados -= cantidad` (nunca
 * bajo 0) y se borra esa entrada. Sin ningún cupo que lo tenga (ya asentado,
 * podado o inexistente) -> `nada_que_asentar`, sin escribir: repetirlo no hace
 * nada. Si asentar falla, el cupo queda consumido (lado conservador).
 */
export function decidirAsentar(
  idCompromiso: string, cuposActuales: Readonly<Record<string, DocCupo | undefined>>,
): DecisionAsentar {
  const cupos: { id: string; usados: number; por: Record<string, ConsumoDeCupo> }[] = [];
  // Un id heredado nunca es un compromiso: no hay nada que devolver.
  if (!idCompromisoValido(idCompromiso)) return { resultado: 'nada_que_asentar' };
  for (const [id, doc] of Object.entries(cuposActuales)) {
    if (!doc || typeof doc.por !== 'object' || doc.por === null || !propio(doc.por, idCompromiso)) continue;
    const consumo = doc.por[idCompromiso];
    // Datos corruptos: no se asienta (queda consumido, el lado conservador) y
    // nunca se escribe un NaN.
    if (!consumoValido(consumo) || !esEnteroNoNegativo(doc.usados)) continue;
    const por = mapaVacio<ConsumoDeCupo>();
    for (const [k, v] of Object.entries(doc.por)) if (k !== idCompromiso) por[k] = v;
    cupos.push({ id, usados: Math.max(0, doc.usados - consumo.cantidad), por });
  }
  return cupos.length === 0 ? { resultado: 'nada_que_asentar' } : { resultado: 'asentado', cupos };
}
