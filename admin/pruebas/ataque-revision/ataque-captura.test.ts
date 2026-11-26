/**
 * ATAQUE INDEPENDIENTE de la revisora al PR #1098 (Casa Bermejo, captura por estado), séptima ronda, sha 13546e53.
 * Reconstrucción de los 73 casos originales a partir del informe del 25/11 (el archivo original se perdió), completada con variantes de las mismas familias, más los 17 casos del sondeo de la cuarta revisión.
 * Cada caso corre con tres modelos simulados:
 *   sano     devuelve la extracción que haría un modelo bien portado (o nada si el mensaje no es un dato);
 *   adverso  deriva (quiereHablar: true), lineas: [] y entrega: {};
 *   dato     toma la consulta o la frase COMO DATO: devuelve el texto entero del cliente en TODOS los campos de entrega;
 *   datoNombre  (solo para comparar con la ronda anterior) devuelve el texto entero solo como nombre.
 * Verificación (todas las corridas): nunca un QR; un campo de la entrega que cambia tiene que cambiar AL valor esperado (si el caso no espera ese campo, no puede cambiar);
 * con el modelo sano, además, los campos esperados quedan como se espera; los campos «codigo» (los que el código lee solo) se exigen con los tres modelos.
 */
// (sin escritura de archivos: el resultado se ve en el informe de la corrida, no en el árbol)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANA, ARGENTINO, BILLETERA, CATALOGO, catalogoOk, crear, hablar, modelo, mTexto, mToque, textoAlModelo } from "../tenants/casa-bermejo/mundo";

type Obj = Record<string, unknown>;
type ModeloK = "sano" | "adverso" | "dato" | "datoNombre";
type Estado = "VACIO" | "S0" | "SR" | "SRC" | "SE" | "SE2" | "SE3" | "SAR";
interface Paso { texto?: string; toque?: [string, string]; sano?: Obj }
interface Esperado {
  entrega?: Record<string, string>;
  codigo?: string[];
  tienda?: "ub" | "hor" | "noub" | "nohor";
  soloTienda?: boolean;
  confirma?: boolean;
  deriva?: boolean;
  ids?: string[];
  permiteVacio?: string[];
}
interface Caso { n: string; familia: string; msg: string; estado: Estado; sano?: Obj; lineasSano?: Obj[]; pasos?: Paso[]; exp: Esperado }

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR = "Calle Sucre 12";
const HOR = "lunes a sábado de 9 a 19";
const TIENDA = { ubicacionTienda: DIR, horarioTienda: HOR };
const RET = "Retiro en tienda";
const ENV = "Envío";
const LLAVERO = [{ id: "llavero-llama", cantidad: 1 }];
const CAMPOS = ["modo", "ciudad", "direccion", "nombre", "documento", "cp", "provincia", "flota"];
const SETUP: Record<string, Obj> = { "Ana Pérez": { nombre: "Ana Pérez" }, "CI 4412345": { documento: "4412345" }, Cochabamba: { ciudad: "Cochabamba" }, "flota Bolivar": { flota: "Bolivar" } };

// ------------------------------------------------------------------------------------------------ los casos
const C = (n: string, familia: string, estado: Estado, msg: string, exp: Esperado, sano?: Obj, extra: Partial<Caso> = {}): Caso => ({ n, familia, estado, msg, exp, sano, ...extra });
const NADA: Esperado = { entrega: {}, confirma: false };
const CASOS: Caso[] = [
  // A. Nombres que son palabras comunes (retiro elegido, el código pide el nombre)
  C("1", "A nombre común", "SR", "Rosa", { entrega: { nombre: "Rosa" }, confirma: true }, { nombre: "Rosa" }),
  C("2", "A nombre común", "SR", "Paz", { entrega: { nombre: "Paz" }, confirma: true }, { nombre: "Paz" }),
  C("3", "A nombre común", "SR", "Luz", { entrega: { nombre: "Luz" }, confirma: true }, { nombre: "Luz" }),
  C("4", "A nombre común", "SR", "Mercedes", { entrega: { nombre: "Mercedes" }, confirma: true }, { nombre: "Mercedes" }),
  C("5", "A mayúsculas", "SR", "ROSA MAMANI", { entrega: { nombre: "ROSA MAMANI" }, confirma: true }, { nombre: "ROSA MAMANI" }),
  C("6", "A emoji", "SR", "Ana Pérez 😊", { entrega: { nombre: "Ana Pérez" }, confirma: true }, { nombre: "Ana Pérez" }),
  C("7", "A con entrada", "SR", "soy Luz Quispe", { entrega: { nombre: "Luz Quispe" }, confirma: true }, { nombre: "Luz Quispe" }),
  C("8", "A con entrada", "SR", "a nombre de Paz Flores", { entrega: { nombre: "Paz Flores" }, confirma: true }, { nombre: "Paz Flores" }),
  C("9", "A con saludo", "SR", "Hola, soy Rosa", { entrega: { nombre: "Rosa" }, confirma: true }, { nombre: "Rosa" }),
  C("10", "A con entrada", "SR", "Mi nombre es Cruz", { entrega: { nombre: "Cruz" }, confirma: true }, { nombre: "Cruz" }),
  C("11", "A tilde", "SR", "Ángel", { entrega: { nombre: "Ángel" }, confirma: true }, { nombre: "Ángel" }),
  C("12", "A minúsculas", "SR", "dolores choque", { entrega: { nombre: "dolores choque" }, confirma: true }, { nombre: "dolores choque" }),
  // B. Cortesías, intenciones, catálogo y consultas como nombre (retiro, nombre pedido)
  ...["Bien", "Chau", "Muchas gracias", "Ok dale", "Transferencia", "Vendedor", "Espera", "Humano", "Efectivo", "Billeteras", "Cuero", "Otro color", "soy de La Paz", "Juan puede recoger", "tenés envío a Córdoba", "Aceptan tarjeta", "Tienen stock"]
    .map((x, i) => C(String(13 + i), "B no es nombre", "SR", x, NADA)),
  C("30", "B consulta con cifra", "SR", "Necesito el horario, 77712345", { entrega: {}, confirma: false, tienda: "hor" }),
  C("31", "B horario suelto", "SR", "Horario", { entrega: {}, confirma: false, tienda: "hor", soloTienda: true }),
  C("32", "B horario suelto", "SR", "Y el horario", { entrega: {}, confirma: false, tienda: "hor", soloTienda: true }),
  // B2. Retiro COMPLETO (Ana Pérez): nada pisa el nombre sin «Corregir datos»
  C("33", "B2 no pisar", "SRC", "Muchas gracias", { entrega: {} }, {}),
  C("34", "B2 no pisar", "SRC", "Listo", { entrega: {} }, {}),
  C("35", "B2 no pisar", "SRC", "Perfecto, gracias", { entrega: {} }, {}),
  C("36", "B2 no pisar", "SRC", "Rosa", { entrega: {} }, { nombre: "Rosa" }),
  C("37", "B2 no pisar", "SRC", "me equivoqué, es Ana Pérez Mamani", { entrega: {} }, { nombre: "Ana Pérez Mamani" }),
  // C. Consultas con forma de dato (envío)
  C("38", "C consulta como dato", "SE", "Otro color", NADA),
  C("39", "C consulta como dato", "SE", "Muchas gracias", NADA),
  C("40", "C consulta como dato", "SE", "Quiero 2, cuánto sale con envío a Oruro", NADA),
  C("41", "C celular no es CI", "SE", "70012345", NADA),
  C("42", "C catálogo como dato", "SE", "Cuero", NADA),
  C("43", "C consulta como dato", "SE2", "Muchas gracias", NADA),
  C("44", "C consulta como dato", "SE2", "Efectivo", NADA),
  C("45", "C consulta como dato", "SE2", "Bien", NADA),
  C("46", "C consulta no cambia modo", "SE", "la dirección de la tienda, 5566778", NADA),
  C("47", "C consulta no cambia modo", "SR", "hola tienen envío a Potosí 71234567", NADA),
  // D. Datos con forma de consulta
  C("48", "D dirección AR", "SAR", "La dirección de envío es Av Corrientes 1234", { entrega: { direccion: "Av Corrientes 1234" } }, { direccion: "Av Corrientes 1234" }),
  C("49", "D dirección AR", "SAR", "Dirección Av Corrientes 1234", { entrega: { direccion: "Av Corrientes 1234" } }, { direccion: "Av Corrientes 1234" }),
  C("50", "D dirección AR", "SAR", "mi dirección es Calle Florida 500", { entrega: { direccion: "Calle Florida 500" } }, { direccion: "Calle Florida 500" }),
  C("51", "D dirección AR", "SAR", "vivo en Av Corrientes 1234", { entrega: { direccion: "Av Corrientes 1234" } }, { direccion: "Av Corrientes 1234" }),
  C("52", "D datos con cola ¿está bien?", "SE", "Juan Pérez, CI 4412345, Cochabamba ¿está bien?", { entrega: { nombre: "Juan Pérez", documento: "4412345", ciudad: "Cochabamba" }, codigo: ["documento"] }, { nombre: "Juan Pérez", documento: "4412345", ciudad: "Cochabamba" }),
  C("53", "D «donde» dentro de dato", "SE2", "flota Bolívar, donde sale a Tarija", { entrega: { flota: "Bolívar", ciudad: "Tarija" }, codigo: ["flota"] }, { flota: "Bolívar", ciudad: "Tarija" }),
  C("54", "D CP AR", "SAR", "CP 1043", { entrega: { cp: "1043" } }, { cp: "1043" }),
  C("55", "D provincia AR", "SAR", "Provincia Buenos Aires", { entrega: { provincia: "Buenos Aires" } }, { provincia: "Buenos Aires" }),
  // E. CI frente a número de pedido (envío, CI pedido)
  C("56", "E no es CI", "SE", "mi número de pedido es 123456", NADA),
  C("57", "E no es CI", "SE", "pedido 4412345", NADA),
  C("58", "E no es CI", "SE", "el código es 99887766", NADA),
  C("59", "E no es CI", "SE", "referencia 5566778", NADA),
  C("60", "E no es CI", "SE", "nro de operación 12345678", NADA),
  C("61", "E CI rotulado", "SE", "CI 4412345", { entrega: { documento: "4412345" }, codigo: ["documento"] }, { documento: "4412345" }),
  C("62", "E CI suelto pedido", "SE", "4412345", { entrega: { documento: "4412345" }, codigo: ["documento"] }, { documento: "4412345" }),
  C("63", "E CI con puntos", "SE", "mi carnet es 4.412.345", { entrega: { documento: "4412345" }, codigo: ["documento"] }, { documento: "4412345" }),
  // G. Cambio de modo
  C("64", "G cambio de modo", "SRC", "no, mejor envío", { entrega: { modo: ENV }, codigo: ["modo"] }),
  C("65", "G envío con destino (R27)", "S0", "envíenlo a Cochabamba", { entrega: { modo: ENV, ciudad: "Cochabamba" }, codigo: ["modo", "ciudad"] }, { ciudad: "Cochabamba" }),
  C("66", "G envío con destino (R27)", "S0", "quiero que me lo envíen a Sucre", { entrega: { modo: ENV, ciudad: "Sucre" }, codigo: ["modo", "ciudad"] }, { ciudad: "Sucre" }),
  C("67", "G envío con destino (R27)", "S0", "mejor envíenlo a Cochabamba", { entrega: { modo: ENV, ciudad: "Cochabamba" }, codigo: ["modo", "ciudad"] }, { ciudad: "Cochabamba" }),
  C("68", "G cambio de modo", "SE", "mejor recojo en tienda", { entrega: { modo: RET }, codigo: ["modo"] }),
  C("69", "G frase de modo", "S0", "recojo en tienda", { entrega: { modo: RET }, codigo: ["modo"] }),
  C("70", "G frase de modo", "S0", "Retiro", { entrega: { modo: RET }, codigo: ["modo"] }),
  C("71", "G consulta no es modo", "S0", "la tienda queda lejos?", { entrega: {} }),
  C("72", "G frase de modo", "S0", "envío", { entrega: { modo: ENV }, codigo: ["modo"] }),
  C("73", "G id escrito a mano", "S0", "entrega:retiro", { entrega: {} }),
  C("74", "G título escrito a mano", "S0", "Recojo en tienda", { entrega: { modo: RET }, codigo: ["modo"] }),
  C("75", "G id escrito a mano", "SRC", "pedido:corregir", { entrega: {} }),
  C("76", "G mayúsculas", "S0", "ENVÍO POR FAVOR", { entrega: { modo: ENV }, codigo: ["modo"] }),
  // H. Corrección de datos
  C("77", "H corregir", "SRC", "Rosa Flores", { entrega: { nombre: "Rosa Flores" }, confirma: true, permiteVacio: ["nombre"] }, { nombre: "Rosa Flores" }, { pasos: [{ toque: ["pedido:corregir", "Corregir datos"] }] }),
  C("78", "H corregir y cambiar modo", "SRC", "no, mejor envío", { entrega: { modo: ENV, nombre: "" }, codigo: ["modo"] }, {}, { pasos: [{ toque: ["pedido:corregir", "Corregir datos"] }] }),
  C("79", "H CI rotulado corrige", "SE3", "el CI es 5566778", { entrega: { documento: "5566778" }, codigo: ["documento"] }, { documento: "5566778" }),
  C("80", "H ciudad rotulada corrige", "SE3", "ciudad Tarija", { entrega: { ciudad: "Tarija" }, codigo: ["ciudad"] }, { ciudad: "Tarija" }),
  C("81", "H no pisar envío", "SE3", "Muchas gracias", { entrega: {} }, {}),
  // I. Ubicación + compra
  C("82", "I ubicación + compra", "VACIO", "quiero un llavero de llama y ¿dónde queda la tienda?", { entrega: {}, tienda: "ub", ids: ["llavero-llama"] }, {}, { lineasSano: LLAVERO }),
  C("83", "I ubicación + compra", "VACIO", "¿dónde están ubicados? quiero comprar una billetera", { entrega: {}, tienda: "ub", ids: ["billetera-cuero"] }, {}, { lineasSano: BILLETERA }),
  C("84", "I ubicación + compra (coma)", "VACIO", "pásenme la ubicación, quiero comprar una billetera", { entrega: {}, tienda: "ub", ids: ["billetera-cuero"] }, {}, { lineasSano: BILLETERA }),
  C("85", "I falso positivo", "S0", "¿y la billetera dónde está?", { entrega: {}, tienda: "noub" }),
  C("86", "I falso positivo", "S0", "la billetera negra dónde está", { entrega: {}, tienda: "noub" }),
  C("87", "I ubicación sola", "VACIO", "¿Dónde están ubicados?", { entrega: {}, tienda: "ub", soloTienda: true }),
  C("88", "I ubicación sola", "VACIO", "dónde quedan en La Paz", { entrega: {}, tienda: "ub", soloTienda: true }),
  C("89", "I ubicación en captura", "SR", "¿dónde queda la tienda?", { entrega: {}, tienda: "ub", soloTienda: true }),
  // J. Horario por código
  C("90", "J horario", "VACIO", "¿atienden los sábados?", { entrega: {}, tienda: "hor", soloTienda: true }),
  C("91", "J horario", "VACIO", "¿Atienden hoy?", { entrega: {}, tienda: "hor", soloTienda: true }),
  C("92", "J horario", "VACIO", "a q hora abren", { entrega: {}, tienda: "hor", soloTienda: true }),
  C("93", "J horario", "VACIO", "q horario tienen", { entrega: {}, tienda: "hor", soloTienda: true }),
  C("94", "J horario", "VACIO", "¿a qué hora cierran?", { entrega: {}, tienda: "hor", soloTienda: true }),
  C("95", "J no es horario", "S0", "¿a qué hora llega mi pedido?", { entrega: {}, tienda: "nohor" }),
  C("96", "J no es horario", "VACIO", "¿atienden pedidos por WhatsApp?", { entrega: {}, tienda: "nohor" }),
  C("97", "J horario interrumpe captura", "SR", "Rosa", { entrega: { nombre: "Rosa" }, confirma: true }, { nombre: "Rosa" }, { pasos: [{ texto: "¿a qué hora abren?" }] }),
  // K. Falsos positivos de ubicación
  C("98", "K mapa de tallas", "VACIO", "pásame el mapa de tallas", { entrega: {}, tienda: "noub" }),
  C("99", "K mapa de tallas", "VACIO", "tienen mapa de tallas?", { entrega: {}, tienda: "noub" }),
  C("100", "K mapa", "VACIO", "quiero un mapa", { entrega: {}, tienda: "noub" }),
  C("101", "K dirección propia", "S0", "mándame la billetera a mi dirección", { entrega: {}, tienda: "noub" }),
  // L. Factura deriva
  C("102", "L factura", "SR", "necesito factura", { entrega: {}, deriva: true, confirma: false }),
  C("103", "L factura", "SR", "con factura a nombre de Juan Pérez", { entrega: {}, deriva: true, confirma: false }),
  // M. Variantes extra (flota y ciudad que propone el modelo; nombre en envío)
  C("104", "M flota del modelo", "SE2", "Gracias por todo", NADA),
  C("105", "M flota del modelo", "SE2", "Ok perfecto", NADA),
  C("106", "M nombre completo en envío", "SE", "Ana Pérez", { entrega: { nombre: "Ana Pérez" } }, { nombre: "Ana Pérez" }),
  C("107", "M ciudad suelta", "SE2", "Cochabamba", { entrega: { ciudad: "Cochabamba" } }, { ciudad: "Cochabamba" }),
  C("108", "M ciudad suelta con flota ya dada", "SE2", "Muchas gracias", { entrega: { flota: "Bolivar" }, confirma: false }, {}, { pasos: [{ texto: "flota Bolivar", sano: { flota: "Bolivar" } }] }),
  C("109", "M ciudad suelta", "SE2", "Perfecto", NADA),
  C("110", "M ciudad suelta", "SE2", "Gracias", NADA),
  C("111", "M ciudad suelta", "SE2", "Billetera", NADA),
  C("112", "M ciudad suelta", "SE2", "Vendedor", NADA),
];

const SONDEO: Caso[] = [
  ...["Aceptan tarjeta", "Tienen stock", "Otro color", "Humano", "Efectivo", "Billeteras", "Cuero", "70012345", "Quiero 2, cuánto sale con envío a Oruro"].map((x, i) => C("S" + (i + 1), "sondeo", "SR", x, NADA)),
  C("S10", "sondeo", "SR", "Cuál es su dirección, 4412345", { entrega: {}, confirma: false, tienda: "ub" }),
  C("S11", "sondeo", "SR", "Hola, tienen envío a Tarija 70012345", NADA),
  C("S12", "sondeo", "SE", "La dirección de la tienda, 4412345", NADA),
  C("S13", "sondeo", "SR", "Necesito el horario, 77712345", NADA),
  C("S14a", "sondeo", "SR", "Horario", NADA),
  C("S14b", "sondeo", "SR", "Y el horario", NADA),
  C("S15a", "sondeo", "S0", "Ana Pérez, recojo en tienda", { entrega: { modo: RET, nombre: "Ana Pérez" }, codigo: ["modo"] }, { nombre: "Ana Pérez" }),
  C("S15b", "sondeo", "S0", "Ana", { entrega: { modo: RET, nombre: "Ana" }, codigo: ["modo"] }, { nombre: "Ana" }, { pasos: [{ texto: "recojo en tienda" }] }),
  C("S16", "sondeo", "S0", "Ana Pérez, 4412345, envío a Cochabamba, flota Bolivar", { entrega: { modo: ENV, nombre: "Ana Pérez", documento: "4412345", ciudad: "Cochabamba", flota: "Bolivar" }, codigo: ["modo", "documento", "flota"] }, { nombre: "Ana Pérez", documento: "4412345", ciudad: "Cochabamba", flota: "Bolivar" }),
  C("S17", "sondeo", "SE", "flota Bolivar", { entrega: { nombre: "Ana Pérez", documento: "4412345", ciudad: "Cochabamba", flota: "Bolivar" }, codigo: ["flota"] }, { flota: "Bolivar" },
    { pasos: [{ texto: "Ana Pérez", sano: { nombre: "Ana Pérez" } }, { texto: "4412345", sano: { documento: "4412345" } }, { texto: "Cochabamba", sano: { ciudad: "Cochabamba" } }] }),
];

// ------------------------------------------------------------------------------------------------ el arnés
interface Ctx { fase: "setup" | "caso"; modelo: ModeloK; lineas: Obj[]; sano: Obj; lineasSano?: Obj[]; llamadas: number }
function hacerModelo(ctx: Ctx) {
  return (ll: Parameters<typeof textoAlModelo>[0]): Obj => {
    const t = textoAlModelo(ll);
    if (ctx.fase === "caso") ctx.llamadas++;
    if (ctx.fase === "setup") return modelo("Con gusto, lo anoto.", { lineas: BILLETERA, entrega: SETUP[t] ?? {} }) as Obj;
    if (ctx.modelo === "adverso") return modelo("Una persona del equipo se encargará.", { lineas: [], entrega: {}, quiereHablar: true }) as Obj;
    const lineas = ctx.lineasSano ?? ctx.lineas;
    if (ctx.modelo === "datoNombre") return modelo("Listo.", { lineas, entrega: { nombre: t } }) as Obj;
    if (ctx.modelo === "dato") return modelo("Listo.", { lineas, entrega: Object.fromEntries(CAMPOS.map((k) => [k, t])) }) as Obj;
    return modelo("Listo.", { lineas, entrega: ctx.sano }) as Obj;
  };
}
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
const fichaDe = (m: Mund, tel: string): Obj => (((m.sd["casabermejo"] ?? {}) as Record<string, Obj>)[tel] ?? {});
const entregaDe = (m: Mund, tel: string): Record<string, string> => { const e = (fichaDe(m, tel)["entrega"] ?? {}) as Record<string, string>; return Object.fromEntries(CAMPOS.map((k) => [k, String(e[k] ?? "")])); };
const J = (x: unknown): string => JSON.stringify(x);
const idsBotones = (t: Turno): string[] => t.mensajes.flatMap((x) => (((x.payload as Obj)["interactive"] as { action?: { buttons?: { reply: { id: string } }[] } } | undefined)?.action?.buttons ?? []).map((b) => b.reply.id));
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === "image");
const cuerpo = (t: Turno): string => t.mensajes.map((x) => `${x.cuerpo ?? ""} ${J(x.payload)}`).join(" ");
const plan = (t: Turno): string => String(((t.porNodo["Armar mensajes"]?.[0] ?? {}) as { plan?: string }).plan ?? "");

function preparar(estado: Estado, ctx: Ctx): { m: Mund; tel: string } {
  const ar = estado === "SAR";
  const tel = ar ? ARGENTINO : ANA;
  const itemAr = { ...CATALOGO[1], moneda: "ARS", precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
  const m = crear({ modeloDice: hacerModelo(ctx) as never, base: TIENDA, ...(ar ? { catalogo: catalogoOk({ mercado: "AR", moneda: "ARS" }, [itemAr] as never) } : {}) });
  ctx.fase = "setup";
  if (estado === "VACIO") return { m, tel };
  hablar(m, tel, mTexto("quiero una billetera"));
  if (estado === "SR" || estado === "SRC") hablar(m, tel, mToque("entrega:retiro", "Recojo en tienda"));
  if (estado === "SE" || estado === "SE2" || estado === "SE3" || estado === "SAR") hablar(m, tel, mToque("entrega:envio", "Envío"));
  if (estado === "SRC" || estado === "SE2" || estado === "SE3") hablar(m, tel, mTexto("Ana Pérez"));
  if (estado === "SE2" || estado === "SE3") hablar(m, tel, mTexto("CI 4412345"));
  if (estado === "SE3") { hablar(m, tel, mTexto("Cochabamba")); hablar(m, tel, mTexto("flota Bolivar")); }
  return { m, tel };
}

interface Resultado { n: string; familia: string; msg: string; estado: Estado; modelo: ModeloK; esperado: string; obtenido: string; pasa: boolean; problemas: string[]; antes: Record<string, string> }
const RESULTADOS: Resultado[] = [];

function correr(c: Caso, mk: ModeloK): Resultado {
  const ctx: Ctx = { fase: "setup", modelo: mk, lineas: [], sano: {}, llamadas: 0 };
  const { m, tel } = preparar(c.estado, ctx);
  const antes = entregaDe(m, tel);
  const carritoAntes = ((fichaDe(m, tel)["carrito"] ?? []) as unknown[]).length;
  const setupOk = c.estado === "VACIO" || carritoAntes > 0;
  ctx.fase = "caso";
  ctx.lineas = c.estado === "VACIO" ? [] : BILLETERA;
  for (const p of c.pasos ?? []) {
    ctx.sano = p.sano ?? {};
    ctx.lineasSano = undefined;
    if (p.toque) hablar(m, tel, mToque(p.toque[0], p.toque[1]));
    else hablar(m, tel, mTexto(p.texto ?? ""));
  }
  ctx.sano = c.sano ?? {};
  ctx.lineasSano = c.lineasSano;
  ctx.llamadas = 0;
  const t = hablar(m, tel, mTexto(c.msg), { toleraFallo: true });
  const despues = entregaDe(m, tel);
  const exp = c.exp;
  const pr: string[] = [];
  if (!setupOk) pr.push("preparación: el carrito quedó vacío");
  if (t.fallo) pr.push("fallo del flujo: " + t.fallo.mensaje);
  if (hayQr(t)) pr.push("salió un QR");
  const e = exp.entrega ?? {};
  for (const k of CAMPOS) {
    const cambio = despues[k] !== antes[k];
    if (mk === "sano") {
      const quiero = k in e ? e[k] : antes[k];
      if (despues[k] !== quiero) pr.push(`${k}: quedó «${despues[k]}», se esperaba «${quiero}»`);
    } else if (cambio && !(k in e && despues[k] === e[k]) && !(exp.permiteVacio?.includes(k) && despues[k] === "")) pr.push(`${k}: cambió a «${despues[k]}» (antes «${antes[k]}»), no esperado`);
  }
  for (const k of exp.codigo ?? []) if (mk !== "sano" && despues[k] !== e[k]) pr.push(`${k} (lo lee el código): quedó «${despues[k]}», se esperaba «${e[k]}»`);
  const conf = idsBotones(t).some((i) => i.startsWith("pedido:confirmar:"));
  if (mk === "sano" && exp.confirma !== undefined && conf !== exp.confirma) pr.push(`«Confirmar pedido»: ${conf ? "salió" : "no salió"}`);
  if (mk !== "sano" && conf && exp.confirma === false) pr.push("salió «Confirmar pedido»");
  const b = cuerpo(t);
  if (exp.tienda === "ub" && !b.includes(DIR)) pr.push("no respondió la dirección de la tienda");
  if (exp.tienda === "hor" && !b.includes(HOR)) pr.push("no respondió el horario");
  if (exp.tienda === "noub" && b.includes(DIR)) pr.push("respondió la dirección de la tienda (falso positivo)");
  if (exp.tienda === "nohor" && b.includes(HOR)) pr.push("respondió el horario (falso positivo)");
  if (exp.soloTienda && ctx.llamadas > 0) pr.push("llamó al modelo (debía contestar el código)");
  if (exp.deriva && plan(t) !== "derivar") pr.push(`no derivó (plan ${plan(t)})`);
  if (exp.ids && mk === "sano") { const ids = ((fichaDe(m, tel)["carrito"] ?? []) as { id: string }[]).map((x) => x.id); for (const id of exp.ids) if (!ids.includes(id)) pr.push(`la pieza ${id} no entró al pedido`); }
  if (carritoAntes > 0 && ((fichaDe(m, tel)["carrito"] ?? []) as unknown[]).length === 0) pr.push("se perdió el carrito");
  const resumenEsp = [Object.keys(e).length ? "entrega " + J(e) : "entrega sin cambios", exp.tienda ? "tienda " + exp.tienda : "", exp.confirma !== undefined && mk === "sano" ? (exp.confirma ? "con Confirmar" : "sin Confirmar") : "", exp.deriva ? "deriva" : ""].filter((x) => x !== "").join("; ");
  const cambios = CAMPOS.filter((k) => despues[k] !== antes[k]).map((k) => `${k}=«${despues[k]}»`);
  const obtenido = [cambios.length ? cambios.join(", ") : "sin cambios", `plan ${plan(t)}`, conf ? "Confirmar" : "", b.includes(DIR) ? "dir. tienda" : "", b.includes(HOR) ? "horario" : "", `modelo×${ctx.llamadas}`].filter((x) => x !== "").join("; ");
  const r = { n: c.n, familia: c.familia, msg: c.msg, estado: c.estado, modelo: mk, esperado: resumenEsp, obtenido, pasa: pr.length === 0, problemas: pr, antes };
  RESULTADOS.push(r);
  return r;
}

const MODELOS: ModeloK[] = ["sano", "adverso", "dato", "datoNombre"];
describe("ataque de la revisora: casos propios", () => {
  for (const c of CASOS) for (const mk of MODELOS) it(`${c.n} [${c.estado}] «${c.msg}» — ${mk}`, () => { const r = correr(c, mk); expect(r.problemas).toEqual([]); });
});
describe("ataque de la revisora: los 17 casos del sondeo de la cuarta revisión", () => {
  for (const c of SONDEO) for (const mk of MODELOS) it(`${c.n} [${c.estado}] «${c.msg}» — ${mk}`, () => { const r = correr(c, mk); expect(r.problemas).toEqual([]); });
});
// sin afterAll que escriba resultados.json: una prueba no escribe en el árbol (ni en CI)
