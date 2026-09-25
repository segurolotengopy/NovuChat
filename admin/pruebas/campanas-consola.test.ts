/**
 * LA PESTAÑA «CAMPAÑAS» DE LA CONSOLA (24/09/2026).
 *
 * La pantalla acompaña y el servidor decide. Esta suite fija que acompañe con
 * las MISMAS cifras y la misma cuenta que el servidor —si se separan, el
 * comercio vería «puede guardarse» y después un rechazo, o al revés— y que la
 * página no escriba nunca lo que solo escribe el servidor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as servidor from '../functions/src/campanas.ts';
import * as consola from '../web/src/lib/campanas.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const AHORA = Date.now();
const dia = (n: number) => servidor.diaBolivia(AHORA + n * 86_400_000);
const HOY = dia(0);
const c = (id: string, texto: string, inicio = HOY, fin = dia(30)) => ({ id, texto, inicio, fin });

describe('la consola y el servidor dicen lo mismo', () => {
  it('las cifras', () => {
    expect(consola.TOPE_TEXTO_CAMPANA).toBe(servidor.TOPE_TEXTO_CAMPANA);
    expect(consola.MINIMO_TEXTO_CAMPANA).toBe(servidor.MINIMO_TEXTO_CAMPANA);
    expect(consola.MAX_DIAS_HASTA_EL_INICIO).toBe(servidor.MAX_DIAS_HASTA_EL_INICIO);
    expect(consola.MAX_DIAS_DE_DURACION).toBe(servidor.MAX_DIAS_DE_DURACION);
    expect(consola.diaBolivia(AHORA)).toBe(servidor.diaBolivia(AHORA));
    for (const t of ['¡Hola!, quiero AGENDAR 👶', 'Control niño sano']) {
      expect(consola.palabrasDeCampana(t)).toBe(servidor.palabrasDeCampana(t));
    }
  });

  it('lo que la pantalla deja guardar, el servidor no lo rechaza sin modelo; y lo que avisa, el servidor lo rechaza', () => {
    const casos = [
      c('a', 'Quiero agendar el control de mi bebé'),
      c('a', 'ok'),
      c('a', 'x'.repeat(301)),
      c('a', 'Quiero una cita', dia(10), dia(5)),
      c('a', 'Quiero una cita', dia(-20), dia(-1)),
      c('a', 'Quiero una cita', dia(-2), dia(10)),
      c('a', 'Quiero una cita', dia(200), dia(210)),
      c('a', 'Quiero una cita', dia(1), dia(400)),
    ];
    for (const k of casos) {
      const enPantalla = consola.problemaEnPantalla(k, [], null, HOY);
      const enServidor = servidor.revisarSinModelo([k], [], 10, AHORA, { ids: [], nombres: [] }).get('a');
      expect(enPantalla === null, `${k.texto.slice(0, 20)} ${k.inicio}→${k.fin}`).toBe(enServidor === null);
      if (enPantalla && enServidor) expect(enPantalla.campo).toBe(enServidor.campo);
    }
    // Duplicado y la campaña que ya corría, igual.
    const vieja = c('a', 'Quiero una cita', dia(-3), dia(10));
    expect(consola.problemaEnPantalla(vieja, [vieja], vieja, HOY)).toBeNull();
    expect(consola.problemaEnPantalla(c('b', '¡QUIERO una cita!'), [vieja], null, HOY)).toMatchObject({ campo: 'texto' });
  });

  it('el hash de la lista en el navegador es el del servidor: así se sabe si la revisión es de lo escrito', async () => {
    const lista = [c('a', 'Quiero una cita'), c('b', 'Quiero un control', dia(2), dia(9))];
    expect(await consola.hashListaEnNavegador(lista)).toBe(servidor.hashLista(lista));
  });

  it('cómo se muestra cada estado', () => {
    const k = c('a', 'Quiero una cita');
    expect(consola.estadoVisible(k, { estado: 'aprobada', motivo: '', campo: '' }, false, HOY).etiqueta).toBe('Revisando…');
    expect(consola.estadoVisible(k, { estado: 'aprobada', motivo: '', campo: '' }, true, HOY).etiqueta).toBe('En uso');
    expect(consola.estadoVisible(c('a', 't', dia(3), dia(9)), { estado: 'aprobada', motivo: '', campo: '' }, true, HOY).etiqueta)
      .toContain('empieza el');
    expect(consola.estadoVisible(k, { estado: 'rechazada', motivo: 'la fecha de fin ya pasó', campo: 'fin' }, true, HOY))
      .toMatchObject({ etiqueta: 'Rechazada', motivo: 'la fecha de fin ya pasó' });
    expect(consola.estadoVisible(k, { estado: 'fuera_del_plan', motivo: 'tu plan no incluye campañas', campo: '' }, true, HOY).etiqueta)
      .toBe('No se aplica');
    expect(consola.estadoVisible(k, { estado: 'pendiente', motivo: '', campo: '' }, true, HOY).etiqueta).toBe('Sin verificar');
    expect(consola.idNuevo()).toMatch(/^[a-z0-9-]{1,40}$/);
  });
});

describe('la página', () => {
  const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  const pagina = sinComentarios(readFileSync(join(aqui, '../web/src/paginas/Campanas.tsx'), 'utf8'));
  const app = readFileSync(join(aqui, '../web/src/App.tsx'), 'utf8');

  it('escribe SOLO la lista y el sello, con updateDoc cuando el documento existe', () => {
    expect(pagina).toContain("const datos = { lista: nueva, actualizadoPor: auth.currentUser?.uid ?? '', actualizadoEn: serverTimestamp() };");
    expect(pagina).toContain('existe ? updateDoc(ref, datos) : setDoc(ref, datos)');
    expect(pagina).not.toMatch(/vigentes\s*:/);
    expect(pagina).not.toMatch(/revision\s*:/);
  });

  it('el tope sale de limiteDeCampanas, el de las reglas y el servidor', () => {
    expect(pagina).toContain('limiteDeCampanas(cuenta)');
  });

  it('la ruta, el título y el menú existen, solo para el administrador', () => {
    expect(app).toContain("campanas: 'Campañas',");
    expect(app).toContain('<Route path="/negocio/:tenantId/campanas" element={\n          <Proteger requiere="adminTenant"><><Cabecera /><Campanas /></></Proteger>} />');
    expect(app).toMatch(/tenantId && esAdminDelNegocio &&\s*<NavLink to=\{`\/negocio\/\$\{tenantId\}\/campanas`\}>Campañas<\/NavLink>/);
  });
});
