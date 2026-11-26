/**
 * OCTAVA RONDA de Casa Bermejo (26/11/2026), tras la revisión independiente de la séptima (CAMBIOS REQUERIDOS: la validación del nombre no se aplicaba a la ciudad, la flota ni los campos de Argentina).
 * El principio: UNA sola función de validación de dato (`bmDatoValido`: tramo contiguo de lo que escribió el cliente, sin cortesías, intenciones, rótulos de otro dato ni piezas del catálogo) y el código pide cada dato con `pide`.
 * Cada punto trae su caso NEGADO (adverso o cortesía) y su caso sano. Primera parte: la librería pura. Segunda: el JSON versionado con el n8n de mentira, con un modelo que TOMA LA CONSULTA COMO DATO EN TODOS LOS CAMPOS.
 * Mensajes por conversación: 0 agregados. Datos ficticios: ninguna dirección ni teléfono es real.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';
import { ANA, ARGENTINO, CATALOGO, catalogoOk, crear, hablar, modeloSano, mTexto, mToque } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '../../../../Flujos/experimental');
const RUTAS = [
  'venta-digital/src/cobro.js', 'venta-digital/src/diferencias.js', '../src/modulos/pedidos/comprobante-diferencias.js', 'venta-digital/src/avisos.js', 'venta-digital/src/conversacion.js', 'venta-digital/src/carrito.js', 'venta-digital/src/catalogo-externo.js',
  '../src/core/sin-agente/mensajes.js', '../src/core/texto/filtro-redaccion.js', '../src/core/texto/identidad.js', '../src/modulos/pedidos/confirmar-pedido.js', '../clientes/casa-bermejo/src/lib/bm.js', '../clientes/casa-bermejo/src/lib/bm-venta.js', 'venta-digital/src/nodos/_comun.js',
].map((r) => join(FLUJOS, r));
const NOMBRES = ['bmNombreValido', 'bmDatoValido', 'bmDatoExcluido', 'bmLugarValido', 'bmDireccionValida', 'bmCpValido', 'bmEntregaDeTurno', 'bmCiudadDelTexto', 'bmPideDeEntrega', 'bmNorm'];
const B = cargarFuente<Record<string, any>>(RUTAS, NOMBRES); // eslint-disable-line @typescript-eslint/no-explicit-any
type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const b = (n: string): Fn => B[n] as Fn;
const MODOS = ['recojo en tienda', 'envío'];
const VENDIBLES = [{ id: 'billetera-cuero', nombre: 'Billetera de cuero', area: 'Accesorios · Billeteras' }, { id: 'llavero-llama', nombre: 'Llavero de llama', area: 'Hogar y oficina · Llaveros' }];
const E = (nueva: unknown, antes: unknown, texto: string, estado: Record<string, unknown> = {}) => b('bmEntregaDeTurno')(nueva, antes, texto, MODOS, { vendibles: VENDIBLES, ...estado });
const ENVIO = { modo: 'envío' };
const CORTESIAS = ['Muchas gracias', 'Bien', 'Efectivo', 'Perfecto', 'Gracias', 'Billetera', 'Vendedor', 'Gracias por todo', 'Ok perfecto', 'Transferencia', 'Humano', 'Cuero', 'Otro color'];

describe('BN1. la CIUDAD suelta pasa por las mismas exclusiones que el nombre (unitario, sin modelo)', () => {
  for (const x of CORTESIAS) it(`NEGADO: «${x}» como respuesta a «¿ciudad?» no es una ciudad`, () => {
    expect(b('bmCiudadDelTexto')(x, 3, { pidio: true, vendibles: VENDIBLES }).ciudad, x).toBe('');
  });
  for (const x of ['Cochabamba', 'Santa Cruz', 'Oruro', 'Tarija']) it(`sano: «${x}» sigue siendo una ciudad`, () => {
    expect(b('bmCiudadDelTexto')(x, 3, { pidio: true, vendibles: VENDIBLES }).ciudad).toBe(x);
  });
  it('sano: «La Paz» que propone el modelo (la ciudad suelta del código pide palabras de 3 letras) vale: la partícula inicial es de la ciudad', () => {
    const r = E({ ciudad: 'La Paz' }, { modo: 'envío', nombre: 'Ana Pérez', documento: '4412345' }, 'La Paz', { esperaCiudad: true });
    expect(r.entrega.ciudad).toBe('La Paz');
  });
  it('NEGADO: la cifra del CI seguida de una cortesía tampoco es una ciudad («4412345 Gracias»)', () => {
    expect(b('bmCiudadDelTexto')('4412345 Gracias', 0, { vendibles: VENDIBLES }).ciudad).toBe('');
    expect(b('bmCiudadDelTexto')('4412345 Cochabamba', 0, { vendibles: VENDIBLES }).ciudad).toBe('Cochabamba');
  });
});

describe('BN2/BN3. la CIUDAD y la FLOTA que propone el modelo: validadas, y solo si el código las pidió (`pide`)', () => {
  const PIDE = { esperaNombre: true, esperaDocumento: true, esperaCiudad: true, esperaFlota: true };
  for (const x of CORTESIAS.concat(['no, mejor envío', 'ENVÍO POR FAVOR', 'CI 4412345', '70012345', 'mi número de pedido es 123456'])) {
    it(`NEGADO: el modelo devuelve «${x}» como ciudad y como flota: no queda ninguna de las dos`, () => {
      const r = E({ ciudad: x, flota: x }, ENVIO, x, PIDE);
      expect(r.entrega.ciudad, x).toBeUndefined();
      expect(r.entrega.flota, x).toBeUndefined();
    });
  }
  it('NEGADO: sin `pide` el modelo no puede fijar la flota ni la ciudad aunque el texto sea limpio', () => {
    const r = E({ ciudad: 'Cochabamba', flota: 'Bolivar' }, ENVIO, 'Bolivar', { esperaNombre: true });
    expect(r.entrega.flota).toBeUndefined();
    expect(r.entrega.ciudad).toBeUndefined();
  });
  it('NEGADO: el nombre ya capturado en el mismo turno no es la ciudad ni la flota («Ana Pérez»)', () => {
    const r = E({ nombre: 'Ana Pérez', ciudad: 'Ana Pérez', flota: 'Ana Pérez' }, ENVIO, 'Ana Pérez', PIDE);
    expect(r.entrega.nombre).toBe('Ana Pérez');
    expect(r.entrega.ciudad).toBeUndefined();
    expect(r.entrega.flota).toBeUndefined();
  });
  it('NEGADO: una sola palabra responde UNA pregunta: si queda como ciudad, la flota del modelo no es la misma palabra', () => {
    const r = E({ ciudad: 'Cochabamba', flota: 'Cochabamba' }, { modo: 'envío', nombre: 'Ana Pérez', documento: '4412345' }, 'Cochabamba', { esperaCiudad: true, esperaFlota: true });
    expect(r.entrega.ciudad).toBe('Cochabamba');
    expect(r.entrega.flota).toBeUndefined();
  });
  it('sano: pedida la flota, «Bolivar» (o «la flota Bolivar») la fija; pedida la ciudad, «Cochabamba» la fija', () => {
    const f = E({ flota: 'Bolivar' }, { modo: 'envío', nombre: 'Ana Pérez', documento: '4412345', ciudad: 'Cochabamba' }, 'Bolivar', { esperaFlota: true });
    expect(f.entrega.flota).toBe('Bolivar');
    const c = E({ ciudad: 'Cochabamba' }, { modo: 'envío', nombre: 'Ana Pérez', documento: '4412345' }, 'Cochabamba', { esperaCiudad: true });
    expect(c.entrega.ciudad).toBe('Cochabamba');
  });
  it('R27: el flota contaminado ya no borra la ciudad de «envíenlo a Cochabamba» (la ciudad la lee el código)', () => {
    const r = E({ flota: 'envíenlo a Cochabamba', ciudad: 'envíenlo a Cochabamba' }, {}, 'envíenlo a Cochabamba', { modoPedido: true });
    expect(r.entrega.modo).toBe('envío');
    expect(r.entrega.ciudad).toBe('Cochabamba');
    expect(r.entrega.flota).toBeUndefined();
  });
});

describe('I1. Argentina: dirección, código postal y provincia, cada uno pedido por el código y validado', () => {
  const AR = { mercado: 'AR', esperaNombre: true, esperaDocumento: true, esperaDireccion: true, esperaCp: true, esperaProvincia: true };
  const TODO = (t: string) => ({ direccion: t, cp: t, provincia: t, nombre: t, ciudad: t, flota: t });
  it('el código pide dirección, código postal y provincia (y nada de ciudad ni flota) en un envío a Argentina', () => {
    expect(b('bmPideDeEntrega')({ modo: 'envío' }, 'AR')).toEqual(['nombre', 'documento', 'direccion', 'cp', 'provincia']);
    expect(b('bmPideDeEntrega')({ modo: 'envío' }, 'BO')).toEqual(['nombre', 'documento', 'ciudad', 'flota']);
  });
  it('NEGADO: «CP 1043» con un modelo que lo devuelve en todos los campos solo fija el código postal', () => {
    const r = E(TODO('CP 1043'), ENVIO, 'CP 1043', AR);
    expect(r.entrega).toEqual({ cp: '1043' });
  });
  it('NEGADO: «Dirección Av Corrientes 1234» solo fija la dirección (sin la entrada) y no la provincia', () => {
    const r = E(TODO('Dirección Av Corrientes 1234'), ENVIO, 'Dirección Av Corrientes 1234', AR);
    expect(r.entrega).toEqual({ direccion: 'Av Corrientes 1234' });
  });
  it('NEGADO: «Provincia Buenos Aires» solo fija la provincia; no es un nombre (M1) ni una dirección', () => {
    const r = E(TODO('Provincia Buenos Aires'), ENVIO, 'Provincia Buenos Aires', AR);
    expect(r.entrega).toEqual({ provincia: 'Buenos Aires' });
    expect(b('bmNombreValido')('Provincia Buenos Aires', 'Provincia Buenos Aires', 1, VENDIBLES)).toBe('');
  });
  it('NEGADO: una cortesía no llena ningún campo de Argentina', () => {
    for (const x of ['Muchas gracias', 'Bien', 'Efectivo', 'Otro color']) expect(E(TODO(x), ENVIO, x, AR).entrega, x).toEqual({});
  });
  it('NEGADO: sin `pide` ni rótulo ni mensaje de datos, el modelo no fija nada', () => {
    expect(E({ direccion: 'Av Corrientes 1234', cp: '1043', provincia: 'Buenos Aires' }, ENVIO, 'Av Corrientes 1234', { mercado: 'AR' }).entrega).toEqual({});
  });
  it('sano: «Calle Florida 500», «1043» y «Buenos Aires» pedidos de uno en uno se capturan', () => {
    expect(E({ direccion: 'Calle Florida 500' }, ENVIO, 'mi dirección es Calle Florida 500', AR).entrega).toEqual({ direccion: 'Calle Florida 500' });
    expect(E({ cp: '1043' }, ENVIO, '1043', { mercado: 'AR', esperaCp: true }).entrega).toEqual({ cp: '1043' });
    expect(E({ provincia: 'Buenos Aires' }, ENVIO, 'Buenos Aires', { mercado: 'AR', esperaProvincia: true }).entrega).toEqual({ provincia: 'Buenos Aires' });
  });
});

describe('M1. un rótulo de otro dato no es un nombre', () => {
  for (const x of ['Provincia Buenos Aires', 'Ciudad Cochabamba', 'Flota Bolivar', 'Dirección Calle Sucre', 'CP Mamani']) it(`NEGADO: «${x}» no es un nombre`, () => expect(b('bmNombreValido')(x, x, 2, VENDIBLES), x).toBe(''));
  for (const x of ['Rosa', 'Paz', 'Luz', 'Mercedes']) it(`sano: «${x}» sigue siendo un nombre`, () => expect(b('bmNombreValido')(x, x, 1, VENDIBLES)).toBe(x));
});

// ------------------------------------------------------------------------------------------------ punta a punta con el JSON versionado
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
type FichaT = { carrito: { id: string }[]; entrega: Record<string, string>; pide: string[]; hist: { r: string; t: string }[] };
const ficha = (m: Mund, tel: string = ANA): FichaT => (m.sd['casabermejo'] as Record<string, FichaT>)[tel]!;
const J = (x: unknown): string => JSON.stringify(x);
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image');
const idsDe = (t: Turno): string[] => t.mensajes.flatMap((x) => ((x.payload['interactive'] as { action?: { buttons?: { reply: { id: string } }[] } } | undefined)?.action?.buttons ?? []).map((b2) => b2.reply.id));
const confirmaDe = (t: Turno): string | undefined => idsDe(t).find((i) => i.startsWith('pedido:confirmar:'));
const CAMPOS = ['nombre', 'documento', 'ciudad', 'flota', 'direccion', 'cp', 'provincia'];
/** El modelo que TOMA EL TEXTO COMO DATO en todos los campos de la entrega (el más duro de los que ataca la revisora). */
const modeloTodos = (): ReturnType<typeof modeloSano> => modeloSano((t) => Object.fromEntries(CAMPOS.map((k) => [k, t])));
/** Envío elegido por el botón, con el nombre y el CI ya capturados: el código pide ciudad y flota. */
const conNombreYCi = (modeloDice: ReturnType<typeof modeloSano>): Mund => {
  const m = crear({ modeloDice });
  hablar(m, ANA, mTexto('quiero una billetera'));
  hablar(m, ANA, mToque('entrega:envio', 'Envío'));
  hablar(m, ANA, mTexto('Ana Pérez'));
  hablar(m, ANA, mTexto('CI 4412345'));
  return m;
};
/** El modelo SANO: extrae solo lo que de verdad es un dato (el nombre, el CI, la ciudad o la flota) y nada de lo demás. */
const sanoSinDatos = (): ReturnType<typeof modeloSano> => modeloSano((t) => (t === 'Ana Pérez' ? { nombre: t } : t === 'CI 4412345' ? { documento: '4412345' } : t === 'Cochabamba' ? { ciudad: t } : t === 'Bolivar' ? { flota: t } : {}));

describe('BN1/BN2/BN3 de punta a punta: una cortesía o una palabra suelta NO completa el envío ni saca «Confirmar pedido»', () => {
  for (const [nombreModelo, fabrica] of [['sano (no extrae nada)', sanoSinDatos], ['todos los campos', modeloTodos]] as const) {
    for (const x of ['Muchas gracias', 'Bien', 'Efectivo', 'Perfecto', 'Gracias', 'Billetera', 'Vendedor', 'Otro color', 'Cuero']) {
      it(`NEGADO [${nombreModelo}] «${x}» tras pedir la ciudad: ni ciudad ni flota, sin «Confirmar pedido» ni QR`, () => {
        const m = conNombreYCi(fabrica());
        expect(ficha(m).pide).toEqual(['ciudad', 'flota']);
        const t = hablar(m, ANA, mTexto(x));
        expect(ficha(m).entrega['ciudad'], x).toBe('');
        expect(ficha(m).entrega['flota'], x).toBe('');
        expect(confirmaDe(t), x).toBeUndefined();
        expect(hayQr(t), x).toBe(false);
      });
    }
  }
  it('NEGADO: con la flota ya dada, «Muchas gracias» no completa la entrega ni saca «Confirmar pedido»', () => {
    const m = conNombreYCi(modeloTodos());
    hablar(m, ANA, mTexto('flota Bolivar'));
    expect(ficha(m).entrega['flota']).toBe('Bolivar');
    const t = hablar(m, ANA, mTexto('Muchas gracias'));
    expect(ficha(m).entrega['ciudad']).toBe('');
    expect(confirmaDe(t)).toBeUndefined();
  });
  it('NEGADO: «Ana Pérez» no queda como nombre Y como ciudad (los mensajes se separan)', () => {
    const m = crear({ modeloDice: modeloTodos() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:envio', 'Envío'));
    hablar(m, ANA, mTexto('Ana Pérez'));
    expect(ficha(m).entrega['nombre']).toBe('Ana Pérez');
    expect(ficha(m).entrega['ciudad']).toBe('');
    expect(ficha(m).entrega['flota']).toBe('');
    hablar(m, ANA, mTexto('CI 4412345'));
    hablar(m, ANA, mTexto('Cochabamba'));
    expect(ficha(m).entrega['ciudad']).toBe('Cochabamba');
    expect(ficha(m).entrega['flota']).toBe('');
  });
  it('NEGADO: «CI 4412345» y «70012345» no dejan flota ni ciudad con el modelo de todos los campos', () => {
    const m = crear({ modeloDice: modeloTodos() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:envio', 'Envío'));
    hablar(m, ANA, mTexto('CI 4412345'));
    hablar(m, ANA, mTexto('70012345'));
    expect(ficha(m).entrega['flota']).toBe('');
    expect(ficha(m).entrega['ciudad']).toBe('');
  });
  it('R27: «envíenlo a Cochabamba» fija el envío Y la ciudad con el modelo de todos los campos (la flota no la contamina)', () => {
    const m = crear({ modeloDice: modeloTodos() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('envíenlo a Cochabamba'));
    expect(ficha(m).entrega['modo']).toBe('Envío');
    expect(ficha(m).entrega['ciudad']).toBe('Cochabamba');
    expect(ficha(m).entrega['flota']).toBe('');
  });
  it('sano: «Cochabamba» y luego «Bolivar» completan el envío y sale «Confirmar pedido» (sin QR hasta el toque)', () => {
    const m = conNombreYCi(modeloTodos());
    const t1 = hablar(m, ANA, mTexto('Cochabamba'));
    expect(ficha(m).entrega['ciudad']).toBe('Cochabamba');
    expect(ficha(m).entrega['flota']).toBe('');
    expect(ficha(m).pide).toEqual(['flota']);
    expect(confirmaDe(t1)).toBeUndefined();
    const t2 = hablar(m, ANA, mTexto('Bolivar'));
    expect(ficha(m).entrega['flota']).toBe('Bolivar');
    expect(confirmaDe(t2)).toBeDefined();
    expect(hayQr(t2)).toBe(false);
  });
});

describe('I1 de punta a punta: un envío a Argentina con el modelo de todos los campos', () => {
  const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
  const conAr = (): Mund => {
    const m = crear({ modeloDice: modeloTodos(), catalogo: catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never) });
    hablar(m, ARGENTINO, mTexto('quiero una billetera'));
    hablar(m, ARGENTINO, mToque('entrega:envio', 'Envío'));
    return m;
  };
  it('el código pide dirección, código postal y provincia', () => {
    expect(ficha(conAr(), ARGENTINO).pide).toEqual(['nombre', 'documento', 'direccion', 'cp', 'provincia']);
  });
  it('NEGADO: «CP 1043» deja solo el código postal (no la dirección ni la provincia)', () => {
    const m = conAr();
    hablar(m, ARGENTINO, mTexto('CP 1043'));
    const e = ficha(m, ARGENTINO).entrega;
    expect([e['cp'], e['direccion'], e['provincia'], e['flota']]).toEqual(['1043', '', '', '']);
  });
  it('NEGADO: «Dirección Av Corrientes 1234» deja solo la dirección', () => {
    const m = conAr();
    hablar(m, ARGENTINO, mTexto('Dirección Av Corrientes 1234'));
    const e = ficha(m, ARGENTINO).entrega;
    expect([e['direccion'], e['cp'], e['provincia']]).toEqual(['Av Corrientes 1234', '', '']);
  });
  it('NEGADO: «Provincia Buenos Aires» deja solo la provincia y no la toma por nombre', () => {
    const m = conAr();
    hablar(m, ARGENTINO, mTexto('Provincia Buenos Aires'));
    const e = ficha(m, ARGENTINO).entrega;
    expect([e['provincia'], e['nombre'], e['direccion'], e['cp']]).toEqual(['Buenos Aires', '', '', '']);
  });
});

describe('LOW seguridad: la respuesta de la tienda no vuelve al modelo desde la memoria de la charla', () => {
  it('«Armar mensajes» guarda en `hist` una marca fija, nunca el texto de la tienda (que volvería al prompt sin <<< >>>)', () => {
    const fuente = readFileSync(join(AQUI, '../../../../Flujos/clientes/casa-bermejo/src/nodos/armar-mensajes.js'), 'utf8');
    expect(fuente).not.toMatch(/\+\s*\(uAntes !== '' \? ' ' \+ uAntes : ''\)\)/);
    expect((fuente.match(/respuesta de la tienda enviada/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('el texto de la tienda no queda en la memoria tras un turno que la contesta', () => {
    const m = crear({ modeloDice: modeloSano(), base: { ubicacionTienda: 'Calle Sucre 12', horarioTienda: 'lunes a sábado de 9 a 19' } });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mTexto('quiero una llavero de llama, ¿a qué hora abren?'));
    expect(J(ficha(m).hist)).not.toContain('lunes a sábado de 9 a 19');
  });
});
