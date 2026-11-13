/**
 * EL SERVIDOR DE SESIÓN DE MENTIRA CON CUPOS Y `asentar`, PARA LAS SUITES DE «VENTA MÍNIMA» (PR-4b).
 *
 * Por qué existe. El servidor falso común (`comun-sin-agente/herramientas/servidor-de-sesion.mjs`) solo sabe `leer` y `comprometer` sin cupos (los demás casos los rechaza con 400:
 * está declarado y probado así). Q'Taco, desde PR-4b, consume cupos de aviso (`Consumir cupos`) y devuelve el cupo con `asentar` (`Confirmar envío`). Aquí NO se reimplementa la
 * decisión: se usa el NÚCLEO REAL (`core/turno/sesion.ts`: `validarSesion`, `planDeCupos`, `decidirCompromiso`, `decidirAsentar`), así que un cupo agotado, un tope ausente, un
 * `repetido` o un `asentar` idempotente se deciden con el mismo código que corre en producción. La parte de E/S (documentos en un `Map`) es la de `sesionFirestore.ts`:
 * `por[idCompromiso].tel` y el chequeo de contacto en `asentar` incluidos.
 *
 * Todo lo que no es un `comprometer` con cupos ni un `asentar` lo contesta el servidor común (que sigue siendo la fuente de verdad de `leer` y del estado).
 */
import { crearServidorDeSesion, type RespuestaHttp, type ServidorDeSesion } from '../../../Flujos/src/core/sin-agente/herramientas/servidor-de-sesion.mjs';
import {
  decidirAsentar, decidirCompromiso, idCupo, idSesion, leerConversacion, planDeCupos, validarSesion,
  type ConsumoDeCupo, type DocCupo, type DocSesion,
} from '../../functions/src/core/turno/sesion';

type DocCupoGuardado = DocCupo & { tope: number };

export interface ServidorConCupos extends ServidorDeSesion {
  /** Los documentos de cupo, por id (`{pnid}~{clave}~{wa_tel|_}~{periodo}`). */
  cupos: Map<string, DocCupoGuardado>;
  /** Las sesiones de los espacios de cupos (`vmc-*`): una por turno, con estado null. */
  sesionesDeCupos: Map<string, DocSesion>;
  /** Cuántos cupos lleva consumidos `clave` (0 si no hay documento) en el período que contiene a `ahora`. */
  usados(pnid: string, clave: string, alcance: 'comercio' | 'contacto', tel: string | null, periodo: 'dia' | 'hora'): number;
  /** Siembra un cupo consumido hasta `usados` (para llegar al tope sin mandar 150 avisos). */
  sembrarCupo(pnid: string, clave: string, alcance: 'comercio' | 'contacto', tel: string | null, periodo: 'dia' | 'hora', usados: number, tope: number): void;
}

const err = (statusCode: number, error: string): RespuestaHttp => ({ statusCode, body: { error } });
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function crearServidorConCupos(op: { ahoraMs?: () => number; espacios?: string[] | null } = {}): ServidorConCupos {
  const ahoraMs = op.ahoraMs ?? (() => Date.now());
  const base = crearServidorDeSesion(op);
  const cupos = new Map<string, DocCupoGuardado>();
  const sesionesDeCupos = new Map<string, DocSesion>();
  const original = base.atender.bind(base);

  const s = base as ServidorConCupos;
  s.cupos = cupos;
  s.sesionesDeCupos = sesionesDeCupos;
  s.usados = (pnid, clave, alcance, tel, periodo) => {
    const id = idCupo(pnid, clave, alcance, tel, periodo === 'dia' ? new Date(ahoraMs() - 4 * 3600_000).toISOString().slice(0, 10) : new Date(ahoraMs() - 4 * 3600_000).toISOString().slice(0, 13));
    return cupos.get(id)?.usados ?? 0;
  };
  s.sembrarCupo = (pnid, clave, alcance, tel, periodo, usados, tope) => {
    const plan = planDeCupos(pnid, tel, [{ clave, alcance, periodo, cantidad: 1, tope }], ahoraMs())[0]!;
    cupos.set(plan.id, { usados, tope, vence: plan.vence, por: {} });
  };

  s.atender = (pnid, cuerpo) => {
    const q = cuerpo['sesion'] as Record<string, unknown> | undefined;
    const maneja = !!q && typeof q === 'object' && (q['accion'] === 'asentar' || (q['accion'] === 'comprometer' && Array.isArray(q['cupos']) && q['cupos'].length > 0));
    if (!maneja) return original(pnid, cuerpo);

    s.llamadas.push(clonar(cuerpo));
    const falla = typeof s.fallar === 'function' ? s.fallar(cuerpo) : null;
    if (falla) return err(falla, 'sesion: ocupada, reintente');
    const v = validarSesion(q, typeof cuerpo['telefono'] === 'string' ? (cuerpo['telefono'] as string) : null);
    if (!v.ok) return err(v.status, v.error);
    const p = v.peticion;
    if (Array.isArray(op.espacios) && !op.espacios.includes(p.espacio) && !/^vmcp?-/.test(p.espacio)) return err(400, 'sesion: forma invalida');
    const tel = cuerpo['telefono'] as string;
    const ahora = ahoraMs();
    const k = idSesion(pnid, p.espacio, tel);
    const doc = sesionesDeCupos.get(k) ?? null;

    if (p.accion === 'asentar') {
      const propios = Object.create(null) as Record<string, DocCupo | undefined>;
      for (const [id, c] of cupos) {
        const partes = id.split('~');
        if (partes.length !== 4 || partes[0] !== pnid || !(partes[2] === '_' || partes[2] === `wa_${tel}`)) continue;
        const por = (c.por ?? {}) as Record<string, ConsumoDeCupo & { tel?: string }>;
        if (!Object.hasOwn(por, p.idCompromiso as string)) continue;
        // El cupo del comercio lo comparten todos: solo devuelve quien lo consumió (`tel`); una entrada sin `tel` queda consumida.
        if (partes[2] === '_' && por[p.idCompromiso as string]?.tel !== tel) continue;
        propios[id] = { usados: c.usados, vence: null, por };
      }
      const d = decidirAsentar(p.idCompromiso as string, propios);
      const conversacion = leerConversacion(doc, ahora);
      if (d.resultado === 'nada_que_asentar') return { statusCode: 200, body: { resultado: d.resultado, conversacion } };
      for (const c of d.cupos) {
        const previo = cupos.get(c.id)!;
        cupos.set(c.id, { ...previo, usados: c.usados, por: c.por });
      }
      return { statusCode: 200, body: { resultado: 'asentado', conversacion } };
    }

    // comprometer con cupos
    const plan = planDeCupos(pnid, tel, p.cupos, ahora);
    const actuales = Object.create(null) as Record<string, DocCupo | undefined>;
    for (const c of plan) {
      const g = cupos.get(c.id);
      actuales[c.id] = g ? { usados: g.usados, vence: g.vence, por: g.por } : undefined;
    }
    const d = decidirCompromiso({
      doc, ahoraMs: ahora, versionLeida: p.versionLeida as number, idCompromiso: p.idCompromiso as string,
      estado: p.estado ?? null, venceEnMin: p.venceEnMin as number, cupos: plan, cuposActuales: actuales,
    });
    if (d.resultado === 'cupo_negado') return { statusCode: 200, body: { resultado: d.resultado, motivo: d.motivo, clave: d.clave, conversacion: d.conversacion } };
    if (d.resultado !== 'comprometido') return { statusCode: 200, body: { resultado: d.resultado, conversacion: d.conversacion } };
    sesionesDeCupos.set(k, { version: d.version, estadoJson: d.estadoJson, vence: d.vence, actualizadoEn: d.actualizadoEn, compromisos: d.compromisos });
    for (const c of d.cupos) {
      const por = { ...c.por, [p.idCompromiso as string]: { ...(c.por[p.idCompromiso as string] as ConsumoDeCupo), tel } };
      cupos.set(c.id, { usados: c.usados, tope: c.tope, vence: c.vence, por });
    }
    return { statusCode: 200, body: { resultado: 'comprometido', conversacion: d.conversacion } };
  };
  return s;
}
