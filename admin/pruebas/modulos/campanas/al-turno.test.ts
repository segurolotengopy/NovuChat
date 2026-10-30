/**
 * Los ganchos de Campañas y Captación en el turno (F3b-2b). Puros: sin Firestore.
 * La equivalencia con la respuesta de antes la prueba la red diferencial
 * (`pruebas/core/turno/configuracion-diferencial.test.ts`); acá se fija el
 * contrato de cada gancho y cuándo el coordinador lo llama.
 */
import { describe, expect, it } from 'vitest';
import { alTurnoCampanas } from '../../../functions/src/modulos/campanas/alTurno.ts';
import { modulosDelTurno, type ContextoDelTurno } from '../../../functions/src/core/turno/ganchosDelTurno.ts';

const CAMPANA = { id: 'c1', texto: 'Promo de prueba', inicio: '2020-01-01', fin: '2099-12-31', estado: 'aprobada' };
const CON_TITULARES = { ...CAMPANA, titulares: ['Titular de prueba uno'], angulo: 'Angulo de prueba', productoId: 'p1' };

function contexto(parte: Partial<ContextoDelTurno>): ContextoDelTurno {
  return {
    tenantId: 't', flujo: 'venta', telefono: null, ahoraMs: Date.UTC(2026, 9, 1), negocio: {}, cuenta: { limites: { campanas: 5 } },
    especifica: undefined, vigentesDeCampanas: [], catalogo: [], solicitud: undefined,
    cobroRealActivo: false, moneda: 'BOB', urlDelQr: (f) => f, citar: (t) => t, ...parte,
  };
}

describe('gancho de Campañas', () => {
  it('sin vigentes devuelve campanas vacías y ninguna clave de anuncios', () => {
    const r = alTurnoCampanas(contexto({}));
    expect(r).toEqual({ campanas: [] });
    expect('anuncios' in r).toBe(false);
  });

  it('con una vigente devuelve la campaña citada', () => {
    const r = alTurnoCampanas(contexto({ vigentesDeCampanas: [CAMPANA], citar: (t) => `«${t}»` }));
    expect((r['campanas'] as Array<{ id: string; texto: string }>)[0]).toMatchObject({ id: 'c1', texto: '«Promo de prueba»' });
  });

  it('con titulares arma el anuncio con el producto y su precio del catálogo', () => {
    const r = alTurnoCampanas(contexto({
      vigentesDeCampanas: [CON_TITULARES],
      catalogo: [{ id: 'p1', datos: { nombre: 'Producto uno', precio: 10, agotado: true } }],
    }));
    const anuncios = r['anuncios'] as Array<{ producto: { nombre: string; precio: number; agotado: boolean } | null }>;
    expect(anuncios).toHaveLength(1);
    expect(anuncios[0]?.producto).toMatchObject({ nombre: 'Producto uno', precio: 10, agotado: true });
  });
});

describe('el coordinador solo llama a los módulos que corren', () => {
  it('captación corre en el número de captación y no en el de venta', () => {
    const ficha = { flujos: ['onboarding', 'venta'] };
    expect(modulosDelTurno(ficha, 'onboarding')).toContain('captacion');
    expect(modulosDelTurno(ficha, 'venta')).not.toContain('captacion');
  });

  it('una ficha que apaga campañas no la corre, y una vieja sí (es común)', () => {
    expect(modulosDelTurno({ modulos: ['productos'] }, 'venta')).not.toContain('campanas');
    expect(modulosDelTurno({ flujos: ['venta'] }, 'venta')).toContain('campanas');
  });
});
