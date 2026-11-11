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
    expect(extraer('mi correo es juanito@gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
    expect(extraer('*juan.perez@gmail.com*')).toEqual({ resultado: 'recibido', correo: 'juan.perez@gmail.com' });
    expect(extraer('~_juan.perez@gmail.com_~')).toEqual({ resultado: 'recibido', correo: 'juan.perez@gmail.com' });
    expect(extraer('¡juan.perez@gmail.com¡')).toEqual({ resultado: 'recibido', correo: 'juan.perez@gmail.com' });
    expect(extraer('¿juan.perez@gmail.com?')).toEqual({ resultado: 'recibido', correo: 'juan.perez@gmail.com' });
    expect(extraer('<juanito@gmail.com>, gracias!')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
  });
  it('los caracteres invisibles (U+200B, U+2060, U+00AD) y la barra final no cambian el correo', () => {
    expect(extraer('juani\u200bto@gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
    expect(extraer('juanito\u2060@gmail.com\u00ad')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
    expect(extraer('juanito@gmail.com/')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
  });
  it('el mismo correo repetido cuenta uno; la arroba de ancho completo se normaliza', () => {
    expect(extraer('juanito@gmail.com o JUANITO@gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
    expect(extraer('juanito＠gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito@gmail.com' });
  });
  it('otro dominio (incluidos los parecidos) es no_gmail y no devuelve correo', () => {
    for (const c of ['a@hotmail.com', 'a@googlemail.com', 'a@gmail.co', 'a@gmial.com', 'a@gmail.com.bo', 'a@mail.gmail.com']) expect(extraer(c)).toEqual({ resultado: 'no_gmail', correo: '' });
  });
  it('una parte local inválida o sin correo es mal_formado', () => {
    for (const c of ['a..b@gmail.com', '.a@gmail.com', 'a.@gmail.com', 'ñandu@gmail.com', 'a+b@gmail.com', '@gmail.com', 'juanito@', 'juanito@gmail .com', 'abc@gmail.com', 'a_b_cde@gmail.com', 'sin arroba', '', 'x'.repeat(31) + '@gmail.com']) {
      expect(extraer(c)).toEqual({ resultado: 'mal_formado', correo: '' });
    }
  });
  it('más de un correo distinto es varios', () => {
    expect(extraer('juanito@gmail.com y anabel@gmail.com')).toEqual({ resultado: 'varios', correo: '' });
    expect(extraer('juanito@gmail.com y anabel@hotmail.com')).toEqual({ resultado: 'varios', correo: '' });
  });
  it('un valor que no es texto no lanza', () => {
    expect(extraer(undefined)).toEqual({ resultado: 'mal_formado', correo: '' });
    expect(extraer(null)).toEqual({ resultado: 'mal_formado', correo: '' });
  });
});

describe('vgEsGmail', () => {
  it('solo un Gmail ya normalizado y bien formado', () => {
    expect(esGmail('juanito@gmail.com')).toBe(true);
    for (const c of ['JUANITO@gmail.com', 'juanito@hotmail.com', 'a..bcdef@gmail.com', 'abcdef+b@gmail.com', 'abc@gmail.com', '', 'a@b@gmail.com', 42, null, undefined]) expect(esGmail(c)).toBe(false);
  });
});
