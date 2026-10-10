/**
 * LA BATERÍA DE «CHAT NOVUCHAT v2 (KENJI)» (`Flujos/experimental/chat-novuchat/herramientas/bateria.mjs` y `bateria-casos.json`).
 *
 * La batería corre las conversaciones por el flujo armado y mide lo que depende del MODELO. Aquí se prueba SIN modelo ni red (`--seco`: una respuesta fija por turno) y se comprueba:
 *   1. que los casos corren por el flujo versionado y dan CERO violaciones de las reglas duras sobre lo que el cliente recibe (también con tres corridas por caso);
 *   2. que están TODAS las conversaciones de aceptación (las capturas de Silvana, los tres escenarios del documento, las del PDF, un caso por rubro, las reglas duras, nombre y empresa, la hoja,
 *      recepción, los medios y el historial);
 *   3. que cada detector de la batería detecta (y no detecta de más): una regla que acepta todo no mediría nada;
 *   4. que la prueba FALLA SI SE REVIERTE lo que importa: se estropea el flujo (quitar un botón, aceptar muletillas, no coalescer clics, confiar en la acción del modelo, no cerrar con la pregunta
 *      exacta) y la batería tiene que decirlo con la regla que corresponde;
 *   5. que no imprime un secreto, no llama a la red en `--seco` y usa solo los anfitriones de Google.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const CARPETA = join(aqui, '../../Flujos/experimental/chat-novuchat');
const RUTA_BATERIA = join(CARPETA, 'herramientas/bateria.mjs');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const B = (await import(/* @vite-ignore */ RUTA_BATERIA)) as {
  main: (argv: string[], deps?: J) => Promise<number>; leerArgumentos: (a: string[]) => J; validarCasos: (d: J) => J[]; revisarMensaje: Fn; medir: Fn; cargarLibreria: () => J; correrCaso: Fn;
  telefonoDe: Fn; ErrorDeUso: new (m: string) => Error; limpiarSecretos: Fn; leerConversaciones: Fn; TARIFA: J; textoDeEnvio: Fn;
};
const FLUJO = JSON.parse(readFileSync(join(CARPETA, 'chat-novuchat.novuchat.json'), 'utf8')) as J;
const CASOS = JSON.parse(readFileSync(join(CARPETA, 'herramientas/bateria-casos.json'), 'utf8')) as J;
const clonar = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Corre `main` capturando la salida estándar y la de errores. */
async function correr(argv: string[], deps: J = {}): Promise<{ codigo: number; salida: string; error: string }> {
  let salida = '';
  let error = '';
  const codigo = await B.main(argv, { salida: (t: string) => { salida += t; }, error: (t: string) => { error += t; }, ...deps });
  return { codigo, salida, error };
}
const sinRed: J = {
  fetch: () => { throw new Error('el modo seco NO llama a la red'); },
  leerArchivo: () => { throw new Error('el modo seco NO lee archivos de entorno'); },
  gcloudToken: () => { throw new Error('el modo seco NO pide un token'); },
};

describe('la batería en seco: los casos corren por el flujo versionado con cero violaciones', () => {
  it('una corrida por caso: cero violaciones, un mensaje por turno, sin fallos de nodo ni fórmulas en la hoja', async () => {
    const r = await correr(['--seco', '--n', '1', '--json'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    const inf = JSON.parse(r.salida) as J;
    expect(inf['modo']).toBe('seco');
    expect(inf['violaciones'].total, JSON.stringify(inf['violaciones'].detalle.slice(0, 5))).toBe(0);
    expect(inf['total'].fallosDeNodo).toEqual([]);
    expect(inf['total'].formulasEnLaHoja).toBe(0);
    expect(inf['total'].mensajesPorTurno).toBe(1);
    expect(inf['total'].turnos).toBeGreaterThan(120);
    expect(inf['total'].filasPorCorrida).toBeLessThanOrEqual(1);
    expect(inf['aviso']).toMatch(/SECO/);
  }, 60_000);

  it('`--n 3`: tres corridas por caso (teléfonos y relojes propios) y también cero violaciones', async () => {
    const r = await correr(['--seco', '--n', '3', '--json'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    const inf = JSON.parse(r.salida) as J;
    expect(inf['corridasPorCaso']).toBe(3);
    expect(inf['total'].corridas).toBe(CASOS['casos'].length * 3);
    expect(inf['violaciones'].total, JSON.stringify(inf['violaciones'].detalle.slice(0, 5))).toBe(0);
    expect(inf['total'].mensajesPorTurno).toBe(1);
  }, 120_000);

  it('el informe de texto trae la tabla, las causas de rechazo y las violaciones; `--conversaciones` imprime lo que dijo cada uno', async () => {
    const r = await correr(['--seco', '--n', '1', '--casos', 'S1,P1,E1', '--conversaciones'], sinRed);
    expect(r.codigo).toBe(0);
    expect(r.salida).toMatch(/VIOLACIONES de reglas duras sobre lo que el cliente recibe: 0/);
    expect(r.salida).toMatch(/Causas de rechazo del mensaje del modelo/);
    expect(r.salida).toMatch(/=== S1 — «Quiero mas informació»/);
    expect(r.salida).toMatch(/Cliente: \(ráfaga\)/);
    expect(r.salida).toMatch(/el primer empleado de tu negocio que nunca duerme/);
  }, 30_000);

  it('el modo seco no llama a la red, no lee la clave y no escribe archivos: es solo la salida estándar', async () => {
    const r = await correr(['--seco', '--n', '1', '--casos', 'S1'], sinRed);
    expect(r.codigo, r.error).toBe(0);
    expect(r.error).toBe('');
  });
});

describe('las conversaciones de aceptación están, con lo que cada una exige', () => {
  const ids = (CASOS['casos'] as J[]).map((c) => c['id'] as string);
  const caso = (id: string): J => (CASOS['casos'] as J[]).find((c) => c['id'] === id)!;
  it('las capturas de Silvana (S1 a S5), los 3 escenarios (E1 a E4), el PDF (P1 a P4), un caso por rubro, las reglas duras, nombre y empresa, la hoja, recepción, los medios y el historial', () => {
    for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'E1', 'E2', 'E3', 'E4', 'P1', 'P2', 'P3', 'P4', 'RSAL', 'RBEL', 'RGAS', 'RRET', 'REDU', 'RCAP',
      'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'N1', 'N2', 'N3', 'N4', 'N5', 'H1', 'H2', 'H3', 'REC', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'K1', 'G1', 'G2', 'G3']) {
      expect(ids, id).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('E1 es una ráfaga de tres clics (Salud, Gastronomía, Retail) que exige UNA respuesta de exploración y que el modelo vea los tres', () => {
    const t = (caso('E1')['turnos'] as J[])[1]!;
    expect(t['tipo']).toBe('rafaga');
    expect((t['eventos'] as J[]).map((e) => e['id'])).toEqual(['rubro:salud', 'rubro:gastronomia', 'rubro:retail']);
    expect(t['exige'].modeloVe).toHaveLength(3);
  });
  it('cada caso de rubro exige que termine con la pregunta EXACTA, y cada caso de regla dura exige que el código conteste sin modelo', () => {
    for (const id of ['RSAL', 'RBEL', 'RGAS', 'RRET', 'REDU', 'RCAP']) {
      const t = (caso(id)['turnos'] as J[])[1]!;
      expect(t['exige'].termina).toBe('¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝');
    }
    for (const id of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']) {
      const turnos = (caso(id)['turnos'] as J[]).slice(1);
      expect(turnos.every((t) => t['exige']?.sinModelo === true), id).toBe(true);
    }
  });
  it('los casos con el modelo «bueno» traen la respuesta de seco; los que ejercen el rechazo traen la mala y exigen el respaldo', () => {
    for (const id of ['S5', 'D8', 'D9', 'D10', 'D11', 'M4']) {
      const t = (caso(id)['turnos'] as J[]).find((x) => x['exige']?.origen === 'respaldo');
      expect(t, id).toBeDefined();
    }
  });
  it('cada turno que llega al modelo en seco tiene su `seco` (o «ERROR» a propósito): nada depende de un valor por omisión', async () => {
    const r = await correr(['--seco', '--n', '1', '--json'], sinRed);
    const inf = JSON.parse(r.salida) as J;
    // «sin_respuesta» solo en los casos que simulan el modelo caído
    const conErrorADrede = (CASOS['casos'] as J[]).filter((c) => (c['turnos'] as J[]).some((t) => t['seco'] === 'ERROR' || (t['eventos'] as J[] | undefined)?.some((e) => e['seco'] === 'ERROR'))).map((c) => c['id']);
    expect(conErrorADrede.length).toBeGreaterThanOrEqual(3);
    const porCaso = (inf['casos'] as J[]).filter((c) => (c['causasDeRechazo'].sin_respuesta ?? 0) > 0).map((c) => c['id']);
    for (const id of porCaso) expect(conErrorADrede, id).toContain(id);
  }, 60_000);
});

describe('los detectores de la batería: detectan y no detectan de más', () => {
  const lib = B.cargarLibreria();
  const msg = (cuerpo: string, extra: J = {}): J => ({
    tipo: 'interactive', cuerpo, evento: 'respuesta', esRespaldo: false,
    payload: { type: 'interactive', interactive: { type: 'button', body: { text: cuerpo }, action: { buttons: [{ type: 'reply', reply: { id: 'planes', title: 'Ver planes' } }, { type: 'reply', reply: { id: 'equipo', title: 'Hablar con el equipo' } }] } } }, ...extra,
  });
  const reglas = (m: J, ctx: J = {}): string[] => B.revisarMensaje(m, { lib, origen: '', contexto: '', ...ctx }).map((x: J) => x.regla);
  const LARGO = 'NovuChat atiende tu WhatsApp en segundos, agenda citas sin cruces y te ayuda a no perder ventas fuera de horario, todos los días de la semana. ¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝';
  it('un mensaje bueno no da ninguna violación', () => {
    expect(reglas(msg(LARGO), { origen: 'modelo' })).toEqual([]);
  });
  it('cada regla dura se detecta con su nombre', () => {
    const casos: [string, string][] = [
      ['Habla con Silvana, que te ayuda.', 'nombre_de_persona_del_equipo'], ['Hola, soy la asesora de NovuChat.', 'nombre_de_persona_del_equipo'],
      ['Te llamamos mañana para contarte todo.', 'promesa_de_contacto'], ['¿Quieres que alguien de nuestro equipo se comunique contigo?', 'promesa_de_contacto'], ['Agendamos una llamada con alguien.', 'promesa_de_contacto'],
      ['Soy una persona real, no soy un bot.', 'niega_ser_ia'], ['¿Querés ver los planes? Mirá, tenés varias opciones.', 'voseo'], ['¡Recibimos tu pago, quedó acreditado!', 'cobro_acreditado'],
      ['¡Te entiendo! 😊', 'muletilla'], ['Con el miniCRM y el tablero Kanban ves todo.', 'minicrm_o_leads_de_ventas'], ['Responde en menos de un minuto.', 'menos_de_un_minuto'],
      ['Incluye 7 días de prueba.', 'digitos_de_mas'], ['Incluye hasta cien conversaciones por mes.', 'cifra_de_consumo'], ['Valida cada transferencia con el banco.', 'valida_pagos_con_el_banco'],
      ['Se integra con SAP y con Shopify.', 'sistema_ajeno_o_integracion_inventada'], ['Es completamente gratis y sin límites.', 'gratuidad_oferta_o_costo_de_meta_minimizado'], ['Los mensajes de Meta cuestan centavos.', 'gratuidad_oferta_o_costo_de_meta_minimizado'],
      ['Mira www.estafa.com para más.', 'enlace'],
    ];
    for (const [t, regla] of casos) expect(reglas(msg(t)), t).toContain(regla);
  });
  it('lo permitido NO se marca: 24/7, 24 horas, los precios del código, el enlace a recepción y el de la imagen de planes, y la negación del banco', () => {
    const ok = [
      'Atiende las 24 horas, todos los días, 24/7.', 'Setup estándar USD 65, pago único. Setup a medida desde USD 125. Planes mensuales desde USD 25.',
      'El asistente solo revisa visualmente el comprobante: no lo valida con el banco. Quien confirma que el dinero entró es tu banco, y tú como dueño.',
      'Escríbele aquí: https://wa.me/59100000001?text=Hola', 'Esa no la tengo a la mano 🤔. ¿Te gustaría hablar con alguien de nuestro equipo?',
    ];
    for (const t of ok) expect(reglas(msg(t)), t).toEqual([]);
  });
  it('los botones: faltan, sobran, están cambiados, o el texto sin botones; la lista exige descripción en todas las filas', () => {
    expect(reglas(msg(LARGO, { payload: { type: 'interactive', interactive: { type: 'button', action: { buttons: [{ type: 'reply', reply: { id: 'planes', title: 'Ver planes' } }] } } } }))).toContain('botones_incorrectos');
    expect(reglas(msg(LARGO, { payload: { type: 'interactive', interactive: { type: 'button', action: { buttons: [{ type: 'reply', reply: { id: 'asesor', title: 'Hablar con un asesor' } }] } } } }))).toContain('botones_incorrectos');
    expect(reglas({ tipo: 'text', cuerpo: LARGO, evento: 'respuesta', payload: { type: 'text', text: { body: LARGO } }, esRespaldo: false })).toContain('sin_los_dos_botones');
    expect(reglas({ tipo: 'text', cuerpo: LARGO, evento: 'suspendido', payload: { type: 'text' }, esRespaldo: false })).toEqual([]);
    const lista = (descripcion: string): J => ({ tipo: 'interactive', cuerpo: 'x', evento: 'lista', esRespaldo: false, payload: { type: 'interactive', interactive: { type: 'list', action: { sections: [{ rows: [{ id: 'rubro:a', title: 'A', description: descripcion }] }] } } } });
    expect(reglas(lista(''))).toContain('fila_sin_descripcion_o_demasiado_larga');
    expect(reglas(lista('Con descripción'))).toEqual([]);
  });
  it('lo que escribe el MODELO exige contenido (25 palabras) y cierre con pregunta o invitación; los textos del código no', () => {
    expect(reglas(msg('Claro, con gusto te ayudo con eso.'), { origen: 'modelo' })).toContain('sin_contenido');
    expect(reglas(msg(LARGO.replace(/¿Te gustaría.*$/, 'NovuChat trabaja las 24 horas sin parar para tu negocio todos los días.')), { origen: 'modelo' })).toContain('sin_cierre');
    expect(reglas(msg('Claro, con gusto te ayudo con eso.'), { origen: 'codigo' })).toEqual([]);
    expect(reglas(msg('¡Con gusto! 😊'), { origen: 'modelo', contexto: 'cortesia' })).toEqual([]);
  });
  it('un rubro explicado cierra con la pregunta EXACTA', () => {
    expect(reglas(msg(LARGO.replace('¿Te gustaría ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝', '¿Quieres ver los planes?')), { origen: 'modelo', contexto: 'rubro' })).toContain('rubro_sin_la_pregunta_exacta');
    expect(reglas(msg(LARGO), { origen: 'modelo', contexto: 'rubro' })).toEqual([]);
  });
  it('medir: el respaldo, la tasa y las causas; `leerConversaciones` imprime lo que dijo cada uno', () => {
    const c = (extra: J): J => ({ caso: 'X', turnos: 2, llamadas: [], violaciones: [], tonos: [], mensajes: 2, plantillas: 0, fallos: [], conversacion: [], palabras: [30, 40], modeloTurnos: 2, respaldos: 1, causas: { corto: 1 }, ...extra });
    const m = B.medir([c({}), c({ respaldos: 0, causas: { promesa: 2 } })]);
    expect(m.tasaDeRespaldo).toBeCloseTo(0.25);
    expect(m.causasDeRechazo).toEqual({ corto: 1, promesa: 2 });
    expect(m.mensajesPorTurno).toBe(1);
    const t = B.leerConversaciones({ casos: [{ id: 'X1', titulo: 'uno', conversacion: [{ dicho: 'hola', mensajes: ['Hola 😊'], origen: 'codigo', contexto: '' }] }] });
    expect(t).toMatch(/=== X1 — uno\n  Cliente: hola\n  Kenji \[codigo\]: Hola 😊/);
  });
});

describe('la batería FALLA si se revierte lo que importa (se estropea el flujo y se mira qué dice)', () => {
  const lib = B.cargarLibreria();
  /** Cambia `buscar` por `poner` en el código de los nodos que lo traen, y exige que haya encontrado el texto (si no, la prueba no probaría nada). */
  function estropear(buscar: string, poner: string, nodos?: string[], base: J = FLUJO): J {
    const f = clonar(base);
    let veces = 0;
    for (const n of f['nodes'] as J[]) {
      if (n.type !== 'n8n-nodes-base.code' || (nodos && !nodos.includes(n.name))) continue;
      const js = String(n.parameters.jsCode);
      if (js.includes(buscar)) { veces += js.split(buscar).length - 1; n.parameters.jsCode = js.split(buscar).join(poner); }
    }
    expect(veces, `no se encontró «${buscar.slice(0, 60)}» en ningún nodo: la estropeadura no prueba nada`).toBeGreaterThan(0);
    return f;
  }
  const casoPorId = (id: string): J => (CASOS['casos'] as J[]).find((c) => c['id'] === id)!;
  async function violacionesCon(flujo: J, id: string): Promise<string[]> {
    const c = await B.correrCaso({ caso: casoPorId(id), rep: 1, flujo, lib, opciones: { seco: true, n: 1 }, credencial: { clave: null, token: null }, deps: sinRed });
    return (c.violaciones as J[]).map((v) => v.regla);
  }
  it('el flujo sin estropear da cero violaciones en esos casos (la base de la comparación)', async () => {
    for (const id of ['S5', 'E1', 'RGAS', 'D13', 'S2']) expect(await violacionesCon(FLUJO, id), id).toEqual([]);
  });
  it('si «Hablar con el equipo» deja de salir tras cada mensaje (un solo botón), se dice «botones_incorrectos»', async () => {
    const f = estropear('function chBotones() {\n  return [CH_BOTON_PLANES, CH_BOTON_EQUIPO];\n}', 'function chBotones() {\n  return [CH_BOTON_PLANES];\n}');
    expect(await violacionesCon(f, 'S2')).toContain('botones_incorrectos');
  });
  it('si el filtro acepta mensajes sin contenido (la muletilla «¡Te entiendo! 😊»), llega al cliente y se dice «muletilla»', async () => {
    const f = estropear("function chValidarMensaje(texto, v) {\n  const t = chLineas(texto);", "function chValidarMensaje(texto, v) {\n  if (chPlano(texto) !== '') return '';\n  const t = chLineas(texto);");
    const v = await violacionesCon(f, 'S5');
    expect(v).toEqual(expect.arrayContaining(['muletilla']));
  });
  it('si no se coalescen los clics (cada ejecución responde solo a su evento y nada se consume), tres clics en 2 s dan tres respuestas: «mas_de_un_mensaje_por_turno»', async () => {
    // La coalescencia tiene DOS cerrojos independientes (el último evento de cada teléfono y lo ya respondido); para revertirla hay que quitar los dos.
    let f = estropear('if (f.seq !== reg.seq) return [];', '', ['Armar turno']);
    f = estropear('const eventos = f.cola.filter((e) => e.seq > f.hasta);', 'const eventos = f.cola.filter((e) => e.seq === reg.seq);', ['Armar turno'], f);
    f = estropear('f.cola = f.cola.filter((e) => e.seq > a.hasta);', '', undefined, f);
    expect(await violacionesCon(f, 'E1')).toContain('mas_de_un_mensaje_por_turno');
  });
  it('si el código confía en la etiqueta del modelo («derivar_equipo» sin que el cliente lo pida), se avisa a recepción de más', async () => {
    const f = estropear("if (lectura.accion === 'derivar_equipo' && textos.some((c) => chPidePersona(c) || chPidioContacto(c) || chPideAsesor(c))) accionConfirmada = 'equipo';",
      "if (lectura.accion === 'derivar_equipo') accionConfirmada = 'equipo';");
    const v = await violacionesCon(f, 'D13');
    expect(v).toEqual(expect.arrayContaining(['avisos_a_recepcion_inesperados']));
  });
  it('si el código no pone la pregunta EXACTA de cierre de los rubros estándar, se dice que no termina como se exige', async () => {
    const f = estropear('  if (chNorm(t).endsWith(chNorm(cierre))) return t;', '  return t;');
    expect(await violacionesCon(f, 'RGAS')).toEqual(expect.arrayContaining(['no_termina_como_se_exige']));
  });
  it('si el código ya no corta el consumo (cae al modelo), se dice «llamo_al_modelo_sin_necesidad»', async () => {
    const f = estropear("    if (chPreguntaConsumo(dijo)) return fijo('consumo');", '');
    expect(await violacionesCon(f, 'D1')).toEqual(expect.arrayContaining(['llamo_al_modelo_sin_necesidad']));
  });
  it('si al pedir los planes ya no sale la imagen de la consola, se dice «sin_imagen_de_planes»', async () => {
    const f = estropear("    payload.interactive.header = archivo.tipo === 'pdf'", "    void 0; if (false) payload.interactive.header = archivo.tipo === 'pdf'");
    expect(await violacionesCon(f, 'D2')).toEqual(expect.arrayContaining(['sin_imagen_de_planes']));
  });
  it('ajustes del 09/10: la base (sin estropear) da cero violaciones en los casos nuevos A1 a A5', async () => {
    for (const id of ['A1', 'A1b', 'A2', 'A2b', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'REC', 'P1']) expect(await violacionesCon(FLUJO, id), id).toEqual([]);
  });
  it('R1: si la red de funciones inventadas deja de rechazar, la invención de QR en belleza llega al cliente y la batería lo dice', async () => {
    const f = estropear("CH_FUNCION_INVENTADA.test(n)) return 'funcion_inventada';", "false) return 'funcion_inventada';");
    const r = await violacionesCon(f, 'A1b');
    expect(r.some((x) => ['trae_lo_que_no_debe', 'falta_lo_que_se_exige', 'origen_inesperado'].includes(x)), r.join()).toBe(true);
    expect((await violacionesCon(f, 'A1')).length).toBeGreaterThan(0);
  });
  it('R2: si deja de existir el contexto `empresa`, la evasión de «Dame más info sobre la empresa» ya no se corrige con los hechos', async () => {
    const f = estropear("if (dijo !== '' && chPreguntaEmpresa(dijo)) return 'empresa';", "if (false) return 'empresa';");
    expect((await violacionesCon(f, 'A1')).length).toBeGreaterThan(0);
  });
  it('hotfix 09/10: si el pedido del nombre se omite cuando la respuesta es larga, se dice que falta (A7); si la disponibilidad deja de ser un dato documentado, se dice (A6)', async () => {
    const f = estropear('if (!chDebePedirDatos(f, contexto)) return { texto: base, pidio: false };\n  const largo', 'if (!chDebePedirDatos(f, contexto) || base.length + 110 > CH_MAX_MENSAJE) return { texto: base, pidio: false };\n  const largo');
    expect(await violacionesCon(f, 'A7')).toContain('falta_lo_que_se_exige');
    const g = estropear("if (chPreguntaHorario(dijo)) return fijo('disponibilidad');", "if (false) return fijo('disponibilidad');");
    expect((await violacionesCon(g, 'A6')).length).toBeGreaterThan(0);
  });
  it('R4: si «Ver planes» como primera respuesta muestra los planes sin pedir el nombre, se dice `ruta_inesperada`', async () => {
    const f = estropear("return !!f && (f.explicado === true || chPlano(f.rubro) !== '')", 'return false && (f.explicado === true');
    expect(await violacionesCon(f, 'A2')).toContain('ruta_inesperada');
  });
  it('R5: si tras el traspaso siguen los botones en vez de la lista de rubros, se dice `botones_inesperados` y `boton_del_equipo_otra_vez`', async () => {
    const f = estropear('lista: antes.equipoAhora === true && !ciclo }', 'lista: false }');
    const r = await violacionesCon(f, 'A1');
    expect(r).toContain('botones_inesperados');
    expect(r).toContain('boton_del_equipo_otra_vez');
  });
  it('R5: si el botón sale sin mirar los planes ya vistos, se dice `ver_planes_cuando_ya_los_vio`', async () => {
    const f = estropear('return est && est.planes === true ? [CH_BOTON_EQUIPO] : chBotones();', 'return chBotones();');
    expect(await violacionesCon(f, 'A4')).toContain('ver_planes_cuando_ya_los_vio');
  });
  it('R5: si el segundo negocio pisa al primero en la hoja (C, D, F) o no se agrega al resumen, se dice `planilla_no_coincide`', async () => {
    const f = estropear("const base = f.primero && typeof f.primero === 'object' ? f.primero : { rubro: f.rubro, empresa: f.empresa };", 'const base = { rubro: f.rubro, empresa: f.empresa };');
    expect(await violacionesCon(f, 'A3')).toContain('planilla_no_coincide');
  });
  it('R5: si una empresa distinta ya no manda un aviso nuevo, se dice `avisos_a_recepcion_inesperados`', async () => {
    const f = estropear('antes.avisado === true && !empresaNueva', 'antes.avisado === true');
    expect(await violacionesCon(f, 'A3')).toContain('avisos_a_recepcion_inesperados');
  });
  it('R6: si los planes pedidos otra vez repiten la imagen y el texto, se dice `imagen_de_planes_repetida`', async () => {
    const f = estropear('if (antes.planesMostrados === true && plan.tope !== true) {', 'if (false) {');
    expect(await violacionesCon(f, 'A4')).toContain('imagen_de_planes_repetida');
  });
  it('R6: si el modelo puede calcar su mensaje anterior, la batería lo cuenta (`repite_el_mensaje_anterior`)', async () => {
    const f = estropear("if (chTexto(v.ultimoAsistente) !== '' && chSimilitud(t, v.ultimoAsistente) >= CH_UMBRAL_REPITE) return 'repite';", '');
    const c = clonar(casoPorId('A5'));
    (c['turnos'] as J[])[2]['seco'] = clonar((c['turnos'] as J[])[1]['seco']);
    const r = await B.correrCaso({ caso: c, rep: 1, flujo: f, lib, opciones: { seco: true, n: 1 }, credencial: { clave: null, token: null }, deps: sinRed });
    expect((r.violaciones as J[]).map((v) => v.regla)).toContain('repite_el_mensaje_anterior');
    expect(r.repeticiones).toBeGreaterThan(0);
  });
  it('si el aviso a recepción deja de respetar la ventana (avisa en cada toque), se dice «avisos_a_recepcion_inesperados»', async () => {
    const f = estropear("const a = aviso((chDatos(cfg).textos || {}).estadoAviso, true, antes.avisado === true && !empresaNueva);", "const a = aviso((chDatos(cfg).textos || {}).estadoAviso, true, false);");
    const c = { ...casoPorId('P1') };
    c['turnos'] = [...(c['turnos'] as J[]), { tipo: 'boton', id: 'equipo', exige: { plantillas: 0 } }];
    const r = await B.correrCaso({ caso: c, rep: 1, flujo: f, lib, opciones: { seco: true, n: 1 }, credencial: { clave: null, token: null }, deps: sinRed });
    expect((r.violaciones as J[]).map((v) => v.regla)).toContain('avisos_a_recepcion_inesperados');
  });
});

describe('argumentos, casos y secretos', () => {
  it('leerArgumentos: valida cada opción y rechaza lo desconocido, lo que falta y lo fuera de rango', () => {
    expect(B.leerArgumentos(['--seco']).seco).toBe(true);
    expect(B.leerArgumentos([])).toMatchObject({ seco: false, n: 3, casos: null, env: '.env.novuchat', vertex: null, locacion: 'us-central1' });
    expect(B.leerArgumentos(['--n', '5', '--casos', 'S1,P2']).casos).toEqual(['S1', 'P2']);
    for (const mal of [['--wat'], ['--n'], ['--n', '0'], ['--n', '21'], ['--n', 'x'], ['--casos', 'a b'], ['--vertex', 'MAL ID'], ['--locacion', '??'], ['--seco', '--env', 'x'], ['--seco', '--vertex', 'proyecto-ejemplo-1']]) {
      expect(() => B.leerArgumentos(mal), mal.join(' ')).toThrow();
    }
  });
  it('el código de salida: 0 si corrió, 2 por uso, sin traza; un caso desconocido nombra los que hay', async () => {
    expect((await correr(['--ayuda'], sinRed)).codigo).toBe(0);
    const r = await correr(['--wat'], sinRed);
    expect(r.codigo).toBe(2);
    expect(r.error).toMatch(/Opción desconocida/);
    const c = await correr(['--seco', '--casos', 'ZZZ'], sinRed);
    expect(c.codigo).toBe(2);
    expect(c.error).toMatch(/Caso desconocido: ZZZ\. Hay: S1/);
  });
  it('validarCasos: rechaza un caso mal escrito con su id', () => {
    const base = (): J => clonar(CASOS);
    expect(() => B.validarCasos(base())).not.toThrow();
    const probar = (cambiar: (d: J) => void, re: RegExp): void => { const d = base(); cambiar(d); expect(() => B.validarCasos(d)).toThrow(re); };
    probar((d) => { d['casos'][1]['id'] = d['casos'][0]['id']; }, /id repetido/);
    probar((d) => { d['casos'][0]['turnos'] = []; }, /sin turnos/);
    probar((d) => { d['casos'][0]['turnos'][0]['tipo'] = 'baile'; }, /tipo de turno desconocido/);
    probar((d) => { d['casos'][0]['turnos'][0]['exige'] = { magia: true }; }, /«exige» solo admite/);
    probar((d) => { d['casos'][0]['turnos'][0]['seco'] = { inventado: 'x' }; }, /«seco» debe ser un objeto/);
    probar((d) => { d['casos'][0]['planilla'] = { otra: 1 }; }, /«planilla» solo admite/);
    probar((d) => { const e = d['casos'].find((c: J) => c['id'] === 'E1'); e['turnos'][1]['eventos'] = [e['turnos'][1]['eventos'][0]]; }, /2 o más eventos/);
    probar((d) => { d['casos'] = []; }, /falta la lista/);
  });
  it('el archivo de casos no es un flujo ni lleva identificadores (el escáner de saneo lo toma por JSON de flujo: `nodes` vacío y la nota)', () => {
    expect(CASOS['nodes']).toEqual([]);
    expect(String(CASOS['_saneo'])).toMatch(/REEMPLAZAR_/);
    const texto = readFileSync(join(CARPETA, 'herramientas/bateria-casos.json'), 'utf8');
    for (const m of texto.match(/\d{10,}/g) ?? []) expect(m).toMatch(/0{6}/);
    expect(texto).not.toMatch(/AIza|EAA[A-Za-z0-9]{10,}|sk-|Bearer /);
  });
  it('teléfonos sintéticos: uno por caso y corrida, con seis ceros, nunca el de recepción ni el del negocio', () => {
    for (const c of CASOS['casos'] as J[]) for (const rep of [1, 2, 3]) {
      const t = B.telefonoDe(c['id'], rep) as string;
      expect(t).toMatch(/^591000000\d\d$/);
      expect(['59100000001', '59100000003']).not.toContain(t);
    }
  });
  it('con clave: la usa SOLO contra generativelanguage.googleapis.com, en el encabezado, y nunca la imprime (ni en un error)', async () => {
    const CLAVE = 'AI' + 'zaFAKE_clave_de_prueba_' + 'ABCDEFGHIJKLMNOP';
    const llamadas: J[] = [];
    const respuesta = (): J => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ mensaje: 'x', accion: 'ninguna', rubro: 'ninguno', necesidad: '', nombre: '', empresa: '', descarte: 'ninguno' }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 80, thoughtsTokenCount: 10 } }) });
    const deps: J = {
      leerArchivo: (r: string) => (r === '.env.novuchat' ? `GEMINI_API_KEY=${CLAVE}\n` : null),
      fetch: async (url: string, init: J) => { llamadas.push({ url, init }); return respuesta(); },
      gcloudToken: () => { throw new Error('no se pide un token'); },
    };
    const r = await correr(['--n', '1', '--casos', 'S1', '--json'], deps);
    expect(r.codigo, r.error).toBe(0);
    expect(r.salida + r.error).not.toContain(CLAVE);
    expect(r.error).toMatch(/variable GEMINI_API_KEY del entorno \(valor no mostrado\)/);
    expect(llamadas.length).toBeGreaterThan(0);
    for (const l of llamadas) {
      expect(new URL(l.url).hostname).toBe('generativelanguage.googleapis.com');
      expect(l.url).toMatch(/\/models\/gemini-3\.5-flash-lite:generateContent$/);
      expect(l.url).not.toContain(CLAVE);
      expect(l.init.headers['x-goog-api-key']).toBe(CLAVE);
    }
    const inf = JSON.parse(r.salida) as J;
    expect(inf['modo']).toBe('real');
    expect(inf['total'].uso.entrada).toBeGreaterThan(0);
    expect(inf['total'].uso.costoUsd).toBeGreaterThan(0);
    // el cuerpo que se envía es el que arma el flujo: instrucciones, historial y esquema
    const cuerpo = JSON.parse(String(llamadas[0]!.init.body)) as J;
    expect(Object.keys(cuerpo).sort()).toEqual(['contents', 'generationConfig', 'systemInstruction']);
    expect(cuerpo['generationConfig'].responseSchema.required).toHaveLength(7);
  }, 30_000);
  it('en modo REAL no cuentan como violación las exigencias que solo tienen sentido en `--seco` (frase literal, origen del texto, lo que «ve» el modelo, cómo termina lo que escribió el modelo)', async () => {
    const CLAVE = 'AI' + 'zaFAKE_clave_de_prueba_' + 'ABCDEFGHIJKLMNOP';
    // Un modelo real que redacta SU mensaje: bueno, pero con otras palabras que las del seco.
    const msg = 'Tienes un negocio muy interesante y NovuChat puede atender tu WhatsApp en segundos, agendar citas sin cruces y ayudarte a no perder ventas fuera de horario, todos los días. ¿Quieres ver nuestros planes o prefieres hablar con alguien de nuestro equipo? 🤝';
    const respuesta = (): J => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ mensaje: msg, accion: 'ninguna', rubro: 'ninguno', necesidad: '', nombre: '', empresa: '', descarte: 'ninguno' }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) });
    const deps: J = { leerArchivo: (r: string) => (r === '.env.novuchat' ? `GEMINI_API_KEY=${CLAVE}\n` : null), fetch: async () => respuesta(), gcloudToken: () => { throw new Error('no'); } };
    const r = await correr(['--n', '1', '--casos', 'S2,P1,P3,E2', '--json'], deps);
    const inf = JSON.parse(r.salida) as J;
    expect(inf['modo']).toBe('real');
    const ruido = ['origen_inesperado', 'el_modelo_no_ve_lo_que_se_exige', 'falta_lo_que_se_exige', 'no_termina_como_se_exige'];
    expect(Object.keys(inf['violaciones'].porRegla).filter((k) => ruido.includes(k)), JSON.stringify(inf['violaciones'].detalle).slice(0, 600)).toEqual([]);
    // lo que sí depende del modelo se sigue midiendo: tasa de respaldo y causas de rechazo salen en el informe
    expect(inf['total']).toHaveProperty('turnosConRespaldo');
    expect(inf['total']).toHaveProperty('causasDeRechazo');
    // y en seco las mismas exigencias SÍ se miden (el caso con la respuesta mala exige el respaldo)
    expect(JSON.stringify(CASOS)).toMatch(/"origen"/);
  }, 30_000);
  it('un error de la red con la clave dentro NO la deja pasar a la salida', async () => {
    const CLAVE = 'AI' + 'zaFAKE_clave_de_prueba_' + 'ABCDEFGHIJKLMNOP';
    const deps: J = {
      leerArchivo: (r: string) => (r === '.env.novuchat' ? `GEMINI_API_KEY=${CLAVE}\n` : null),
      fetch: async () => { throw new Error(`fallo de red con ${CLAVE} adentro`); },
    };
    const r = await correr(['--n', '1', '--casos', 'S1', '--json'], deps);
    expect(r.salida + r.error).not.toContain(CLAVE);
  }, 30_000);
  it('sin clave en el entorno: sale con 2 nombrando las variables buscadas, nunca un valor', async () => {
    const r = await correr(['--n', '1', '--casos', 'S1'], { leerArchivo: () => null, fetch: () => { throw new Error('sin red'); } });
    expect(r.codigo).toBe(2);
    expect(r.error).toMatch(/No hay clave del modelo en el entorno/);
    expect(r.error).toMatch(/GEMINI_API_KEY/);
  });
  it('limpiarSecretos quita las formas de clave y de token', () => {
    const t = B.limpiarSecretos(`x AIzaSyA1234567890123456789012345 y ya${'29'}.a0AbCdEf y Bearer abc.def z`, ['secreto-largo']);
    expect(t).not.toMatch(/AIza|ya29\.|abc\.def/);
    expect(B.limpiarSecretos('hay secreto-largo aquí', ['secreto-largo'])).toBe('hay [secreto] aquí');
  });
});
