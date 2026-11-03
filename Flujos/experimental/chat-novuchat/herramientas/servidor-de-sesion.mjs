/**
 * SERVIDOR DE SESIÓN DE MENTIRA (PR-4c1): la rama `sesion` de `configuracionFlujo`, en memoria, para las pruebas del chat.
 * Contrato: docs/arquitectura/estado-de-conversacion.md (§2 a §6, §11). Lo comparte la suite del flujo y la batería; una prueba diferencial
 * (`admin/pruebas/chat-novuchat-sesion.test.ts`) lo compara con el núcleo real `core/turno/sesion.ts`, así que no puede divergir en silencio.
 * Responde como el nodo HTTP con respuesta completa: `{ statusCode, body }`.
 */
const RE_TEL = /^[0-9]{8,15}$/;
const RE_ESPACIO = /^[a-z][a-z0-9-]{0,31}$/;
const RE_EJEC = /^[A-Za-z0-9_-]{1,64}$/;
const RE_COMP = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
const MAX_BYTES = 16 * 1024;
const err = (statusCode, error) => ({ statusCode, body: { error } });

export function crearServidorDeSesion({ ahoraMs = () => Date.now() } = {}) {
  const docs = new Map();
  const s = {
    docs,
    llamadas: [],
    /** Gancho: se ejecuta justo antes de decidir un `comprometer` (para meter un compromiso rival). */
    antesDeComprometer: null,
    /** Si es una función que devuelve un código HTTP, esa llamada falla con él. */
    fallar: null,
    conversacion(pnid, espacio, tel) {
      const d = docs.get(`${pnid}~${espacio}~wa_${tel}`);
      if (!d) return { version: 0, estado: null, desde: null, vence: null, vencido: false };
      const vencido = d.vence <= ahoraMs();
      return { version: d.version, estado: vencido ? null : JSON.parse(d.estadoJson), desde: d.actualizadoEn, vence: d.vence, vencido };
    },
    /** Pone un estado sin pasar por el contrato (siembra de pruebas): sube la versión. */
    sembrar(pnid, espacio, tel, estado, venceEnMin = 2880) {
      const k = `${pnid}~${espacio}~wa_${tel}`;
      const d = docs.get(k);
      docs.set(k, { version: (d ? d.version : 0) + 1, estadoJson: estado === null ? null : JSON.stringify(estado), vence: ahoraMs() + venceEnMin * 60000, actualizadoEn: ahoraMs(), compromisos: d ? d.compromisos : [] });
    },
    /** `pnid` sale de la ruta autenticada, nunca del cuerpo. */
    atender(pnid, cuerpo) {
      s.llamadas.push(JSON.parse(JSON.stringify(cuerpo)));
      const falla = typeof s.fallar === 'function' ? s.fallar(cuerpo) : null;
      if (falla) return err(falla, 'sesion: ocupada, reintente');
      const q = cuerpo && cuerpo.sesion;
      if (!q || typeof q !== 'object' || Array.isArray(q) || q.v !== 1) return err(400, 'sesion: forma invalida');
      if (!RE_TEL.test(String(cuerpo.telefono || ''))) return err(400, 'sesion: requiere un telefono valido');
      const claves = ['v', 'accion', 'espacio', 'canal', 'ejecucion', 'idMensaje', 'versionLeida', 'idCompromiso', 'estado', 'venceEnMin', 'cupos'];
      const accion = q.accion === undefined ? 'leer' : q.accion;
      if (Object.keys(q).some((k) => !claves.includes(k)) || !['leer', 'comprometer'].includes(accion) || !RE_ESPACIO.test(String(q.espacio)) || !RE_EJEC.test(String(q.ejecucion))) return err(400, 'sesion: forma invalida');
      const tel = String(cuerpo.telefono);
      if (accion === 'leer') {
        if (q.idCompromiso !== undefined || q.estado !== undefined || q.venceEnMin !== undefined || q.cupos !== undefined) return err(400, 'sesion: forma invalida');
        return { statusCode: 200, body: { conversacion: s.conversacion(pnid, q.espacio, tel), visto: null } };
      }
      if (typeof q.idCompromiso !== 'string' || !RE_COMP.test(q.idCompromiso) || !Number.isInteger(q.versionLeida) || q.versionLeida < 0
        || q.estado === undefined || (q.estado !== null && (typeof q.estado !== 'object' || Array.isArray(q.estado)))
        || !Number.isInteger(q.venceEnMin) || q.venceEnMin < 1 || q.venceEnMin > 4320) return err(400, 'sesion: forma invalida');
      if (q.estado !== null && Buffer.byteLength(JSON.stringify(q.estado), 'utf8') > MAX_BYTES) return err(413, 'sesion: estado demasiado grande');
      if (typeof s.antesDeComprometer === 'function') s.antesDeComprometer(cuerpo);
      const k = `${pnid}~${q.espacio}~wa_${tel}`;
      const actual = s.conversacion(pnid, q.espacio, tel);
      const d = docs.get(k);
      const previos = d ? d.compromisos : [];
      if (previos.includes(q.idCompromiso)) return { statusCode: 200, body: { resultado: 'repetido', conversacion: actual } };
      if (q.versionLeida !== actual.version) return { statusCode: 200, body: { resultado: 'conflicto_version', conversacion: actual } };
      const version = actual.version + 1;
      const ahora = ahoraMs();
      const vence = ahora + q.venceEnMin * 60000;
      docs.set(k, { version, estadoJson: q.estado === null ? null : JSON.stringify(q.estado), vence, actualizadoEn: ahora, compromisos: [...previos, q.idCompromiso].slice(-5) });
      return { statusCode: 200, body: { resultado: 'comprometido', conversacion: { version, estado: q.estado, desde: ahora, vence, vencido: false } } };
    },
  };
  return s;
}
