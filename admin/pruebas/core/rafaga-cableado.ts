/**
 * EL CABLEADO MÍNIMO de la ráfaga sobre los JSON REALES, en memoria (no es una suite).
 *
 * La pieza común (`Flujos/src/core/rafaga/`) solo ENTREGA los textos agrupados en `textoDelTurno`; que el flujo los lea lo cablea el PR de cada flujo. Como #1117 no trae flujos, las pruebas parchean
 * aquí el nodo que decide el turno con el MISMO patrón que usan los PR de flujo (Walisuma, rama `claude/rafaga-walisuma`, `decidir-turno.js`):
 *
 *   const rafagaDelTurno = cnPrimero('Agrupar ráfaga') || {};
 *   const agrupado = typeof rafagaDelTurno.textoDelTurno === 'string' && rafagaDelTurno.textoDelTurno.trim() !== '' ? rafagaDelTurno.textoDelTurno : '';
 *   … cbLinea(agrupado !== '' ? agrupado : t.texto, 1500)
 *
 * Los PR de flujo ya traen su cableado; esto existe para que #1117 pruebe la pieza con un consumidor REAL del texto agrupado y no solo mire la salida de «Agrupar ráfaga».
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Flujo = any;

const LEE_EL_AGRUPADO = [
  "const rafagaDelTurno = cnPrimero('Agrupar ráfaga') || {};",
  "const agrupado = typeof rafagaDelTurno.textoDelTurno === 'string' && rafagaDelTurno.textoDelTurno.trim() !== '' ? rafagaDelTurno.textoDelTurno : '';",
].join('\n');

function parchar(flujo: Flujo, nodo: string, cambios: [string, string][]): Flujo {
  const n = flujo.nodes.find((x: { name: string }) => x.name === nodo);
  let codigo: string = n.parameters.jsCode;
  for (const [de, a] of cambios) {
    if (codigo.split(de).length !== 2) throw new Error(`el cableado de la prueba esperaba UNA aparición de «${de}» en «${nodo}»: el nodo cambió, hay que actualizar rafaga-cableado.ts`);
    codigo = codigo.replace(de, () => a);
  }
  n.parameters.jsCode = codigo;
  return flujo;
}

/** Walisuma: «Decidir turno» lee el texto agrupado en lugar de `t.texto` (la rama `conversacion`). Consumidor: «Decidir turno». */
export const cablearWalisuma = (flujo: Flujo): Flujo => parchar(flujo, 'Decidir turno', [
  ["let textoDelTurno = '';", `let textoDelTurno = '';\n${LEE_EL_AGRUPADO}`],
  ['cbLinea(t.texto, 1500)', "cbLinea(agrupado !== '' ? agrupado : t.texto, 1500)"],
]);

/** Bellido (agenda-minima.v0): «Decidir turno» parte del texto agrupado. Consumidor: «Decidir turno». */
export const cablearBellido = (flujo: Flujo): Flujo => parchar(flujo, 'Decidir turno', [
  ["let texto = String(t.texto || '');", `${LEE_EL_AGRUPADO}\nlet texto = String((agrupado !== '' ? agrupado : t.texto) || '');`],
]);
