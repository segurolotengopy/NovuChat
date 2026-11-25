// Clasifica la respuesta de Meta de cada demo con una lista CERRADA de resultados.
// Nada de lo que devuelve Meta (cuerpos, ids, nombres) pasa al texto de salida:
// solo los nombres fijos «Demo A» y «Demo B» y las palabras de esta lista.
//   ok                      200, status CONNECTED (el único valor que la documentación de Meta garantiza) Y el `id`
//                           de la respuesta es el del número que se consultó
//   id_no_coincide          200 y CONNECTED pero de OTRO número (un nodo que falla por dentro puede dejar pasar la
//                           respuesta del demo anterior: nunca un «ok» prestado)
//   estado_<VALOR>          200 y otro status (solo letras y guion bajo, hasta 30)
//   no_existe_o_sin_acceso  error 100 de Meta: el número no existe O el token no puede leerlo (Meta usa
//                           el mismo código para las dos cosas; el subcódigo 33 no las separa)
//   token / permiso         error 190 (token vencido o inválido) / error 10 o 200-299 (permiso)
//   transitorio             red, 5xx, 429 o errores temporales de Meta (códigos de la lista o `is_transient`):
//                           SIN veredicto, no se avisa
//   error_del_nodo          n8n no pudo armar la consulta (credencial borrada o sin asignar) o dejó pasar su entrada
//                           (ni respuesta ni error): falla
//   respuesta_sin_estado, error_de_meta
const cfg = $('Config base').first().json;
const DEMOS = [
  { nombre: 'Demo A', nodo: 'Consultar número Demo A', numero: cfg.phoneNumberIdA },
  { nombre: 'Demo B', nodo: 'Consultar número Demo B', numero: cfg.phoneNumberIdB },
];
const TEMPORALES = [1, 2, 4, 17, 32, 341, 613, 80007];

// Un error de n8n SIN respuesta de Meta: si habla de la credencial no se arregla solo (falla, con palabra fija);
// cualquier otro (red, tiempo, DNS) es temporal. El mensaje de n8n NUNCA se copia.
const DE_LA_CREDENCIAL = /credential|credencial|authenticat|unauthori[sz]ed|forbidden|not set|does not exist/i;

function clasificar(r, numero) {
  if (!r || typeof r !== 'object') return 'transitorio';
  if (typeof r.statusCode !== 'number') {
    // n8n entrega el error como TEXTO o como OBJETO (`message`, `description`); se lee de las dos formas y NUNCA se copia.
    const e = r.error;
    const m = typeof e === 'string' ? e : e && typeof e === 'object' ? String(e.message || '') + ' ' + String(e.description || '') : null;
    // Ni respuesta ni error: el nodo falló por dentro y n8n dejó pasar su entrada.
    if (m === null) return 'error_del_nodo';
    return DE_LA_CREDENCIAL.test(m) ? 'error_del_nodo' : 'transitorio';
  }
  const http = r.statusCode;
  const cuerpo = r.body && typeof r.body === 'object' ? r.body : {};
  if (http === 200) {
    if (typeof cuerpo.status !== 'string') return 'respuesta_sin_estado';
    if (cuerpo.status === 'CONNECTED') return typeof numero === 'string' && numero !== '' && String(cuerpo.id) === numero ? 'ok' : 'id_no_coincide';
    return /^[A-Z_]{2,30}$/.test(cuerpo.status) ? 'estado_' + cuerpo.status : 'estado_otro';
  }
  const e = cuerpo.error && typeof cuerpo.error === 'object' ? cuerpo.error : {};
  const c = e.code;
  if (c === 190) return 'token';
  if (c === 10 || (typeof c === 'number' && c >= 200 && c <= 299)) return 'permiso';
  if (http === 429 || http >= 500 || e.is_transient === true || TEMPORALES.includes(c)) return 'transitorio';
  if (c === 100) return 'no_existe_o_sin_acceso';
  if (http === 401 || http === 403) return 'token';
  return 'error_de_meta';
}

const leer = (nodo) => { try { return $(nodo).first().json; } catch (e) { return undefined; } };
const resultados = DEMOS.map((d) => ({ nombre: d.nombre, res: clasificar(leer(d.nodo), d.numero) }));
const fallas = resultados.filter((x) => x.res !== 'ok' && x.res !== 'transitorio');
const hayDuda = resultados.some((x) => x.res === 'transitorio');
// Sin veredicto (y sin falla): no se manda NADA y el silencio lo vigila el chequeo externo.
if (!fallas.length && hayDuda) return [];
return [{ json: {
  destino: fallas.length ? 'fail' : 'ok',
  cuerpo: resultados.map((x) => x.nombre + ': ' + x.res).join(' | '),
  urlPing: cfg.urlPing,
} }];
