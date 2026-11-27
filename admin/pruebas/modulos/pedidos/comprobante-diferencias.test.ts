/** El texto común del comprobante que NO coincide (Bermejo B2, D3): nombra TODAS las diferencias, pasa a recepción y nunca afirma un pago. */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const M = runInNewContext(`${readFileSync(join(RAIZ, 'Flujos/src/modulos/pedidos/comprobante-diferencias.js'), 'utf8')}\n({ cdTextoComprobanteConDiferencias });`) as { cdTextoComprobanteConDiferencias: (d: unknown, s: unknown, u: boolean) => string };
const t = M.cdTextoComprobanteConDiferencias;
describe('cdTextoComprobanteConDiferencias', () => {
  it('tres diferencias salen las tres, en orden, y recepción ya fue avisada', () => {
    const x = t(['la cuenta de destino', 'el monto', 'la fecha'], true, false);
    expect(x).toMatch(/la cuenta de destino, el monto y la fecha/);
    expect(x).toMatch(/Ya lo pasé a recepción/);
  });
  it('NEGADO: nunca afirma un pago ni pide otro comprobante', () => {
    for (const s of [true, false, 'repetido']) expect(t(['el monto'], s, true)).not.toMatch(/acreditad|verificad|recibimos tu pago|env[ií]a(me)? otro|otro comprobante/i);
  });
  it('si el aviso no salió, no dice que ya avisó y da el camino directo; con «usted» no queda ningún «tu» ni «puedes»', () => {
    expect(t(['el monto'], false, false)).toMatch(/No pude avisar a recepción/);
    expect(t(['el monto', 'la fecha'], true, true)).not.toMatch(/\btu\b|\btus\b|puedes|escríbele/);
  });
  it('sin lista, sigue diciendo que hay diferencias (no inventa cuáles)', () => {
    expect(t([], true, false)).toMatch(/Veo diferencias con tu pedido\./);
  });
});
