/**
 * CORRECCIONES DEL PR 1012 (17/11/2026), sin nodos ni mensajes nuevos.
 * 1) Chat de NovuChat: `Soltar mensajes` pasa adId y campanaId (de `Interpretar entrada`) al prospecto del miniCRM, para que `idCampana` se llene.
 * 2) venta-minima: un `referral` que llega como arreglo (o texto) no es un anuncio, como en los demas esqueletos.
 */
import { describe, expect, it } from 'vitest';
import { type J, codigoDe, ejecutar, leerFlujo } from './lib/flujo.ts';

const AD = '100000000000001';

describe('chat de NovuChat: el Ad ID y la campana llegan al prospecto', () => {
  const f = leerFlujo('clientes/novuchat/chat-novuchat.prueba.json');
  const soltar = (interpretar: J): J => {
    const a = { comprometer: false, fallaEstado: false, mejorEsfuerzo: false, from: '59170000001', conversacion: true, primeraVez: true, guardarPlanilla: true, despues: { telefono: '59170000001' },
      salida: [{ para: '59170000001', texto: 'hola', payload: { type: 'text' } }], resumen: { plan: 'x' }, ahoraMs: Date.now() };
    return ejecutar(codigoDe(f, 'Soltar mensajes'), [{}], { 'Armar mensajes': a, 'Interpretar entrada': interpretar })[0] ?? {};
  };
  it('con Ad ID y campana validos, el prospecto los lleva', () => {
    expect(soltar({ adId: AD, campanaId: 'camp-ad' })['prospectoPlanilla']).toMatchObject({ telefono: '59170000001', adId: AD, campanaId: 'camp-ad' });
  });
  it('sin ellos, o con formas invalidas, el prospecto no los lleva', () => {
    for (const i of [{}, { adId: '', campanaId: '' }, { adId: 'x<y', campanaId: 'a b' }]) {
      const p = soltar(i)['prospectoPlanilla'] as J;
      expect(p).toBeTruthy();
      expect(p).not.toHaveProperty('adId');
      expect(p).not.toHaveProperty('campanaId');
    }
  });
});

describe('venta-minima: un referral que no es un objeto no cuenta como anuncio', () => {
  const f = leerFlujo('experimental/venta-minima/venta-minima.prueba.json');
  const interpretar = (referral: unknown): J => ejecutar(codigoDe(f, 'Interpretar entrada'), [{}], {
    'Carga de entrada': { messages: [{ from: '59170000001', id: 'wamid.PRUEBA', type: 'text', text: { body: 'hola' }, referral }], contacts: [{ profile: { name: 'Ana' } }], phoneNumberId: '1000000001' },
    'Config del negocio': { phoneNumberIdEsperado: '1000000001', prefijosPermitidos: '591', campanas: [], campanasAdId: [] },
  }, { $getWorkflowStaticData: () => ({}) })[0] ?? {};
  it('un arreglo o un texto se descartan; un objeto se conserva', () => {
    for (const r of [[{ source_id: AD }], 'texto', 5]) {
      const x = interpretar(r);
      expect(x['anuncio'], JSON.stringify(r)).toBeNull();
      expect(x['adId']).toBe('');
    }
    expect(interpretar({ source_id: AD, source_type: 'ad' })['adId']).toBe(AD);
  });
});
