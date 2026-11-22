/**
 * LA PLANTILLA DEL AVISO FUERA DE LA VENTANA («código para las dos», común a Walisuma y Casa Bermejo; 22/11/2026).
 * El reclamo de Andres: el aviso a recepción llegaba sin el nombre ni el teléfono del cliente. Se prueba NEGANDO: nunca sale un aviso sin ellos ni una plantilla que no esté APPROVED.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const CODIGO = readFileSync(join(RAIZ, 'Flujos/src/modulos/pedidos/aviso-plantilla.js'), 'utf8');
type Json = Record<string, unknown>;
const M = runInNewContext(`${CODIGO}\n({ apPlantillaAviso, apParametrosConsulta });`) as {
  apPlantillaAviso: (b: unknown) => { nombre: string; idioma: string; variables: number } | null;
  apParametrosConsulta: (m: string, n: string, t: string, msg: string) => { p10: string[]; p4: string[] };
};
const base = (x: Json = {}): Json => ({ avisoPedidoPlantilla: 'aviso_pedido_equipo', avisoPedidoEstado: 'APPROVED', avisoRespaldoPlantilla: 'pedido_registrado', avisoRespaldoEstado: 'APPROVED', avisoPlantillaIdioma: 'es', ...x });
const flujo = (c: string, n: string): string => {
  const f = JSON.parse(readFileSync(join(RAIZ, `Flujos/clientes/${c}/${c}.json`), 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
  return String(f.nodes.find((x) => x.name === n)?.parameters.jsCode ?? '');
};

describe('apPlantillaAviso', () => {
  it('prefiere la de 10 variables si está APPROVED', () => {
    expect(M.apPlantillaAviso(base())).toEqual({ nombre: 'aviso_pedido_equipo', idioma: 'es', variables: 10 });
  });
  it('NEGADO: con la de 10 PENDING cae a la de respaldo de 4; nunca usa una que no esté APPROVED', () => {
    expect(M.apPlantillaAviso(base({ avisoPedidoEstado: 'PENDING' }))).toEqual({ nombre: 'pedido_registrado', idioma: 'es', variables: 4 });
  });
  it('NEGADO: sin ninguna APPROVED, idioma inválido o nombre inválido no hay plantilla (nunca se inventa)', () => {
    expect(M.apPlantillaAviso(base({ avisoPedidoEstado: 'PENDING', avisoRespaldoEstado: 'REJECTED' }))).toBeNull();
    expect(M.apPlantillaAviso(base({ avisoPlantillaIdioma: 'ESPAÑOL' }))).toBeNull();
    expect(M.apPlantillaAviso(base({ avisoPedidoPlantilla: 'Aviso Pedido', avisoRespaldoPlantilla: '' }))).toBeNull();
    expect(M.apPlantillaAviso(null)).toBeNull();
  });
});

describe('apParametrosConsulta', () => {
  it('el nombre y el WhatsApp del cliente viajan SIEMPRE, en las dos plantillas', () => {
    const p = M.apParametrosConsulta('pidió hablar con una persona', 'Andres', '59171234567', 'Hola');
    expect(p.p10).toHaveLength(10);
    expect(p.p10[3]).toBe('Andres');
    expect(p.p10[4]).toBe('+59171234567');
    expect(p.p4).toHaveLength(4);
    expect(p.p4[2]).toBe('Andres (+59171234567)');
  });
  it('NEGADO: sin nombre de perfil sale «sin nombre», nunca vacío; el teléfono nunca falta', () => {
    const p = M.apParametrosConsulta('', '', '+591 7123-4567', '');
    expect(p.p10[3]).toBe('sin nombre');
    expect(p.p10[4]).toBe('+59171234567');
    expect(p.p10[0]).toBe('Consulta: consulta');
    expect(p.p10[7]).toBe('—');
  });
});

describe('los dos flujos usan el módulo común', () => {
  for (const c of ['casa-bermejo', 'walisuma']) {
    it(`${c}: «Armar avisos» elige con apPlantillaAviso y manda 10 o 4 variables`, () => {
      const js = flujo(c, 'Armar avisos');
      expect(js).toContain('function apPlantillaAviso');
      expect(js).toMatch(/apPlantillaAviso\(c\.base\)/);
      expect(js).toMatch(/pl\.variables === 10 \? parametros10 : parametros4/);
      expect(js).toContain('apParametrosConsulta(');
    });
  }
  it('Casa Bermejo: un catálogo que no se pudo leer deja su causa técnica en el aviso', () => {
    expect(flujo('casa-bermejo', 'Armar avisos')).toContain('causa técnica: ');
  });
  it('Casa Bermejo: el aviso de un pedido también lleva el nombre y el WhatsApp en las dos plantillas', () => {
    const js = flujo('casa-bermejo', 'Armar avisos');
    expect(js).toMatch(/totalTexto, entregaTexto, nombre, '\+' \+ c\.from/);
    expect(js).toMatch(/entregaTexto \+ ' · ' \+ cliente/);
  });
});
