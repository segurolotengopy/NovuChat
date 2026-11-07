/**
 * CONTENIDO DE LA ALERTA OPERATIVA: el contrato, la regla «sin PII» y la regla del enlace, en UN solo
 * módulo para que sea fácil de cambiar. El contrato `avisos-correo/v1` de WAM (ADR-011: hosts permitidos
 * para `enlace`, prohibiciones de contenido, plantilla y latido) se aplica EDITANDO ESTE ARCHIVO y su
 * prueba, sin tocar la firma, el tope ni el envío (`alertaOperativa.ts`).
 */
export const NIVELES = ['critico', 'aviso', 'info'] as const;
export type Nivel = (typeof NIVELES)[number];

export const LIMITES = { asunto: 70, que_paso: 150, que_se_espera_de_andres: 130, flujo: 60, nodo: 60 } as const;
const CAMPOS = [
  'nivel', 'proyecto', 'asunto', 'que_paso', 'que_se_espera_de_andres', 'enlace', 'ocurrido_en', 'id_unico',
  // Extensión declarada al contrato común: lo mínimo para agrupar «por tipo de error».
  'tipo_error', 'flujo', 'nodo',
] as const;
const OBLIGATORIOS = ['nivel', 'proyecto', 'asunto', 'que_paso', 'que_se_espera_de_andres', 'enlace', 'ocurrido_en', 'id_unico', 'tipo_error'] as const;

export interface EventoAlerta {
  nivel: Nivel;
  proyecto: 'novuchat';
  asunto: string;
  que_paso: string;
  que_se_espera_de_andres: string;
  enlace: string;
  ocurrido_en: string;
  id_unico: string;
  tipo_error: string;
  flujo: string;
  nodo: string;
}

export class ErrorAlerta extends Error {
  constructor(readonly codigo: string, readonly estado: number) { super(codigo); }
}


// ---------------------------------------------------------------------------
// SIN PII
// ---------------------------------------------------------------------------
const OMITIDO = '[omitido]';

/** Quita de un texto libre lo que parece un dato personal o un identificador de ejecución. */
export function sanearTexto(t: string): { texto: string; saneado: boolean } {
  const limpio = t
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, OMITIDO)                                         // correos
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, OMITIDO) // uuid
    .replace(/\b[0-9a-f]{16,}\b/gi, OMITIDO)                                                 // hash o id largo
    .replace(/\+?\d[\d ()\-.]{4,}\d/g, OMITIDO)                                              // teléfonos y ids de 6+ cifras
    .replace(/\d{6,}/g, OMITIDO);
  return { texto: limpio, saneado: limpio !== t };
}

/** Un campo estructural (flujo, nodo, tipo) no se sanea: si parece un dato personal, se rechaza. */
const pareceDatoPersonal = (t: string): boolean => sanearTexto(t).saneado;

const MARCAS_DE_EJECUCION = /^(\d{6,}|[0-9a-f]{16,})$/i;
const TIPO = /^[a-z0-9_.-]{1,60}$/;
const ID_UNICO = /^[A-Za-z0-9_-]{8,64}$/;

function enlaceValido(enlace: string, hosts: string[]): boolean {
  // Un runbook del repositorio: ruta relativa a `docs/`, sin esquema ni `..`.
  if (/^docs\/[A-Za-z0-9_./#-]{1,150}$/.test(enlace) && !enlace.includes('..')) return true;
  let u: URL;
  try { u = new URL(enlace); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  // Nunca una URL interna: IP, localhost o dominios de red interna.
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || /\.(internal|local|lan)$/.test(host)) return false;
  return hosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

export function validarEvento(cuerpo: unknown, hostsEnlace: string[]): { evento: EventoAlerta; saneado: boolean } {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new ErrorAlerta('cuerpo_invalido', 400);
  const d = cuerpo as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!(CAMPOS as readonly string[]).includes(k)) throw new ErrorAlerta('campo_no_permitido', 400);
  for (const k of OBLIGATORIOS) if (typeof d[k] !== 'string' || !(d[k] as string).trim()) throw new ErrorAlerta('campo_faltante', 400);
  for (const k of ['flujo', 'nodo'] as const) if (d[k] !== undefined && typeof d[k] !== 'string') throw new ErrorAlerta('campo_invalido', 400);
  const s = (k: string): string => String(d[k] ?? '').trim();

  if (!(NIVELES as readonly string[]).includes(s('nivel'))) throw new ErrorAlerta('nivel_invalido', 400);
  if (s('proyecto') !== 'novuchat') throw new ErrorAlerta('proyecto_invalido', 400);
  if (!TIPO.test(s('tipo_error'))) throw new ErrorAlerta('tipo_error_invalido', 400);
  if (!ID_UNICO.test(s('id_unico')) || MARCAS_DE_EJECUCION.test(s('id_unico'))) throw new ErrorAlerta('id_unico_invalido', 400);
  const ms = Date.parse(s('ocurrido_en'));
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s('ocurrido_en')) || Number.isNaN(ms)) throw new ErrorAlerta('ocurrido_en_invalido', 400);
  if (!enlaceValido(s('enlace'), hostsEnlace)) throw new ErrorAlerta('enlace_invalido', 400);

  for (const k of ['flujo', 'nodo'] as const) {
    if (s(k).length > LIMITES[k] || pareceDatoPersonal(s(k))) throw new ErrorAlerta('dato_personal', 422);
  }
  if (pareceDatoPersonal(s('tipo_error'))) throw new ErrorAlerta('dato_personal', 422);

  let saneado = false;
  const libre = (k: 'asunto' | 'que_paso' | 'que_se_espera_de_andres'): string => {
    if (s(k).length > LIMITES[k]) throw new ErrorAlerta('texto_largo', 422);
    const r = sanearTexto(s(k));
    saneado ||= r.saneado;
    return r.texto;
  };
  const evento: EventoAlerta = {
    nivel: s('nivel') as Nivel, proyecto: 'novuchat',
    asunto: libre('asunto'), que_paso: libre('que_paso'), que_se_espera_de_andres: libre('que_se_espera_de_andres'),
    enlace: s('enlace'), ocurrido_en: new Date(ms).toISOString(), id_unico: s('id_unico'),
    tipo_error: s('tipo_error'), flujo: s('flujo'), nodo: s('nodo'),
  };
  return { evento, saneado };
}

