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
  // Seguimiento del #615 (L1): teléfonos con separadores que no son espacio, punto ni guion.
  ['coma', '77,777,777'], ['paréntesis', '77(777)777'], ['ampersand', '77&777&777'],
  ['dobles espacios', '7  7  7  7  7  7'], ['coma y espacio', '777, 777, 77'],
  // L2: humana/IA y formas de decir «soy una persona».
  ['humana', 'soy humana'], ['carne y hueso', 'de carne y hueso'], ['asesora real', 'asesora real'],
  ['I A', 'I A'], ['inteligencia artificial', 'inteligencia artificial'],
  // L3 (opción A de Andres): instituciones y marcas.
  ['BCB', 'BCB'], ['BISA', 'BISA'], ['BMSC', 'BMSC'], ['Prodem', 'Prodem'], ['Ecofuturo', 'Ecofuturo'],
  ['QR', 'QR'], ['Cobranzas', 'Cobranzas'], ['Yape', 'Yape'], ['yape', 'yape'], ['WhatsApp', 'WhatsApp'], ['Meta', 'Meta'],
  ['Soporte', 'Soporte'],
  // RECHAZOS INTENCIONALES (opción A de Andres; costo de la prohibición 4): la lista es por palabra y no distingue
  // el cargo del nombre. Si un comercio se llama así, usa «nuestro equipo» o su nombre de pila.
  ['Soporte Técnico Ruiz', 'Soporte Técnico Ruiz'], ['Farmacia Real', 'Farmacia Real'],
  ['Recursos Humanos', 'Recursos Humanos'], ['Clínica Meta', 'Clínica Meta'],
  ['correo', 'ruben' + '@' + 'malo.bo'], ['enlace', 'https://malo.example'], ['dominio', 'malo.com'], ['www', 'www.malo.bo'],
];
// Solo el servidor y la consola pueden verlos (normalizan; la regla no).
export const ARNES_SOLO_NORMALIZADO: [string, string][] = [
  ['B A N C O', 'B A N C O'], ['b.a.n.c.o', 'b.a.n.c.o'], ['b4nco', 'b4nco'],
  ['p a g o', 'p a g o'], ['dep0sito', 'dep0sito'],
];

// Decisión de Andres (opción A): «Caja» y «Fortaleza» quedan FUERA de la lista prohibida y siguen pasando,
// igual que los nombres con tildes, `&` y puntos de la lista de permitidos.
export const NOMBRES_QUE_PASAN: string[] = [
  'Caja', 'Fortaleza', 'Maya Pérez', 'Celaya Pedraza', 'Luiso Porte', 'Rubén Núñez', 'María José (recepción)', 'Clínica Sofía & Equipo', 'Dr. Pérez', 'Turno 123', 'nuestro equipo',
];

// Lo que NO se detecta a propósito: las formas compactas de `yape` y `soporte` se quitaron porque rechazaban
// nombres de pila comunes («Maya Pérez», «Celaya Pedraza», «Luiso Porte»). Quedan solo por palabra completa
// (regla, servidor y consola), así que «Y A P E» y «S o p o r t e» pasan.
export const PASAN_POR_DISENO: string[] = ['Y A P E', 'S o p o r t e'];
