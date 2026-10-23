/**
 * LOS CONSTRUCTORES DE MENSAJES (`Flujos/experimental/comun-sin-agente/src/mensajes.js`).
 *
 * Se EJECUTAN con el mismo ayudante que las demás suites de flujos (`./lib/flujo`), que le quita al código los
 * globales que el sandbox de n8n no tiene (`URL`, `Buffer`, `crypto`, `process`, `require`…): si el módulo usara
 * alguno, aquí reventaría igual que en producción. Cada límite de la Cloud API de Meta tiene su caso que lo pasa.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const RUTA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/comun-sin-agente/src/mensajes.js');
const FUENTE = readFileSync(RUTA, 'utf8');
const NOMBRES = ['cmRecorte', 'cmTexto', 'cmBotones', 'cmLista', 'cmEnlace', 'cmUrlWa', 'cmMensaje', 'cmSinMencionDelBoton', 'cmMotivoAviso', 'cmTextosMismoNumero', 'cmContactoConBoton'] as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const M = ejecutar(`${FUENTE}\nreturn [{ json: { ${NOMBRES.join(', ')} } }];`, [{}])[0] as Record<(typeof NOMBRES)[number], Fn>;

describe('el módulo es autosuficiente', () => {
  it('no usa funciones cn*, nodos, require ni los globales que n8n no tiene', () => {
    const sinComentarios = FUENTE.replace(/\/\/.*$/gm, '');
    expect(sinComentarios).not.toMatch(/\bcn[A-Z]\w*\(/);
    expect(sinComentarios).not.toMatch(/\$\(|\$input|\$json|\brequire\(|\bURL\b|\bBuffer\b|\bcrypto\b|\bprocess\b/);
  });
  it('todos sus nombres llevan el prefijo cm (no choca con las ayudas cn* del flujo)', () => {
    const declarados = [...FUENTE.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(declarados.length).toBeGreaterThanOrEqual(NOMBRES.length);
    expect(declarados.filter((n) => !/^cm[A-Z]/.test(n!))).toEqual([]);
  });
});

describe('texto', () => {
  it('cuerpo de la Cloud API con `to` vacío (lo pone el último nodo) y vista previa de enlaces', () => {
    expect(M.cmTexto('Hola')).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '', type: 'text', text: { preview_url: true, body: 'Hola' } });
  });
  it('recorta a 4000 con «…» y no antes', () => {
    expect(M.cmTexto('a'.repeat(4000)).text.body).toHaveLength(4000);
    const largo = M.cmTexto('a'.repeat(4001)).text.body as string;
    expect(largo).toHaveLength(4000);
    expect(largo.endsWith('…')).toBe(true);
  });
  it('un valor ausente no escribe «undefined» ni «null»', () => {
    expect(M.cmTexto(undefined).text.body).toBe('');
    expect(M.cmTexto(null).text.body).toBe('');
    expect(M.cmRecorte(undefined, 10)).toBe('');
  });
});

describe('botones', () => {
  const tres = [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }, { id: 'c', title: 'Tres' }, { id: 'd', title: 'Cuatro' }];
  it('como mucho TRES botones (Meta rechaza cuatro)', () => {
    const b = M.cmBotones('Elige', tres).interactive.action.buttons;
    expect(b).toHaveLength(3);
    expect(b.map((x: { reply: { id: string } }) => x.reply.id)).toEqual(['a', 'b', 'c']);
  });
  it('título a 20, cuerpo a 1024 e id a 200', () => {
    const m = M.cmBotones('c'.repeat(1100), [{ id: 'i'.repeat(300), title: 'T'.repeat(30) }]);
    expect(m.interactive.body.text).toHaveLength(1024);
    expect(m.interactive.action.buttons[0].reply.title).toHaveLength(20);
    expect(m.interactive.action.buttons[0].reply.id).toHaveLength(200);
    expect(m.interactive.type).toBe('button');
  });
  it('sin botones no revienta (lista vacía)', () => {
    expect(M.cmBotones('x', undefined).interactive.action.buttons).toEqual([]);
  });
});

describe('lista', () => {
  const filas = Array.from({ length: 12 }, (_, i) => ({ id: 'f' + i, title: 'Fila ' + i + ' ' + 'x'.repeat(30), description: 'd'.repeat(100) }));
  it('como mucho DIEZ filas, título a 24 y descripción a 72', () => {
    const l = M.cmLista('Cuerpo', 'Ver opciones muy largas del menú', 'Un título de sección larguísimo', filas).interactive;
    expect(l.type).toBe('list');
    expect(l.action.sections[0].rows).toHaveLength(10);
    expect(l.action.sections[0].rows[0].title).toHaveLength(24);
    expect(l.action.sections[0].rows[0].description).toHaveLength(72);
    expect(l.action.button).toHaveLength(20);
    expect(l.action.sections[0].title).toHaveLength(24);
  });
  it('una fila sin descripción la lleva vacía (no «undefined»)', () => {
    expect(M.cmLista('c', 'b', 't', [{ id: 'a', title: 'A' }]).interactive.action.sections[0].rows[0].description).toBe('');
  });
});

describe('enlace y URL de WhatsApp', () => {
  it('cta_url con el texto del botón a 20', () => {
    const e = M.cmEnlace('Mira', 'Un texto de botón largo de más', 'https://ejemplo.com/x').interactive;
    expect(e.type).toBe('cta_url');
    expect(e.action.parameters).toEqual({ display_text: 'Un texto de botón l…', url: 'https://ejemplo.com/x' });
  });
  it('cmUrlWa deja solo dígitos en el número y codifica el saludo', () => {
    expect(M.cmUrlWa('+12 3456-78', 'Hola, soy yo & más')).toBe('https://wa.me/12345678?text=Hola%2C%20soy%20yo%20%26%20m%C3%A1s');
  });
  it('NIEGA: un saludo con «&» o «#» no corta el enlace', () => {
    expect(M.cmUrlWa('1', 'a&b#c')).not.toMatch(/[&#]/);
  });
  it('sin saludo no deja «undefined»', () => {
    expect(M.cmUrlWa('123', undefined)).toBe('https://wa.me/123?text=');
  });
});

describe('item de salida', () => {
  it('el respaldo es el texto si no se da', () => {
    expect(M.cmMensaje('cliente', {}, 'T', undefined, { tipoReporte: 'text' })).toEqual({ para: 'cliente', payload: {}, texto: 'T', respaldo: 'T', tipoReporte: 'text' });
  });
  it('un respaldo explícito manda', () => {
    expect(M.cmMensaje('cliente', {}, 'T', 'R').respaldo).toBe('R');
  });
});

describe('pasar con una persona: el botón, o solo texto', () => {
  const op = { numero: '71234561', desde: '71234562', cuerpo: 'Eso lo coordina recepción. Tócale el botón y le escribes directo.', botonTexto: 'Escribir a recepción', saludo: 'Hola', evento: 'no_contactar' };
  it('con número distinto del de quien escribe: botón cta_url a wa.me, y el respaldo lleva el enlace', () => {
    const m = M.cmContactoConBoton(op);
    expect(m.conBoton).toBe(true);
    expect(m.tipoReporte).toBe('interactive');
    expect(m.payload.interactive.type).toBe('cta_url');
    expect(m.payload.interactive.action.parameters.url).toBe('https://wa.me/71234561?text=Hola');
    expect(m.respaldo).toContain('Escríbele aquí: https://wa.me/71234561?text=Hola');
    expect(m.texto).toBe(op.cuerpo);
    expect(m.evento).toBe('no_contactar');
    expect(m.para).toBe('cliente');
  });
  it('NIEGA: sin número no hay botón y el texto NO nombra uno', () => {
    const m = M.cmContactoConBoton({ ...op, numero: '' });
    expect(m.conBoton).toBe(false);
    expect(m.payload.type).toBe('text');
    expect(m.texto).not.toMatch(/bot[oó]n/i);
    expect(m.texto).toBe('Eso lo coordina recepción.');
    expect(m.respaldo).toBe(m.texto);
  });
  it('NIEGA: si el número es el de quien escribe, tampoco hay botón (un botón a su propio chat no sirve)', () => {
    const m = M.cmContactoConBoton({ ...op, numero: '+7 1234 562', desde: '71234562' });
    expect(m.conBoton).toBe(false);
    expect(m.payload.type).toBe('text');
  });
  it('si al quitar la mención no queda nada, sale el texto por defecto', () => {
    expect(M.cmSinMencionDelBoton('Tócale el botón.', 'Lo coordina una persona.')).toBe('Lo coordina una persona.');
    expect(M.cmSinMencionDelBoton('Hola. Toca el botón de abajo', 'x')).toBe('Hola.');
    expect(M.cmSinMencionDelBoton('Escríbele tocando el botón de abajo.', 'x')).toBe('x');
  });
  it('un texto sin mención del botón queda igual', () => {
    expect(M.cmSinMencionDelBoton('Gracias por escribirnos.', 'x')).toBe('Gracias por escribirnos.');
  });
  it('`para` se puede cambiar (el flujo nombra a sus destinatarios)', () => {
    expect(M.cmContactoConBoton({ ...op, para: 'paciente' }).para).toBe('paciente');
  });
});

describe('lo que la revisión de seguridad encontró (01/10): recortes seguros, solo https y respaldo que no pierde el enlace', () => {
  it('NIEGA: un recorte nunca parte un emoji por la mitad (Meta rechaza un medio carácter)', () => {
    const t = M.cmRecorte('abc😀😀😀😀', 5);
    expect(t).not.toMatch(/[\uD800-\uDBFF]…?$/);
    expect(t.endsWith('…')).toBe(true);
    expect(M.cmRecorte('😀'.repeat(30), 20)).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(M.cmRecorte('hola', 20)).toBe('hola');
  });
  it('NIEGA: un botón con enlace que no es https no sale como botón (sale el texto, sin el enlace)', () => {
    for (const url of ['javascript:alert(1)', 'http://ejemplo.com', 'data:text/html,x', 'ftp://x.example', '//x.example', 'https://', 'https://a b']) {
      const m = M.cmEnlace('Mira', 'Abrir', url);
      expect(m.type, url).toBe('text');
      expect(JSON.stringify(m), url).not.toContain(url.split(' ')[0]);
    }
    expect(M.cmEnlace('Mira', 'Abrir', 'https://ejemplo.com/x').interactive.type).toBe('cta_url');
  });
  it('NIEGA: el respaldo de «pasar con una persona» nunca pasa de 4000 y NO corta el enlace del final', () => {
    const m = M.cmContactoConBoton({ numero: '71234561', desde: '71234562', cuerpo: 'x'.repeat(5000), botonTexto: 'Escribir', saludo: 'Hola' });
    expect(m.respaldo.length).toBeLessThanOrEqual(4000);
    expect(m.respaldo.endsWith('https://wa.me/71234561?text=Hola')).toBe(true);
  });
});

describe('segunda revisión de seguridad (02/10): el saludo largo no rompe el respaldo', () => {
  it('NIEGA: con un saludo y un texto de respaldo larguísimos, el respaldo sigue ≤ 4000 y termina con el enlace', () => {
    const m = M.cmContactoConBoton({ numero: '71234561', desde: '71234562', cuerpo: 'x'.repeat(5000), botonTexto: 'Escribir', saludo: 'h'.repeat(9000), textoDelRespaldo: 'r'.repeat(9000) });
    expect(m.respaldo.length).toBeLessThanOrEqual(4000);
    expect(m.respaldo).toMatch(/https:\/\/wa\.me\/71234561\?text=h+(%E2%80%A6)?$/);
    expect(m.payload.interactive.action.parameters.url.length).toBeLessThan(700);
  });
});

describe('PROMESA SIN RESPALDO DEL BOTÓN: quien escribe es la recepción', () => {
  // Todas las plantillas de cuerpo que los flujos le pasan a `cmContactoConBoton`, y algunas variantes de redacción.
  const CUERPOS = [
    'Eso lo coordina recepción. Tócale el botón y le escribes directo.',
    'Ya le avisé a Rubén. Escríbele directo con el botón de abajo.',
    'Para eso toca el botón y escríbele a recepción.',
    'Escríbele tocando el botón.',
    'TOCA EL BOTON para hablar con recepción',
    'Pasa con recepción: pulsa el botón de arriba.',
    'Usa el botón y listo.',
    'Te paso con recepción 👇\n\nEl botón abre su chat.',
    'Botón de recepción disponible.',
  ];
  const base = { numero: '71234561', desde: '71234561', botonTexto: 'Escribir', saludo: 'Hola' };
  it('NIEGA: desde === recepción nunca produce un texto con «botón» (texto, respaldo y payload), con cualquier cuerpo', () => {
    for (const cuerpo of CUERPOS) for (const desde of ['71234561', '+7 1234 561', '71234561 ']) {
      const m = M.cmContactoConBoton({ ...base, desde, cuerpo });
      expect(m.conBoton).toBe(false);
      expect(m.payload.type).toBe('text');
      for (const t of [m.texto, m.respaldo, m.payload.text.body]) {
        expect(t).not.toMatch(/bot[oó]n/i);
        expect(t).not.toMatch(/\btoca|t[oó]cale|pulsa|presiona|aprieta/i);
      }
    }
  });
  it('el texto de ese caso no promete lo que no se cumple (nada de «te escribirán», «te llamamos», «ya avisé», «lo consulto»)', () => {
    const m = M.cmContactoConBoton({ ...base, cuerpo: CUERPOS[1] });
    expect(m.texto).not.toMatch(/te (escribir|llam|avis)|ya (le )?avis|lo consulto|luego|enseguida/i);
    expect(m.texto).toContain('mismo número de recepción');
  });
  it('un texto propio del flujo para ese caso (`sinBotonMismoNumero`) también se limpia si nombra el botón', () => {
    const m = M.cmContactoConBoton({ ...base, cuerpo: 'x', sinBotonMismoNumero: 'Estás en recepción. Toca el botón.' });
    expect(m.texto).toBe('Estás en recepción.');
  });
  it('sin número de recepción, el cuerpo sigue sin mencionar el botón (comportamiento anterior)', () => {
    for (const cuerpo of CUERPOS) expect(M.cmContactoConBoton({ ...base, numero: '', cuerpo }).texto).not.toMatch(/bot[oó]n/i);
  });
  it('con número distinto sí hay botón y el cuerpo queda intacto', () => {
    const m = M.cmContactoConBoton({ ...base, desde: '71234562', cuerpo: CUERPOS[0] });
    expect(m.conBoton).toBe(true);
    expect(m.texto).toBe(CUERPOS[0]);
  });
  it('cmSinMencionDelBoton detecta cada variante (con y sin tilde, mayúsculas)', () => {
    for (const v of ['toca el botón', 'Toca el boton', 'TÓCALE EL BOTÓN', 'tócale el botón de abajo', 'tocando el botón', 'con el botón', 'con el boton de abajo', 'pulsa el botón', 'presiona el botón', 'aprieta el boton', 'usa el botón', 'el botón', 'botón', 'BOTON']) {
      const s = M.cmSinMencionDelBoton('Hola equipo. ' + v + ' ahora.', 'por defecto') as string;
      expect(s, v).not.toMatch(/bot[oó]n/i);
      expect(s, v).toBe('Hola equipo.');
    }
    expect(M.cmSinMencionDelBoton('Escríbele con el botón.', 'D')).toBe('D');
    expect(M.cmSinMencionDelBoton('Toca el botón', 'D')).toBe('D');
  });
});

describe('cmMotivoAviso: por qué no salió el aviso', () => {
  const rec = '71234561';
  it('tope, mismo número y Meta, cada rama', () => {
    expect(M.cmMotivoAviso({ aviso: 'no_salio', motivoFallo: 'tope_avisos', planeado: false, desde: '71234562', numeroRecepcion: rec })).toBe('tope');
    expect(M.cmMotivoAviso({ aviso: 'no_salio', motivoFallo: 'sin_destinatario', planeado: false, desde: '+7 1234 561', numeroRecepcion: rec })).toBe('mismo_numero');
    expect(M.cmMotivoAviso({ aviso: 'no_salio', motivoFallo: '', planeado: true, desde: '71234562', numeroRecepcion: rec })).toBe('meta');
  });
  it('NIEGA: con `salio` o `ninguno` nunca hay motivo; sin datos, vacío; causas que no son las tres, vacío', () => {
    for (const aviso of ['salio', 'ninguno', undefined, 'otro']) expect(M.cmMotivoAviso({ aviso, motivoFallo: 'tope_avisos', planeado: true, desde: rec, numeroRecepcion: rec })).toBe('');
    expect(M.cmMotivoAviso(undefined)).toBe('');
    expect(M.cmMotivoAviso({})).toBe('');
    expect(M.cmMotivoAviso({ aviso: 'no_salio', motivoFallo: 'plantilla_no_configurada', planeado: false, desde: '71234562', numeroRecepcion: rec })).toBe('');
    expect(M.cmMotivoAviso({ aviso: 'no_salio', motivoFallo: 'sin_destinatario', planeado: false, desde: '71234562', numeroRecepcion: '' })).toBe('');
  });
});

describe('la limpieza quita la oración entera, nunca deja una frase rota', () => {
  it('NIEGA: «Dale al botón para escribirle.», «Haz clic en el botón de abajo.», «El botón rojo cuesta 50 Bs.», «Usa el botón o llama al 70000000.»', () => {
    for (const f of ['Dale al botón para escribirle.', 'Haz clic en el botón de abajo.', 'El botón rojo cuesta 50 Bs.', 'Usa el botón o llama al 70000000.']) {
      const s = M.cmSinMencionDelBoton('Eso lo ve recepción. ' + f + ' Gracias.', 'D') as string;
      expect(s, f).toBe('Eso lo ve recepción. Gracias.');
      expect(M.cmSinMencionDelBoton(f, 'D'), f).toBe('D');
    }
    expect(M.cmSinMencionDelBoton('Hola 👇\n\nEl botón abre su chat.\n\nGracias.', 'D')).toBe('Hola 👇\n\nGracias.');
  });
  it('tiempo lineal: 4096 y 20.000 espacios (o puntos) no cuelgan (< 50 ms)', () => {
    for (const n of [4096, 20000]) for (const base of [' ', ' .', '\n ']) {
      const t0 = Date.now();
      M.cmSinMencionDelBoton('a' + base.repeat(n) + 'tócale el botón' + base.repeat(n), 'D');
      expect(Date.now() - t0).toBeLessThan(50);
    }
  });
});

describe('la rotación por contador (flujos sin memoria del último texto)', () => {
  it('NIEGA: dos contadores seguidos nunca dan el mismo texto', () => {
    const op = { numero: '71234561', desde: '71234561', cuerpo: 'x', botonTexto: 'E', saludo: 'h' };
    for (let n = 0; n < 9; n++) expect(M.cmContactoConBoton({ ...op, rotacion: n }).texto).not.toBe(M.cmContactoConBoton({ ...op, rotacion: n + 1 }).texto);
    expect(M.cmContactoConBoton({ ...op, rotacion: NaN }).texto).toBe(M.cmTextosMismoNumero[0]);
  });
});

describe('tres redacciones fijas para el mismo número, sin repetir la última', () => {
  const op = { numero: '71234561', desde: '71234561', cuerpo: 'x', botonTexto: 'E', saludo: 'h' };
  it('son 3, distintas, sin botón ni promesa', () => {
    const t = M.cmTextosMismoNumero as string[];
    expect(new Set(t).size).toBe(3);
    for (const x of t) { expect(x).not.toMatch(/bot[oó]n|te (escribir|llam|avis)|ya (le )?avis|luego/i); expect(M.cmSinMencionDelBoton(x, 'D')).toBe(x); }
  });
  it('NIEGA: con `esRepetido` nunca devuelve la redacción que acaba de salir, en cadena de 6 turnos', () => {
    let ultimo = '';
    for (let i = 0; i < 6; i++) {
      const m = M.cmContactoConBoton({ ...op, esRepetido: (x: string) => x === ultimo });
      expect(m.texto).not.toBe(ultimo);
      expect(m.texto).not.toMatch(/bot[oó]n/i);
      ultimo = m.texto;
    }
  });
});
