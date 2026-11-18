/**
 * LA FOTO DE CATÁLOGO SE REPORTA SIN CONTEO (Andres, 16/11/2026). Las imágenes de apoyo salen por «Enviar aviso» (los previos) y antes nadie las reportaba: no se veían en la consola.
 * Ahora «Reportar foto (saliente)» manda a la ingesta `sinConteo: true` con `tipo: 'image'` y el id que devolvió Meta, SOLO si Meta aceptó una foto. Se NIEGA: un envío fallido no reporta; el aviso
 * a recepción no es una foto; el entrante y los demás salientes no llevan `sinConteo`; el reporte no cuelga de nada que cuente respuestas; el orden de ramas del lienzo se conserva (el reporte de la foto y su guardado corren
 * DESPUÉS de toda la rama del texto: ni el reporte ni la descarga lo retrasan); 0 mensajes de WhatsApp de más.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error el módulo común es un .mjs sin tipos
import { hallazgosDelReporteSinConteo } from '../../../../Flujos/src/core/sin-agente/reporte-sin-conteo.mjs';
import type { Flujo, J } from '../../lib/flujo';
import { ANA, PRODUCCION, PRUEBA, crear, hablar, imagenes, mTexto, tel, textos, valorMeta } from './mundo';

const FOTO = 'Reportar foto (saliente)';
const PIDE_VER = 'Quiero ver cómo queda, me da miedo verme artificial';
const dice = (t: string) => () => t;
const ANTES_DESPUES = '[ENVIAR_ARTE_ANTES_DESPUES] Es una paciente real. Cada rostro responde distinto.';
const conSinConteo = (t: { llamadas: { ingesta: J[] } }): J[] => t.llamadas.ingesta.filter((c) => 'sinConteo' in c);
const clon = (f: Flujo): Flujo => JSON.parse(JSON.stringify(f)) as Flujo;
const nodo = (f: Flujo, n: string): J => (f.nodes as J[]).find((x) => x['name'] === n) as J;
const destinos = (f: Flujo, de: string, s = 0): string[] => ((((f.connections as J)[de] as J | undefined)?.['main'] as J[][] | undefined)?.[s] ?? []).map((x) => String(x['node']));
/** Todos los nodos alcanzables desde `de`. */
const alcanza = (f: Flujo, de: string): Set<string> => {
  const visto = new Set<string>();
  const pila = [de];
  while (pila.length) {
    const n = pila.pop() as string;
    const c = ((f.connections as J)[n] as J | undefined)?.['main'] as J[][] | undefined;
    for (const sal of c ?? []) for (const x of sal) if (!visto.has(String(x['node']))) { visto.add(String(x['node'])); pila.push(String(x['node'])); }
  }
  return visto;
};

describe('la foto enviada se reporta SIN CONTEO', () => {
  it('el cuerpo lleva sinConteo true, tipo image, saliente, el teléfono y el id que devolvió Meta; el texto es un rótulo corto', () => {
    const m = crear({ modeloDice: dice(ANTES_DESPUES) });
    const t = hablar(m, ANA, mTexto(PIDE_VER));
    expect(imagenes(t).length).toBe(1);
    const reportes = conSinConteo(t);
    expect(reportes.length).toBe(1);
    const r = reportes[0] as J;
    expect(r['sinConteo']).toBe(true);
    expect(r['tipo']).toBe('image');
    expect(r['direccion']).toBe('saliente');
    expect(r['telefono']).toBe(ANA);
    expect(String(r['texto'])).toMatch(/^Foto de apoyo: [a-z_]+$/);
    expect(r['evento']).toBeUndefined();
    // el id es el del mensaje que devolvió Meta al enviar la foto
    const aviso = t.avisos.find((a) => a.tipo === 'image');
    expect(r['idMeta']).toBe(((aviso?.respuesta['messages'] as J[])[0] as J)['id']);
  });
  it('NEGADA: un envío fallido (Meta rechaza o la red cae) no reporta la foto', () => {
    for (const previos of ['error', 'lanza'] as const) {
      const m = crear({ modeloDice: dice(ANTES_DESPUES), previos });
      const t = hablar(m, ANA, mTexto(PIDE_VER));
      expect(conSinConteo(t).length, previos).toBe(0);
      expect(t.ejecutados.has(FOTO), previos).toBe(false);
    }
  });
  it('NEGADA: el aviso a recepción (no es una foto al cliente) no se reporta; el entrante y los demás salientes no llevan sinConteo', () => {
    const m = crear({ modeloDice: dice(ANTES_DESPUES) });
    const t = hablar(m, ANA, mTexto(PIDE_VER));
    const otros = t.llamadas.ingesta.filter((c) => !('sinConteo' in c));
    expect(otros.length).toBe(2);   // el entrante y el texto saliente, como siempre
    expect(otros.map((c) => c['direccion']).sort()).toEqual(['entrante', 'saliente']);
    for (const c of otros) expect('sinConteo' in c).toBe(false);
    // un turno sin foto: ni una llamada con sinConteo
    const sin = hablar(crear(), ANA, mTexto('hola'));
    expect(conSinConteo(sin).length).toBe(0);
    expect(sin.llamadas.ingesta.length).toBe(2);
  });
  it('0 mensajes de WhatsApp de más: lo enviado al cliente es la foto y el texto, igual que antes; el reporte va a la ingesta, no a Meta', () => {
    const m = crear({ modeloDice: dice(ANTES_DESPUES) });
    const t = hablar(m, ANA, mTexto(PIDE_VER));
    expect(t.avisos.filter((a) => a.tipo === 'image').length).toBe(1);
    expect(t.mensajes.length).toBe(1);
    expect(textos(t)[0]).not.toMatch(/foto de apoyo/i);
    expect(t.registro.filter((r) => r.nodo === FOTO).every((r) => r.rol === 'ingesta')).toBe(true);
  });
  it('el reporte de la foto y su guardado corren DESPUÉS de todo envío al cliente: el texto no espera ni al reporte ni a la descarga', () => {
    const m = crear({ modeloDice: dice(ANTES_DESPUES) });
    const t = hablar(m, ANA, mTexto(PIDE_VER));
    const i = (n: string): number => t.orden.indexOf(n);
    expect(i(FOTO)).toBeGreaterThan(i('Enviar aviso'));
    expect(i(FOTO)).toBeGreaterThan(i('Enviar a WhatsApp'));
    expect(i('Preparar guardado (saliente)')).toBeGreaterThan(i(FOTO));
    expect(i('Preparar guardado (saliente)')).toBeGreaterThan(i('Enviar a WhatsApp'));
    // el guardado recibe la foto: media id, el wamid de Meta y el teléfono
    const prep = (t.porNodo['Preparar guardado (saliente)'] ?? [])[0];
    expect(prep?.['via']).toBe('media');
    expect(prep?.['telefono']).toBe(ANA);
    expect(prep?.['idMeta']).toBe(conSinConteo(t)[0]?.['idMeta']);
  });
});

describe('estructura: el reporte no cuenta como respuesta y el lienzo conserva su orden', () => {
  for (const [nombre, flujo] of [['producción', PRODUCCION], ['prueba', PRUEBA]] as Array<[string, Flujo]>) {
    it(`${nombre}: ningún camino lleva del reporte de la foto a «Resumen del turno», «Armar mensajes» ni a un envío al cliente`, () => {
      const desde = alcanza(flujo, FOTO);
      for (const n of ['Resumen del turno', 'Armar mensajes', 'Enviar a WhatsApp', 'Enviar respaldo', 'Enviar aviso', 'Reportar mensaje (saliente)']) expect(desde.has(n), n).toBe(false);
      const desdeIf = alcanza(flujo, '¿Reportar foto? (saliente)');
      for (const n of ['Resumen del turno', 'Armar mensajes', 'Enviar a WhatsApp']) expect(desdeIf.has(n), n).toBe(false);
    });
    it(`${nombre}: «Enviar aviso» sigue a «Armar mensajes» PRIMERO y a la rama del reporte después; el reporte está DEBAJO de toda la rama de «Armar mensajes»`, () => {
      expect(destinos(flujo, 'Enviar aviso')).toEqual(['Armar mensajes', '¿Reportar foto? (saliente)']);
      const y = (n: string): number => Number((nodo(flujo, n)['position'] as number[])[1]);
      for (const n of alcanza(flujo, 'Armar mensajes')) expect(y('¿Reportar foto? (saliente)'), n).toBeGreaterThan(y(n));
      expect(y(FOTO)).toBeGreaterThan(y('Armar mensajes'));
      // el guardado saliente va DEBAJO de todo el lienzo, como en el resto del núcleo
      const prep = y('Preparar guardado (saliente)');
      for (const n of flujo.nodes as J[]) if (!/guardado|Guardar imagen enviada/i.test(String(n['name']))) expect(y(String(n['name']))).toBeLessThan(prep);
      expect((flujo.settings as J)['executionOrder']).toBe('v1');
    });
    it(`${nombre}: solo «${FOTO}» manda sinConteo, nunca el entrante ni el saliente común; ninguno de los dos reportes de cliente pierde su cuerpo`, () => {
      for (const n of flujo.nodes as J[]) {
        const tiene = /sinConteo/.test(JSON.stringify(n['parameters'] ?? {}));
        expect(tiene, String(n['name'])).toBe(n['name'] === FOTO);
      }
      expect(String((nodo(flujo, 'Reportar mensaje (saliente)')['parameters'] as J)['jsonBody'])).toContain("tipo: m.tipoReporte");
      expect(String((nodo(flujo, FOTO)['parameters'] as J)['jsonBody'])).toContain("sinConteo: true");
    });
    it(`${nombre}: nada corta el turno: onError continueRegularOutput en el reporte; el guardado también`, () => {
      expect(nodo(flujo, FOTO)['onError']).toBe('continueRegularOutput');
      expect(nodo(flujo, FOTO)['alwaysOutputData']).toBe(true);
      expect(nodo(flujo, 'Guardar imagen enviada')['onError']).toBe('continueRegularOutput');
    });
  }
});

describe('la guardia del reporte sin conteo se NIEGA con mutaciones', () => {
  const sano = (): Flujo => clon(PRODUCCION);
  it('el flujo armado no tiene hallazgos', () => { expect(hallazgosDelReporteSinConteo(sano(), { exigir: true })).toEqual([]); });
  it('sin sinConteo en el cuerpo', () => {
    const f = sano();
    const p = nodo(f, FOTO)['parameters'] as J;
    p['jsonBody'] = String(p['jsonBody']).replace('sinConteo: true', 'sinConteo: false');
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/sinConteo true/);
  });
  it('sin tipo image', () => {
    const f = sano();
    const p = nodo(f, FOTO)['parameters'] as J;
    p['jsonBody'] = String(p['jsonBody']).replace("tipo: 'image'", "tipo: 'text'");
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/tipo image/);
  });
  it('el `if` deja pasar el aviso a recepción', () => {
    const f = sano();
    const c = (((nodo(f, '¿Reportar foto? (saliente)')['parameters'] as J)['conditions'] as J)['conditions'] as J[])[0] as J;
    c['leftValue'] = String(c['leftValue']).replace("kind === 'arte'", "kind !== ''");
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/solo deja pasar una foto/);
  });
  it('el reporte corta el turno si falla', () => {
    const f = sano();
    delete nodo(f, FOTO)['onError'];
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/onError continueRegularOutput/);
  });
  it('el reporte pasa ARRIBA de «Armar mensajes» (cambia el orden de ramas)', () => {
    const f = sano();
    nodo(f, '¿Reportar foto? (saliente)')['position'] = [5240, 60];
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/DEBAJO de «/);
  });
  it('el reporte pasa a ser la primera salida de «Enviar aviso»', () => {
    const f = sano();
    const sal = ((f.connections as J)['Enviar aviso'] as J)['main'] as J[][];
    sal[0] = [...(sal[0] as J[])].reverse();
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/última salida/);
  });
  it('otro nodo manda sinConteo', () => {
    const f = sano();
    const p = nodo(f, 'Reportar mensaje (saliente)')['parameters'] as J;
    p['jsonBody'] = `${String(p['jsonBody'])} /* sinConteo */`;
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/no puede mandar sinConteo/);
  });
  it('el reporte de la foto cuelga de algo que cuenta (sigue hacia otro nodo)', () => {
    const f = sano();
    ((f.connections as J)[FOTO] as J)['main'] = [[{ node: 'Armar mensajes', type: 'main', index: 0 }]];
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/solo puede seguir hacia el guardado/);
  });
  it('sin la rama: con exigir falla, sin exigir se calla', () => {
    const f = sano();
    f.nodes = (f.nodes as J[]).filter((n) => !['¿Reportar foto? (saliente)', FOTO].includes(String(n['name']))) as Flujo['nodes'];
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).length).toBe(1);
    expect(hallazgosDelReporteSinConteo(f)).toEqual([]);
  });
});

describe('otro teléfono, otra foto: cada una se reporta con su propio teléfono', () => {
  it('dos teléfonos, dos reportes, cada uno con el suyo', () => {
    const m = crear({ modeloDice: dice(ANTES_DESPUES) });
    const b = tel(22);
    const t1 = hablar(m, ANA, mTexto(PIDE_VER));
    const t2 = hablar(m, b, mTexto(PIDE_VER));
    expect(conSinConteo(t1).map((c) => c['telefono'])).toEqual([ANA]);
    expect(conSinConteo(t2).map((c) => c['telefono'])).toEqual([b]);
  });
});

describe('modo prueba: la foto que sale al teléfono de prueba NO se reporta a la ingesta real', () => {
  const prueba = (): ReturnType<typeof crear> => crear({ flujo: PRUEBA, modeloDice: dice(ANTES_DESPUES), base: { telefonosDePrueba: `${ANA},${tel(22)}` } });
  const cuerpo = (extra: J): J => ({ body: { ...valorMeta(mTexto(PIDE_VER), ANA), ...extra } });
  it('NEGADA: con modoPrueba y enviarDeVerdad la foto sale, pero ninguna llamada lleva sinConteo ni se ejecuta el reporte', () => {
    const t = prueba().turno(cuerpo({ modoPrueba: true, telefonoDePrueba: ANA, enviarDeVerdad: true }), { via: 'Entrada de prueba' });
    expect(imagenes(t).length).toBe(1);
    expect(conSinConteo(t).length).toBe(0);
    expect(t.ejecutados.has(FOTO)).toBe(false);
    expect(t.llamadas.ingesta.length).toBe(0);
  });
  it('la condición del `if` exige enviar y modoPrueba distinto de true; sin eso la guardia falla', () => {
    const f = clon(PRODUCCION);
    const c = (((nodo(f, '¿Reportar foto? (saliente)')['parameters'] as J)['conditions'] as J)['conditions'] as J[])[0] as J;
    expect(String(c['leftValue'])).toContain('modoPrueba !== true');
    c['leftValue'] = String(c['leftValue']).replace(" && $('Config del negocio').first().json.modoPrueba !== true", '');
    expect(hallazgosDelReporteSinConteo(f, { exigir: true }).join(' ')).toMatch(/modoPrueba !== true/);
  });
});
