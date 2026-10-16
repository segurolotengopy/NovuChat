/**
 * H2 «INTERVENCIÓN DE UNA PERSONA» — LA PANTALLA: QUÉ PINTA Y QUÉ NO HACE (guardas de fuente), SIN NAVEGADOR NI RED.
 *
 * Los componentes se pintan con `react-dom/server` (sin efectos): sirve para ver QUÉ botones, textos y atributos salen en
 * cada situación. El comportamiento con clic (doble clic, reintento, teclado) lo prueba `pruebas-navegador/conversaciones-turno.spec.ts`
 * con las callables simuladas, y la lógica de cada decisión está en `turno-logica.test.ts`.
 *
 *  A. BarraTurno: el estado y los botones por rol y por situación; el propietario solo lee; el uid va abreviado y escapado.
 *  B. EscribirComoPersona: ventana abierta (cuenta regresiva), sin dato, cerrada; contador; campo con etiqueta.
 *  C. NEGATIVAS de fuente: nada de HTML, de `e.message`, de almacenamiento del navegador, de `fetch`, de `Math.random`; las
 *     llamadas al servidor son SOLO las tres callables del contrato y con SOLO los campos del contrato.
 *  D. El Detalle junta las piezas y el mensaje de una persona se pinta distinto, con rótulo abreviado y su estado.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accionesDeTurno, situacionDeTurno, turnoDeDocumento, type CapaTurno,
} from '../../web/src/central/lib/turno';
import { puedeGestionarConversaciones } from '../../web/src/central/lib/conversaciones';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const leer = (ruta: string) => readFileSync(join(ADMIN, ruta), 'utf8');
const codigo = (ruta: string) => leer(ruta)
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { BarraTurno } = await import('../../web/src/central/componentes/BarraTurno');
const { EscribirComoPersona } = await import('../../web/src/central/componentes/EscribirComoPersona');

const YO = 'uidDeLaCajera0123456789abcd';
const OTRA = 'uidDeOtraPersona0123456789ab';
const CAPA: CapaTurno = { tomar: async () => ({}), devolver: async () => ({}), enviar: async () => ({}) };

/** BarraTurno tal como la arma el Detalle: la situación y las acciones salen de la lógica. */
function barra(o: { turno?: unknown; rol: string | null; propietario?: boolean; activo?: boolean }): string {
  const turno = turnoDeDocumento(o.turno);
  const propietario = o.propietario ?? false;
  const situacion = situacionDeTurno(turno, YO);
  const acciones = accionesDeTurno({
    situacion, puedeGestionar: puedeGestionarConversaciones(o.rol, propietario),
    esAdmin: o.rol === 'admin' && !propietario, comercioActivo: o.activo ?? true,
  });
  return renderToStaticMarkup(createElement(BarraTurno, {
    tenantId: 'comercio-x', conversacionId: 'wa_59100000047', turno, situacion, acciones, miUid: YO, capa: CAPA,
  }));
}
const MIO = { responde: 'persona', tomadoPor: YO };
const AJENO = { responde: 'persona', tomadoPor: OTRA };

describe('A. quién responde y los botones', () => {
  it('responde el asistente + admin/oper: estado, «Tomar conversación» y el aviso de que el asistente deja de responder', () => {
    for (const rol of ['admin', 'oper']) {
      const h = barra({ rol });
      expect(h, rol).toContain('Responde el asistente');
      expect(h, rol).toContain('Tomar conversación');
      expect(h, rol).toContain('el asistente deja de responder');
      expect(h, rol).not.toContain('Devolver');
    }
  });

  it('la tengo yo: «Responde una persona (usted)» y «Devolver al asistente», sin «Tomar»', () => {
    const h = barra({ rol: 'oper', turno: MIO });
    expect(h).toContain('Responde una persona (usted)');
    expect(h).toContain('Devolver al asistente');
    expect(h).not.toContain('Tomar conversación');
    expect(h).not.toContain('Responde el asistente');
  });

  it('la tiene otra persona: se ve quién (abreviado); un oper no ve ningún botón y un admin puede devolverla', () => {
    const oper = barra({ rol: 'oper', turno: AJENO });
    expect(oper).toContain(`Responde una persona (${OTRA.slice(0, 6)}…)`);
    expect(oper).not.toContain('<button');
    const admin = barra({ rol: 'admin', turno: AJENO });
    expect(admin).toContain('Devolver al asistente');
    expect(admin).not.toContain('Tomar conversación');
    expect(admin).not.toContain(OTRA);          // el uid nunca entero
  });

  it('NEGATIVA: el propietario de NovuChat, el soporte y la ingesta solo LEEN: el estado sí, ningún botón', () => {
    for (const o of [{ rol: 'admin', propietario: true }, { rol: null }, { rol: 'ingesta' }, { rol: 'soporte' }]) {
      for (const turno of [undefined, MIO, AJENO]) {
        const h = barra({ ...o, turno });
        expect(h, JSON.stringify({ o, turno })).not.toContain('<button');
        expect(h, JSON.stringify({ o, turno })).toContain('data-testid="estado-turno"');
      }
    }
  });

  it('con un `turno` raro se ve «Responde el asistente», nunca «una persona»', () => {
    for (const turno of ['persona', { responde: 'Persona', tomadoPor: YO }, { responde: 'persona' }, 42, [], { responde: 'persona', tomadoPor: '' }]) {
      const h = barra({ rol: 'admin', turno });
      expect(h, JSON.stringify(turno)).toContain('Responde el asistente');
      expect(h, JSON.stringify(turno)).not.toContain('Responde una persona');
    }
  });

  it('con el comercio no activo los botones se ven deshabilitados y dicen por qué', () => {
    const h = barra({ rol: 'admin', activo: false });
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Tomar conversación/);
    expect(h).toContain('El comercio no está activo');
  });

  it('el estado se anuncia (`role="status"`) y el grupo tiene nombre accesible', () => {
    const h = barra({ rol: 'admin' });
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-label="Quién responde esta conversación"');
  });

  it('NEGATIVA: un uid con HTML se escapa y se abrevia; nunca llega como marcado', () => {
    const h = barra({ rol: 'oper', turno: { responde: 'persona', tomadoPor: '<img src=x onerror=alert(1)>' + 'z'.repeat(20) } });
    expect(h).not.toContain('<img');
    expect(h).not.toContain('onerror=alert');
    expect(h).toContain('&lt;img');
  });
});

describe('B. el campo para escribir', () => {
  const AHORA = Date.UTC(2026, 9, 16, 16, 0, 0);
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(AHORA); });
  afterEach(() => { vi.useRealTimers(); });
  const campo = (ultimoEntranteEn: number | null, habilitados = true) =>
    renderToStaticMarkup(createElement(EscribirComoPersona, {
      tenantId: 'comercio-x', conversacionId: 'wa_59100000047', ultimoEntranteEn, habilitados, capa: CAPA,
    }));

  it('ventana abierta: cuenta regresiva desde `ultimoEntranteEn`, campo con etiqueta, contador y «Enviar» (vacío = deshabilitado)', () => {
    const h = campo(AHORA - 20 * 3_600_000);
    expect(h).toContain('04:00:00');
    expect(h).toContain('role="timer"');
    expect(h).toContain('<label for="cv-redactor-texto"');
    expect(h).toContain('Mensaje para el cliente');
    expect(h).toContain('0 / 1.000');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Enviar/);
    expect(h).not.toMatch(/<textarea[^>]*disabled/);
    expect(h).not.toContain('No consta cuándo');
  });

  it('SIN DATO: no se puede enviar y se explica; sin cuenta regresiva', () => {
    const h = campo(null);
    expect(h).toContain('No consta cuándo escribió el cliente');
    expect(h).toContain('No se puede enviar');
    expect(h).not.toContain('cuenta-regresiva');
    expect(h).toMatch(/<textarea[^>]*disabled/);
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Enviar/);
  });

  it('ventana CERRADA (más de 24 h): campo deshabilitado y el porqué', () => {
    const h = campo(AHORA - 25 * 3_600_000);
    expect(h).toContain('ventana de 24 h de WhatsApp está cerrada');
    expect(h).toMatch(/<textarea[^>]*disabled/);
    expect(h).not.toContain('cuenta-regresiva');
  });

  it('comercio no activo: deshabilitado y lo dice', () => {
    const h = campo(AHORA - 3_600_000, false);
    expect(h).toContain('El comercio no está activo');
    expect(h).toMatch(/<textarea[^>]*disabled/);
  });

  it('el campo se declara descrito por el contador (accesible) y no viene marcado como inválido al empezar', () => {
    const h = campo(AHORA - 3_600_000);
    expect(h).toContain('aria-describedby="cv-redactor-contador"');
    expect(h).not.toContain('aria-invalid');
  });
});

describe('C. NEGATIVAS de fuente de lo nuevo', () => {
  const NUEVOS = [
    'web/src/central/lib/turno.ts',
    'web/src/central/componentes/BarraTurno.tsx',
    'web/src/central/componentes/EscribirComoPersona.tsx',
  ];

  it('nada de HTML, de almacenamiento del navegador, de `fetch` ni de `e.message`', () => {
    for (const ruta of NUEVOS) {
      const c = codigo(ruta);
      for (const prohibido of ['dangerouslySetInnerHTML', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'localStorage',
        'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'eval(', 'new Function']) {
        expect(c, `${ruta} usa ${prohibido}`).not.toContain(prohibido);
      }
      expect(c, `${ruta} lee .message`).not.toMatch(/\.message\b/);
      expect(c, `${ruta} lee ['message']`).not.toMatch(/\[\s*['"]message['"]\s*\]/);
    }
  });

  it('la clave sale de bytes aleatorios del navegador (`crypto.getRandomValues`), nunca de `Math.random` ni de la hora', () => {
    const c = codigo('web/src/central/lib/turno.ts');
    expect(c).toContain('globalThis.crypto.getRandomValues(bytes)');
    expect(c).not.toContain('Math.random');
    expect(c).not.toMatch(/nuevaClave[\s\S]{0,200}Date\.now/);
  });

  it('las tres callables, y SOLO con los campos del contrato; la pantalla no escribe `turno` ni mensajes', () => {
    const c = codigo('web/src/central/lib/turno.ts');
    const llamadas = [...c.matchAll(/httpsCallable\s*(?:<[^>]*>)?\(([^)]*)\)\(\s*(\{[^}]*\})/g)].map((m) => `${m[1]!.replace(/\s+/g, ' ')} ${m[2]!.replace(/\s+/g, ' ')}`);
    expect(llamadas).toEqual([
      "funciones, 'tomarConversacion' { tenantId: e.tenantId, conversacionId: e.conversacionId }",
      "funciones, 'devolverConversacion' { tenantId: e.tenantId, conversacionId: e.conversacionId }",
      "funciones, 'enviarComoPersona' { tenantId: e.tenantId, conversacionId: e.conversacionId, texto: e.texto, claveIdempotencia: e.claveIdempotencia }",
    ]);
    for (const ruta of [...NUEVOS, 'web/src/central/paginas/ConversacionesNueva.tsx', 'web/src/central/componentes/DetalleConversacion.tsx']) {
      const f = codigo(ruta);
      for (const escritura of ['setDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) expect(f, `${ruta} usa ${escritura}`).not.toContain(escritura);
    }
  });

  it('los componentes no hablan con Firebase: reciben la capa (así una prueba la reemplaza)', () => {
    for (const ruta of ['web/src/central/componentes/BarraTurno.tsx', 'web/src/central/componentes/EscribirComoPersona.tsx']) {
      expect(codigo(ruta), ruta).not.toMatch(/from 'firebase\//);
      expect(codigo(ruta), ruta).not.toMatch(/core\/lib\/firebase/);
    }
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain('capaTurnoReal(funciones)');
  });

  it('el envío se frena con un `ref` (doble clic) y mientras se envía el campo es de solo lectura; nunca hay reintento automático', () => {
    const c = codigo('web/src/central/componentes/EscribirComoPersona.tsx');
    expect(c).toContain('if (enCurso.current || !puedeEnviar) return;');
    expect(c).toContain('enCurso.current = true;');
    expect(c).toContain('readOnly={enviando}');
    expect(c).toMatch(/disabled=\{!puedeEnviar\}/);
    // «Enviar» solo con algo escrito, dentro del tope, con la ventana abierta y sin otro envío en curso.
    expect(c).toContain('const puedeEnviar = !enviando && motivo === null && texto.hayTexto && !texto.excede;');
    expect(c).not.toMatch(/setTimeout|setInterval\([^)]*enviar|reintent\w*\s*\(/i);
    const b = codigo('web/src/central/componentes/BarraTurno.tsx');
    expect(b).toContain('if (enCurso.current || !acciones.habilitados) return;');
  });

  it('el teclado: Ctrl+Enter (o Cmd+Enter) envía, Enter solo agrega un salto; el campo tiene etiqueta y descripción', () => {
    const c = codigo('web/src/central/componentes/EscribirComoPersona.tsx');
    expect(c).toContain("(e.ctrlKey || e.metaKey) && e.key === 'Enter'");
    expect(c).toContain('htmlFor="cv-redactor-texto"');
    expect(c).toContain('id="cv-redactor-texto"');
    expect(c).toContain('aria-describedby=');
    expect(c).toContain('aria-invalid=');
    expect(c).toContain('role="alert"');
  });

  it('todo texto de tercero (uid, rótulo, nombre) pasa por <TextoSeguro>', () => {
    expect(codigo('web/src/central/componentes/BarraTurno.tsx')).toContain('<TextoSeguro valor={textoEstadoTurno(p.turno, p.miUid)} maxLargo={80} />');
    expect(codigo('web/src/central/componentes/DetalleConversacion.tsx')).toContain('<TextoSeguro valor={rotuloAutor} maxLargo={40} />');
  });
});

describe('D. el Detalle junta las piezas', () => {
  const d = codigo('web/src/central/componentes/DetalleConversacion.tsx');

  it('el rol de admin que se pasa al Detalle descarta al propietario de NovuChat (solo lee)', () => {
    const p = codigo('web/src/central/paginas/ConversacionesNueva.tsx');
    expect(p).toContain("esAdmin={rol === 'admin' && !permisos.propietario}");
    expect(p).toContain('const puedeGestionar = puedeGestionarConversaciones(rol, permisos.propietario);');
  });

  it('pinta la barra del turno y, SOLO si quien mira tiene la conversación, el campo para escribir', () => {
    expect(d).toContain('<BarraTurno');
    expect(d).toMatch(/\{acciones\.verEscribir && \(\s*<EscribirComoPersona/);
    expect(d).toContain('ultimoEntranteEn={ficha.ultimoEntranteEn}');       // la ventana de Meta: NO `ventanaVenceEn` (contrato §2)
    expect(d).not.toMatch(/<EscribirComoPersona[^>]*ventanaVenceEn/);
    expect(d).toContain('situacionDeTurno(ficha.turno, p.miUid)');
    expect(d).toContain('puedeGestionar: p.puedeGestionar, esAdmin: p.esAdmin, comercioActivo: p.comercioActivo');
  });

  it('el mensaje de una persona se pinta distinto del del asistente, con su rótulo abreviado y su estado de envío', () => {
    expect(d).toContain("x.direccion === 'saliente' && x.autor === 'persona'");
    expect(d).toContain("esPersona ? ' cv-burbuja--persona' : ''");
    expect(d).toContain('rotuloDeAutor(x.autor, x.autorUid, p.miUid)');
    expect(d).toContain('{esPersona && x.estadoEnvio && (');
    expect(d).toContain('textoEstadoMensaje(x.estadoEnvio)');
    expect(d).toContain("estadoEnvio: x['autor'] === 'persona' ? estadoDeMensaje(x['estadoEnvio']) : null");
    // el estado de envío solo se lee de los mensajes de una persona (el del asistente no lo trae)
    const css = leer('web/src/central/estilos/conversaciones.css');
    expect(css).toMatch(/\.cv-burbuja--persona\s*\{/);
    expect(css).toMatch(/\.cv-envio--incierto/);
    expect(css).toMatch(/\.cv-redactor\s*\{/);
  });

  it('la lista marca las que tiene una persona y el filtro «El asistente atiende» existe', () => {
    expect(codigo('web/src/central/componentes/ListaConversaciones.tsx')).toContain('{f.turno && <span className="cv-etiqueta cv-etiqueta--persona">Responde una persona</span>}');
    expect(codigo('web/src/central/lib/conversaciones.ts')).toContain("{ id: 'asistente', rotulo: 'El asistente atiende' }");
  });

  it('«Necesita humano» sigue leyéndose de `necesitaHumano` (H2 de texto no lo escribe)', () => {
    expect(codigo('web/src/central/lib/conversaciones.ts')).toContain("necesitaHumano: x['necesitaHumano'] === true");
    expect(codigo('web/src/central/componentes/ListaConversaciones.tsx')).toContain('necesitaHumanoDe(f, ahora) && <span className="cv-etiqueta cv-etiqueta--humano">Necesita humano</span>');
  });
});
