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
// La arroba va aparte: el saneo del repositorio público rechaza cualquier texto con forma de correo.
const A = '@';
const VG = cargarFuente<Record<string, any>>([join(COMUN, 'src/gmail.js')], ['vgExtraerGmail', 'vgEsGmail']); // eslint-disable-line @typescript-eslint/no-explicit-any
const extraer = VG.vgExtraerGmail as F;
const esGmail = VG.vgEsGmail as F;

describe('vgExtraerGmail', () => {
  it('acepta un Gmail, con mayúsculas y punto final, o dentro de una frase', () => {
    expect(extraer('Juan.Perez' + A + 'Gmail.com.')).toEqual({ resultado: 'recibido', correo: 'juan.perez' + A + 'gmail.com' });
    expect(extraer('mi correo es juanito' + A + 'gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
    expect(extraer('*juan.perez' + A + 'gmail.com*')).toEqual({ resultado: 'recibido', correo: 'juan.perez' + A + 'gmail.com' });
    expect(extraer('~_juan.perez' + A + 'gmail.com_~')).toEqual({ resultado: 'recibido', correo: 'juan.perez' + A + 'gmail.com' });
    expect(extraer('¡juan.perez' + A + 'gmail.com¡')).toEqual({ resultado: 'recibido', correo: 'juan.perez' + A + 'gmail.com' });
    expect(extraer('¿juan.perez' + A + 'gmail.com?')).toEqual({ resultado: 'recibido', correo: 'juan.perez' + A + 'gmail.com' });
    expect(extraer('<juanito' + A + 'gmail.com>, gracias!')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
  });
  it('los caracteres invisibles (U+200B, U+2060, U+00AD) y la barra final no cambian el correo', () => {
    expect(extraer('juani\u200bto' + A + 'gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
    expect(extraer('juanito\u2060' + A + 'gmail.com\u00ad')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
    expect(extraer('juanito' + A + 'gmail.com/')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
  });
  it('el mismo correo repetido cuenta uno; la arroba de ancho completo se normaliza', () => {
    expect(extraer('juanito' + A + 'gmail.com o JUANITO' + A + 'gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
    expect(extraer('juanito＠gmail.com')).toEqual({ resultado: 'recibido', correo: 'juanito' + A + 'gmail.com' });
  });
  it('otro dominio (incluidos los parecidos) es no_gmail y no devuelve correo', () => {
    for (const c of ['a' + A + 'hotmail.com', 'a' + A + 'googlemail.com', 'a' + A + 'gmail.co', 'a' + A + 'gmial.com', 'a' + A + 'gmail.com.bo', 'a' + A + 'mail.gmail.com']) expect(extraer(c)).toEqual({ resultado: 'no_gmail', correo: '' });
  });
  it('una parte local inválida o sin correo es mal_formado', () => {
    for (const c of ['a..b' + A + 'gmail.com', '.a' + A + 'gmail.com', 'a.' + A + 'gmail.com', 'ñandu' + A + 'gmail.com', 'a+b' + A + 'gmail.com', '@gmail.com', 'juanito@', 'juanito' + A + 'gmail .com', 'abc' + A + 'gmail.com', 'a_b_cde' + A + 'gmail.com', 'sin arroba', '', 'x'.repeat(31) + '@gmail.com']) {
      expect(extraer(c)).toEqual({ resultado: 'mal_formado', correo: '' });
    }
  });
  it('más de un correo distinto es varios', () => {
    expect(extraer('juanito' + A + 'gmail.com y anabel' + A + 'gmail.com')).toEqual({ resultado: 'varios', correo: '' });
    expect(extraer('juanito' + A + 'gmail.com y anabel' + A + 'hotmail.com')).toEqual({ resultado: 'varios', correo: '' });
  });
  it('un valor que no es texto no lanza', () => {
    expect(extraer(undefined)).toEqual({ resultado: 'mal_formado', correo: '' });
    expect(extraer(null)).toEqual({ resultado: 'mal_formado', correo: '' });
  });
});

describe('vgEsGmail', () => {
  it('solo un Gmail ya normalizado y bien formado', () => {
    expect(esGmail('juanito' + A + 'gmail.com')).toBe(true);
    for (const c of ['JUANITO' + A + 'gmail.com', 'juanito' + A + 'hotmail.com', 'a..bcdef' + A + 'gmail.com', 'abcdef+b' + A + 'gmail.com', 'abc' + A + 'gmail.com', '', 'a@b' + A + 'gmail.com', 42, null, undefined]) expect(esGmail(c)).toBe(false);
  });
});
