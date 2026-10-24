/** Casos negados de «nombre de quien atiende» (arnés del revisor de seguridad, #615). Sin valores reales. */
// Casos del arnés del revisor de seguridad (#615) que la REGLA también puede ver.
export const ARNES_REGLA: [string, string][] = [
  ['guion suave', 'Ban\u00ADco'], ['tags U+E0000', 'Rub\u{E0041}én'], ['selector FE0F', 'Rubén\uFE0F'],
  ['U+034F', 'Rub\u034Fén'], ['U+180E', 'Rub\u180Eén'], ['U+3164', 'Rub\u3164én'],
  ['U+061C', 'Rub\u061Cén'], ['cirílico', 'Рубен'], ['griego', 'Βanco'], ['ancho completo', 'Ｒｕｂéｎ'],
  ['emoji', 'Rubén 😀'],
  ['BancoSol', 'BancoSol'], ['BNB', 'BNB'], ['Mercantil', 'Mercantil'], ['Tigo Money', 'Tigo Money'],
  ['ASFI', 'ASFI'], ['Impuestos Nacionales', 'Impuestos Nacionales'], ['policía', 'policía'],
  ['sistema', 'el sistema'], ['tu jefe', 'tu jefe'], ['ya pagó', 'ya pagó'],
  ['depósito confirmado', 'depósito confirmado'], ['transferencia aprobada', 'transferencia aprobada'],
  ['soy una persona', 'soy una persona'], ['persona de verdad', 'persona de verdad'], ['I.A.', 'I.A.'],
  ['teléfono con espacios', '77 777 777'], ['teléfono con guiones', '77-777-777'], ['teléfono mixto', '77777 777'],
  ['pago acreditado', 'pago acreditado'], ['el banco', 'el banco'], ['no soy un bot', 'no soy un bot'],
  ['humano', 'soy humano'], ['acreditadamente', 'acreditadamente'], ['verificadores', 'verificadores'],
  ['correo', 'ruben' + '@' + 'malo.bo'], ['enlace', 'https://malo.example'], ['dominio', 'malo.com'], ['www', 'www.malo.bo'],
];
// Solo el servidor y la consola pueden verlos (normalizan; la regla no).
export const ARNES_SOLO_NORMALIZADO: [string, string][] = [
  ['B A N C O', 'B A N C O'], ['b.a.n.c.o', 'b.a.n.c.o'], ['b4nco', 'b4nco'],
  ['p a g o', 'p a g o'], ['dep0sito', 'dep0sito'],
];
