/**
 * Usuarios.tsx: guardas de fuente de la marca «Titular» (sin navegador ni red).
 * Solo presentación: el rechazo verdadero es del servidor (`titular-protegido.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const fuente = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web/src/central/paginas/Usuarios.tsx'), 'utf8');

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
  it('NEGATIVA: no hay botón Quitar ni llamada a quitarUsuario (va con el rediseño)', () => {
    expect(fuente).not.toContain('quitarUsuario');
    expect(fuente).not.toMatch(/>\s*Quitar\s*</);
  });
  it('NEGATIVA: el navegador no importa nada de firebase-admin ni de titular.ts', () => {
    expect(fuente).not.toContain('firebase-admin');
    expect(fuente).not.toContain('central/titular');
  });
});
