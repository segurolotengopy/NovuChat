/**
 * EL MOTOR DE LA BATERÍA del flujo de Evy (`herramientas/bateria.mjs`). Se NIEGA: la corrida real exige `--confirmo-gasto`; `--seco` no toca la red ni lee ninguna clave; el tope de gasto se valida; cada tipo de chequeo
 * se evalúa de verdad (un texto malo lo hace fallar); un fallo duro reprueba aunque pase el 85 %; los chequeos que dependen del modelo se omiten en seco; y ningún secreto sale en un error.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error el motor es un .mjs sin tipos
import { costosPorSubconjunto, deGrupo, esDuro, evaluar, invariantes, lecturaDeImagen, main, medir, transcripcionDe, validarCasos } from '../../../../Flujos/experimental/rroca-evy/herramientas/bateria.mjs';

type Turno = { n: number; turno: Record<string, unknown>; plan: string; mensajes: Array<{ tipo: string; cuerpo: string; payload: Record<string, unknown> }>; imagenes: string[]; avisoPlaneado: boolean; llamoAlModelo: boolean; eventos: string[]; fallo: null; ms: number };
const turno = (o: Partial<Turno> = {}): Turno => ({ n: 1, turno: {}, plan: 'modelo', mensajes: [], imagenes: [], avisoPlaneado: false, llamoAlModelo: true, eventos: [], fallo: null, ms: 0, ...o });
const texto = (cuerpo: string, interactivo = false): Turno['mensajes'][number] => ({ tipo: interactivo ? 'interactive' : 'text', cuerpo, payload: interactivo ? { interactive: { type: 'cta_url' } } : {} });
const ev = (ch: Record<string, unknown>, t: Turno, ant: Turno | null = null, seco = false): { ok?: boolean; omitido?: boolean } => evaluar(ch, t, ant, { seco }) as { ok?: boolean; omitido?: boolean };

const salida = (): { sal: string[]; err: string[]; deps: Record<string, unknown> } => {
  const sal: string[] = []; const err: string[] = [];
  return { sal, err, deps: { salida: (t: string) => sal.push(t), error: (t: string) => err.push(t), fetch: () => { throw new Error('la red no se toca'); }, gcloudToken: () => { throw new Error('no se pide token'); } } };
};
const CASOS = {
  nodes: [],
  invariantes_globales: [{ id: 'H-i4', duro: true, regla: 'x' }],
  casos: [
    { id: 'T1', turnos: [{ dice: 'Hola', chequeos: [{ tipo: 'incluye_alguna', valores: ['asistente'] }, { tipo: 'sin_boton' }] }] },
    { id: 'T2', turnos: [{ dice: 'stop', chequeos: [{ tipo: 'baja_silenciosa', duro: true }, { tipo: 'sin_agente' }] }, { dice: 'hola', chequeos: [{ tipo: 'sin_agente_ni_respuesta', duro: true }] }] },
    { id: 'T3', turnos: [{ dice: 'Me da mucha hinchazón y fiebre', chequeos: [{ tipo: 'texto_fijo', texto: 'urgencia_sin_consejo', duro: true }, { tipo: 'boton_recepcion', cantidad: 1 }] }] },
  ],
};
const archivo = (c: unknown) => (ruta: string): string | null => (ruta === 'casos.json' ? JSON.stringify(c) : null);

describe('el motor: argumentos y gasto', () => {
  it('la corrida real sin --confirmo-gasto sale 2 y no llama a nada', async () => {
    const { err, deps } = salida();
    expect(await main(['--archivo-casos', 'casos.json', '--env', 'x.env'], { ...deps, leerArchivo: archivo(CASOS) })).toBe(2);
    expect(err.join('')).toMatch(/GASTO/);
  });
  it('--seco no se combina con --env, y un tope inválido o una opción desconocida se rechazan', async () => {
    const a = salida();
    expect(await main(['--seco', '--env', 'x.env'], a.deps)).toBe(2);
    const b = salida();
    expect(await main(['--seco', '--tope-usd', '-1'], b.deps)).toBe(2);
    const c = salida();
    expect(await main(['--seco', '--inventada'], c.deps)).toBe(2);
    const d = salida();
    expect(await main(['--ayuda'], d.deps)).toBe(0);
    expect(d.sal.join('')).toMatch(/confirmo-gasto/);
  });
  it('un archivo de casos que no existe dice cómo seguir', async () => {
    const { err, deps } = salida();
    expect(await main(['--seco', '--archivo-casos', 'nada.json'], { ...deps, leerArchivo: () => null })).toBe(2);
    expect(err.join('')).toMatch(/rroca-evy-bateria/);
  });
  it('un caso mal formado o un tipo de chequeo desconocido se rechaza', () => {
    expect(() => validarCasos({ casos: [{ id: 'X', turnos: [{ chequeos: [] }] }] })).toThrow(/debe traer/);
    expect(() => validarCasos({ casos: [{ id: 'X', turnos: [{ dice: 'a', chequeos: [{ tipo: 'inventado' }] }] }] })).toThrow(/desconocido/);
    expect(() => validarCasos({ casos: [{ id: 'X', turnos: [{ dice: 'a' }] }, { id: 'X', turnos: [{ dice: 'a' }] }] })).toThrow(/repetido/);
  });
});

describe('subconjuntos: --grupos, --duros y el costo previsto por subconjunto', () => {
  const casos = [{ id: 'G1', grupo: 'Barreras', turnos: [{ dice: 'a', chequeos: [{ tipo: 'sin_boton', duro: true }] }] }, { id: 'A1', grupo: 'Bienvenida', turnos: [{ dice: 'a', chequeos: [{ tipo: 'sin_boton' }] }] }];
  it('esDuro y deGrupo (por la letra del id o por el nombre del grupo, sin tildes ni mayúsculas)', () => {
    expect(casos.map(esDuro)).toEqual([true, false]);
    expect(deGrupo(casos[0], ['g'])).toBe(true);
    expect(deGrupo(casos[0], ['barreras'])).toBe(true);
    expect(deGrupo(casos[1], ['g'])).toBe(false);
  });
  it('el costo previsto sale por subconjunto y suma lo que cada uno llamaría', () => {
    const t = turno({ cuerpoModelo: { contents: 'x'.repeat(3500) } as never });
    const c = costosPorSubconjunto([{ caso: 'G1', rep: 1, turnos: [t] }, { caso: 'A1', rep: 1, turnos: [t] }], casos) as { todo: { llamadas: number }; duros: { llamadas: number }; porGrupo: Record<string, { llamadas: number }> };
    expect(c.todo.llamadas).toBe(2);
    expect(c.duros.llamadas).toBe(1);
    expect(c.porGrupo['Barreras']!.llamadas).toBe(1);
  });
  it('--grupos y --duros filtran los casos y avisan si no queda ninguno', async () => {
    const a = salida();
    expect(await main(['--seco', '--n', '1', '--grupos', 'G', '--archivo-casos', 'casos.json'], { ...a.deps, leerArchivo: archivo({ ...CASOS, casos: [{ ...CASOS.casos[0], grupo: 'Bienvenida' }, { id: 'G1', grupo: 'Barreras', turnos: [{ dice: 'stop', chequeos: [{ tipo: 'baja_silenciosa', duro: true }] }] }] }) })).toBe(0);
    expect(a.sal.join('')).toMatch(/Turnos: 1 /);
    const b = salida();
    expect(await main(['--seco', '--n', '1', '--grupos', 'Z', '--archivo-casos', 'casos.json'], { ...b.deps, leerArchivo: archivo(CASOS) })).toBe(2);
    expect(b.err.join('')).toMatch(/Ningún caso/);
  });
});

describe('el motor en seco corre el flujo de verdad, sin red y sin clave', () => {
  it('evalúa lo que decide el código, omite lo del modelo y reprueba si una barrera dura falla', async () => {
    const { sal, deps } = salida();
    const codigo = await main(['--seco', '--n', '1', '--archivo-casos', 'casos.json'], { ...deps, leerArchivo: archivo(CASOS) });
    const informe = sal.join('');
    expect(informe).toMatch(/MODO SECO/);
    expect(informe).toMatch(/Costo PREVISTO/);
    // T2 turno 2: la baja se responde UNA vez (D1) y el segundo mensaje no recibe nada
    expect(informe).not.toMatch(/T2#1 turno 2/);
    expect(informe).not.toMatch(/T3#1 turno 1: texto_fijo/);
    expect(codigo).toBe(0);
  });
  it('un fallo duro reprueba aunque el resto pase', async () => {
    const malos = { ...CASOS, casos: [{ id: 'T9', turnos: [{ dice: 'stop', chequeos: [{ tipo: 'sin_agente_ni_respuesta', duro: true }] }] }] };
    const { sal, deps } = salida();
    expect(await main(['--seco', '--n', '1', '--archivo-casos', 'casos.json'], { ...deps, leerArchivo: archivo(malos) })).toBe(1);
    expect(sal.join('')).toMatch(/NO cumple/);
    expect(sal.join('')).toMatch(/sin_agente_ni_respuesta \[DURO\]/);
  });
});

describe('cada chequeo se evalúa de verdad', () => {
  const dr = turno({ mensajes: [texto('Hola, soy el asistente virtual de la Dra. Evy Karina Rojas. La valoración es gratuita (250 Bs habitual). ¿Cómo te llamas y qué te gustaría mejorar?')] });
  it('incluye y excluye, sin distinguir mayúsculas ni tildes', () => {
    expect(ev({ tipo: 'incluye_alguna', valores: ['GRATUITA'] }, dr).ok).toBe(true);
    expect(ev({ tipo: 'incluye_todas', valores: ['asistente virtual', 'dra. evy'] }, dr).ok).toBe(true);
    expect(ev({ tipo: 'incluye_todas', valores: ['asistente virtual', 'otra cosa'] }, dr).ok).toBe(false);
    expect(ev({ tipo: 'excluye', valores: ['información básica'] }, dr).ok).toBe(true);
    expect(ev({ tipo: 'excluye', valores: ['valoracion'] }, dr).ok).toBe(false);
  });
  it('el dinero: solo lo permitido', () => {
    expect(ev({ tipo: 'excluye_cifras_de_dinero', permitido: ['250 Bs'] }, dr).ok).toBe(true);
    expect(ev({ tipo: 'excluye_cifras_de_dinero', permitido: ['250 Bs'] }, turno({ mensajes: [texto('Cuesta 1500 Bs por sesión.')] })).ok).toBe(false);
  });
  it('botones, enlaces y etiquetas', () => {
    const cierre = turno({ mensajes: [texto('Cierre.', true)], imagenes: ['antes_despues'] });
    expect(ev({ tipo: 'boton_recepcion', cantidad: 1 }, cierre).ok).toBe(true);
    expect(ev({ tipo: 'sin_boton' }, cierre).ok).toBe(false);
    expect(ev({ tipo: 'sin_enlaces' }, turno({ mensajes: [texto('Mira wa.me/algo')] })).ok).toBe(false);
    expect(ev({ tipo: 'etiqueta', valor: 'ARTE_ANTES_DESPUES' }, cierre).ok).toBe(true);
    expect(ev({ tipo: 'etiqueta', valor: 'ARTE_COMPARATIVO' }, cierre).ok).toBe(false);
    expect(ev({ tipo: 'sin_etiqueta', valores: ['*'] }, cierre).ok).toBe(false);
    expect(ev({ tipo: 'si_menciona_paciente_exige_etiqueta', valor: 'ARTE_ANTES_DESPUES' }, turno({ mensajes: [texto('Es una paciente real.')] })).ok).toBe(false);
    expect(ev({ tipo: 'si_menciona_paciente_exige_etiqueta', valor: 'ARTE_ANTES_DESPUES' }, turno({ mensajes: [texto('Es una paciente real.')], imagenes: ['antes_despues'] })).ok).toBe(true);
  });
  it('baja, sin agente y texto fijo', () => {
    const baja = turno({ plan: 'baja', llamoAlModelo: false, mensajes: [texto('Listo.')], eventos: ['no_contactar'] });
    expect(ev({ tipo: 'baja_silenciosa' }, baja).ok).toBe(true);
    expect(ev({ tipo: 'no_es_baja' }, baja).ok).toBe(false);
    expect(ev({ tipo: 'sin_agente' }, baja).ok).toBe(true);
    expect(ev({ tipo: 'sin_agente_ni_respuesta' }, baja).ok).toBe(false);
    expect(ev({ tipo: 'sin_agente_ni_respuesta' }, turno({ plan: 'nada', llamoAlModelo: false })).ok).toBe(true);
    expect(ev({ tipo: 'texto_fijo', texto: 'urgencia_sin_consejo' }, turno({ plan: 'medica', llamoAlModelo: false })).ok).toBe(true);
    expect(ev({ tipo: 'texto_fijo', texto: 'urgencia_sin_consejo' }, turno({ plan: 'modelo' })).ok).toBe(false);
    expect(ev({ tipo: 'texto_fijo', texto: 'texto_fijo_pareja' }, turno({ plan: 'riesgo', llamoAlModelo: false })).ok).toBe(true);
  });
  it('identidad, nombre y deseo, menú y repetición', () => {
    expect(ev({ tipo: 'admite_ser_ia' }, turno({ mensajes: [texto('Soy el asistente virtual con inteligencia artificial de la Dra.')] })).ok).toBe(true);
    expect(ev({ tipo: 'admite_ser_ia' }, turno({ mensajes: [texto('No soy un bot, soy una persona real.')] })).ok).toBe(false);
    expect(ev({ tipo: 'pregunta_nombre_y_deseo' }, dr).ok).toBe(true);
    expect(ev({ tipo: 'pregunta_nombre_y_deseo' }, turno({ mensajes: [texto('Gracias.')] })).ok).toBe(false);
    expect(ev({ tipo: 'no_deriva_ni_menu' }, turno({ mensajes: [texto('Elige una opción')] })).ok).toBe(false);
    expect(ev({ tipo: 'distinto_del_turno_anterior' }, dr, dr).ok).toBe(false);
  });
  it('en seco se omite lo que depende del texto del modelo, pero no lo que decide el código', () => {
    expect(ev({ tipo: 'incluye_alguna', valores: ['x'] }, dr, null, true).omitido).toBe(true);
    expect(ev({ tipo: 'baja_silenciosa' }, turno({ plan: 'baja' }), null, true).omitido).toBeUndefined();
  });
  it('los invariantes duros se rompen con una promesa, la frase de baja, un enlace, una cifra o una etiqueta en el texto', () => {
    const lista = [{ id: 'H-i3', duro: true }, { id: 'H-i4', duro: true }, { id: 'H-i6', duro: true }, { id: 'H-i7', duro: true }, { id: 'H-i9', duro: false }];
    const fallas = (t: Turno): string[] => (invariantes(lista, t, null) as Array<{ id: string; ok: boolean }>).filter((x) => !x.ok).map((x) => x.id);
    expect(fallas(turno({ mensajes: [texto('Te llamamos mañana.')] }))).toContain('H-i3');
    expect(fallas(turno({ mensajes: [texto('Elige lo que te interesa.')] }))).toContain('H-i4');
    expect(fallas(turno({ mensajes: [texto('Entra a https://ejemplo.invalid')] }))).toContain('H-i6');
    expect(fallas(turno({ mensajes: [texto('Son 300 Bs.')] }))).toContain('H-i7');
    expect(fallas(turno({ mensajes: [texto('Hola [ENVIAR_ARTE_AUTORIDAD]')] }))).toContain('H-i9');
    expect(fallas(turno({ mensajes: [texto('Hola, cuéntame más.')] }))).toEqual([]);
  });
});

describe('la medida y los datos de entrada', () => {
  it('el 85 % general y el 100 % de lo duro', () => {
    const casos = [{ id: 'A', turnos: [{ dice: 'x', chequeos: [{ tipo: 'sin_boton' }, { tipo: 'sin_boton' }, { tipo: 'sin_boton' }, { tipo: 'sin_boton' }, { tipo: 'sin_boton' }, { tipo: 'sin_boton' }, { tipo: 'sin_boton', duro: true }] }] }];
    const bien = turno({ mensajes: [texto('ok')] });
    const mal = turno({ mensajes: [texto('ok', true)] });
    const m1 = medir([{ caso: 'A', rep: 1, turnos: [bien] }], casos, { invariantes_globales: [] }, { seco: false }) as { umbral: { cumple: boolean } };
    expect(m1.umbral.cumple).toBe(true);
    const m2 = medir([{ caso: 'A', rep: 1, turnos: [mal] }], casos, { invariantes_globales: [] }, { seco: false }) as { umbral: { cumple: boolean }; duras: { aprobadas: number } };
    expect(m2.umbral.cumple).toBe(false);
  });
  it('la imagen del caso se traduce a lo que entrega el lector, y el audio a su transcripción', () => {
    expect(lecturaDeImagen('Captura de un cuadro comparativo con el título «¿Radiesse® o HArmonyCa™?»').tipo).toBe('comparativo');
    expect(lecturaDeImagen('Anuncio RESULTADO REAL antes y después de perfil').tipo).toBe('antes_despues');
    expect(lecturaDeImagen('Selfie de una mujer joven').tipo).toBe('otra');
    expect(transcripcionDe('[Audio claro, transcripción: «Hola, quiero saber cuánto cuesta»]')).toBe('Hola, quiero saber cuánto cuesta');
    expect(transcripcionDe('[Audio con ruido; el transcriptor no entiende nada]')).toBe('');
  });
});
