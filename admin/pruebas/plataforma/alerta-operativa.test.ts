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
  inmediatosDe, topeValido, validarEntrada, verificarFirmaAlerta, MAX_CUERPO_ALERTA,
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
    expect(r.cuerpo).toBe('contrato_invalido:que_paso(telefono_o_identificador),que_paso(correo)');
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

  it('si proyecto o id_unico no son válidos, NO se envía nada y se responde 4xx', async () => {
    for (const mal of [{ proyecto: 'wam' }, { id_unico: 'abc' }, { id_unico: `evt-${TEL}` }, { proyecto: 'Mal Proyecto', que_paso: `x ${TEL}` }]) {
      const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
      const r = await llamar(a, enviar, buenEvento(mal));
      expect(r.status, JSON.stringify(mal)).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(enviados, JSON.stringify(mal)).toHaveLength(0);
      expect(a.eventos.size).toBe(0);
    }
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
    expect(violaciones(buenEvento({ id_unico: 'resumen-2026-11-07' }))).toEqual([]);
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
    expect(armarCorreo(validar(buenEvento({ id_unico: 'resumen-2026-11-07' })).aviso).asunto).toContain('[AAB1 RESUMEN]');
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

describe('resumen: solo si hay eventos acumulados; ventana por la hora del servidor y marca de la última corrida', () => {
  const guardar = async (a: AlmacenAlertas, id: string, recibido: number, extra: Record<string, unknown> = {}) =>
    a.crear(eventoGuardado(id, { recibido_ms: recibido, ocurrido_ms: recibido, ...extra }));

  it('con 0 eventos NO se envía nada (el latido es de la vigía de FinOps) pero la marca avanza', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    expect(await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA })).toEqual({ eventos: 0, enviado: false });
    expect(enviados).toHaveLength(0);
    expect(a.marca.ms).toBe(AHORA);
  });

  it('con eventos sale, con idempotencia propia del día, asunto RESUMEN y sin «0 errores»; la marca avanza', async () => {
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
    expect(a.marca.ms).toBe(AHORA);
  });

  it('cuenta desde la última corrida exitosa (marca) y por recibido_ms, no por ocurrido_en', async () => {
    const a = almacenEnMemoria(); const { enviados, enviar } = envioFalso();
    a.marca.ms = AHORA - 2 * HORA;
    await guardar(a, 'evt-m-0001-abcd', AHORA - 3 * HORA);                              // antes de la marca: ya resumido
    await guardar(a, 'evt-m-0002-abcd', AHORA - HORA, { ocurrido_ms: AHORA - 40 * 86_400_000 }); // ocurrió hace mucho, llegó hoy: entra
    await guardar(a, 'evt-m-0003-abcd', AHORA - 90 * 60_000, { ocurrido_ms: AHORA + 99 * HORA }); // ocurrido_en mentido al futuro: igual solo por recibido
    await enviarResumenDiario({ almacen: a, enviar, ahoraMs: AHORA });
    expect(enviados[0]!.texto).toContain('2 avisos');
    // Sin marca, la ventana es 24 h.
    const b = almacenEnMemoria(); const { enviados: e2, enviar: s2 } = envioFalso();
    await guardar(b, 'evt-m-0004-abcd', AHORA - 30 * HORA);
    await guardar(b, 'evt-m-0005-abcd', AHORA - 20 * HORA);
    await enviarResumenDiario({ almacen: b, enviar: s2, ahoraMs: AHORA });
    expect(e2[0]!.texto).toContain('1 aviso desde');
  });

  it('el envío del resumen falla: lanza (el programador reintenta) y la marca NO avanza', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-f-0001-abcd', AHORA - HORA);
    await expect(enviarResumenDiario({ almacen: a, enviar: async () => { throw new Error('resend_503'); }, ahoraMs: AHORA })).rejects.toThrow('resend_503');
    expect(a.marca.ms).toBeNull();
  });

  it('500 o más: el titular dice «500 o más» y el texto cabe en el contrato (≤30 líneas, ≤1500)', () => {
    const muchos = Array.from({ length: 500 }, (_, i) => eventoGuardado(`evt-x-${String(i).padStart(6, '0')}`, { tipo_error: `tipo_${i % 40}` }));
    const e = armarResumen(muchos, AHORA);
    expect(e.texto).toContain('500 o más avisos desde el último resumen');
    const paso = e.texto.split('\n').slice(2, e.texto.split('\n').indexOf(''));
    expect(paso.length).toBeLessThanOrEqual(30);
    expect(paso.join('\n').length).toBeLessThanOrEqual(1500);
  });

  it('sin configuración de envío no sale ni se adelanta la marca', async () => {
    const a = almacenEnMemoria();
    await guardar(a, 'evt-s-0001-abcd', AHORA - HORA);
    expect(await enviarResumenDiario({ almacen: a, enviar: null, ahoraMs: AHORA })).toEqual({ eventos: 1, enviado: false });
    expect(a.marca.ms).toBeNull();
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
    expect(f).toContain("defineSecret('ALERTA_OPERATIVA_HMAC')");
    expect(f).toContain("defineSecret('RESEND_API_KEY_ALERTAS')");
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
