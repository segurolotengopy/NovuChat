/**
 * BLOQUEAR CONTACTO — LA PANTALLA (31/10/2026). Sin navegador ni red: lógica pura y componentes con `react-dom/server`.
 * Se prueba NEGANDO: quién NO ve el botón, cuándo NO se ofrece, qué NO se puede hacer con el contacto bloqueado.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  accionesDeBloqueo, accionesSinBloqueadas, filaBloqueada, ordenarBloqueadas, rotuloBloqueados, textoErrorBloqueo, textoFechaBloqueo,
  MOTIVO_TURNO_VIGENTE, type CapaBloqueo, type EntradaBloqueo,
} from '../../web/src/central/lib/bloqueo';
import { accionesDeTurno, type Acciones } from '../../web/src/central/lib/turno';
import { consultaDeBloqueadas, LIMITE_BLOQUEADAS, fichaDeDocumento, puedeGestionarConversaciones } from '../../web/src/central/lib/conversaciones';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { BloqueoContacto } = await import('../../web/src/central/componentes/BloqueoContacto');
const { PanelBloqueados } = await import('../../web/src/central/componentes/PanelBloqueados');

const CAPA: CapaBloqueo = { bloquear: async () => ({}), desbloquear: async () => ({}) };
const base: EntradaBloqueo = { puedeGestionar: true, esAdmin: true, comercioActivo: true, bloqueada: false, situacion: 'asistente' };
const tomable: Acciones = accionesDeTurno({
  situacion: 'asistente', puedeGestionar: true, esAdmin: true, comercioActivo: true, puedeIntervenir: true, ventanaAbierta: true,
});
const pintar = (o: Partial<EntradaBloqueo>) => {
  const e = { ...base, ...o };
  return renderToStaticMarkup(createElement(BloqueoContacto, {
    tenantId: 'comercio-x', conversacionId: 'wa_59100000047', bloqueada: e.bloqueada, acciones: accionesDeBloqueo(e), capa: CAPA,
  }));
};

describe('quién ve «Bloquear contacto»', () => {
  it('el administrador, con el asistente atendiendo', () => {
    expect(accionesDeBloqueo(base)).toMatchObject({ verBloquear: true, verDesbloquear: false, avisoTurnoVigente: false });
    expect(pintar({})).toContain('Bloquear contacto');
  });
  it('NEGATIVA: un operador (no admin) no ve ni Bloquear ni Desbloquear', () => {
    for (const bloqueada of [false, true]) {
      const a = accionesDeBloqueo({ ...base, esAdmin: false, bloqueada });
      expect(a).toMatchObject({ verBloquear: false, verDesbloquear: false, avisoTurnoVigente: false });
    }
    expect(pintar({ esAdmin: false })).not.toContain('Bloquear contacto');
  });
  it('NEGATIVA: el propietario de NovuChat (solo lectura) no ve botones', () => {
    const gestiona = puedeGestionarConversaciones('admin', true);
    expect(gestiona).toBe(false);
    expect(accionesDeBloqueo({ ...base, puedeGestionar: gestiona, esAdmin: false })).toMatchObject({ verBloquear: false, verDesbloquear: false });
  });
  it('NEGATIVA: con un turno vigente (mío o ajeno) no se ofrece bloquear y se explica', () => {
    for (const situacion of ['mio', 'ajeno'] as const) {
      const a = accionesDeBloqueo({ ...base, situacion });
      expect(a).toMatchObject({ verBloquear: false, avisoTurnoVigente: true });
      const html = pintar({ situacion });
      expect(html).not.toContain('Bloquear contacto</button>');
      expect(html).toContain(MOTIVO_TURNO_VIGENTE);
    }
  });
  it('con el comercio inactivo los botones se ven deshabilitados', () => {
    expect(pintar({ comercioActivo: false })).toMatch(/<button[^>]*disabled[^>]*>Bloquear contacto/);
  });
  it('la confirmación existe antes de llamar: el botón inicial no ejecuta (no hay «Sí, bloquear» sin pulsar)', () => {
    expect(pintar({})).not.toContain('Sí, bloquear');
  });
});

describe('una conversación bloqueada', () => {
  it('muestra el marcador y «Desbloquear»; NO ofrece «Bloquear»', () => {
    const html = pintar({ bloqueada: true });
    expect(html).toContain('marca-bloqueado');
    expect(html).toContain('Desbloquear contacto');
    expect(html).not.toContain('Bloquear contacto</button>');
  });
  it('NEGATIVA: no ofrece Tomar ni escribir ni los avisos de intervención; Devolver se conserva', () => {
    expect(tomable.verTomar).toBe(true);
    const a = accionesSinBloqueadas({ ...tomable, verDevolver: true }, true);
    expect(a).toMatchObject({ verTomar: false, verEscribir: false, sinTomarPorVentana: false, sinIntervencion: false, verDevolver: true });
    expect(accionesSinBloqueadas(tomable, false)).toBe(tomable);
  });
  it('un operador ve el marcador pero NO el botón de desbloquear', () => {
    const html = pintar({ bloqueada: true, esAdmin: false });
    expect(html).toContain('marca-bloqueado');
    expect(html).not.toContain('Desbloquear contacto');
  });
  it('solo `bloqueada === true` exacto bloquea la ficha', () => {
    for (const v of ['true', 1, {}, null, undefined, false]) expect(fichaDeDocumento('wa_59100000047', { bloqueada: v }).bloqueada).toBe(false);
    expect(fichaDeDocumento('wa_59100000047', { bloqueada: true }).bloqueada).toBe(true);
  });
});

describe('la lista «Bloqueados (N)»', () => {
  const t = (ms: number) => ({ toMillis: () => ms });
  it('lee solo los bloqueados, ordena en el cliente (más reciente primero, sin fecha al final)', () => {
    const filas = [
      filaBloqueada('wa_59100000001', { bloqueada: true, bloqueadaEn: t(1000) }),
      filaBloqueada('wa_59100000002', { bloqueada: true, bloqueadaEn: t(3000) }),
      filaBloqueada('wa_59100000003', { bloqueada: true }),
      filaBloqueada('wa_59100000004', { bloqueada: 'true', bloqueadaEn: t(9000) }),
    ];
    expect(filas[3]).toBeNull();
    const ok = ordenarBloqueadas(filas.filter((f): f is NonNullable<typeof f> => f !== null));
    expect(ok.map((f) => f.id)).toEqual(['wa_59100000002', 'wa_59100000001', 'wa_59100000003']);
  });
  it('la consulta es de un solo campo y SIN orden (no pide índice nuevo)', () => {
    expect(consultaDeBloqueadas()).toEqual({ restricciones: [{ campo: 'bloqueada', op: '==', valor: true }], orden: [], limite: LIMITE_BLOQUEADAS });
  });
  it('rótulo con número, y sin número mientras no llegó (no se inventa un cero)', () => {
    expect(rotuloBloqueados(3)).toBe('Bloqueados (3)');
    expect(rotuloBloqueados(null)).toBe('Bloqueados');
  });
  it('fecha en hora de Bolivia', () => {
    expect(textoFechaBloqueo(Date.UTC(2026, 9, 31, 18, 5))).toBe('31/10/2026 14:05');
    expect(textoFechaBloqueo(null)).toBe('sin fecha');
  });
  it('el panel pinta el rótulo con N y no expone filas hasta abrirse; sin sesión de admin no se monta (la página lo condiciona)', () => {
    const filas = [{ id: 'wa_59100000001', telefono: '59100000001', nombre: '', bloqueadaEn: 1000 }];
    const html = renderToStaticMarkup(createElement(PanelBloqueados, { tenantId: 'comercio-x', filas, comercioActivo: true, capa: CAPA }));
    expect(html).toContain('Bloqueados (1)');
    expect(html).not.toContain('fila-bloqueada');
    const pagina = readFileSync(join(ADMIN, 'web/src/central/paginas/ConversacionesNueva.tsx'), 'utf8');
    expect(pagina).toMatch(/esAdminDelNegocio && \(\s*<PanelBloqueados/);
    expect(pagina).toContain("rol === 'admin' && !permisos.propietario");
  });
});

describe('errores y fuente', () => {
  it('failed-precondition al bloquear = turno vigente, en español', () => {
    expect(textoErrorBloqueo('bloquear', 'failed-precondition')).toBe(MOTIVO_TURNO_VIGENTE);
    expect(textoErrorBloqueo('bloquear', 'permission-denied')).toMatch(/permiso/);
    expect(textoErrorBloqueo('desbloquear', 'xyz')).toMatch(/desbloquear/);
  });
  it('NEGATIVA de fuente: no lee `e.message`, no usa fetch ni voseo; llama solo a las dos callables', () => {
    const quitar = (r: string) => readFileSync(join(ADMIN, r), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const r of ['web/src/central/lib/bloqueo.ts', 'web/src/central/componentes/BloqueoContacto.tsx', 'web/src/central/componentes/PanelBloqueados.tsx']) {
      const c = quitar(r);
      expect(c, r).not.toMatch(/\.message|fetch\(|dangerouslySetInnerHTML|localStorage|Math\.random/);
      expect(c, r).not.toMatch(/\b(podés|tenés|hacé|elegí|sos)\b/i);
    }
    const lib = quitar('web/src/central/lib/bloqueo.ts');
    expect([...lib.matchAll(/'((?:des)?bloquearContacto)'/g)].map((m) => m[1]).sort()).toEqual(['bloquearContacto', 'desbloquearContacto']);
  });
});

describe('posición de «Bloquear contacto»', () => {
  it('va en la misma fila que «No contactar» (cv-det-sub), justo después, y no suelto debajo de la barra de turno', () => {
    const c = readFileSync(join(ADMIN, 'web/src/central/componentes/DetalleConversacion.tsx'), 'utf8');
    const sub = c.indexOf('className="cv-det-sub"');
    const noContactar = c.indexOf('className="cv-nocontactar"');
    const bloqueo = c.indexOf('<BloqueoContacto');
    const barra = c.indexOf('<BarraTurno');
    expect(c.match(/<BloqueoContacto/g)).toHaveLength(1);
    expect(sub).toBeGreaterThan(-1);
    expect(noContactar).toBeGreaterThan(sub);
    expect(bloqueo).toBeGreaterThan(noContactar);
    expect(bloqueo).toBeLessThan(barra);
    expect(c.slice(noContactar, bloqueo)).not.toContain('</div>');
  });
});
