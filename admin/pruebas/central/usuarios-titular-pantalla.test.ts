/**
 * Usuarios.tsx: guardas de fuente de la marca «Titular» (sin navegador ni red).
 * Solo presentación: el rechazo verdadero es del servidor (`titular-protegido.test.ts`).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web/src/central/paginas/Usuarios.tsx'), 'utf8');

/** Extrae el cuerpo de `function titularDeFicha` de un fuente y lo vuelve ejecutable. */
function criterioDe(codigo: string): (f: Record<string, unknown> | undefined) => string | null {
  const m = /function titularDeFicha\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(codigo);
  if (!m) throw new Error('no se encontro titularDeFicha');
  const js = m[1]!.replace(/: string \| null/g, '').replace(/as string/g, '');
  // La prueba ejecuta SOLO el cuerpo de una función del propio repositorio (leído del fuente, no de entrada
  // externa) para comprobar que el espejo de la web da lo mismo que el servidor.
  return vm.compileFunction(js, ['ficha']) as (f: Record<string, unknown> | undefined) => string | null;
}

describe('Usuarios.tsx y el titular de la cuenta', () => {
  it('lee titularCuentaUid de la ficha del negocio y marca «Titular» en su fila', () => {
    expect(fuente).toContain("doc(db, 'tenants', tenantId)");
    expect(fuente).toContain('titularCuentaUid');
    expect(fuente).toMatch(/m\.id === titular && <strong> Titular<\/strong>/);
  });
  it('avisa antes de enviar si se pide oper para el titular', () => {
    expect(fuente).toContain('pideDegradarTitular');
    expect(fuente).toContain('titular de la cuenta');
  });
  it('el espejo de la web y titularDeFicha del servidor dan lo mismo con los mismos casos', () => {
    const servidor = criterioDe(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'functions/src/central/titular.ts'), 'utf8'));
    const web = criterioDe(fuente);
    const casos: Array<Record<string, unknown> | undefined> = [
      undefined, {}, { titularCuentaUid: 'TA' }, { titularCuentaUid: '  TA ' }, { titularCuentaUid: '' },
      { titularCuentaUid: '   ' }, { titularCuentaUid: null }, { titularCuentaUid: 7 }, { titularCuentaUid: {} },
      { titularCuentaUid: ['TA'] }, { titularCuentaUid: true },
    ];
    for (const c of casos) expect(web(c)).toBe(servidor(c));
    expect(web({ titularCuentaUid: ' TA ' })).toBe('TA');
  });
  it('NEGATIVA: no hay botón Quitar ni llamada a quitarUsuario (va con el rediseño)', () => {
    expect(fuente).not.toContain('quitarUsuario');
    expect(fuente).not.toMatch(/>\s*Quitar\s*</);
  });
  it('NEGATIVA: el navegador no importa nada de firebase-admin ni de titular.ts', () => {
    expect(fuente).not.toContain('firebase-admin');
    expect(fuente).not.toContain('central/titular');
  });
});
