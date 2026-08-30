/**
 * Pruebas del saneo del texto que sale hacia FormSubmit.
 *
 * NO NECESITAN EMULADOR: son funciones puras. Están acá porque el escapado en
 * origen es EL control que reemplaza la garantía de texto plano que daba Resend.
 * Con FormSubmit el correo lo compone un tercero y en HTML: si esto falla, un
 * enlace escrito por un comercio llega vivo a la bandeja de Andres.
 */
import { describe, expect, it } from 'vitest';
import {
  ALIAS_VALIDO, CORREO_VALIDO, neutralizar, neutralizarEncabezado,
} from '../functions/src/saneo.ts';

const CTRL = '\u0001';
const BIDI = '\u202E';
const NUL = '\u0000';

describe('Neutralización del texto del reclamo', () => {
  it('escapa el marcado para que no sobreviva a un renderizado HTML', () => {
    const salida = neutralizar('<img src=x onerror="robar()">', 500);
    expect(salida).not.toContain('<');
    expect(salida).not.toContain('>');
    expect(salida).not.toContain('"');
    expect(salida).toBe('&lt;img src=x onerror=&quot;robar()&quot;&gt;');
  });

  it('neutraliza un enlace de phishing', () => {
    const salida = neutralizar("<a href='https://malo'>Banco</a>", 500);
    expect(salida).not.toMatch(/<a /);
    expect(salida).toContain('&lt;a href=&#39;https://malo&#39;&gt;');
  });

  it('escapa el ampersand, sin dejar entidades a medio formar', () => {
    expect(neutralizar('a & b', 50)).toBe('a &amp; b');
    expect(neutralizar('&lt;', 50)).toBe('&amp;lt;');
  });

  it('quita caracteres de control pero conserva saltos de línea y tabulación', () => {
    const salida = neutralizar('linea1\nlinea2\tcol' + CTRL, 500);
    expect(salida).toBe('linea1\nlinea2\tcol');
  });

  it('quita las marcas bidireccionales', () => {
    // Con ellas, un texto se LEE distinto de como está guardado.
    const salida = neutralizar('pago' + BIDI + 'odagap', 500);
    expect(salida).toBe('pagoodagap');
  });

  it('recorta al tope indicado', () => {
    expect(neutralizar('x'.repeat(5000), 1000)).toHaveLength(1000);
  });

  it('devuelve cadena vacía ante cualquier cosa que no sea texto', () => {
    for (const valor of [undefined, null, 42, {}, [], true]) {
      expect(neutralizar(valor, 100)).toBe('');
    }
  });
});

describe('Neutralización de encabezados', () => {
  it('elimina CR y LF: es la inyección de encabezados de correo', () => {
    // Sin esto, un asunto con un salto de línea agrega un `Bcc:` y desvía una
    // copia del correo a donde quiera quien escribió el reclamo.
    const salida = neutralizarEncabezado('Falla del bot\nBcc: otro@ejemplo.com', 200);
    expect(salida).not.toContain('\n');
    expect(salida).not.toContain('\r');
    expect(salida).toBe('Falla del bot Bcc: otro@ejemplo.com');
  });

  it('convierte CR, LF y NUL en espacio, los tres igual', () => {
    // Consistencia: los tres separadores tienen que comportarse del mismo modo.
    // Antes, el barrido de controles borraba el CR y pegaba las palabras, así
    // que CR y LF hacían cosas distintas.
    expect(neutralizarEncabezado('a\rb', 50)).toBe('a b');
    expect(neutralizarEncabezado('a\nb', 50)).toBe('a b');
    expect(neutralizarEncabezado('a' + NUL + 'b', 50)).toBe('a b');
  });

  it('también escapa el marcado', () => {
    expect(neutralizarEncabezado('<b>urgente</b>', 200)).toBe('&lt;b&gt;urgente&lt;/b&gt;');
  });
});

describe('Validación del destino', () => {
  it('acepta un correo con forma válida', () => {
    expect(CORREO_VALIDO.test('reclamos@ejemplo.com')).toBe(true);
  });

  it('rechaza valores que podrían alterar la RUTA del punto final', () => {
    // El destino se concatena a la URL de FormSubmit. Un `/` o un `?` cambiaría
    // el servicio de destino.
    for (const malo of [
      'reclamos@ejemplo.com/../otro',
      'reclamos@ejemplo.com?x=1',
      'reclamos@ejemplo.com#frag',
      'https://otro-servicio.example.com',
      'con espacio@ejemplo.com',
      '',
    ]) {
      expect(CORREO_VALIDO.test(malo) || ALIAS_VALIDO.test(malo)).toBe(false);
    }
  });

  it('acepta un alias opaco y rechaza uno con separadores', () => {
    expect(ALIAS_VALIDO.test('a1b2c3d4e5f6')).toBe(true);
    expect(ALIAS_VALIDO.test('a1b2/c3d4')).toBe(false);
    expect(ALIAS_VALIDO.test('corto')).toBe(false);
  });
});

// ===========================================================================
// Resolución de funcionarios y ranuras de agenda (funciones puras)
// ===========================================================================
import { ranurasDe, resolverFuncionarios } from '../functions/src/prompt.ts';

describe('Funcionario por defecto', () => {
  const negocio = { nombreNegocio: 'Salon Aurora', calendarioId: 'agenda@ejemplo.com',
                    horarios: { lun: '09:00-19:00' } };

  it('sin funcionarios cargados, el comercio ES el funcionario', () => {
    // Es lo que hace que una PyME de una sola persona no tenga que configurar
    // nada, y que el flujo tenga un solo camino de código.
    const r = resolverFuncionarios([], negocio, new Set());
    expect(r).toHaveLength(1);
    expect(r[0]?.porDefecto).toBe(true);
    expect(r[0]?.calendarioId).toBe('agenda@ejemplo.com');
    expect(r[0]?.servicios).toEqual([]);   // vacío = atiende todo
  });

  it('con funcionarios inactivos únicamente, también cae al de por defecto', () => {
    const r = resolverFuncionarios(
      [{ id: 'f1', datos: { nombre: 'X', activo: false } }], negocio, new Set());
    expect(r[0]?.porDefecto).toBe(true);
  });

  it('un funcionario sin calendario propio hereda el del comercio', () => {
    const r = resolverFuncionarios(
      [{ id: 'f1', datos: { nombre: 'Dra. Rojas', activo: true, calendarioId: '' } }],
      negocio, new Set());
    expect(r[0]?.calendarioId).toBe('agenda@ejemplo.com');
  });

  it('descarta las referencias a servicios que ya no existen', () => {
    // Las reglas solo pudieron comprobar que `servicios` es una lista de hasta
    // 50 elementos, no que esos identificadores existan. Un servicio borrado del
    // catálogo deja la referencia atrás; si no se descartara acá, el agente
    // ofrecería un servicio inexistente.
    const r = resolverFuncionarios(
      [{ id: 'f1', datos: { nombre: 'Dra. Rojas', activo: true,
                            servicios: ['item-1', 'item-borrado', 'item-2'] } }],
      negocio, new Set(['item-1', 'item-2']));
    expect(r[0]?.servicios).toEqual(['item-1', 'item-2']);
  });
});

describe('Ranuras de agenda', () => {
  const d = (h: number, m: number) => new Date(Date.UTC(2026, 8, 1, h, m));

  it('una cita de una hora ocupa cuatro ranuras de 15 minutos', () => {
    expect(ranurasDe('f1', d(11, 0), d(12, 0))).toEqual([
      'f1_20260901_44', 'f1_20260901_45', 'f1_20260901_46', 'f1_20260901_47',
    ]);
  });

  it('DOS CITAS SUPERPUESTAS COMPARTEN RANURAS aunque no empiecen a la misma hora', () => {
    // Es el corazón del candado. Buscar el choque por hora de INICIO —el
    // reflejo natural— dejaría pasar exactamente este caso: 11:00-12:00 y
    // 11:30-12:30 no empiezan igual y sin embargo se pisan.
    const a = ranurasDe('f1', d(11, 0), d(12, 0));
    const b = ranurasDe('f1', d(11, 30), d(12, 30));
    expect(a.filter((r) => b.includes(r))).toEqual(['f1_20260901_46', 'f1_20260901_47']);
  });

  it('dos funcionarios distintos a la misma hora NO chocan', () => {
    // El error que motivó todo esto: una manicure a las 11:30 bloqueaba una
    // ortodoncia a las 11:30, que atiende otra persona.
    const a = ranurasDe('manicurista', d(11, 30), d(12, 30));
    const b = ranurasDe('odontologo', d(11, 30), d(12, 30));
    expect(a.filter((r) => b.includes(r))).toEqual([]);
  });

  it('citas consecutivas no se pisan', () => {
    const a = ranurasDe('f1', d(11, 0), d(12, 0));
    const b = ranurasDe('f1', d(12, 0), d(13, 0));
    expect(a.filter((r) => b.includes(r))).toEqual([]);
  });

  it('una cita más corta que una ranura ocupa igual una entera', () => {
    expect(ranurasDe('f1', d(9, 0), d(9, 5))).toEqual(['f1_20260901_36']);
  });
});
