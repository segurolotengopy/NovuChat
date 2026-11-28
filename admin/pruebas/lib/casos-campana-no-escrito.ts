/**
 * LA TABLA COMPARTIDA DEL «NO» ESCRITO A LA CAMPAÑA (PR-B, 27/11/2026, decisiones E3 y E8).
 *
 * Una sola lista de casos para las dos implementaciones de la misma regla: la del servidor (`esNoEscritoDeCampana`,
 * `core/conversacion/bajas.ts`) y la del chat (`cnNoEscritoDeCampana`, `_comun.js`). Cada suite la recorre con su función; si
 * una cambia y la otra no, la tabla lo delata.
 *
 * La regla: tras NFD sin tildes y minúsculas, la coma pasa a espacio, los «.» y «!» del final se quitan y los espacios se
 * colapsan; el texto tiene que ser EXACTAMENTE `no` o `no gracias`. Todo lo demás es conversación.
 */
export const NO_ESCRITO_SI: readonly string[] = [
  'no', 'No', 'NO', ' no ', '\tNo\n', 'no.', 'No.', 'No!', 'no!!', 'No...', 'no . !',
  'no gracias', 'No gracias', 'NO GRACIAS', 'No, gracias', 'no,gracias', 'No,  gracias', 'No gracias.', 'No gracias!', 'No, gracias!',
  'nó', 'No  gracias', '  No,   gracias  ',
];

export const NO_ESCRITO_NO: readonly string[] = [
  '', ' ', 'nop', 'nope', 'no sé', 'no se', 'no me interesa', 'no gracias, no me interesa', 'no, gracias, después', 'no gracias no',
  'no no', 'no?', 'no ¿?', 'nooo', 'si', 'sí', 'No, quiero más información', 'gracias', 'no gracias!!!hola', '¡no!', 'no\ngracias hola',
  'no-gracias', 'no y gracias', 'stop',
];
