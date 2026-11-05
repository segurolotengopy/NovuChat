/**
 * MÓDULO COMÚN `sesion` de comun-sin-agente (PR-4a0; nació como PR-4c1 del chat): el servidor de sesión de mentira y los ayudantes `ss*` de los nodos Code, con sus PARÁMETROS (`SS_CONFIG`).
 * La suite diferencial compara el servidor falso con el núcleo real (`core/turno/sesion.ts`): mismas peticiones, mismas decisiones.
 * Los ayudantes (`comun-sin-agente/src/sesion.js`) se cargan en un contexto vacío (sin URL, Buffer ni crypto, como el Code de n8n); sin `new Function`.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crearServidorDeSesion } from '../../Flujos/experimental/comun-sin-agente/herramientas/servidor-de-sesion.mjs';
import { decidirCompromiso, leerConversacion, planDeCupos, validarSesion, type DocSesion } from '../functions/src/core/turno/sesion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FUENTE = readFileSync(join(AQUI, '../../Flujos/experimental/comun-sin-agente/src/sesion.js'), 'utf8');
/** Los parámetros del módulo para el chat (`SS_CONFIG`): un OBJETO que entra al contexto como variable, nunca texto de código. */
const CONFIG_CHAT = { espacio: 'chat-novuchat', espacioPrueba: 'chat-novuchat-prueba', venceMin: 2880, maxBytes: 15000, prefijo: 'chat', nodoCarga: 'Carga de entrada', nodoBase: 'Config base' };
const EXPORTA = '({ ssEjecucion, ssTelefonoDeSesion, ssCuerpoLeer, ssIdCompromiso, ssCuerpoComprometer, ssBytes, ssSesionDeLaConfig, ssResultadoDeCompromiso, ssNumeroHeader, ssEsPrueba, ssDesdeAutorizado })';
/**
 * Evalúa el módulo en un contexto NUEVO y vacío (como el Code de n8n) cuyas ÚNICAS variables son las que se pasan: `SS_CONFIG` (objeto) y, si hace falta, `cnPrimero` (una función de la prueba).
 * NINGÚN parámetro se vuelve texto de código: el texto evaluado es siempre `FUENTE` + `EXPORTA`, constantes. Lo que devuelve nace en OTRO contexto: se compara con `toEqual`/`toMatchObject`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cargar = (config: Record<string, unknown>, variables: Record<string, unknown> = {}): Record<string, any> => runInNewContext(`${FUENTE}\n${EXPORTA}`, { SS_CONFIG: config, ...variables });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const H: Record<string, any> = cargar(CONFIG_CHAT);
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
    const cuerpo = H['ssCuerpoComprometer'](TEL, 'ej1', 'reg1', 0, { a: 1 });
    f.antesDeComprometer = () => { f.antesDeComprometer = null; f.sembrar(PNID, 'chat-novuchat', TEL, { rival: true }); };
    const r = H['ssResultadoDeCompromiso'](f.atender(PNID, cuerpo));
    expect(r).toMatchObject({ resultado: 'conflicto', version: 1, ganador: { rival: true } });
    f.fallar = () => 503;
    const antes = f.conversacion(PNID, 'chat-novuchat', TEL).version;
    expect(H['ssResultadoDeCompromiso'](f.atender(PNID, H['ssCuerpoComprometer'](TEL, 'ej1', 'reg2', 1, { a: 2 })))).toMatchObject({ resultado: 'falla' });
    f.fallar = null;
    expect(f.conversacion(PNID, 'chat-novuchat', TEL).version).toBe(antes);
  });
});

describe('ayudantes de los nodos Code (sesion.js, prefijo ss)', () => {
  it('ejecución e id de compromiso con la forma del servidor; cada paso lleva el suyo', () => {
    expect(H['ssEjecucion']('123')).toBe('123');
    expect(H['ssEjecucion']('a/b c\n' + 'x'.repeat(100))).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(H['ssEjecucion'](undefined)).toBe('sin-id');
    expect(H['ssEjecucion']('///')).toBe('sin-id');
    const a = H['ssIdCompromiso']('1', 'reg1');
    expect(a).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/);
    expect(H['ssIdCompromiso']('1', 'reg2')).not.toBe(a);
    expect(H['ssIdCompromiso']('2', 'reg1')).not.toBe(a);
  });
  it('los cuerpos pasan la validación real; el estado que no cabe, el teléfono corto y la versión inválida dan null (nunca se manda)', () => {
    for (const cuerpo of [H['ssCuerpoLeer'](TEL, '7'), H['ssCuerpoComprometer'](TEL, '7', 'fin1', 3, { a: 1 }), H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, null)]) {
      expect(validarSesion(cuerpo.sesion, cuerpo.telefono).ok).toBe(true);
      expect(Object.keys(cuerpo)).toEqual(['telefono', 'sesion']); // ningún tenantId ni número en el cuerpo
    }
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { x: 'y'.repeat(16000) })).toBeNull();
    expect(H['ssCuerpoComprometer']('12345', '7', 'fin1', 0, {})).toBeNull();
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', -1, {})).toBeNull();
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 1.5, {})).toBeNull();
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, [1])).toBeNull();
  });
  it('el tamaño se mide en BYTES UTF-8: 15.000 caracteres con «ñ» (30.000 bytes) no caben; 7.000 sí', () => {
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'ñ'.repeat(15000) })).toBeNull();
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'ñ'.repeat(7000) })).not.toBeNull();
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: '😀'.repeat(4000) })).toBeNull();
    expect(H['ssBytes']('ñ😀a')).toBe(7);
    expect(() => H['ssBytes']('a\uD800b')).not.toThrow(); // un surrogate suelto cuenta como U+FFFD (3 bytes)
    expect(H['ssBytes']('a\uD800b')).toBe(5);
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'x\uDC00y' })).not.toBeNull();
  });
  it('cnSesionDeLaConfig: solo 200 con conversación válida es ok; todo lo demás es falla (genérico con botón)', () => {
    const buena = { conversacion: { version: 4, estado: { a: 1 }, vencido: false } };
    expect(H['ssSesionDeLaConfig'](200, buena)).toEqual({ ok: true, version: 4, estado: { a: 1 }, vencido: false, corrupta: false });
    expect(H['ssSesionDeLaConfig'](200, { conversacion: { version: 0, estado: null, vencido: false, corrupta: true } })).toMatchObject({ ok: true, version: 0, corrupta: true });
    for (const [cod, cu] of [[500, buena], [409, buena], [200, {}], [200, null], [200, { conversacion: { version: -1, estado: null } }], [200, { conversacion: { version: 1, estado: [] } }], [200, { conversacion: { version: '1', estado: null } }]] as const) {
      expect(H['ssSesionDeLaConfig'](cod, cu), `${cod} ${JSON.stringify(cu)}`.slice(0, 80)).toMatchObject({ ok: false });
    }
  });
  it('cnResultadoDeCompromiso: ok, repetido=ok, conflicto con ganador; 5xx, timeout, forma rara, cupo y datos inválidos son falla', () => {
    const conv = { version: 2, estado: { z: 1 }, vencido: false };
    expect(H['ssResultadoDeCompromiso']({ statusCode: 200, body: { resultado: 'comprometido', conversacion: conv } })).toEqual({ resultado: 'ok', version: 2, ganador: null });
    expect(H['ssResultadoDeCompromiso']({ statusCode: 200, body: { resultado: 'repetido', conversacion: conv } }).resultado).toBe('ok');
    expect(H['ssResultadoDeCompromiso']({ statusCode: 200, body: JSON.stringify({ resultado: 'conflicto_version', conversacion: conv }) })).toEqual({ resultado: 'conflicto', version: 2, ganador: { z: 1 } });
    for (const x of [{ statusCode: 503, body: { error: 'x' } }, { error: { message: 'timeout' } }, null, undefined, 'x', { statusCode: 200, body: 'no json' }, { statusCode: 200, body: { resultado: 'cupo_negado', conversacion: conv } },
      { statusCode: 200, body: { resultado: 'datos_invalidos', conversacion: conv } }, { statusCode: 200, body: { resultado: 'comprometido' } }, { statusCode: 200, body: { resultado: 'otra', conversacion: conv } }]) {
      expect(H['ssResultadoDeCompromiso'](x), JSON.stringify(x)).toEqual({ resultado: 'falla', version: 0, ganador: null });
    }
  });
  it('el archivo no usa globales que el Code de n8n no tiene (ni eval ni new Function) y SÍ está incluido en los nodos del chat (PR-4a0)', () => {
    expect(FUENTE.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/\b(URL|Buffer|crypto|require|process|fetch|eval|TextEncoder)\b(?!\s*:)|new\s+Function|\bFunction\s*\(/);
    const cons = readFileSync(join(AQUI, '../../Flujos/experimental/chat-novuchat/construir.mjs'), 'utf8');
    expect(cons).toContain('comun-sin-agente/src/sesion.js'); // el chat INCLUYE el módulo común (no lo copia)
    for (const j of ['chat-novuchat.novuchat.json', 'chat-novuchat.prueba.json']) expect(readFileSync(join(AQUI, '../../Flujos/experimental/chat-novuchat', j), 'utf8')).toContain('ssCuerpoComprometer');
  });

});

describe('PARÁMETROS del módulo (SS_CONFIG): lo que cambia de un flujo a otro es SOLO la configuración', () => {
  const QTACO = { espacio: 'venta-minima', espacioPrueba: 'venta-minima-prueba', venceMin: 1440, maxBytes: 8000, prefijo: 'vm', nodoCarga: 'Carga de entrada', nodoBase: 'Config base' };
  /** El `cnPrimero` del flujo, de mentira: la carga de entrada y la config base que el flujo daría (una FUNCIÓN que entra al contexto como variable). */
  const nodos = (carga: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> => ({ cnPrimero: (n: string) => (n === 'Carga de entrada' ? carga : n === 'Config base' ? base : null) });
  it('espacio, vencimiento, tope de bytes y prefijo del idCompromiso salen de SS_CONFIG: otro flujo, otro espacio, sin tocar el código', () => {
    const Q = cargar(QTACO);
    const c = Q['ssCuerpoComprometer'](TEL, '7', 'fin1', 3, { a: 1 });
    expect(c.sesion).toMatchObject({ espacio: 'venta-minima', venceEnMin: 1440, idCompromiso: 'vm-fin1-7' });
    expect(validarSesion(c.sesion, c.telefono).ok).toBe(true);
    expect(Q['ssCuerpoLeer'](TEL, '7').sesion.espacio).toBe('venta-minima');
    expect(Q['ssIdCompromiso']('9', 'reg2')).toBe('vm-reg2-9');
    // el tope de bytes es el SUYO (8.000), no el del chat (15.000)
    expect(Q['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'x'.repeat(9000) })).toBeNull();
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { t: 'x'.repeat(9000) })).not.toBeNull();
    // y el chat sigue siendo el chat
    expect(H['ssCuerpoComprometer'](TEL, '7', 'fin1', 3, { a: 1 }).sesion).toMatchObject({ espacio: 'chat-novuchat', venceEnMin: 2880, idCompromiso: 'chat-fin1-7' });
  });
  it('la variante de PRUEBA usa SU espacio y solo para telefonosDePrueba (con los nombres de nodo del flujo); sin lista, ninguno; producción, cualquiera', () => {
    const prueba = { prueba: { modoPrueba: true }, phoneNumberId: 'P1' };
    const Q = cargar(QTACO, nodos(prueba, { telefonosDePrueba: `${TEL},59100000044`, phoneNumberIdEsperado: 'P1' }));
    expect(Q['ssEsPrueba']()).toBe(true);
    expect(Q['ssCuerpoLeer'](TEL, '7').sesion.espacio).toBe('venta-minima-prueba');
    expect(Q['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, {}).sesion.espacio).toBe('venta-minima-prueba');
    expect(Q['ssCuerpoComprometer']('59100000099', '7', 'fin1', 0, {})).toBeNull(); // un teléfono de producción NO compromete en prueba
    expect(Q['ssNumeroHeader']()).toBe('P1');
    const sinLista = cargar(QTACO, nodos(prueba, {}));
    expect(sinLista['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, {})).toBeNull();
    const prod = cargar(QTACO, nodos({ phoneNumberId: 'P2', prueba: null }, { telefonosDePrueba: TEL }));
    expect(prod['ssEsPrueba']()).toBe(false);
    expect(prod['ssCuerpoComprometer']('59100000099', '7', 'fin1', 0, {}).sesion.espacio).toBe('venta-minima');
    expect(prod['ssNumeroHeader']()).toBe('P2');
    // los nombres de nodo también son parámetros: con otros nombres, los nodos de arriba no cuentan
    const otros = cargar({ ...QTACO, nodoCarga: 'Otra carga' }, nodos(prueba, {}));
    expect(otros['ssEsPrueba']()).toBe(false);
  });
  it('el servidor falso acepta solo los `espacios` de UN flujo: ni el del chat; un espacio fuera de la lista es 400 (restricción del DOBLE; el núcleo real no la tiene)', () => {
    const f = crearServidorDeSesion({ ahoraMs: () => AHORA, espacios: ['venta-minima', 'venta-minima-prueba'] });
    const pide = (espacio: string) => f.atender(PNID, { telefono: TEL, sesion: { v: 1, accion: 'leer', espacio, ejecucion: 'e' } }).statusCode;
    expect(pide('venta-minima')).toBe(200);
    expect(pide('venta-minima-prueba')).toBe(200);
    expect(pide('chat-novuchat')).toBe(400);
    expect(crearServidorDeSesion({ ahoraMs: () => AHORA }).atender(PNID, { telefono: TEL, sesion: { v: 1, accion: 'leer', espacio: 'chat-novuchat', ejecucion: 'e' } }).statusCode).toBe(200);
  });
  const QTACO_AISLADO = { espacio: 'venta-minima', espacioPrueba: 'venta-minima-prueba', venceMin: 1440, maxBytes: 8000, prefijo: 'vm', nodoCarga: 'Carga de entrada', nodoBase: 'Config base' };
  it('AISLAMIENTO entre espacios: lo que Q\'Taco compromete en `venta-minima` NO lo lee el chat en `chat-novuchat` (mismo servidor, mismo teléfono, mismo número)', () => {
    // La restricción `espacios` es solo del servidor FALSO; el núcleo real no la tiene: allí el aislamiento lo da la CLAVE del documento (`{pnid}~{espacio}~wa_{tel}`).
    const servidor = crearServidorDeSesion({ ahoraMs: () => AHORA });
    const Q = cargar(QTACO_AISLADO);
    const c = Q['ssCuerpoComprometer'](TEL, '7', 'fin1', 0, { pedido: 'secreto de Q\'Taco' });
    expect(servidor.atender(PNID, c).body['resultado']).toBe('comprometido');
    const delChat = servidor.atender(PNID, H['ssCuerpoLeer'](TEL, '8'));
    expect(delChat.body['conversacion']).toMatchObject({ version: 0, estado: null });
    expect(servidor.atender(PNID, Q['ssCuerpoLeer'](TEL, '9')).body['conversacion']).toMatchObject({ version: 1, estado: { pedido: 'secreto de Q\'Taco' } });
    // y al revés: el chat compromete lo suyo sin pisar la versión de Q'Taco
    expect(servidor.atender(PNID, H['ssCuerpoComprometer'](TEL, '8', 'fin1', 0, { a: 1 })).body['resultado']).toBe('comprometido');
    expect(servidor.atender(PNID, Q['ssCuerpoLeer'](TEL, '9')).body['conversacion']).toMatchObject({ version: 1, estado: { pedido: 'secreto de Q\'Taco' } });
  });
});

