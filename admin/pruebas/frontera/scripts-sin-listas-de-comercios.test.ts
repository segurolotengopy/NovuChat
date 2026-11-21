/**
 * Ningún script común lleva una lista literal de comercios (regla de zonas: «nunca un nombre de cliente en
 * código común»). Un script que nombre un comercio en una línea de código debe estar en `EXCEPCIONES`, con
 * su porqué; una excepción nueva se discute, no se agrega para poner la prueba en verde. La lista solo se achica.
 * Las líneas de comentario no cuentan; los datos de tenant (`admin/scripts/datos/`) tampoco.
 * Límites conocidos: la excepción vale por ARCHIVO ENTERO (no por línea), y el filtro de comentarios salta
 * toda línea que empieza con `#`, `//`, `*` o `/*` (una lista que empezara una línea con `*` no se vería).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RAIZ } from './frontera.ts';

const COMERCIOS = /rroca-(ruben|antonio|evy|emma)|qtaco|walisuma|casa-bermejo|bellido|doctoras|platinum|\brroca\b|\brub[eé]n\b|casa[-_ ]?bermejo|q[-' ]?taco/i;
const EXTENSIONES = /\.(sh|mjs|js|py|ts)$/;

const EXCEPCIONES: Record<string, string> = {
  'scripts/publicar-flujo.sh': '(b) guardias por cliente del publicador; lo cambia otro PR',
  'scripts/registrar-llave-rele-n8n.sh': '(b) alias permitidos de la llave del relé: guardia contra alias ajenos',
  'scripts/registrar-numero.sh': '(b) solo un ejemplo de archivo .env en un mensaje de uso',
  'admin/scripts/plataforma/comercios-no-tocados.mjs': 'LA fuente única de los comercios que no se tocan',
  'admin/scripts/plataforma/aplicar-consola-conversaciones.mjs': '(b) TENANTS_EXCLUIDOS propia (solo Bellido), con su historia',
  'admin/scripts/plataforma/aplicar-catalogo-externo.mjs': '(b) texto del mensaje de rechazo',
  'admin/scripts/plataforma/aplicar-guardar-medios.mjs': '(b) texto del mensaje de rechazo',
  'admin/scripts/plataforma/aplicar-persona-puede-escribir.mjs': '(b) texto de un mensaje',
  'admin/scripts/plataforma/baja-comercio.mjs': '(b) texto del mensaje de rechazo',
  'admin/scripts/plataforma/verificar-salida-persona.mjs': '(b) texto de un mensaje',
  'admin/scripts/plataforma/cobro-ensayo-ruben.mjs': '(b) script de un ensayo de un solo comercio, por diseño',
  'admin/scripts/plataforma/planilla-u-a-x-bellido.mjs': '(b) script de un solo comercio, por diseño',
  'admin/scripts/plataforma/desactivar-productos.mjs': '(b) lista cerrada de comercio e ids permitidos: guardia de una operación puntual',
  'admin/scripts/plataforma/habilitar-productos.mjs': '(b) lista cerrada de comercios permitidos: guardia de una operación puntual',
  'admin/scripts/plataforma/quitar-campanas.mjs': '(b) ids permitidos de una operación puntual de un comercio',
  'admin/scripts/plataforma/rellenar-conversaciones.mjs': '(b) PERMITIBLES: levantar la exclusión exige nombrarlo',
  'admin/scripts/plataforma/relleno-crm-historico.mjs': '(b) guardia: qué hojas se rellenan o vacían; propuesta pendiente de fuente única',
  'admin/scripts/plataforma/vaciar-hoja-crm.mjs': '(b) texto de uso',
  'admin/scripts/plataforma/resetear-telefono-prueba.mjs': 'propuesta: FLUJO_DE_TENANT debería salir de la ficha del tenant en Firestore (diseño, fuera de este PR)',
  'admin/scripts/plataforma/vaciar-memoria-flujo.mjs': '(b) claves de staticData del flujo de Rubén: lista cerrada de una operación puntual',
  'admin/scripts/portar-prompt-cliente.py': '(b) texto de uso',
};

function lineasDeCodigo(texto: string): string[] {
  return texto.split('\n').filter((l) => !/^\s*(#|\/\/|\*|\/\*)/.test(l));
}

function listarScripts(raiz: string, git = true): string[] {
  const salida = git
    ? execFileSync('git', ['ls-files', 'scripts', 'admin/scripts'], { cwd: raiz, encoding: 'utf8' })
    : execFileSync('find', ['scripts', 'admin/scripts', '-type', 'f'], { cwd: raiz, encoding: 'utf8' });
  return salida.split('\n').filter((f) => f && !f.startsWith('admin/scripts/datos/') && EXTENSIONES.test(f));
}
const nombranComercio = (raiz: string, f: string) => lineasDeCodigo(readFileSync(join(raiz, f), 'utf8')).some((l) => COMERCIOS.test(l));

describe('scripts comunes sin listas literales de comercios', () => {
  const archivos = listarScripts(RAIZ);

  it('solo los archivos de la lista cerrada nombran un comercio en código', () => {
    const nombran = archivos.filter((f) => lineasDeCodigo(readFileSync(join(RAIZ, f), 'utf8')).some((l) => COMERCIOS.test(l)));
    const fuera = nombran.filter((f) => !(f in EXCEPCIONES));
    expect(fuera, `nombran un comercio sin estar declarados: ${fuera.join(', ')}`).toEqual([]);
  });

  it('cada excepción sigue siendo necesaria (la lista solo se achica)', () => {
    const sobran = Object.keys(EXCEPCIONES).filter((f) => !archivos.includes(f)
      || !lineasDeCodigo(readFileSync(join(RAIZ, f), 'utf8')).some((l) => COMERCIOS.test(l)));
    expect(sobran, `ya no nombran un comercio; quitarlos de EXCEPCIONES: ${sobran.join(', ')}`).toEqual([]);
  });

  it('el detector ve una lista literal nueva (prueba negativa)', () => {
    expect(lineasDeCodigo("const T = ['qtaco', 'walisuma'];").some((l) => COMERCIOS.test(l))).toBe(true);
    expect(lineasDeCodigo('// qtaco en un comentario').some((l) => COMERCIOS.test(l))).toBe(false);
  });

  it('el recorrido de archivos ve un script nuevo con una lista y no ve los datos de tenant', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'comercios-'));
    try {
      mkdirSync(join(tmp, 'scripts'), { recursive: true });
      mkdirSync(join(tmp, 'admin/scripts/datos/x'), { recursive: true });
      writeFileSync(join(tmp, 'scripts/nuevo.sh'), 'for t in "Q\'Taco" casa_bermejo; do echo $t; done\n');
      writeFileSync(join(tmp, 'admin/scripts/datos/x/d.mjs'), "export const T = ['qtaco'];\n");
      const vistos = listarScripts(tmp, false);
      expect(vistos).toEqual(['scripts/nuevo.sh']);
      expect(vistos.filter((f) => nombranComercio(tmp, f) && !(f in EXCEPCIONES))).toEqual(['scripts/nuevo.sh']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('la regex ampliada ve las variantes y no inventa', () => {
    for (const t of ["['rroca','ruben']", '{ rroca: 1 }', 'platinum', 'Rubén', "Q'Taco", 'q-taco', 'casa bermejo']) {
      expect(COMERCIOS.test(t), t).toBe(true);
    }
    for (const t of ['const rrocaX = 1', 'tuberuben2', 'taco']) expect(COMERCIOS.test(t), t).toBe(false);
  });
});
