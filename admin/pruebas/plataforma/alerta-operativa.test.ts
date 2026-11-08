/**
 * ALERTA OPERATIVA («envío incierto»), alineada con avisos-correo/v1 (ADR-011 de WAM): probada NEGANDO.
 *
 * Sin emulador ni red: el almacén es de memoria (la MISMA batería corre contra Firestore real en
 * `alerta-operativa-firestore.test.ts`) y el envío es un doble que registra lo que habría ido a Resend.
 * Valores sintéticos, ARMADOS EN EJECUCIÓN: el literal de un teléfono, un correo o un secreto no aparece en el
 * repositorio público (guarda de saneo).
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  TOPE_DIARIO, TOPE_MAXIMO, armarCorreo, armarResumen, atenderAlerta, autenticar, enviarPorResend, enviarResumenDiario,
  inmediatosDe, topeValido, reiniciarCandadoDeRespaldo, validarEntrada, verificarFirmaAlerta, MAX_CUERPO_ALERTA, siguienteMedianocheUtc, diaUtc,
  type AlmacenAlertas, type Enviar, type Envio,
} from '../../functions/src/plataforma/alertaOperativa.ts';
import { ErrorContrato, detectar, enlaceNormalizado } from '../../functions/src/plataforma/alertaContenido.ts';
import { almacenEnMemoria, type AlmacenMemoria } from './alerta-almacen-memoria.ts';
import { AHORA, DIA, bateriaDelAlmacen, eventoGuardado } from './alerta-almacen-contrato.ts';

const SECRETO = 'secreto-de-prueba-solo-para-esta-suite';
const HOSTS = ['github.com'];
const HORA = 3_600_000;
const ENLACE = ['https://github.com', 'org', 'repo', 'blob', 'main', 'docs', 'runbook.md'].join('/');

// Datos de ejemplo armados en ejecución.
const TEL = ['5917', '1234567'].join('');
const TEL_CON_MAS = ['+591 7', '123 4567'].join('');
const TEL_CON_GUION = ['712', '-', '34567'].join('');
const TEL_LOCAL = ['7123', '4567'].join('');
const CORREO = ['juan', '@', 'correo', '.test'].join('');
const IP = ['10', '0', '0', '5'].join('.');
const OTP = ['48', '2913'].join('');
const CLAVE_RESEND = ['re', '_', 'prueba', 'Clave'].join('');
const DEST = ['dest', '@', 'dominio.test'].join('');
const REMITE = ['alertas-novuchat', '@', 'dominio.test'].join('');
const relleno = (n: number): string => { const s = 'ab '.repeat(n).slice(0, n); return s.endsWith(' ') ? `${s.slice(0, -1)}b` : s; };

const buenEvento = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  nivel: 'urgente', proyecto: 'novuchat', asunto: 'Envío incierto en un flujo',
  que_paso: 'Un flujo con relé terminó con error en el nodo de envío.',
  que_se_espera_de_andres: 'Revisar el flujo en n8n y reintentar si hace falta.',
  enlace: ENLACE, ocurrido_en: '2026-11-07T14:59:00Z', id_unico: 'evt-0001-abcdef', tipo_error: 'envio_incierto',
  flujo: 'demo-a', nodo: 'Enviar respuesta', ...extra,
});
const sin = (o: Record<string, unknown>, k: string): Record<string, unknown> => { const c = { ...o }; delete c[k]; return c; };

function firmar(cuerpo: unknown, marca = AHORA, secreto = SECRETO): { crudo: Buffer; cabeceras: Record<string, string> } {
  const crudo = Buffer.from(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
  const firma = createHmac('sha256', secreto).update(`${marca}.`).update(crudo).digest('hex');
  return { crudo, cabeceras: { 'x-novuchat-alerta-timestamp': String(marca), 'x-novuchat-alerta-signature': `sha256=${firma}` } };
}

interface Op { marca?: number; secreto?: string; sinFirma?: boolean; ahora?: number; metodo?: string; tope?: number; denegar?: string[]; hosts?: string[] }
function llamar(almacen: AlmacenAlertas, enviar: Enviar | null, cuerpo: unknown, op: Op = {}) {
  const f = firmar(cuerpo, op.marca ?? AHORA, op.secreto ?? SECRETO);
  const cab: Record<string, string> = op.sinFirma ? {} : f.cabeceras;
  return atenderAlerta(
    { metodo: op.metodo ?? 'POST', cabecera: (n) => cab[n.toLowerCase()], crudo: f.crudo },
    {
      secreto: SECRETO, ahoraMs: op.ahora ?? AHORA,
      cargar: async () => ({ almacen, enviar, hosts: op.hosts ?? HOSTS, denegar: op.denegar ?? [], ...(op.tope !== undefined ? { tope: op.tope } : {}) }),
    });
}
const envioFalso = () => {
  const enviados: Envio[] = [];
  const enviar: Enviar = async (e) => { enviados.push(e); };
  return { enviados, enviar };
};
const validar = (e: Record<string, unknown>, extra: { denegar?: string[]; ahoraMs?: number } = {}) =>
  validarEntrada(e, { hosts: HOSTS, denegar: extra.denegar ?? [], ahoraMs: extra.ahoraMs ?? AHORA });
const violaciones = (e: Record<string, unknown>, extra: { denegar?: string[]; ahoraMs?: number } = {}): string[] => {
  try { validar(e, extra); } catch (error) {
    if (error instanceof ErrorContrato) return error.violaciones.map((v) => `${v.campo}:${v.regla}`);
    throw error;
  }
  return [];
};

// ---------------------------------------------------------------------------
describe('firma HMAC propia', () => {
  it('sin firma, de otro secreto, vieja o futura: 401, no se guarda ni se envía nada y NO se lee la configuración', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    let lecturas = 0;
    for (const op of [{ sinFirma: true }, { secreto: 'otro-secreto' }, { marca: AHORA - 3 * 60_000 }, { marca: AHORA + 3 * 60_000 }]) {
      const f = firmar(buenEvento(), op.marca ?? AHORA, op.secreto ?? SECRETO);
      const cab: Record<string, string> = op.sinFirma ? {} : f.cabeceras;
      const r = await atenderAlerta(
        { metodo: 'POST', cabecera: (n) => cab[n.toLowerCase()], crudo: f.crudo },
        { secreto: SECRETO, ahoraMs: AHORA, cargar: async () => { lecturas++; return { almacen: a, enviar, hosts: HOSTS, denegar: [] }; } });
      expect(r).toEqual({ status: 401, cuerpo: 'no autorizado' });
    }
    expect(lecturas).toBe(0);
    expect(a.eventos.size).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('cuerpo alterado, firma mal formada, método distinto de POST', async () => {
    const a = almacenEnMemoria(); const { enviar } = envioFalso();
    const f = firmar(buenEvento());
    const alterado = Buffer.from(f.crudo.toString().replace('demo-a', 'demo-b'));
    expect(autenticar({ metodo: 'POST', cabecera: (n) => f.cabeceras[n.toLowerCase()], crudo: alterado }, SECRETO, AHORA).ok).toBe(false);
    expect(verificarFirmaAlerta(SECRETO, String(AHORA), 'sha256=zz', f.crudo, AHORA)).toBe(false);
    expect(verificarFirmaAlerta(SECRETO, String(AHORA), `sha256=${'0'.repeat(64)}`, f.crudo, AHORA)).toBe(false);
    expect(verificarFirmaAlerta('', String(AHORA), f.cabeceras['x-novuchat-alerta-signature']!, f.crudo, AHORA)).toBe(false);
    expect((await llamar(a, enviar, buenEvento(), { metodo: 'GET' })).status).toBe(405);
    expect(a.eventos.size).toBe(0);
  });

  it('una firma con la forma de la ingesta (por número) no vale; la correcta dentro de la ventana, sí', async () => {
    const a = almacenEnMemoria(); const { enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento(), { marca: AHORA - 60_000 })).status).toBe(200);
    const f = firmar(buenEvento({ id_unico: 'evt-otro-0001' }));
    const r = await atenderAlerta(
      { metodo: 'POST', cabecera: (n) => ({ 'x-novuchat-timestamp': String(AHORA), 'x-novuchat-signature': f.cabeceras['x-novuchat-alerta-signature']! } as Record<string, string>)[n.toLowerCase()], crudo: f.crudo },
      { secreto: SECRETO, ahoraMs: AHORA, cargar: async () => ({ almacen: a, enviar, hosts: HOSTS, denegar: [] }) });
    expect(r.status).toBe(401);
  });

  it('un cuerpo mayor que MAX_CUERPO_ALERTA se rechaza (413) aunque la firma sea válida', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const grande = buenEvento({ que_paso: 'x'.repeat(MAX_CUERPO_ALERTA + 10) });
    const r = await llamar(a, enviar, grande);
    expect(r.status).toBe(413);
    expect(a.eventos.size).toBe(0);
    expect(enviados).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe('contrato: entrada interna -> aviso v1', () => {
  it('el aviso v1 son exactamente los 9 campos con contrato; tipo_error, flujo y nodo quedan aparte', () => {
    const v = validar(buenEvento());
    expect(Object.keys(v.aviso).sort()).toEqual([
      'asunto', 'contrato', 'enlace', 'id_unico', 'nivel', 'ocurrido_en', 'proyecto', 'que_paso', 'que_se_espera_de_andres',
    ]);
    expect(v.aviso.contrato).toBe('avisos-correo/v1');
    expect(v).toMatchObject({ tipo_error: 'envio_incierto', flujo: 'demo-a', nodo: 'Enviar respuesta', saneado: false });
  });

  it('la entrada NO admite `contrato` ni ningún campo ajeno; falta de un campo; nivel del contrato viejo', () => {
    expect(violaciones(buenEvento({ contrato: 'avisos-correo/v1' }))).toEqual(['desconocido:campo_no_permitido']);
    expect(violaciones(buenEvento({ telefono: TEL }))).toEqual(['desconocido:campo_no_permitido']);
    expect(violaciones(sin(buenEvento(), 'asunto'))).toContain('asunto:campo_faltante');
    expect(violaciones(buenEvento({ nivel: 'critico' }))).toEqual(['nivel:nivel_invalido']);
    expect(violaciones(buenEvento({ nivel: 'info' }))).toEqual(['nivel:nivel_invalido']);
    expect(violaciones(buenEvento({ proyecto: 'wam' }))).toEqual(['proyecto:proyecto_invalido']);
    expect(violaciones(buenEvento({ tipo_error: 'Tiene Espacios' }))).toEqual(['tipo_error:forma']);
    expect(violaciones(buenEvento({ asunto: 'ab' }))).toEqual(['asunto:forma']);
    expect(() => validarEntrada([], { hosts: HOSTS, denegar: [], ahoraMs: AHORA })).toThrow();
  });

  it('contenido prohibido: se rechaza ENTERO (422), sale el aviso de texto fijo <id>:bloqueado y el valor nunca viaja', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const r = await llamar(a, enviar, buenEvento({ que_paso: `Falló para ${TEL} (${CORREO})` }));
    expect(r.status).toBe(422);
    expect(r.cuerpo).toContain('que_paso(telefono_o_identificador)');
    expect(r.cuerpo).toContain('que_paso(correo)');
    expect(enviados).toHaveLength(1);
    const e = enviados[0]!;
    expect(e.idempotencia).toBe('novuchat:evt-0001-abcdef:bloqueado');
    expect(e.texto).toContain('que_paso (telefono_o_identificador)');
    expect(e.texto).toContain('nada; la sesión de novuchat corrige el emisor');
    for (const v of [e.texto, e.asunto, e.html, JSON.stringify([...a.eventos.values()]), r.cuerpo]) {
      expect(v).not.toContain(TEL);
      expect(v).not.toContain(CORREO);
    }
    // Se guardó el aviso bloqueado, NO el original.
    expect([...a.eventos.keys()]).toEqual(['evt-0001-abcdef:bloqueado']);
  });

  it('el aviso bloqueado conserva el nivel urgente y baja a «aviso» en cualquier otro caso', async () => {
    for (const [nivel, esperado] of [['urgente', 'urgente'], ['informativo', 'aviso'], ['aviso', 'aviso']] as const) {
      const a = almacenEnMemoria();
      await llamar(a, null, buenEvento({ nivel, que_paso: `a ${TEL}` }));
      expect(a.eventos.get('evt-0001-abcdef:bloqueado')!.nivel).toBe(esperado);
    }
  });

  it('si el proyecto no es válido, NO se envía nada y se responde 4xx', async () => {
    for (const mal of [{ proyecto: 'wam' }, { proyecto: 'Mal Proyecto', que_paso: `x ${TEL}` }]) {
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      const r = await llamar(a, enviar, buenEvento(mal));
      expect(r.status, JSON.stringify(mal)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(enviados, JSON.stringify(mal)).toHaveLength(0);
      expect(a.eventos.size).toBe(0);
    }
  });

  it('un id_unico inválido NO pierde la alerta: sale un aviso bloqueado con un id del SERVIDOR y ningún valor del llamador', async () => {
    for (const id of ['abc', `evt-${TEL}`, 'resumen-2026-11-07']) {
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      const r = await llamar(a, enviar, buenEvento({ id_unico: id, que_paso: `falló ${TEL}`, flujo: 'demo-a' }));
      expect(r.status, id).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(enviados, id).toHaveLength(1);
      expect(enviados[0]!.idempotencia).toBe('novuchat:id-invalido-2026-11-07T15');
      for (const v of [enviados[0]!.texto, enviados[0]!.asunto, enviados[0]!.html, r.cuerpo]) {
        expect(v).not.toContain(TEL);
        expect(v).not.toContain(id.slice(0, 12) === 'resumen-2026' ? 'resumen-2026' : id);
      }
      expect([...a.eventos.keys()]).toEqual(['id-invalido-2026-11-07T15']);
    }
  });

  it('con un id inválido, el aviso del servidor es A LO MÁS UNO POR HORA (mismo id de servidor: duplicado) y conserva «urgente»', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    await llamar(a, enviar, buenEvento({ id_unico: 'abc' }));
    await llamar(a, enviar, buenEvento({ id_unico: 'abd' }));
    await llamar(a, enviar, buenEvento({ id_unico: 'abe' }), { ahora: AHORA + 20 * 60_000, marca: AHORA + 20 * 60_000 });
    expect(enviados).toHaveLength(1);
    expect(a.eventos.get('id-invalido-2026-11-07T15')!.nivel).toBe('urgente');
    const t = AHORA + HORA;
    await llamar(a, enviar, buenEvento({ id_unico: 'abf' }), { ahora: t, marca: t });
    expect([...a.eventos.keys()]).toContain('id-invalido-2026-11-07T16');
  });

  it('si la base falla al guardar el aviso bloqueado, el correo del bloqueo SALE igual (no se pierde la alerta)', async () => {
    const a: AlmacenMemoria = almacenEnMemoria();
    a.crear = async () => { throw new Error('base caída'); };
    const { enviados, enviar } = envioFalso();
    const r = await llamar(a, enviar, buenEvento({ que_paso: `falló ${TEL}` }));
    expect(r.status).toBe(422);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.idempotencia).toBe('novuchat:evt-0001-abcdef:bloqueado');
    expect(enviados[0]!.texto).not.toContain(TEL);
  });

  it('un campo fuera del contrato: 400 y, como proyecto e id son válidos, el aviso bloqueado nombra el campo «desconocido», no su nombre', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const r = await llamar(a, enviar, buenEvento({ [`tel_${TEL}`]: TEL }));
    expect(r.status).toBe(400);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.texto).toContain('desconocido (campo_no_permitido)');
    expect(enviados[0]!.texto).not.toContain(TEL);
  });
});

describe('detectores del ADR en TODOS los campos de texto (incluido asunto)', () => {
  const casos: Array<[string, string, string]> = [
    ['prefijo re_', `clave ${CLAVE_RESEND}`, 'secreto_posible'],
    ['Bearer', ['Bearer', 'abc'].join(' '), 'secreto_posible'],
    ['token de GitHub', ['gh', 'p_', 'x'].join(''), 'secreto_posible'],
    ['AWS', ['AK', 'IA', 'x'].join(''), 'secreto_posible'],
    ['Google', ['AI', 'za', 'x'].join(''), 'secreto_posible'],
    ['Slack', ['xo', 'xb'].join(''), 'secreto_posible'],
    ['Meta', ['EA', 'A', 'x'].join(''), 'secreto_posible'],
    ['JWT', ['ey', 'J', 'x'].join(''), 'secreto_posible'],
    ['llave privada', ['-----', 'BEGIN'].join(''), 'secreto_posible'],
    ['palabra de 32', 'a'.repeat(32), 'secreto_posible'],
    ['+ y dígito', '+5 llamadas', 'telefono_o_identificador'],
    ['7 dígitos', `id ${TEL_LOCAL.slice(0, 1)}${TEL_LOCAL.slice(1)}9`, 'telefono_o_identificador'],
    ['teléfono completo', TEL, 'telefono_o_identificador'],
    ['teléfono con +', TEL_CON_MAS, 'telefono_o_identificador'],
    ['teléfono con guion', `Cliente ${TEL_CON_GUION} sin respuesta`, 'telefono_con_separadores'],
    ['número aislado de 6', `código ${OTP}`, 'codigo_tipo_otp'],
    ['correo', CORREO, 'correo'],
    ['arroba suelta', 'a @ b', 'correo'],
    ['url', ['https', '://', 'x.test'].join(''), 'url_en_texto'],
    ['www', ['www', '.x.test'].join(''), 'url_en_texto'],
    ['IPv4', `host ${IP}`, 'url_en_texto'],
    ['localhost', 'en localhost', 'url_en_texto'],
    ['.internal', 'n8n.internal', 'url_en_texto'],
    ['.local', 'maquina.local', 'url_en_texto'],
  ];
  for (const campo of ['asunto', 'que_paso', 'que_se_espera_de_andres'] as const) {
    it(`${campo}: cada uno de los ${casos.length} detectores rechaza`, () => {
      for (const [nombre, texto, regla] of casos) {
        expect(violaciones(buenEvento({ [campo]: texto })), `${campo} / ${nombre}`).toContain(`${campo}:${regla}`);
      }
    });
  }
  it('también en flujo, nodo y tipo_error (campos estructurales): un dato personal se rechaza', () => {
    expect(violaciones(buenEvento({ flujo: TEL }))).toContain('flujo:telefono_o_identificador');
    expect(violaciones(buenEvento({ nodo: CORREO }))).toContain('nodo:correo');
    expect(violaciones(buenEvento({ tipo_error: `error_${TEL}` }))).toContain('tipo_error:telefono_o_identificador');
  });
  it('AVISOS_DENEGAR: cadenas del entorno se rechazan sin nombrar la cadena en la regla ni en la respuesta', async () => {
    const secreta = 'proyecto-ficticio-xyz';
    expect(violaciones(buenEvento({ que_paso: `falló en ${secreta}` }), { denegar: [secreta] })).toEqual(['que_paso:denegado_por_proyecto']);
    const a = almacenEnMemoria();
    const r = await llamar(a, null, buenEvento({ que_paso: `falló en ${secreta}` }), { denegar: [secreta] });
    expect(r.cuerpo).not.toContain(secreta);
    expect(JSON.stringify([...a.eventos.values()])).not.toContain(secreta);
  });
  it('lo legítimo pasa: fechas, horas, versiones, números de 4 cifras o menos, lo enmascarado', () => {
    const ok = 'Falló 3 veces el 2026-11-07 a las 10:30 con n8n 2.36.5 (v1.2); cliente ·1234; monto 1500';
    expect(violaciones(buenEvento({ que_paso: ok }))).toEqual([]);
  });
  it('detectar() es la función pura de las reglas: lista vacía para texto limpio', () => {
    expect(detectar('Error en el nodo de envío')).toEqual([]);
  });
});

describe('caracteres de control, bidi y ancho cero', () => {
  const malos = [['bidi', '\u202e'], ['ancho cero', '\u200b'], ['campana', '\u0007'], ['C1', '\u0085'], ['separador', '\u2028'], ['BOM', '\ufeff']];
  for (const campo of ['asunto', 'que_paso', 'que_se_espera_de_andres', 'flujo', 'nodo'] as const) {
    it(`${campo}: se rechazan con 422 caracter_control`, async () => {
      for (const [nombre, c] of malos) {
        expect(violaciones(buenEvento({ [campo]: `Texto${c}normal` })), `${campo} / ${nombre}`).toContain(`${campo}:caracter_control`);
      }
      const a = almacenEnMemoria();
      expect((await llamar(a, null, buenEvento({ [campo]: 'Texto\u202enormal' }))).status).toBe(422);
    });
  }
  it('un salto de línea solo se admite en que_paso', () => {
    expect(violaciones(buenEvento({ que_paso: 'Titular\nresto' }))).toEqual([]);
    expect(violaciones(buenEvento({ asunto: 'Dos\nlíneas' }))).toContain('asunto:caracter_control');
    expect(violaciones(buenEvento({ que_se_espera_de_andres: 'Dos\nlíneas' }))).toContain('que_se_espera_de_andres:caracter_control');
  });
});

describe('enlace: https, sin puerto/consulta/fragmento/IP, host EXACTO de la lista; se guarda el href normalizado', () => {
  it('rechaza lo que no cumple', () => {
    const malos = [
      'http://github.com/x', 'https://github.com:8443/x', 'https://github.com/x?a=1', 'https://github.com/x#frag', `https://${IP}/x`,
      'https://localhost/x', 'https://n8n.internal/x', 'https://otro.test/x', 'https://sub.github.com/x', 'https://github.com.malo.test/x',
      ['https://usuario:clave', '@github.com/x'].join(''), 'https://github.com/a b', 'https://github.com/a\\b', ['https://github.com/', '@x'].join(''),
      'docs/produccion/runbook.md', '/etc/passwd', 'javascript:alert(1)', `https://github.com/${'a'.repeat(300)}`, 'https://github.com/x\u202e',
    ];
    for (const m of malos) expect(enlaceNormalizado(m, HOSTS), m).toBeNull();
    for (const m of malos) expect(violaciones(buenEvento({ enlace: m })), m).toContain('enlace:enlace_no_permitido');
  });
  it('sin hosts configurados, ningún enlace pasa; null y ausente están permitidos', () => {
    expect(enlaceNormalizado(ENLACE, [])).toBeNull();
    expect(violaciones(buenEvento({ enlace: null }))).toEqual([]);
    expect(violaciones(sin(buenEvento(), 'enlace'))).toEqual([]);
    expect(validar(buenEvento({ enlace: null })).aviso.enlace).toBeNull();
  });
  it('acepta el del runbook y guarda u.href normalizado (host en minúsculas, mismo path)', () => {
    expect(enlaceNormalizado('https://GitHub.com/org/repo/blob/main/docs/runbook.md', HOSTS)).toBe(ENLACE);
    expect(validar(buenEvento()).aviso.enlace).toBe(ENLACE);
  });
});

describe('ocurrido_en e id_unico', () => {
  it('AAAA-MM-DDTHH:MM:SSZ sin fracciones ni desfase; no más de 10 min en el futuro ni 30 días en el pasado', () => {
    for (const mal of ['2026-11-07T14:59:00.000Z', '2026-11-07T14:59:00+00:00', '2026-11-07 14:59:00Z', '2026-11-07T14:59Z', '07/11/2026', '2026-13-45T25:61:61Z']) {
      expect(violaciones(buenEvento({ ocurrido_en: mal })), mal).toContain('ocurrido_en:forma');
    }
    const t = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;
    expect(violaciones(buenEvento({ ocurrido_en: t(AHORA + 11 * 60_000) }))).toEqual(['ocurrido_en:en_el_futuro']);
    expect(violaciones(buenEvento({ ocurrido_en: t(AHORA - 31 * 86_400_000) }))).toEqual(['ocurrido_en:muy_antiguo']);
    expect(violaciones(buenEvento({ ocurrido_en: t(AHORA + 9 * 60_000) }))).toEqual([]);
    expect(violaciones(buenEvento({ ocurrido_en: t(AHORA - 29 * 86_400_000) }))).toEqual([]);
  });
  it('id_unico: la forma del ADR; con forma de teléfono o de id de ejecución se rechaza', () => {
    expect(violaciones(buenEvento({ id_unico: 'envio:demo-a_x.1' }))).toEqual([]);
    for (const mal of ['abc', '-empieza-mal-1', 'con espacio 123', 'x'.repeat(121), `evt-${TEL}`, `ejec-${'1234'}${'5678'}`, `ev-${OTP}-x`, `+${TEL}`]) {
      expect(violaciones(buenEvento({ id_unico: mal })).filter((v) => v.startsWith('id_unico')), mal).not.toEqual([]);
    }
  });
});

describe('B2: una alerta no se pierde por un nombre largo o un símbolo raro', () => {
  const NOMBRE_REAL = 'NovuChat — Venta digital de Rubén (rroca-ruben, Noches Sin Insomnio)';
  it('un nombre real de 68 caracteres con raya, tilde y paréntesis pasa tal cual y sin marcar', () => {
    expect([...NOMBRE_REAL]).toHaveLength(68);
    const v = validar(buenEvento({ flujo: NOMBRE_REAL, nodo: 'Enviar respuesta (relé) · v2.36.5 - 07/11/2026' }));
    expect(v.flujo).toBe(NOMBRE_REAL);
    expect(v.saneado).toBe(false);
  });
  it('un nombre de 120 caracteres se recorta a 80 y se marca saneado; la alerta sale', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const largo = `Flujo ${'largo '.repeat(20)}`.trim();
    const r = await llamar(a, enviar, buenEvento({ flujo: largo, nodo: largo }));
    expect(r.status).toBe(200);
    const g = a.eventos.get('evt-0001-abcdef')!;
    expect([...g.flujo]).toHaveLength(80);
    expect([...g.nodo]).toHaveLength(80);
    expect(g.saneado).toBe(true);
    expect(enviados).toHaveLength(1);
  });
  it('un símbolo fuera de la lista (emoji, <, comillas dobles) se cambia por «_»; un control se rechaza', () => {
    const v = validar(buenEvento({ flujo: 'Flujo <b>negrita</b> "x" 🚀' }));
    expect(v.flujo).toBe('Flujo _b_negrita_/b_ _x_ _');
    expect(v.saneado).toBe(true);
    expect(violaciones(buenEvento({ flujo: 'Flujo\u200bX' }))).toContain('flujo:caracter_control');
  });
  it('el exceso de largo en asunto, expectativa, titular, líneas y total se RECORTA (no 422) y se marca saneado', async () => {
    const lineas = Array.from({ length: 40 }, (_, i) => `linea ${i} ${relleno(60)}`);
    const a = almacenEnMemoria(); const { enviar } = envioFalso();
    const r = await llamar(a, enviar, buenEvento({
      asunto: relleno(150), que_se_espera_de_andres: relleno(300), que_paso: [relleno(200), ...lineas].join('\n'),
    }));
    expect(r.status).toBe(200);
    const g = a.eventos.get('evt-0001-abcdef')!;
    expect([...g.asunto]).toHaveLength(100);
    expect([...g.que_se_espera_de_andres]).toHaveLength(180);
    expect([...g.que_paso.split('\n')[0]!]).toHaveLength(110);
    expect(g.que_paso.split('\n').length).toBeLessThanOrEqual(30);
    expect([...g.que_paso].length).toBeLessThanOrEqual(1500);
    expect(g.saneado).toBe(true);
  });
});

describe('niveles, topes, agrupado e idempotencia', () => {
  it('urgente y aviso salen; informativo NUNCA sale solo (va al resumen)', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento({ nivel: 'informativo' }))).cuerpo).toBe('en_resumen');
    expect((await llamar(a, enviar, buenEvento({ nivel: 'urgente', id_unico: 'evt-urg-0001', tipo_error: 't_urgente' }))).cuerpo).toBe('enviado');
    expect((await llamar(a, enviar, buenEvento({ nivel: 'aviso', id_unico: 'evt-avi-0001', tipo_error: 't_aviso' }))).cuerpo).toBe('enviado');
    expect(enviados).toHaveLength(2);
    expect(a.eventos.get('evt-0001-abcdef')!.estado).toBe('en_resumen');
  });

  it('1 correo inmediato por hora por tipo: el segundo del mismo tipo va al resumen, otro tipo sale, pasada la hora vuelve', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-a-0001-abcd' }))).cuerpo).toBe('enviado');
    const t30 = AHORA + 30 * 60_000;
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-a-0002-abcd' }), { ahora: t30, marca: t30 })).cuerpo).toBe('en_resumen');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-b-0001-abcd', tipo_error: 'otro_tipo' }))).cuerpo).toBe('enviado');
    expect(enviados).toHaveLength(2);
    const t61 = AHORA + 61 * 60_000;
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-a-0003-abcd' }), { ahora: t61, marca: t61 })).cuerpo).toBe('enviado');
  });

  const mandar = async (n: number, op: Op = {}) => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    for (let i = 0; i < n; i++) await llamar(a, enviar, buenEvento({ id_unico: `evt-tope-${i}-abcd`, tipo_error: `tipo_${i}` }), op);
    return { a, enviados };
  };

  it('tope por defecto 5/día (4 inmediatos + 1 del resumen); nada se pierde; un día nuevo lo reinicia', async () => {
    const { a, enviados } = await mandar(8);
    expect(enviados).toHaveLength(inmediatosDe(TOPE_DIARIO));
    expect(a.eventos.size).toBe(8);
    const manana = AHORA + 24 * HORA;
    expect((await llamar(a, envioFalso().enviar, buenEvento({ id_unico: 'evt-manana-001', tipo_error: 'tipo_9' }), { ahora: manana, marca: manana })).cuerpo).toBe('enviado');
  });

  it('el tope SALE DE LA CONFIGURACIÓN: 8 -> 7 inmediatos, 3 -> 2, 1 -> 0; no está fijo en el código', async () => {
    for (const [tope, esperados] of [[8, 7], [3, 2], [1, 0], [5, 4]] as const) {
      const { a, enviados } = await mandar(12, { tope });
      expect(enviados, `tope ${tope}`).toHaveLength(esperados);
      expect(a.eventos.size).toBe(12);
    }
  });

  it('MÁXIMO DURO 8: 9, 50 y 1000 no suben de 8; inválidos (texto, 0, negativo, decimal, null, NaN) valen 5', async () => {
    for (const v of [9, 50, 1000, Number.MAX_SAFE_INTEGER]) expect(topeValido(v), String(v)).toBe(TOPE_MAXIMO);
    for (const v of ['x', '8', 0, -3, 4.5, null, undefined, Number.NaN, {}, []]) expect(topeValido(v), String(v)).toBe(TOPE_DIARIO);
    expect([topeValido(1), topeValido(5), topeValido(8)]).toEqual([1, 5, 8]);
    // De punta a punta: una configuración de 50 NO deja pasar más de 7 inmediatos.
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    for (let i = 0; i < 20; i++) await llamar(a, enviar, buenEvento({ id_unico: `evt-max-${i}-abcd`, tipo_error: `tipo_${i}` }), { tope: topeValido(50) });
    expect(enviados).toHaveLength(7);
  });

  it('idempotencia: el mismo id_unico no se guarda ni se reenvía, aunque pase la hora', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento())).cuerpo).toBe('enviado');
    const t = AHORA + 2 * HORA;
    expect((await llamar(a, enviar, buenEvento(), { ahora: t, marca: t })).cuerpo).toBe('duplicado');
    expect(enviados).toHaveLength(1);
    expect(a.eventos.size).toBe(1);
    expect(enviados[0]!.idempotencia).toBe('novuchat:evt-0001-abcdef');
  });

  it('el envío falla: el evento NO se pierde, queda envio_fallido y el cupo y la hora del tipo no se gastan', async () => {
    const a = almacenEnMemoria();
    const r = await llamar(a, async () => { throw new Error('resend_500'); }, buenEvento());
    expect(r).toEqual({ status: 200, cuerpo: 'envio_fallido' });
    expect(a.eventos.get('evt-0001-abcdef')!.estado).toBe('envio_fallido');
    expect(a.dias.get(DIA)).toBe(0);
    expect(a.tipos.get('envio_incierto')).toBe(0);
    const { enviados, enviar } = envioFalso();
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-0002-abcdef' }))).cuerpo).toBe('enviado');
    expect(enviados).toHaveLength(1);
  });

  it('si liberar() falla tras un envío fallido, igual queda envio_fallido y no se responde 500', async () => {
    const a: AlmacenMemoria = almacenEnMemoria();
    a.liberar = async () => { throw new Error('base caída'); };
    const r = await llamar(a, async () => { throw new Error('resend_500'); }, buenEvento());
    expect(r).toEqual({ status: 200, cuerpo: 'envio_fallido' });
    expect(a.eventos.get('evt-0001-abcdef')!.estado).toBe('envio_fallido');
  });

  it('si el correo ya salió y poner(enviado) falla, se responde 200 «enviado» (no 500: n8n reintentaría)', async () => {
    const a: AlmacenMemoria = almacenEnMemoria();
    a.poner = async () => { throw new Error('base caída'); };
    const { enviados, enviar } = envioFalso();
    expect(await llamar(a, enviar, buenEvento())).toEqual({ status: 200, cuerpo: 'enviado' });
    expect(enviados).toHaveLength(1);
  });

  it('si reservar() lanza (contención), el evento queda guardado y va al resumen, sin 500 ni correo', async () => {
    const a: AlmacenMemoria = almacenEnMemoria();
    a.reservar = async () => { throw new Error('contención'); };
    const { enviados, enviar } = envioFalso();
    expect(await llamar(a, enviar, buenEvento())).toEqual({ status: 200, cuerpo: 'en_resumen' });
    expect(a.eventos.size).toBe(1);
    expect(enviados).toHaveLength(0);
  });

  it('sin dominio ni destinatario configurados guarda el evento y no envía', async () => {
    const a = almacenEnMemoria();
    expect((await llamar(a, null, buenEvento())).cuerpo).toBe('en_resumen');
    expect(a.eventos.size).toBe(1);
  });

  it('si la configuración no se puede leer, 500 sin detalle y nada guardado', async () => {
    const f = firmar(buenEvento());
    const r = await atenderAlerta(
      { metodo: 'POST', cabecera: (n) => f.cabeceras[n.toLowerCase()], crudo: f.crudo },
      { secreto: SECRETO, ahoraMs: AHORA, cargar: async () => { throw new Error(`detalle ${SECRETO}`); } });
    expect(r).toEqual({ status: 500, cuerpo: 'error' });
  });
});

describe('plantilla del correo (ADR-011 §2.2)', () => {
  it('asunto «[AAB1 NIVEL] novuchat · asunto» (≤150), nombre visible, ref y pie', () => {
    const e = armarCorreo(validar(buenEvento()).aviso);
    expect(e.asunto).toBe('[AAB1 URGENTE] novuchat · Envío incierto en un flujo');
    expect(e.nombreVisible).toBe('AAB1 avisos · novuchat');
    expect(e.idempotencia).toBe('novuchat:evt-0001-abcdef');
    expect(e.texto).toContain('ref novuchat:evt-0001-abcdef · contrato avisos-correo/v1');
    expect(e.texto).toContain('Aviso automático; responder a este correo no llega a nadie.');
    expect(e.texto).toContain('Las acciones las ejecuta Claude con la autorización de Andres.');
    expect(e.texto.split('\n')[0]).toBe('URGENTE · novuchat · 2026-11-07T14:59:00Z');
    expect(e.texto).toContain(`Enlace: ${ENLACE}`);
    expect(armarCorreo(validar(buenEvento({ enlace: null })).aviso).texto).not.toContain('Enlace:');
    expect(armarCorreo({ ...validar(buenEvento()).aviso, id_unico: 'resumen-2026-11-07' }).asunto).toContain('[AAB1 RESUMEN]');
    expect(armarCorreo({ ...validar(buenEvento()).aviso, asunto: relleno(100) }).asunto.length).toBeLessThanOrEqual(150);
  });

  it('los primeros 400 caracteres llevan nivel, expectativa completa y titular, con todo al máximo', () => {
    const v = validar(buenEvento({
      asunto: relleno(100), que_se_espera_de_andres: relleno(180),
      que_paso: [relleno(110), ...Array.from({ length: 29 }, () => relleno(45))].join('\n'),
    }));
    const t = armarCorreo(v.aviso).texto;
    const cabeza = t.slice(0, 400);
    expect(cabeza).toContain('URGENTE');
    expect(cabeza).toContain('novuchat');
    expect(cabeza).toContain(`Qué se espera de Andres: ${relleno(180)}`);
    expect(cabeza).toContain(`Qué pasó: ${relleno(110)}`);
    expect(t).not.toMatch(/\b(tenés|querés|podés|revisá|vos)\b/i);
  });

  it('el html es el mismo texto dentro de <pre>, con escape', () => {
    const e = armarCorreo({ ...validar(buenEvento()).aviso, que_paso: 'Con <b>&</b> "x"' });
    expect(e.html.startsWith('<pre>')).toBe(true);
    expect(e.html).not.toContain('<b>');
    expect(e.html).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
  });
});

describe('resumen: solo si hay eventos sin resumir; cada evento incluido se marca (sin ventanas de tiempo)', () => {
  const guardar = async (a: AlmacenAlertas, id: string, recibido: number, extra: Record<string, unknown> = {}) =>
    a.crear(eventoGuardado(id, { recibido_ms: recibido, ocurrido_ms: recibido, ...extra }));

  it('con 0 eventos NO se envía nada (el latido es de la vigía de FinOps)', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect(await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA })).toEqual({ eventos: 0, enviado: false });
    expect(enviados).toHaveLength(0);
  });

  it('con eventos sale, con idempotencia propia del día, asunto RESUMEN y sin «0 errores»; los marca resumidos', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    await guardar(a, 'evt-r-0001-abcd', AHORA - HORA);
    await guardar(a, 'evt-r-0002-abcd', AHORA - 2 * HORA, { tipo_error: 'otro_tipo', estado: 'enviado' });
    const r = await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA });
    expect(r).toEqual({ eventos: 2, enviado: true });
    expect(enviados[0]!.asunto).toContain('[AAB1 RESUMEN]');
    expect(enviados[0]!.idempotencia).toBe('novuchat:resumen-2026-11-07');
    expect(enviados[0]!.texto).toContain('2 avisos desde el último resumen');
    expect(enviados[0]!.texto).toContain('- otro_tipo: 1');
    expect(enviados[0]!.texto).not.toContain('0 errores');
    expect([...a.eventos.values()].every((e) => e.resumido_en === AHORA)).toBe(true);
    // Una segunda corrida no repite lo ya resumido.
    expect(await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA + 1000 })).toEqual({ eventos: 0, enviado: false });
    expect(enviados).toHaveLength(1);
  });

  it('LA CARRERA: un evento que llega mientras el resumen se envía NO se pierde ni se marca; va en el siguiente', async () => {
    const a = almacenEnMemoria(); const { enviados } = envioFalso();
    await guardar(a, 'evt-c-0001-abcd', AHORA - HORA);
    const enviar: Enviar = async (e) => { enviados.push(e); await guardar(a, 'evt-c-0002-abcd', AHORA); };
    await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA });
    expect(a.eventos.get('evt-c-0001-abcd')!.resumido_en).toBe(AHORA);
    expect(a.eventos.get('evt-c-0002-abcd')!.resumido_en).toBeNull();
    // El mismo día NO sale otro resumen (la lista del día ya está resumida): C espera al día siguiente.
    expect(await enviarResumenDiario({ almacen: a, enviar: async (e) => { enviados.push(e); }, ahoraMs: AHORA + 1000 })).toEqual({ eventos: 0, enviado: false });
    expect(a.eventos.get('evt-c-0002-abcd')!.resumido_en).toBeNull();
    const manana = AHORA + 24 * HORA;
    await enviarResumenDiario({ almacen: a, enviar: async (e) => { enviados.push(e); }, ahoraMs: manana });
    expect(enviados).toHaveLength(2);
    expect(enviados[1]!.texto).toContain('1 aviso desde');
    expect(a.eventos.get('evt-c-0002-abcd')!.resumido_en).toBe(manana);
  });

  it('el envío del resumen falla: lanza (el programador reintenta) y NADA se marca', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-f-0001-abcd', AHORA - HORA);
    await expect(enviarResumenDiario({ almacen: a, enviar: async () => { throw new Error('resend_503'); }, ahoraMs: AHORA })).rejects.toThrow('resend_503');
    expect(a.eventos.get('evt-f-0001-abcd')!.resumido_en).toBeNull();
    // El reintento vuelve a juntar el mismo evento.
    const { enviados, enviar } = envioFalso();
    expect((await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA + 1000 })).enviado).toBe(true);
    expect(enviados).toHaveLength(1);
  });

  it('500 o más: el titular dice «500 o más» y el texto cabe en el contrato (≤30 líneas, ≤1500)', () => {
    const muchos = Array.from({ length: 500 }, (_, i) => eventoGuardado(`evt-x-${String(i).padStart(6, '0')}`, { tipo_error: `tipo_${i % 40}` }));
    const e = armarResumen(muchos, AHORA);
    expect(e.texto).toContain('500 o más avisos desde el último resumen');
    const paso = e.texto.split('\n').slice(2, e.texto.split('\n').indexOf(''));
    expect(paso.length).toBeLessThanOrEqual(30);
    expect(paso.join('\n').length).toBeLessThanOrEqual(1500);
  });

  it('sin configuración de envío no sale ni se marca nada', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-s-0001-abcd', AHORA - HORA);
    expect(await enviarResumenDiario({ almacen: a, enviar: null, ahoraMs: AHORA })).toEqual({ eventos: 1, enviado: false });
    expect(a.eventos.get('evt-s-0001-abcd')!.resumido_en).toBeNull();
  });

  it('con la cuota de Resend agotada el resumen no llama a Resend ni marca; pasada la medianoche UTC sale', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    await guardar(a, 'evt-q-0001-abcd', AHORA - HORA);
    a.cuota.hasta = Date.parse('2026-11-08T00:00:00Z');
    expect(await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA })).toEqual({ eventos: 1, enviado: false });
    expect(enviados).toHaveLength(0);
    expect((await enviarResumenDiario({ almacen: a, enviar, ahoraMs: Date.parse('2026-11-08T00:00:01Z') })).enviado).toBe(true);
  });
});

describe('Resend: Idempotency-Key, reintentos y errores', () => {
  const envio = (): Envio => armarCorreo(validar(buenEvento()).aviso);
  const respuesta = (estado: number, nombre = ''): Response => new Response(JSON.stringify(nombre ? { name: nombre } : {}), { status: estado });
  const con = async (respuestas: Array<Response | Error>, esperas: number[] = []) => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => { const r = respuestas.shift()!; if (r instanceof Error) throw r; return r; });
    vi.stubGlobal('fetch', f);
    const enviar = enviarPorResend(CLAVE_RESEND, REMITE, DEST, async (ms) => { esperas.push(ms); });
    return { f, enviar, esperas };
  };
  const intentar = async (respuestas: Array<Response | Error>) => {
    const esperas: number[] = [];
    const { f, enviar } = await con(respuestas, esperas);
    let error: Error | null = null;
    try { await enviar(envio()); } catch (e) { error = e as Error; } finally { vi.unstubAllGlobals(); }
    return { f, esperas, error };
  };

  it('Idempotency-Key = novuchat:<id_unico>, la clave solo en Authorization, from con nombre visible, html y texto', async () => {
    const { f, enviar } = await con([respuesta(200)]);
    try { await enviar(envio()); } finally { vi.unstubAllGlobals(); }
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const h = init.headers as Record<string, string>;
    expect(h['Idempotency-Key']).toBe('novuchat:evt-0001-abcdef');
    expect(h['Authorization']).toBe(`Bearer ${CLAVE_RESEND}`);
    const cuerpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(cuerpo['from']).toBe(`AAB1 avisos · novuchat <${REMITE}>`);
    expect(cuerpo['to']).toEqual([DEST]);
    expect(typeof cuerpo['html']).toBe('string');
    expect(String(init.body)).not.toContain(CLAVE_RESEND);
  });

  it('red caída o 5xx: hasta 3 intentos con esperas de 1 s y 4 s, la MISMA clave y los mismos bytes', async () => {
    const r = await intentar([new Error('red'), respuesta(503), respuesta(200)]);
    expect(r.error).toBeNull();
    expect(r.f).toHaveBeenCalledTimes(3);
    expect(r.esperas).toEqual([1000, 4000]);
    const claves = r.f.mock.calls.map(([, i]) => (i.headers as Record<string, string>)['Idempotency-Key']);
    expect(new Set(claves).size).toBe(1);
    expect(new Set(r.f.mock.calls.map(([, i]) => String(i.body))).size).toBe(1);
  });

  it('tres fallos seguidos: se agota y lanza un código fijo sin la respuesta ni la clave', async () => {
    const r = await intentar([respuesta(500), respuesta(500), respuesta(500)]);
    expect(r.f).toHaveBeenCalledTimes(3);
    expect(r.error!.message).toBe('resend_agotado_500');
    expect(r.error!.message).not.toContain(CLAVE_RESEND);
  });

  it('un 4xx NUNCA se reintenta (400, 401, 403, 422): una sola llamada', async () => {
    for (const estado of [400, 401, 403, 422]) {
      const r = await intentar([respuesta(estado, 'validation_error'), respuesta(200)]);
      expect(r.f, String(estado)).toHaveBeenCalledTimes(1);
      expect(r.error!.message).toBe(`resend_${estado}`);
      expect(r.esperas).toEqual([]);
    }
  });

  it('daily_quota_exceeded y monthly_quota_exceeded: sin reintento', async () => {
    for (const nombre of ['daily_quota_exceeded', 'monthly_quota_exceeded']) {
      const r = await intentar([respuesta(429, nombre), respuesta(200)]);
      expect(r.f, nombre).toHaveBeenCalledTimes(1);
      expect(r.error!.message).toBe('resend_cuota');
    }
  });

  it('429 de frecuencia y 409 concurrente se reintentan; 409 invalid_idempotent_request = ya enviado', async () => {
    expect((await intentar([respuesta(429, 'rate_limit_exceeded'), respuesta(200)])).f).toHaveBeenCalledTimes(2);
    expect((await intentar([respuesta(409, 'concurrent_idempotent_requests'), respuesta(200)])).f).toHaveBeenCalledTimes(2);
    const r = await intentar([respuesta(409, 'invalid_idempotent_request')]);
    expect(r.error).toBeNull();
    expect(r.f).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// TERCERA RONDA: despliegue, detectores sobre enlace/id/Unicode, tope y día UTC, cuota, menores
// ---------------------------------------------------------------------------
const cp = (...codigos: number[]): string => String.fromCodePoint(...codigos);
const NBSP = cp(0xa0);

describe('enlace: la ruta también es contenido (decodificada, con los detectores)', () => {
  const base = 'https://github.com';
  it('un secreto, un correo, 7+ cifras o una cadena denegada escondidos en la ruta (también codificados) se rechazan', () => {
    const casos: Array<[string, string, string]> = [
      ['palabra de 32+', `${base}/org/repo/blob/${'a1'.repeat(16)}/x.md`, 'secreto_posible'],
      ['prefijo de secreto', `${base}/org/repo/${['gh', 'p_', 'abc'].join('')}`, 'secreto_posible'],
      ['correo codificado', `${base}/org/repo/${['juan', '%40', 'correo.test'].join('')}`, 'correo'],
      ['correo en la ruta', `${base}/org/repo/${['juan', '%40', 'x'].join('')}`, 'correo'],
      ['teléfono en la ruta', `${base}/org/repo/issues/${TEL}`, 'telefono_o_identificador'],
      ['teléfono codificado', `${base}/org/repo/${TEL.split('').map((c) => `%3${c}`).join('')}`, 'telefono_o_identificador'],
      ['denegado', `${base}/org/proyecto-ficticio-xyz/x`, 'denegado_por_proyecto'],
    ];
    for (const [nombre, url, regla] of casos) {
      const r = (() => { try { validar(buenEvento({ enlace: url }), { denegar: ['proyecto-ficticio-xyz'] }); return []; } catch (e) { return (e as ErrorContrato).violaciones.map((v) => `${v.campo}:${v.regla}`); } })();
      expect(r, nombre).toContain(`enlace:${regla}`);
    }
  });
  it('control invisible decodificado o %-secuencia rota: se rechaza', () => {
    expect(violaciones(buenEvento({ enlace: `${base}/org/repo/x%E2%80%AEy` }))).toContain('enlace:caracter_control');
    expect(violaciones(buenEvento({ enlace: `${base}/org/repo/%E0%A4%A` }))).toContain('enlace:enlace_no_permitido');
  });
  it('Actions: SIN enlaceRepos (defecto) un enlace de ejecución se rechaza; con el repo en la lista cerrada pasa, y solo los ids numéricos se tapan', () => {
    const run = `${base}/org/repo/actions/runs/${'9'.repeat(10)}`;
    const job = `${run}/job/${'8'.repeat(11)}`;
    expect(violaciones(buenEvento({ enlace: run }))).toContain('enlace:telefono_o_identificador');
    const con = (e: string): string[] => {
      try { validarEntrada(buenEvento({ enlace: e }), { hosts: HOSTS, denegar: [], ahoraMs: AHORA, repos: ['org/repo'] }); return []; }
      catch (x) { return (x as ErrorContrato).violaciones.map((v) => `${v.campo}:${v.regla}`); }
    };
    expect(con(run)).toEqual([]);
    expect(con(job)).toEqual([]);
    expect(con(`${base}/ORG/Repo/actions/runs/${'9'.repeat(8)}`)).toEqual([]);              // mayúsculas y 8 cifras
    // Ids fuera de 8 a 12 cifras, o de otro repo, o con otra ruta detrás: se rechazan.
    expect(con(`${base}/org/repo/actions/runs/${'9'.repeat(13)}`)).toContain('enlace:telefono_o_identificador');
    expect(con(`${base}/org/repo/actions/runs/${'9'.repeat(10)}/otra`)).toContain('enlace:telefono_o_identificador');
    expect(con(`${base}/org/otro/actions/runs/${'9'.repeat(10)}`)).toContain('enlace:telefono_o_identificador');
    expect(con(`${base}/org/repo/pull/${'9'.repeat(10)}`)).toContain('enlace:telefono_o_identificador');
  });
  it('Actions: un teléfono en el dueño, en el repo o en el run NO se cuela por la exención', () => {
    const con = (e: string): string[] => {
      try { validarEntrada(buenEvento({ enlace: e }), { hosts: HOSTS, denegar: [], ahoraMs: AHORA, repos: ['org/repo', `${TEL}/NovuChat`, '+591-712-34567/a'] }); return []; }
      catch (x) { return (x as ErrorContrato).violaciones.map((v) => `${v.campo}:${v.regla}`); }
    };
    // Aunque el repo esté en la lista, el dueño o el repo con un teléfono pasan por los detectores completos.
    expect(con(`${base}/${TEL}/NovuChat/actions/runs/123456789`)).toContain('enlace:telefono_o_identificador');
    expect(con(`${base}/a/${['+591', '712', '34567'].join('-')}/actions/runs/123456789`)).not.toEqual([]);
    expect(con(`${base}/${['+591', '712', '34567'].join('-')}/a/actions/runs/123456789`)).not.toEqual([]);
    // Sin lista: el mismo caso de la revisión.
    expect(violaciones(buenEvento({ enlace: `${base}/${TEL}/NovuChat/actions/runs/123` }))).toContain('enlace:telefono_o_identificador');
    expect(violaciones(buenEvento({ enlace: `${base}/a/${['+591', '712', '34567'].join('-')}/actions/runs/123` }))).not.toEqual([]);
    // Un run con teléfono escrito con separadores no es un id numérico de 8 a 12 cifras.
    expect(con(`${base}/org/repo/actions/runs/${['591', '7123', '4567'].join('-')}`)).not.toEqual([]);
  });
  it('un nombre largo con guiones en el runbook NO se toma por secreto', () => {
    expect(violaciones(buenEvento({ enlace: `${base}/org/repo/blob/main/docs/produccion/timbre-salida-de-persona-clientes-reales.md` }))).toEqual([]);
  });
});

describe('id_unico: TODOS los detectores; una coincidencia = sin aviso :bloqueado y 4xx', () => {
  const malos: Array<[string, string]> = [
    ['prefijo de secreto', ['evt', 'AK' + 'IA', 'x1234'].join('-')],
    ['32+ alfanuméricos sin guiones', `evt-${'a1'.repeat(16)}`],
    ['IPv4', `ip-${IP}-abcd`],
    ['localhost', 'evt-localhost-abcd'],
    ['.internal', 'evt-n8n.internal-ab'],
    ['.local', 'evt-maquina.local-ab'],
    ['dominio sin esquema', 'evt-sitio.com-abcd'],
    ['denegado', 'evt-proyecto-ficticio-xyz-1'],
    ['teléfono', `evt-${TEL}`],
    ['número de 6', `evt-${OTP}-x`],
  ];
  for (const [nombre, id] of malos) {
    it(`${nombre}: rechazado, 4xx, y el aviso sale con un id del servidor (nunca con el del llamador)`, async () => {
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      const r = await llamar(a, enviar, buenEvento({ id_unico: id }), { denegar: ['proyecto-ficticio-xyz'] });
      expect(r.status, nombre).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(enviados, nombre).toHaveLength(1);
      expect(enviados[0]!.idempotencia).toBe('novuchat:id-invalido-2026-11-07T15');
      expect(JSON.stringify([enviados, [...a.eventos.keys()]])).not.toContain(id);
    });
  }
  it('un id largo CON guiones y legítimo pasa (no es una palabra de 32 alfanuméricos)', () => {
    expect(violaciones(buenEvento({ id_unico: 'novuchat-envio-incierto-demo-a-0001-abcd' }))).toEqual([]);
  });
  it('resumen- es del resumen propio: un emisor externo no puede usar ese prefijo', async () => {
    expect(violaciones(buenEvento({ id_unico: 'resumen-2026-11-07' }))).toContain('id_unico:forma');
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const r = await llamar(a, enviar, buenEvento({ id_unico: 'resumen-2026-11-07' }));
    expect(r.status).toBe(400);
    expect(enviados).toHaveLength(1);                          // sale el aviso del servidor, no el del llamador
    expect(enviados[0]!.idempotencia).toBe('novuchat:id-invalido-2026-11-07T15');
  });
  it('<id>:bloqueado nunca pasa de 120: con id de 108 sale con su id; con 109 o más, con el del servidor', async () => {
    const id = (n: number): string => `evt-${'ab-'.repeat(60)}`.slice(0, n - 1) + '1';
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const r108 = await llamar(a, enviar, buenEvento({ id_unico: id(108), que_paso: `falló ${TEL}` }));
    expect(r108.status).toBe(422);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.idempotencia.length).toBeLessThanOrEqual('novuchat:'.length + 120);
    expect([...a.eventos.keys()][0]!.length).toBeLessThanOrEqual(120);
    const b = almacenEnMemoria(); const { enviados: e2, enviar: s2 } = envioFalso();
    const r109 = await llamar(b, s2, buenEvento({ id_unico: id(109), que_paso: `falló ${TEL}` }));
    expect(r109.status).toBe(422);
    expect(e2).toHaveLength(1);                                 // sin `<id>:bloqueado` (pasaría de 120): sale el del servidor
    expect(e2[0]!.idempotencia).toBe('novuchat:id-invalido-2026-11-07T15');
    expect([...b.eventos.keys()]).toEqual(['id-invalido-2026-11-07T15']);
  });
});

describe('Unicode: normalización NFKC, dígitos de cualquier escritura, invisibles y dominios sin esquema', () => {
  it('teléfono con cifras de ancho completo, arábigo-índicas, NBSP, paréntesis y guiones intercalados', () => {
    const ancho = [...TEL].map((c) => cp(0xff10 + Number(c))).join('');
    const arabe = [...TEL_LOCAL.slice(0, 7)].map((c) => cp(0x660 + Number(c))).join('');
    const casos = [
      ancho, arabe, `712${NBSP}34567`, `(591) 7${NBSP}123${NBSP}4567`, '712 - 34567', `71-23-45-67-8`, `+${NBSP}591`.replace('591', '7'),
      `7.1.2.3.4.5.6`,
    ];
    for (const c of casos) {
      const r = violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` }));
      expect(r.some((x) => /telefono_/.test(x)), JSON.stringify(c)).toBe(true);
    }
    // Lo legítimo sigue pasando: fecha ISO, hora, versión y números sueltos pequeños.
    expect(violaciones(buenEvento({ que_paso: 'Pasó el 2026-11-07T14:59:00Z con v2.36.5, 3 de 4 intentos y 12 mensajes' }))).toEqual([]);
  });
  it('NFKC: la arroba, el «+», el prefijo de un secreto y «www.» de ancho completo se ven igual que los normales', () => {
    const ancho = (t: string): string => [...t].map((c) => cp(c.charCodeAt(0) + 0xfee0)).join('');
    expect(violaciones(buenEvento({ que_paso: `escribió juan${ancho('@')}correo` }))).toContain('que_paso:correo');
    expect(violaciones(buenEvento({ que_paso: `clave ${ancho('AKIA')}x` }))).toContain('que_paso:secreto_posible');
    expect(violaciones(buenEvento({ que_paso: `en ${ancho('www')}.sitio` }))).toContain('que_paso:url_en_texto');
    expect(violaciones(buenEvento({ que_paso: `llamar al ${ancho('+')}5` }))).toContain('que_paso:telefono_o_identificador');
  });
  it('caracteres invisibles (Cf, rellenos de Hangul, VS, CGJ, ALM, etiquetas) se rechazan en todo campo', () => {
    const invisibles = [0x2060, 0x200d, 0x115f, 0x1160, 0x3164, 0xffa0, 0x180e, 0x034f, 0x061c, 0xe0041, 0xad, 0x2066];
    for (const campo of ['asunto', 'que_paso', 'que_se_espera_de_andres', 'flujo', 'nodo']) {
      for (const c of invisibles) {
        expect(violaciones(buenEvento({ [campo]: `Texto${cp(c)}normal` })), `${campo} U+${c.toString(16)}`).toContain(`${campo}:caracter_control`);
      }
    }
  });
  it('dominios sin esquema se rechazan; las palabras con punto que no son dominio, no', () => {
    for (const d of ['ejemplo.com', 'sitio.bo', 'x.io', 'mi-app.dev', 'otro.website', 'a.org', 'b.net', 'c.site', 'd.app', 'e.test']) {
      expect(violaciones(buenEvento({ que_paso: `falló en ${d}` })), d).toContain('que_paso:url_en_texto');
    }
    expect(violaciones(buenEvento({ que_paso: 'Falló el nodo n8n. Revisar luego.' }))).toEqual([]);
  });
});

describe('menores: tab, CRLF, ¿?, bloqueado y tipo_error', () => {
  it('en que_paso un tab pasa a espacio y CRLF a LF; cualquier otro control se rechaza', () => {
    const v = validar(buenEvento({ que_paso: 'Titular\tcon tab\r\nsegunda línea' }));
    expect(v.aviso.que_paso).toBe('Titular con tab\nsegunda línea');
    expect(violaciones(buenEvento({ que_paso: 'Titular\rsuelto' }))).toContain('que_paso:caracter_control');
    expect(violaciones(buenEvento({ que_paso: `Titular${cp(7)}x` }))).toContain('que_paso:caracter_control');
    // En una sola línea el tab sigue siendo un control.
    expect(violaciones(buenEvento({ asunto: 'Con\ttab' }))).toContain('asunto:caracter_control');
  });
  it('flujo y nodo admiten ¿ y ? (nombres reales de nodos) sin cambiarlos', () => {
    const v = validar(buenEvento({ nodo: '¿Hay stock?', flujo: '¿Cómo va? (demo)' }));
    expect([v.nodo, v.flujo, v.saneado]).toEqual(['¿Hay stock?', '¿Cómo va? (demo)', false]);
  });
  it('tipo_error: una lista cerrada de minúsculas; uno de 40 caracteres pasa (sin la regla de palabra larga) y un secreto no', () => {
    const largo = 'error_envio_incierto_flujo_demo_a_n8n_x1';
    expect(largo).toHaveLength(40);
    expect(violaciones(buenEvento({ tipo_error: largo }))).toEqual([]);
    expect(violaciones(buenEvento({ tipo_error: `error_${TEL}` }))).toContain('tipo_error:telefono_o_identificador');
    expect(violaciones(buenEvento({ tipo_error: ['re', '_', 'abc'].join('') }))).toContain('tipo_error:secreto_posible');
    // En un texto libre la palabra larga SÍ se rechaza.
    expect(violaciones(buenEvento({ que_paso: largo }))).toContain('que_paso:secreto_posible');
  });
});

describe('tope: validado dentro del procesamiento, y por día UTC', () => {
  it('con deps.tope = 50 o 1000 (sin pasar por la configuración) salen 7 como máximo; el resumen es aparte', async () => {
    for (const tope of [50, 1000, 9]) {
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      for (let i = 0; i < 20; i++) await llamar(a, enviar, buenEvento({ id_unico: `evt-ia-${i}-abcd`, tipo_error: `tipo_${i}` }), { tope });
      expect(enviados, `tope ${tope}`).toHaveLength(7);
      expect(a.eventos.size).toBe(20);
    }
  });
  it('el contador es por día UTC: a las 03:59Z y 04:01Z (antes y después de la medianoche de La Paz) cuentan en el MISMO día', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const t1 = Date.parse('2026-11-08T03:59:00Z'); const t2 = Date.parse('2026-11-08T04:01:00Z');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-d1-0001-abcd', tipo_error: 'tipo_a' }), { tope: 2, ahora: t1, marca: t1 })).cuerpo).toBe('enviado');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-d2-0001-abcd', tipo_error: 'tipo_b' }), { tope: 2, ahora: t2, marca: t2 })).cuerpo).toBe('en_resumen');
    expect(enviados).toHaveLength(1);
    expect([...a.dias.keys()]).toEqual(['2026-11-08']);
    // Cruzar la medianoche UTC SÍ reinicia el cupo.
    const t3 = Date.parse('2026-11-09T00:01:00Z');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-d3-0001-abcd', tipo_error: 'tipo_c' }), { tope: 2, ahora: t3, marca: t3 })).cuerpo).toBe('enviado');
  });
});

describe('cuota de Resend agotada: no se vuelve a llamar hasta las 00:00 UTC', () => {
  it('resend_cuota marca la cuota; los eventos siguientes van al resumen SIN llamar a Resend; tras la medianoche UTC se reanuda', async () => {
    const a = almacenEnMemoria();
    let llamadas = 0; let falla = true;
    const enviar: Enviar = async () => { llamadas++; if (falla) throw new Error('resend_cuota'); };
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-q1-0001-abcd', tipo_error: 'tipo_a' }))).cuerpo).toBe('envio_fallido');
    expect(a.cuota.hasta).toBe(Date.parse('2026-11-08T00:00:00Z'));   // literal: no se compara el código contra sí mismo
    expect(a.dias.get(diaUtc(AHORA))).toBe(0);                                   // no gastó cupo
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-q2-0001-abcd', tipo_error: 'tipo_b' }))).cuerpo).toBe('en_resumen');
    expect(llamadas).toBe(1);                                                    // el segundo ni siquiera llamó
    falla = false;
    const manana = Date.parse('2026-11-08T00:01:00Z');
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'evt-q3-0001-abcd', tipo_error: 'tipo_c' }), { ahora: manana, marca: manana })).cuerpo).toBe('enviado');
    expect(llamadas).toBe(2);
  });
  it('otros errores de Resend (5xx, 4xx) NO marcan la cuota', async () => {
    const a = almacenEnMemoria();
    await llamar(a, async () => { throw new Error('resend_500'); }, buenEvento());
    expect(a.cuota.hasta).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CUARTA RONDA: teléfonos con separadores, ids con hora ISO, resumen con lista fija y 409
// ---------------------------------------------------------------------------
describe('teléfonos escritos con cualquier separador (fechas ISO y versiones reales siguen pasando)', () => {
  it('7123-45-67, 71.234.567, 7123–4567 (guion largo), 7123/4567, 7123_4567, 71,23,45,67 y evt:591:7123:4567 se rechazan', () => {
    const casos = [
      '7123-45-67', '71.234.567', `7123${cp(0x2013)}4567`, `7123${cp(0x2014)}4567`, `7123${cp(0x2011)}4567`, '7123/4567', '7123_4567',
      '71,23,45,67', 'evt:591:7123:4567', '(591) 7123-4567', '591.7123.4567',
    ];
    for (const c of casos) {
      const r = violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` }));
      expect(r.some((x) => /telefono_/.test(x)), JSON.stringify(c)).toBe(true);
    }
  });
  it('un teléfono NO se disfraza de fecha ni de versión: años implausibles y versiones de dos dígitos mayores se miran', () => {
    for (const c of ['7123-45-67', '5917-12-34', '1234-56-78', '71.234.56', '2026-11-07-1234567', '12.345.678']) {
      expect(violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
  });
  it('id_unico: 7 o más cifras en TOTAL se rechazan aunque estén separadas por letras o dos puntos; una hora ISO no cuenta', () => {
    for (const id of ['evt:591:7123:4567', 'evt-591a7123b4567', 'ejec-1234-5678-x', `evt-${cp(0x661)}${cp(0x662)}${cp(0x663)}${cp(0x664)}${cp(0x665)}${cp(0x666)}${cp(0x667)}`]) {
      expect(violaciones(buenEvento({ id_unico: id })).some((x) => x.startsWith('id_unico')), id).toBe(true);
    }
    for (const id of ['envio-demo-a:2026-11-07T16:55:00Z', 'oci-limites:2026-11-07T16:55:00Z', 'envio:flujo-x:2026-11-07T16']) {
      expect(violaciones(buenEvento({ id_unico: id })), id).toEqual([]);
    }
    // Un epoch o un hex largo NO son una hora ISO.
    expect(violaciones(buenEvento({ id_unico: 'envio-1731000000' })).some((x) => x.startsWith('id_unico'))).toBe(true);
    expect(violaciones(buenEvento({ id_unico: `envio-${'a1b2c3d4'.repeat(4)}` })).some((x) => x.startsWith('id_unico'))).toBe(true);
  });
  it('los nombres reales de Flujos/ (con 2.º, (24 h), v0, 3727, 17:00, (200), 401…) siguen pasando como flujo y como nodo', () => {
    const nombres = [
      'Aceptar (200)', 'Rechazar (401)', 'Cada 10 minutos', 'Cada 5 minutos', 'Chat NovuChat v2 (Kenji)',
      'Comprometer evento (2.º intento)', 'NovuChat Bellido — Recordatorio de citas (24 h)', 'NovuChat — Agenda mínima (v0, prueba)',
      "NovuChat — Venta mínima (v0) — Q'Taco", 'NovuChat — Venta mínima (v0) — QTaco 3727', 'NovuChat — Rescate 22 h (rroca-ruben)',
      'Todos los días 17:00 (apagado en la prueba)', '¿Comprometer evento? (3.º)', '¿Conflicto al registrar? (2.º)',
      'Enviar respuesta (relé) · v2.36.5 - 2026-11-07', 'Replanificar registro (2.º)',
    ];
    for (const n of nombres) {
      const v = violaciones(buenEvento({ flujo: n, nodo: n }));
      expect(v, n).toEqual([]);
    }
  });
});

describe('resumen: lista fija del día, reintento idéntico y el 409', () => {
  const guardar = async (a: AlmacenAlertas, id: string, recibido: number) =>
    a.crear(eventoGuardado(id, { recibido_ms: recibido, ocurrido_ms: recibido }));

  it('la lista de ids se guarda ANTES de enviar', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-l-0001-abcd', AHORA - HORA);
    let visto: unknown = 'no-llamado';
    await enviarResumenDiario({ almacen: a, enviar: async () => { visto = await a.resumenDelDia('2026-11-07'); }, ahoraMs: AHORA });
    expect(visto).toEqual({ ids: ['evt-l-0001-abcd'], ahoraMs: AHORA });
  });

  it('falla marcar, llega C, el reintento reusa la lista y Resend contesta 409: C SIGUE pendiente y el cuerpo fue idéntico', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-k-0001-abcd', AHORA - 2 * HORA);
    await guardar(a, 'evt-k-0002-abcd', AHORA - HORA);
    const cuerpos: string[] = [];
    const enviar: Enviar = async (e) => { cuerpos.push(`${e.asunto}|${e.idempotencia}|${e.texto}`); };
    // 1.er intento: el envío sale, pero marcar falla (la base cae).
    const marcarReal = a.marcarResumidos.bind(a);
    a.marcarResumidos = async () => { throw new Error('base caída'); };
    await expect(enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA })).rejects.toThrow('base caída');
    expect([...a.eventos.values()].every((e) => e.resumido_en === null)).toBe(true);
    // Llega C entre los dos intentos.
    await guardar(a, 'evt-k-0003-abcd', AHORA + 30_000);
    a.marcarResumidos = marcarReal;
    // Reintento (minutos después): Resend contesta 409 invalid_idempotent_request si el cuerpo difiere; aquí es el mismo.
    const r = await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA + 120_000 });
    expect(r).toEqual({ eventos: 2, enviado: true });
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[1]).toBe(cuerpos[0]);                                            // EXACTAMENTE el mismo cuerpo
    expect(a.eventos.get('evt-k-0001-abcd')!.resumido_en).toBe(AHORA + 120_000);
    expect(a.eventos.get('evt-k-0002-abcd')!.resumido_en).toBe(AHORA + 120_000);
    expect(a.eventos.get('evt-k-0003-abcd')!.resumido_en).toBeNull();               // C no se marcó sin haberse enviado
    // El mismo día no sale otro resumen; al día siguiente C va solo.
    expect((await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA + 180_000 })).enviado).toBe(false);
    expect((await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA + 24 * HORA })).eventos).toBe(1);
    expect(a.eventos.get('evt-k-0003-abcd')!.resumido_en).toBe(AHORA + 24 * HORA);
  });

  it('con Resend de verdad: si el reintento trae otro cuerpo habría 409 «ya enviado»; con la lista fija el cuerpo coincide y no hace falta tolerarlo', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-j-0001-abcd', AHORA - HORA);
    const cuerpos: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, i: RequestInit) => { cuerpos.push(String(i.body)); return new Response('{}', { status: 200 }); }));
    try {
      const enviar = enviarPorResend(CLAVE_RESEND, REMITE, DEST, async () => undefined);
      const marcarReal = a.marcarResumidos.bind(a);
      a.marcarResumidos = async () => { throw new Error('base caída'); };
      await expect(enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA })).rejects.toThrow();
      await guardar(a, 'evt-j-0002-abcd', AHORA + 1000);
      a.marcarResumidos = marcarReal;
      await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA + 60_000 });
    } finally { vi.unstubAllGlobals(); }
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[1]).toBe(cuerpos[0]);
    expect(a.eventos.get('evt-j-0002-abcd')!.resumido_en).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// QUINTA RONDA: respaldo con la base caída, tope de los avisos del servidor, fechas con barras, índice
// ---------------------------------------------------------------------------
describe('fechas con barras y horas con milisegundos NO son teléfonos; los teléfonos de siempre siguen rechazados', () => {
  it('«El 07/11/2026 falló», «a las 07/11 17:00», «10:30:15.123» y variantes pasan', () => {
    for (const t of [
      'El 07/11/2026 falló', 'a las 07/11 17:00', '10:30:15.123', '07/11/2026 14:59', '07/11/2026 14:59:03', 'Falló el 07/11/2026 a las 10:30:15.123 con v2.36.5',
      'Pasó a las 07/11 17:00:45', 'Desde el 01/02/1999 hasta el 31/12/2099',
    ]) expect(violaciones(buenEvento({ que_paso: t })), t).toEqual([]);
  });
  it('la prueba original del nombre con «v2.36.5 - 07/11/2026» pasa como flujo y como nodo', () => {
    const v = validar(buenEvento({ flujo: 'Enviar respuesta (relé) · v2.36.5 - 07/11/2026', nodo: 'Enviar respuesta (relé) · v2.36.5 - 07/11/2026' }));
    expect(v.saneado).toBe(false);
  });
  it('un teléfono no se disfraza de fecha con barras: 71/23/4567, 5917/12/34, 07/11/20261234 y 7123/4567 se rechazan', () => {
    for (const c of ['71/23/4567', '5917/12/34', '07/11/20261234', '7123/4567', '12/34/5678', '59/17/1234 567']) {
      expect(violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
    // Y los de la ronda anterior.
    for (const c of ['7123-45-67', '71.234.567', '7123_4567', '71,23,45,67', 'evt:591:7123:4567']) {
      expect(violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
  });
});

describe('ids reservados del servidor: id-invalido- y :bloqueado', () => {
  it('un emisor no puede usar el prefijo id-invalido- ni el sufijo :bloqueado (regla forma, 4xx, sale el aviso del servidor)', async () => {
    for (const id of ['id-invalido-2026-11-07T15', 'id-invalido-xyz-0001', 'evt-0001-abcd:bloqueado']) {
      expect(violaciones(buenEvento({ id_unico: id })), id).toContain('id_unico:forma');
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      const r = await llamar(a, enviar, buenEvento({ id_unico: id }));
      expect(r.status, id).toBe(400);
      expect(enviados[0]!.idempotencia, id).toBe('novuchat:id-invalido-2026-11-07T15');
    }
    // Lo parecido pero legítimo pasa.
    expect(violaciones(buenEvento({ id_unico: 'envio-invalido-x-0001' }))).toEqual([]);
    expect(violaciones(buenEvento({ id_unico: 'evt-0001-bloqueado' }))).toEqual([]);
  });
  it('los ids inválidos repetidos de la misma hora se CUENTAN en el documento del servidor', async () => {
    const a = almacenEnMemoria(); const { enviar } = envioFalso();
    for (const id of ['abc', 'abd', 'abe', 'abf']) await llamar(a, enviar, buenEvento({ id_unico: id }));
    expect(a.eventos.size).toBe(1);
    expect(a.eventos.get('id-invalido-2026-11-07T15')!.repetidos).toBe(3);
    // Un duplicado de un id normal NO suma (no es un aviso del servidor).
    await llamar(a, enviar, buenEvento()); await llamar(a, enviar, buenEvento());
    expect(a.eventos.get('evt-0001-abcdef')!.repetidos).toBeUndefined();
  });
});

describe('contenido_bloqueado: como máximo 1 inmediato por día y nunca el último disponible', () => {
  const hora = (h: number): number => Date.parse(`2026-11-07T${String(h).padStart(2, '0')}:00:00Z`);
  it('N horas seguidas de ids inválidos y luego una urgente real: la urgente SALE y solo salió un bloqueado', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    for (let h = 0; h < 15; h++) await llamar(a, enviar, buenEvento({ id_unico: `malo${h}`, ocurrido_en: '2026-11-07T00:00:00Z' }), { ahora: hora(h), marca: hora(h) });
    const bloqueados = enviados.filter((e) => e.idempotencia.startsWith('novuchat:id-invalido-'));
    expect(bloqueados).toHaveLength(1);
    const r = await llamar(a, enviar, buenEvento({ id_unico: 'real-0001-abcd', tipo_error: 'envio_real' }), { ahora: hora(15), marca: hora(15) });
    expect(r.cuerpo).toBe('enviado');
    expect(enviados.at(-1)!.idempotencia).toBe('novuchat:real-0001-abcd');
  });
  it('mezclando :bloqueado e id-invalido en el mismo día, siguen siendo 1; con tope 2 (1 inmediato) un bloqueado NUNCA lo gasta', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    await llamar(a, enviar, buenEvento({ que_paso: `falló ${TEL}` }));                                             // :bloqueado
    await llamar(a, enviar, buenEvento({ id_unico: 'malo' }), { ahora: hora(17), marca: hora(17) });          // id-invalido
    await llamar(a, enviar, buenEvento({ que_paso: `falló ${TEL}`, id_unico: 'otro-id-0002' }), { ahora: hora(19), marca: hora(19) });
    expect(enviados).toHaveLength(1);
    const b = almacenEnMemoria(); const { enviados: e2, enviar: s2 } = envioFalso();
    for (let h = 0; h < 6; h++) await llamar(b, s2, buenEvento({ id_unico: `malo${h}`, ocurrido_en: '2026-11-07T00:00:00Z' }), { tope: 2, ahora: hora(h), marca: hora(h) });
    expect(e2).toHaveLength(0);
    expect((await llamar(b, s2, buenEvento({ id_unico: 'real-0002-abcd', tipo_error: 'envio_real', ocurrido_en: '2026-11-07T06:59:00Z' }), { tope: 2, ahora: hora(7), marca: hora(7) })).cuerpo).toBe('enviado');
  });
  it('un bloqueado nunca toma el último cupo: con tope 5 deja libre el 4.º inmediato', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    for (let i = 0; i < 3; i++) await llamar(a, enviar, buenEvento({ id_unico: `real-${i}-abcd`, tipo_error: `tipo_${i}` }));   // 3 de 4
    await llamar(a, enviar, buenEvento({ que_paso: `falló ${TEL}`, id_unico: 'rechazado-0001' }));                            // no pasa: sería el último
    expect(enviados).toHaveLength(3);
    expect((await llamar(a, enviar, buenEvento({ id_unico: 'real-9-abcd', tipo_error: 'tipo_9' }))).cuerpo).toBe('enviado');
  });
});

describe('envío directo de respaldo con la base caída: un solo correo por DÍA por instancia', () => {
  it('48 h de bloqueos con `crear` caído: UN correo por día UTC (3 días tocados = 3 correos; nunca 2 en el mismo día) y el contenido nunca viaja', async () => {
    reiniciarCandadoDeRespaldo();
    const a: AlmacenMemoria = almacenEnMemoria();
    a.crear = async () => { throw new Error('base caída'); };
    const { enviados, enviar } = envioFalso();
    const porDia = new Map<string, number>();
    for (let h = 0; h < 48; h++) {
      const t = Date.parse('2026-11-07T20:30:00Z') + h * HORA;                     // una ventana de 48 h NO alineada: toca 3 días UTC
      const antes = enviados.length;
      for (const sufijo of ['abcd', 'efgh']) {
        await llamar(a, enviar, buenEvento({ que_paso: `falló ${TEL}`, id_unico: `evt-${h}-${sufijo}`, ocurrido_en: new Date(t - 60_000).toISOString().slice(0, 19) + 'Z' }), { ahora: t, marca: t });
      }
      const dia = new Date(t).toISOString().slice(0, 10);
      porDia.set(dia, (porDia.get(dia) ?? 0) + enviados.length - antes);
    }
    expect([...porDia.values()].every((n) => n <= 1)).toBe(true);
    expect(enviados).toHaveLength(3);
    expect(JSON.stringify(enviados)).not.toContain(TEL);
    reiniciarCandadoDeRespaldo();
  });
});

describe('el emulador no exige índices: esta prueba SÍ', () => {
  it('firestore.indexes.json trae el índice compuesto de `eventos` que usa el resumen (resumido_en ASC, recibido_ms DESC, COLLECTION)', () => {
    const aqui2 = dirname(fileURLToPath(import.meta.url));
    const idx = JSON.parse(readFileSync(join(aqui2, '..', '..', 'firestore.indexes.json'), 'utf8')) as {
      indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }>;
    };
    const hay = idx.indexes.some((i) => i.collectionGroup === 'eventos' && i.queryScope === 'COLLECTION'
      && JSON.stringify(i.fields) === JSON.stringify([{ fieldPath: 'resumido_en', order: 'ASCENDING' }, { fieldPath: 'recibido_ms', order: 'DESCENDING' }]));
    expect(hay, 'falta el índice (resumido_en ASC, recibido_ms DESC) de `eventos`: la consulta del resumen falla en producción').toBe(true);
    // Y la consulta del código es la que ese índice sirve.
    const fuente = readFileSync(join(aqui2, '..', '..', 'functions', 'src', 'plataforma', 'alertaOperativa.ts'), 'utf8');
    expect(fuente).toContain(".where('resumido_en', '==', null).orderBy('recibido_ms', 'desc')");
  });
});

// ---------------------------------------------------------------------------
// SEXTA RONDA: fechas con rangos válidos, tipo reservado, repetidos en el resumen
// ---------------------------------------------------------------------------
describe('fechas y horas con RANGOS VÁLIDOS: lo que parece fecha pero no lo es, se mira como teléfono', () => {
  it('«71/23 4567», «71/23-4567», «71/23.4567», «77/12 34 56», «12/34 5678», «71/23 45:67», «71/23/2045», «77/12/2034 567» y «71:23:45.678» se rechazan', () => {
    for (const c of ['71/23 4567', '71/23-4567', '71/23.4567', '77/12 34 56', '12/34 5678', '71/23 45:67', '71/23/2045', '77/12/2034 567', '71:23:45.678']) {
      expect(violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
  });
  it('una fecha VÁLIDA a la que sigue o precede un resto que la haría teléfono tampoco se tapa', () => {
    for (const c of ['07/11 4567', '07/11 45 67', '07/11/2026 4567', '4567 07/11', '07/11 17:00 4567']) {
      expect(violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
  });
  it('rangos: día 32, mes 13, hora 24, minuto 60 o año 1899 NO son una fecha', () => {
    for (const c of ['32/11/2026 17:00', '07/13/2026 17:00', '07/11/2026 24:00:00', '07/11/2026 17:60:00', '07/11/1899 17:00', '10:30:60.123', '24:30:15.123']) {
      expect(violaciones(buenEvento({ que_paso: `Falló ${c} y 5 más` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
  });
  it('«El 07/11/2026 falló», «a las 07/11 17:00», «10:30:15.123», «07/11/2026 17:00», «07/11/2026, 3 intentos» y los nombres reales pasan', () => {
    for (const t of ['El 07/11/2026 falló', 'a las 07/11 17:00', '10:30:15.123', '07/11/2026 17:00', '07/11/2026, 3 intentos', 'Desde el 31/12/1999 23:59:59.999']) {
      expect(violaciones(buenEvento({ que_paso: t })), t).toEqual([]);
    }
    for (const n of ['NovuChat — Rescate 22 h (rroca-ruben)', 'Todos los días 17:00', 'Enviar respuesta (relé) · v2.36.5 - 07/11/2026', 'Enviar · v2.36.5 - 2026-11-07']) {
      expect(violaciones(buenEvento({ flujo: n, nodo: n })), n).toEqual([]);
    }
  });
  it('una fecha ISO inválida (mes 99, día 00) no se tapa', () => {
    expect(violaciones(buenEvento({ que_paso: 'Cliente 2026-99-99 sin respuesta 1234' })).some((x) => /telefono_/.test(x))).toBe(true);
  });
});

describe('fecha ISO con hora separada por espacio, otra fecha a continuación y fecha en un id (séptima ronda)', () => {
  it('«2026-11-07 14:00», «… 14:00:03», «… 10:30:15 (America/La_Paz, UTC-4)», «2026-11-07/2026-11-08», «2026-11-07 07/11» y «07/11/2026 - 120 eventos» pasan', () => {
    for (const t of [
      '2026-11-07 14:00', '2026-11-07 14:00:03', '2026-11-07 10:30:15 (America/La_Paz, UTC-4)', '2026-11-07/2026-11-08', '2026-11-07 07/11',
      '07/11/2026 - 120 eventos', '2026-11-07T14:00:03Z', 'Entre el 2026-11-07 y el 2026-11-08 hubo 3 fallos',
    ]) expect(violaciones(buenEvento({ que_paso: t })), t).toEqual([]);
  });
  it('ids con fecha ISO y una secuencia corta pasan: evt-2026-11-07-0001, ci-2026-11-07-123', () => {
    for (const id of ['evt-2026-11-07-0001', 'ci-2026-11-07-123', 'envio-demo:2026-11-07T14:00:03Z-7']) expect(violaciones(buenEvento({ id_unico: id })), id).toEqual([]);
  });
  it('siguen RECHAZADOS: los 9 teléfonos con barras, «2026-11-07 4567», «4567 2026-11-07», «2026-11-07 45 67» y los ids con 7+ cifras', () => {
    for (const c of ['71/23 4567', '71/23-4567', '71/23.4567', '77/12 34 56', '12/34 5678', '71/23 45:67', '71/23/2045', '77/12/2034 567', '71:23:45.678',
      '2026-11-07 4567', '4567 2026-11-07', '2026-11-07 45 67', '07/11/2026 4567']) {
      expect(violaciones(buenEvento({ que_paso: `Cliente ${c} sin respuesta` })).some((x) => /telefono_/.test(x)), c).toBe(true);
    }
    for (const id of [`evt-2026-11-07-${TEL}`, 'evt-2026-11-07-5917-1234', 'evt-5917123-2026-11-07', 'evt-2026-11-07-1234567', 'evt-2026-11-07-591-7123']) {
      expect(violaciones(buenEvento({ id_unico: id })).some((x) => x.startsWith('id_unico')), id).toBe(true);
    }
  });
});

describe('el tipo contenido_bloqueado es del servidor', () => {
  it('un llamador que lo manda recibe 400 (forma) y no gasta el tope de los avisos del servidor', async () => {
    expect(violaciones(buenEvento({ tipo_error: 'contenido_bloqueado' }))).toContain('tipo_error:forma');
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    const r = await llamar(a, enviar, buenEvento({ tipo_error: 'contenido_bloqueado' }));
    expect(r.status).toBe(400);
    // Lo único que sale es el aviso del servidor por el campo inválido (id propio, tipo propio).
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.idempotencia).toBe('novuchat:evt-0001-abcdef:bloqueado');
    expect(a.eventos.get('evt-0001-abcdef')).toBeUndefined();
    // Un tipo parecido sí es del llamador.
    expect(violaciones(buenEvento({ tipo_error: 'contenido_bloqueado_x' }))).toEqual([]);
  });
});

describe('el resumen muestra los avisos repetidos', () => {
  it('una línea «<id>: N repetidos» por cada aviso del servidor con repetidos, y no más de 5', () => {
    const ev = [
      eventoGuardado('id-invalido-2026-11-07T15', { repetidos: 7 }),
      eventoGuardado('evt-r-0001-abcd'),
      ...Array.from({ length: 6 }, (_, i) => eventoGuardado(`id-invalido-2026-11-07T0${i}`, { repetidos: i + 1 })),
    ];
    const t = armarResumen(ev, AHORA).texto;
    expect(t).toContain('- id-invalido-2026-11-07T15: 7 repetidos');
    expect((t.match(/ repetidos/g) ?? []).length).toBe(5);
    expect(armarResumen([eventoGuardado('evt-s-0001-abcd')], AHORA).texto).not.toContain('repetidos');
  });
});

describe('registros y fuente: ningún secreto, valor ni dominio real', () => {
  it('ningún valor de secreto, cuerpo, respuesta de Resend, dato personal ni cadena denegada llega a los registros', async () => {
    const logs: string[] = [];
    const espias = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...x: unknown[]) => { logs.push(x.map(String).join(' ')); }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('cuerpo-secreto-de-resend', { status: 422 })));
    const denegada = 'proyecto-ficticio-xyz';
    try {
      const a = almacenEnMemoria();
      const enviar = enviarPorResend(CLAVE_RESEND, REMITE, DEST, async () => undefined);
      await llamar(a, enviar, buenEvento({ que_paso: `Falló para ${TEL}` }), { denegar: [denegada] });                // contenido prohibido + envío 422
      await llamar(a, enviar, buenEvento({ id_unico: 'evt-x-0001-abcd' }), { sinFirma: true });
      await llamar(a, enviar, buenEvento({ id_unico: 'evt-z-0001-abcd', que_paso: `en ${denegada}` }), { denegar: [denegada] });
      await llamar(a, enviar, '{no es json', {});
      const roto: AlmacenAlertas = { ...almacenEnMemoria(), crear: async () => { throw new Error(`boom ${SECRETO} ${TEL}`); } };
      const r = await llamar(roto, enviar, buenEvento({ id_unico: 'evt-y-0001-abcd' }));
      expect(r).toEqual({ status: 500, cuerpo: 'error' });
    } finally { espias.forEach((e) => e.mockRestore()); vi.unstubAllGlobals(); }
    const todo = logs.join('\n');
    for (const prohibido of [SECRETO, CLAVE_RESEND, 'cuerpo-secreto-de-resend', TEL, DEST, denegada]) expect(todo).not.toContain(prohibido);
  });

  it('el código no escribe dominios, correos ni claves reales; los secretos van por defineSecret; nada de defineString/defineInt', () => {
    const aqui = dirname(fileURLToPath(import.meta.url));
    const dir = join(aqui, '..', '..', 'functions', 'src', 'plataforma');
    for (const n of ['alertaOperativa.ts', 'alertaContenido.ts']) {
      const fuente = readFileSync(join(dir, n), 'utf8');
      expect(fuente, n).not.toMatch(/re_[A-Za-z0-9]{10,}/);
      expect(fuente, n).not.toMatch(/aab1\.website/);
      expect(fuente, n).not.toMatch(/[\w.-]+@(?!\$\{)[\w-]+\.(com|bo|website|net)\b/);
      expect(fuente, n).not.toMatch(/\bdefine(String|Int|Boolean)\(/);
    }
    const f = readFileSync(join(dir, 'alertaOperativa.ts'), 'utf8');
    expect(f).toContain("defineSecret('ALERTAS_HMAC')");
    expect(f).toContain("defineSecret('ALERTAS_RESEND_API_KEY')");
    // El tope máximo está escrito una sola vez y es 8; el valor vigente sale de plataforma/alertas.
    expect(f).toMatch(/TOPE_MAXIMO = 8;/);
    expect(f).toContain("d.get('topeDiario')");
  });
});

// La misma batería que corre contra Firestore real en alerta-operativa-firestore.test.ts.
bateriaDelAlmacen('memoria', async () => {
  const m = almacenEnMemoria();
  return {
    almacen: m,
    async contadores(tipo, dia) { return { enviados: m.dias.get(dia) ?? 0, ultimoMs: m.tipos.has(tipo) ? m.tipos.get(tipo)! : null }; },
  };
});
