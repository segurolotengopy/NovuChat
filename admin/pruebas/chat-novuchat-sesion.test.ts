/**
 * PR-4c1: el servidor de sesión de mentira y los ayudantes de los nodos Code del chat, SIN tocar el flujo.
 * La suite diferencial compara el servidor falso con el núcleo real (`core/turno/sesion.ts`): mismas peticiones, mismas decisiones.
 * Los ayudantes (`src/nodos/_sesion.js`) se cargan en un contexto vacío (sin URL, Buffer ni crypto, como el Code de n8n); sin `new Function`.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crearServidorDeSesion } from '../../Flujos/experimental/chat-novuchat/herramientas/servidor-de-sesion.mjs';
import { decidirCompromiso, leerConversacion, planDeCupos, validarSesion, type DocSesion } from '../functions/src/core/turno/sesion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(AQUI, '../../Flujos/experimental/chat-novuchat/src/nodos/_sesion.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const H: Record<string, any> = runInNewContext(`${FUENTE}\n({ cnEjecucion, cnTelefonoDeSesion, cnCuerpoLeer, cnIdCompromiso, cnCuerpoComprometer, cnBytes, cnSesionDeLaConfig, cnResultadoDeCompromiso })`, {});
const PNID = '59100000003';
const TEL = '59100000011';
const AHORA = Date.UTC(2026, 9, 5, 14);

describe('servidor de sesión de mentira vs el núcleo real', () => {
  it('mismas decisiones en una serie: ausente, comprometer, repetido, conflicto, versión vieja, estado null, vencimiento', () => {
    let reloj = AHORA;
    const falso = crearServidorDeSesion({ ahoraMs: () => reloj });
    let doc: DocSesion | null = null;
    const real = (cuerpo: Record<string, unknown>) => {
      const v = validarSesion(cuerpo['sesion'], String(cuerpo['telefono']));
      if (!v.ok) return { status: v.status };
      const p = v.peticion;
      if (p.accion === 'asentar') return { status: 200, fueraDeAlcance: true };
      if (p.accion === 'leer') return { status: 200, conv: leerConversacion(doc, reloj) };
      const d = decidirCompromiso({ doc, ahoraMs: reloj, versionLeida: p.versionLeida!, idCompromiso: p.idCompromiso!, estado: p.estado ?? null, venceEnMin: p.venceEnMin!, cupos: planDeCupos(PNID, TEL, p.cupos, reloj), cuposActuales: {} });
      if (d.resultado === 'comprometido') doc = { version: d.version, estadoJson: d.estadoJson, vence: d.vence, actualizadoEn: d.actualizadoEn, compromisos: d.compromisos };
      return { status: 200, resultado: d.resultado, conv: d.conversacion };
    };
    const prof = (n: number): Record<string, unknown> => { let o: Record<string, unknown> = {}; for (let i = 1; i < n; i++) o = { h: o }; return o; };
    const c = (accion: string, extra: Record<string, unknown> = {}) => ({ telefono: TEL, sesion: { v: 1, accion, espacio: 'chat-novuchat', canal: 'wa', ejecucion: 'e1', ...extra } });
    const k = (id: string, ver: number, estado: unknown, min = 2880) => c('comprometer', { idCompromiso: id, versionLeida: ver, estado, venceEnMin: min });
    const serie = [
      c('leer'), k('chat-reg1-e1', 0, { a: 1 }), c('leer'), k('chat-reg1-e1', 0, { a: 9 }), k('chat-reg2-e1', 0, { a: 2 }), k('chat-reg3-e1', 1, { a: 3 }),
      k('chat-fin1-e1', 2, null), c('leer'), k('chat-fin2-e1', 3, { b: 1 }, 1), 'AVANZA', c('leer'), k('chat-fin3-e1', 4, { b: 2 }),
      k('corto', 5, {}), c('comprometer', { idCompromiso: 'chat-xx-e1', versionLeida: 5 }), { telefono: '123', sesion: { v: 1, accion: 'leer', espacio: 'chat-novuchat', ejecucion: 'e' } },
      { telefono: TEL, sesion: { v: 1, accion: 'leer', espacio: 'chat-novuchat', ejecucion: 'e', tenantId: 'otro' } }, k('chat-big-e1', 5, { x: 'y'.repeat(17000) }),
      // Lo que el núcleo rechaza y la primera versión del falso aceptaba:
      c('leer', { canal: 'sms' }), c('leer', { ejecucion: 123 }), c('leer', { versionLeida: -1 }), c('leer', { versionLeida: 1.5 }), c('leer', { versionLeida: 7 }), c('leer', { estado: {} }),
      c('leer', { idMensaje: 'wamid.ABC' }), c('leer', { idMensaje: 'con espacio' }), c('leer', { idMensaje: 5 }), c('leer', { canal: 'wa' }),
      k('chat-idm-e1', 5, {}), c('comprometer', { idCompromiso: 'chat-idm-e1', versionLeida: 5, estado: {}, venceEnMin: 5, idMensaje: 'wamid.X' }),
      k('hasOwnProperty', 5, {}), k('constructor', 5, {}), k('_chat-xx-e1', 5, {}), k('chat-prof-e1', 5, prof(20)), k('chat-prof-e1', 5, prof(21)),
      c('comprometer', { idCompromiso: 'chat-sinv-e1', estado: {}, venceEnMin: 5 }), c('comprometer', { idCompromiso: 'chat-sine-e1', versionLeida: 5, venceEnMin: 5 }),
      c('comprometer', { idCompromiso: 'chat-sinm-e1', versionLeida: 5, estado: {} }), k('chat-min0-e1', 5, {}, 0), k('chat-max-e1', 5, {}, 4321), k('chat-ok-e1', 5, { ñ: 'á' }),
      // Fuera de alcance, declarado: cupos con tope 0 (el núcleo: cupo_negado) y `asentar`.
      c('comprometer', { idCompromiso: 'chat-cupo-e1', versionLeida: 6, estado: {}, venceEnMin: 5, cupos: [{ clave: 'avisos', alcance: 'contacto', periodo: 'dia', cantidad: 1, tope: 0 }] }),
      c('comprometer', { idCompromiso: 'chat-cupo2-e1', versionLeida: 6, estado: {}, venceEnMin: 5, cupos: [{ clave: 'avisos', alcance: 'contacto', periodo: 'dia', cantidad: 1, tope: 5 }] }),
      c('asentar', { idCompromiso: 'chat-cupo2-e1' }),
    ] as (Record<string, unknown> | 'AVANZA')[];
    for (const q of serie) {
      if (q === 'AVANZA') { reloj += 2 * 60_000; continue; }
      const a = falso.atender(PNID, q);
      const b = real(q);
      const sesion = (q['sesion'] ?? {}) as Record<string, unknown>;
      const fuera = b.fueraDeAlcance === true || (Array.isArray(sesion['cupos']) && sesion['cupos'].length > 0);
      // FUERA DE ALCANCE (declarado): `asentar` y los cupos no existen en el servidor falso: ahí responde 400 donde el núcleo acepta. Todo lo demás debe coincidir.
      if (fuera) { expect(a.statusCode, 'fuera de alcance: 400').toBe(400); continue; }
      expect(a.statusCode, JSON.stringify(q).slice(0, 120)).toBe(b.status);
      if (b.status === 200) {
        const conv = (a.body['conversacion'] ?? {}) as Record<string, unknown>;
        expect(a.body['resultado'], 'resultado').toBe(b.resultado);
        expect({ version: conv['version'], estado: conv['estado'], vencido: conv['vencido'] }).toEqual({ version: b.conv!.version, estado: b.conv!.estado, vencido: b.conv!.vencido });
      }
    }
  });
  it('el aislamiento es por número de la ruta: el mismo teléfono en otro número no ve el estado, y un tenantId del cuerpo se rechaza', () => {
    const f = crearServidorDeSesion({ ahoraMs: () => AHORA });
    f.atender(PNID, { telefono: TEL, sesion: { v: 1, accion: 'comprometer', espacio: 'chat-novuchat', ejecucion: 'e', idCompromiso: 'chat-reg1-e', versionLeida: 0, estado: { a: 1 }, venceEnMin: 5 } });
    expect(f.atender('59100000099', { telefono: TEL, sesion: { v: 1, accion: 'leer', espacio: 'chat-novuchat', ejecucion: 'e' } }).body['conversacion']).toMatchObject({ version: 0, estado: null });
    expect(f.atender(PNID, { telefono: TEL, sesion: { v: 1, accion: 'leer', espacio: 'chat-novuchat', ejecucion: 'e', tenantId: 'x' } }).statusCode).toBe(400);
  });
  it('los ganchos: antesDeComprometer mete un rival (conflicto) y fallar da 503 sin escribir', () => {
    const f = crearServidorDeSesion({ ahoraMs: () => AHORA });
    const cuerpo = H['cnCuerpoComprometer'](TEL, 'ej1', 'reg1', 0, { a: 1 });
    f.antesDeComprometer = () => { f.antesDeComprometer = null; f.sembrar(PNID, 'chat-novuchat', TEL, { rival: true }); };
    const r = H['cnResultadoDeCompromiso'](f.atender(PNID, cuerpo));
    expect(r).toMatchObject({ resultado: 'conflicto', version: 1, ganador: { rival: true } });
    f.fallar = () => 503;
    const antes = f.conversacion(PNID, 'chat-novuchat', TEL).version;
    expect(H['cnResultadoDeCompromiso'](f.atender(PNID, H['cnCuerpoComprometer'](TEL, 'ej1', 'reg2', 1, { a: 2 })))).toMatchObject({ resultado: 'falla' });
    f.fallar = null;
    expect(f.conversacion(PNID, 'chat-novuchat', TEL).version).toBe(antes);
  });
});

describe('ayudantes de los nodos Code (_sesion.js)', () => {
  it('ejecución e id de compromiso con la forma del servidor; cada paso lleva el suyo', () => {
    expect(H['cnEjecucion']('123')).toBe('123');
    expect(H['cnEjecucion']('a/b c\n' + 'x'.repeat(100))).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(H['cnEjecucion'](undefined)).toBe('sin-id');
    expect(H['cnEjecucion']('///')).toBe('sin-id');
    const a = H['cnIdCompromiso']('1', 'reg1');
    expect(a).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
    expect(H['cnIdCompromiso']('1', 'reg2')).not.toBe(a);
    expect(H['cnIdCompromiso']('2', 'reg1')).not.toBe(a);
  });
  it('los cuerpos pasan la validación real; el estado que no cabe, el teléfono corto y la versión inválida dan null (nunca se manda)', () => {
    for (const cuerpo of [H['cnCuerpoLeer'](TEL, '7'), H['cnCuerpoComprometer'](TEL, '7', 'fin1', 3, { a: 1 }), H['cnCuerpoComprometer'](TEL, '7', 'fin1', 0, null)]) {
      expect(validarSesion(cuerpo.sesion, cuerpo.telefono).ok).toBe(true);
      expect(Object.keys(cuerpo)).toEqual(['telefono', 'sesion']); // ningún tenantId ni número en el cuerpo
    }
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', 0, { x: 'y'.repeat(16000) })).toBeNull();
    expect(H['cnCuerpoComprometer']('12345', '7', 'fin1', 0, {})).toBeNull();
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', -1, {})).toBeNull();
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', 1.5, {})).toBeNull();
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', 0, [1])).toBeNull();
  });
  it('el tamaño se mide en BYTES UTF-8: 15.000 caracteres con «ñ» (30.000 bytes) no caben; 7.000 sí', () => {
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'ñ'.repeat(15000) })).toBeNull();
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'ñ'.repeat(7000) })).not.toBeNull();
    expect(H['cnCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: '😀'.repeat(4000) })).toBeNull();
    expect(H['cnBytes']('ñ😀a')).toBe(7);
  });
  it('cnSesionDeLaConfig: solo 200 con conversación válida es ok; todo lo demás es falla (genérico con botón)', () => {
    const buena = { conversacion: { version: 4, estado: { a: 1 }, vencido: false } };
    expect(H['cnSesionDeLaConfig'](200, buena)).toEqual({ ok: true, version: 4, estado: { a: 1 }, vencido: false, corrupta: false });
    expect(H['cnSesionDeLaConfig'](200, { conversacion: { version: 0, estado: null, vencido: false, corrupta: true } })).toMatchObject({ ok: true, version: 0, corrupta: true });
    for (const [cod, cu] of [[500, buena], [409, buena], [200, {}], [200, null], [200, { conversacion: { version: -1, estado: null } }], [200, { conversacion: { version: 1, estado: [] } }], [200, { conversacion: { version: '1', estado: null } }]] as const) {
      expect(H['cnSesionDeLaConfig'](cod, cu), `${cod} ${JSON.stringify(cu)}`.slice(0, 80)).toMatchObject({ ok: false });
    }
  });
  it('cnResultadoDeCompromiso: ok, repetido=ok, conflicto con ganador; 5xx, timeout, forma rara, cupo y datos inválidos son falla', () => {
    const conv = { version: 2, estado: { z: 1 }, vencido: false };
    expect(H['cnResultadoDeCompromiso']({ statusCode: 200, body: { resultado: 'comprometido', conversacion: conv } })).toEqual({ resultado: 'ok', version: 2, ganador: null });
    expect(H['cnResultadoDeCompromiso']({ statusCode: 200, body: { resultado: 'repetido', conversacion: conv } }).resultado).toBe('ok');
    expect(H['cnResultadoDeCompromiso']({ statusCode: 200, body: JSON.stringify({ resultado: 'conflicto_version', conversacion: conv }) })).toEqual({ resultado: 'conflicto', version: 2, ganador: { z: 1 } });
    for (const x of [{ statusCode: 503, body: { error: 'x' } }, { error: { message: 'timeout' } }, null, undefined, 'x', { statusCode: 200, body: 'no json' }, { statusCode: 200, body: { resultado: 'cupo_negado', conversacion: conv } },
      { statusCode: 200, body: { resultado: 'datos_invalidos', conversacion: conv } }, { statusCode: 200, body: { resultado: 'comprometido' } }, { statusCode: 200, body: { resultado: 'otra', conversacion: conv } }]) {
      expect(H['cnResultadoDeCompromiso'](x), JSON.stringify(x)).toEqual({ resultado: 'falla', version: 0, ganador: null });
    }
  });
  it('el archivo no usa globales que el Code de n8n no tiene y todavía no está incluido en ningún nodo ni JSON', () => {
    expect(FUENTE.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/\b(URL|Buffer|crypto|require|process|fetch|eval|TextEncoder)\b(?!\s*:)|new\s+Function|\bFunction\s*\(/);
    const cons = readFileSync(join(AQUI, '../../Flujos/experimental/chat-novuchat/construir.mjs'), 'utf8');
    expect(cons).not.toContain('_sesion');
    for (const j of ['chat-novuchat.novuchat.json', 'chat-novuchat.prueba.json']) expect(readFileSync(join(AQUI, '../../Flujos/experimental/chat-novuchat', j), 'utf8')).not.toContain('cnCuerpoComprometer');
  });
});
