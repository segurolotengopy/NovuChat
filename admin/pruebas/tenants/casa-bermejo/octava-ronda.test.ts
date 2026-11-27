/**
 * OCTAVA RONDA de Casa Bermejo (26/11/2026), REESCRITA el 26/11/2026 con el rediseño «Intermedio» de la entrega: una cortesía o una palabra suelta no completa ningún paso, un dato por paso (`pide`), y nada de adivinar texto libre.
 * Cada punto trae su caso NEGADO (adverso o cortesía) y su caso sano. Primera parte: la librería pura. Segunda: el JSON versionado con el n8n de mentira, con un modelo que TOMA EL TEXTO COMO DATO EN TODOS LOS CAMPOS que todavía existen (nombre y documento).
 *
 * DEJAN DE APLICAR (la octava ronda original validaba ciudad, flota y los campos de Argentina con listas de palabras; el 26/11/2026 Andres decidió no adivinar texto libre y esos datos cambiaron):
 *   - BN1 «la CIUDAD suelta pasa por las exclusiones del nombre» (`bmCiudadDelTexto`, `bmDatoExcluido`, `bmDatoValido`, `bmLugarValido`): las listas negras de ciudad y de flota se BORRARON. Queda la validación mínima (no vacío, no consulta, no palabra de control, largo): aquí se prueba con `bmCiudadYAclaracion`.
 *   - BN2/BN3 «la CIUDAD y la FLOTA que propone el modelo»: el modelo ya no propone ciudad ni flota (la ciudad la escribe el cliente cuando el código la pide; la flota la define la tienda y no se pide).
 *   - I1 «Argentina: dirección, código postal y provincia»: ya no se piden (dirección exacta, CP y provincia por texto libre); la provincia sale de la lista de su región (entrega-listas.test.ts).
 *   - M1 «un rótulo de otro dato no es un nombre» para «Provincia …», «Ciudad …», «Flota …», «Dirección …» y «CP …»: esos rótulos ya no son datos que se pidan; se conserva la parte de los nombres reales (Rosa, Paz, Luz, Mercedes).
 * Mensajes por conversación: ver entrega-listas.test.ts. Datos ficticios: ninguna dirección ni teléfono es real.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';
import { ANA, crear, hablar, mLista, modeloSano, mTexto, mToque } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '../../../../Flujos/experimental');
const RUTAS = [
  'venta-digital/src/cobro.js', 'venta-digital/src/diferencias.js', '../src/modulos/pedidos/comprobante-diferencias.js', 'venta-digital/src/avisos.js', 'venta-digital/src/conversacion.js', 'venta-digital/src/carrito.js', 'venta-digital/src/catalogo-externo.js',
  '../src/core/sin-agente/mensajes.js', '../src/core/texto/filtro-redaccion.js', '../src/core/texto/identidad.js', '../src/modulos/pedidos/confirmar-pedido.js', '../clientes/casa-bermejo/src/lib/bm.js', '../clientes/casa-bermejo/src/lib/bm-venta.js', 'venta-digital/src/nodos/_comun.js',
].map((r) => join(FLUJOS, r));
const NOMBRES = ['bmNombreValido', 'bmEntregaDeTurno', 'bmCiudadYAclaracion', 'bmPideDeEntrega', 'bmNorm'];
const B = cargarFuente<Record<string, any>>(RUTAS, NOMBRES); // eslint-disable-line @typescript-eslint/no-explicit-any
type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const b = (n: string): Fn => B[n] as Fn;
const VENDIBLES = [{ id: 'billetera-cuero', nombre: 'Billetera de cuero', area: 'Accesorios · Billeteras' }, { id: 'llavero-llama', nombre: 'Llavero de llama', area: 'Hogar y oficina · Llaveros' }];
const CORTESIAS = ['Muchas gracias', 'Bien', 'Perfecto', 'Gracias', 'Gracias por todo', 'Ok perfecto', 'Chau', 'quiero pagar', 'quiero hablar con un vendedor'];

describe('BN1. el paso de la CIUDAD: una cortesía, una orden o una despedida no es una ciudad (unitario, sin modelo)', () => {
  for (const x of CORTESIAS) it(`NEGADO: «${x}» como respuesta a «¿ciudad?» no es una ciudad`, () => {
    expect(b('bmCiudadYAclaracion')(x).ciudad, x).toBe('');
  });
  for (const x of ['Cochabamba', 'Santa Cruz', 'Oruro', 'Tarija', 'La Paz']) it(`sano: «${x}» es una ciudad y se guarda TAL CUAL`, () => {
    expect(b('bmCiudadYAclaracion')(x).ciudad).toBe(x);
  });
  it('NEGADO: «4412345» (un documento) o «4412345 Gracias» tampoco es una ciudad', () => {
    expect(b('bmCiudadYAclaracion')('4412345').ciudad).toBe('');
    expect(b('bmCiudadYAclaracion')('4412345 Gracias').ciudad).toBe('');
  });
});

describe('BN. UN dato por paso: lo que el cliente adelanta no se guarda, y el modelo no puede fijar ciudad, departamento ni flota', () => {
  const ENV = { modo: 'envío' };
  it('NEGADO: sin `pide` el modelo no fija nada de la entrega aunque el texto sea limpio (ni el nombre ni el documento)', () => {
    const r = b('bmEntregaDeTurno')({ nombre: 'Ana Pérez', documento: '4412345', ciudad: 'Oruro', departamento: 'dep:or', flota: 'Bolivar' }, ENV, 'Ana Pérez', ['recojo en tienda', 'envío'], { vendibles: VENDIBLES });
    expect(r.entrega).toEqual({});
  });
  it('NEGADO: la ciudad, el departamento y la flota que devuelve el modelo se IGNORAN siempre (la ciudad y la aclaración las lee el código del texto del cliente; el departamento sale de la lista; la flota no existe)', () => {
    const r = b('bmEntregaDeTurno')({ ciudad: 'Trucha', departamento: 'dep:lp', flota: 'Bolivar', provincia: 'prov:ar-x' }, ENV, 'gracias', ['recojo en tienda', 'envío'], { vendibles: VENDIBLES, esperaCiudad: false });
    expect(r.entrega).toEqual({});
  });
  it('el código pide, por estado, UN paso por vez (lista en pasos): departamento → ciudad → nombre y cédula', () => {
    const P = b('bmPideDeEntrega');
    expect(P({ modo: 'envío' }, 'BO')).toEqual(['departamento']);
    expect(P({ modo: 'envío' }, 'AR')).toEqual(['region']);
    expect(P({ modo: 'envío', region: 'reg:cuyo' }, 'AR')).toEqual(['provincia']);
    expect(P({ modo: 'envío', region: 'reg:cuyo', provincia: 'prov:ar-m' }, 'AR')).toEqual(['ciudad']);
    expect(P({ modo: 'envío', region: 'reg:cuyo', provincia: 'prov:ar-m', ciudad: 'Mendoza' }, 'AR')).toEqual(['nombre', 'documento']);
  });
});

describe('M1. los nombres reales siguen siéndolo', () => {
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
const CAMPOS = ['nombre', 'documento'];
/** El modelo que TOMA EL TEXTO COMO DATO en todos los campos que le quedan a la entrega (el más duro de los que ataca la revisora). */
const modeloTodos = (): ReturnType<typeof modeloSano> => modeloSano((t) => Object.fromEntries(CAMPOS.map((k) => [k, t])));
/** El envío por el botón, con el departamento ya elegido por la lista: el código pide la ciudad. */
const conCiudadPedida = (modeloDice: ReturnType<typeof modeloSano>): Mund => {
  const m = crear({ modeloDice });
  hablar(m, ANA, mTexto('quiero una billetera'));
  hablar(m, ANA, mToque('entrega:envio', 'Envío'));
  hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
  return m;
};
/** El modelo SANO: extrae solo lo que de verdad es un dato (el nombre) y nada de lo demás. */
const sanoSinDatos = (): ReturnType<typeof modeloSano> => modeloSano((t) => (t === 'Ana Pérez' ? { nombre: t } : {}));

describe('BN de punta a punta: una cortesía o una palabra suelta NO completa el paso de la ciudad ni saca «Confirmar pedido»', () => {
  for (const [nombreModelo, fabrica] of [['sano (no extrae nada)', sanoSinDatos], ['todos los campos', modeloTodos]] as const) {
    for (const x of ['Muchas gracias', 'Bien', 'Perfecto', 'Gracias', 'Chau', 'quiero pagar']) {
      it(`NEGADO [${nombreModelo}] «${x}» tras pedir la ciudad: ninguna ciudad, se repregunta la MISMA, sin «Confirmar pedido» ni QR`, () => {
        const m = conCiudadPedida(fabrica());
        expect(ficha(m).pide).toEqual(['ciudad']);
        const t = hablar(m, ANA, mTexto(x));
        expect(ficha(m).entrega['ciudad'], x).toBe('');
        expect(ficha(m).pide, x).toEqual(['ciudad']);
        expect(confirmaDe(t), x).toBeUndefined();
        expect(hayQr(t), x).toBe(false);
      });
    }
  }
  it('NEGADO: «Ana Pérez» dicho en el paso de la CIUDAD no queda como nombre (un dato por paso): se guarda como ciudad TAL CUAL si el código la pidió, y el nombre se pide después', () => {
    const m = conCiudadPedida(modeloTodos());
    hablar(m, ANA, mTexto('Ana Pérez'));
    expect(ficha(m).entrega['nombre']).toBe('');
    expect(ficha(m).pide).toEqual(['nombre', 'documento']);
  });
  it('NEGADO: con el modelo de todos los campos, «CI 4412345» en el paso de la ciudad solo fija el documento (rotulado) y no deja ciudad', () => {
    const m = conCiudadPedida(modeloTodos());
    hablar(m, ANA, mTexto('CI 4412345'));
    expect(ficha(m).entrega['documento']).toBe('4412345');
    expect(ficha(m).entrega['ciudad']).toBe('');
    expect(ficha(m).pide).toEqual(['ciudad']);
  });
  it('sano: «Cochabamba» y luego «Ana Pérez 4412345» completan el envío y sale «Confirmar pedido» (sin QR hasta el toque)', () => {
    const m = conCiudadPedida(modeloTodos());
    const t1 = hablar(m, ANA, mTexto('Cochabamba'));
    expect(ficha(m).entrega['ciudad']).toBe('Cochabamba');
    expect(ficha(m).pide).toEqual(['nombre', 'documento']);
    expect(confirmaDe(t1)).toBeUndefined();
    const t2 = hablar(m, ANA, mTexto('Ana Pérez 4412345'));
    expect(ficha(m).entrega['nombre']).toBe('Ana Pérez');
    expect(confirmaDe(t2)).toBeDefined();
    expect(hayQr(t2)).toBe(false);
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
