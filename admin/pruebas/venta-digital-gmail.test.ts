/**
 * GMAIL DEL CLIENTE (`Flujos/experimental/venta-digital/src/gmail.js`, prefijo `vg`): extrae y valida UN correo de Gmail del texto literal del cliente.
 * Se prueba NEGANDO: lo que no es un Gmail válido, o es más de un correo, nunca llega a `recibido`.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from './core/fuente-vm';

const COMUN = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-digital');
type F = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const VG = cargarFuente<Record<string, any>>([join(COMUN, 'src/gmail.js')], ['vgExtraerGmail', 'vgEsGmail']); // eslint-disable-line @typescript-eslint/no-explicit-any
const extraer = VG.vgExtraerGmail as F;
const esGmail = VG.vgEsGmail as F;

describe('vgExtraerGmail', () => {
  it('acepta un Gmail, con mayúsculas y punto final, o dentro de una frase', () => {
    expect(extraer('Juan.Perez@Gmail.com.')).toEqual({ resultado: 'recibido', correo: 'juan.perez@gmail.com' });
    expect(extraer('mi correo es juan@gmail.com')).toEqual({ resultado: 'recibido', correo: 'juan@gmail.com' });
    expect(extraer('<juan@gmail.com>, gracias!')).toEqual({ resultado: 'recibido', correo: 'juan@gmail.com' });
  });
  it('el mismo correo repetido cuenta uno; la arroba de ancho completo se normaliza', () => {
    expect(extraer('juan@gmail.com o JUAN@gmail.com')).toEqual({ resultado: 'recibido', correo: 'juan@gmail.com' });
    expect(extraer('juan＠gmail.com')).toEqual({ resultado: 'recibido', correo: 'juan@gmail.com' });
  });
  it('otro dominio (incluidos los parecidos) es no_gmail y no devuelve correo', () => {
    for (const c of ['a@hotmail.com', 'a@googlemail.com', 'a@gmail.co', 'a@gmial.com', 'a@gmail.com.bo', 'a@mail.gmail.com']) expect(extraer(c)).toEqual({ resultado: 'no_gmail', correo: '' });
  });
  it('una parte local inválida o sin correo es mal_formado', () => {
    for (const c of ['a..b@gmail.com', '.a@gmail.com', 'a.@gmail.com', 'ñandu@gmail.com', 'a+b@gmail.com', '@gmail.com', 'juan@', 'sin arroba', '', 'a@gmail.com'.replace('a', 'x'.repeat(31))]) {
      expect(extraer(c)).toEqual({ resultado: 'mal_formado', correo: '' });
    }
  });
  it('más de un correo distinto es varios', () => {
    expect(extraer('juan@gmail.com y ana@gmail.com')).toEqual({ resultado: 'varios', correo: '' });
    expect(extraer('juan@gmail.com y ana@hotmail.com')).toEqual({ resultado: 'varios', correo: '' });
  });
  it('un valor que no es texto no lanza', () => {
    expect(extraer(undefined)).toEqual({ resultado: 'mal_formado', correo: '' });
    expect(extraer(null)).toEqual({ resultado: 'mal_formado', correo: '' });
  });
});

describe('vgEsGmail', () => {
  it('solo un Gmail ya normalizado y bien formado', () => {
    expect(esGmail('juan@gmail.com')).toBe(true);
    for (const c of ['JUAN@gmail.com', 'juan@hotmail.com', 'a..b@gmail.com', 'a+b@gmail.com', '', 'a@b@gmail.com', 42, null, undefined]) expect(esGmail(c)).toBe(false);
  });
});
