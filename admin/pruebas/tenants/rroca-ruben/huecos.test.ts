/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-2, LOS HUECOS DEL COBRO Y DE LOS AVISOS, comparados con su ORIGEN.
 *
 * El módulo común de Cobros y el de Avisos todavía no existen: `src/lib/cobro.js` y `src/lib/avisos.js` son COPIAS declaradas (PROPIO.md) de `venta-minima/src/lib/cobro.js` y `avisos.js`
 * (rama #519, `cartera/qtaco-visor-comprobantes`). Cada declaración (función o constante) se compara BYTE A BYTE con su origen de tres maneras:
 *   1. contra el HASH fijado (sha-256 de la declaración tal como estaba en el origen el 18/10/2026): no depende de ninguna rama;
 *   2. contra el archivo de `venta-minima` del árbol de trabajo, si ya trae lo de #519 (antes de la fusión tiene la versión vieja y no sirve de origen);
 *   3. contra la rama `origin/cartera/qtaco-visor-comprobantes`, si el repositorio la tiene (si #519 se fusionó o la rama se borró, el 2 y el 1 la cubren).
 * Si el origen cambia, la prueba falla y obliga a decidir (volver a copiar y fijar el hash nuevo, o resolver el módulo común).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const RROCA = join(REPO, 'Flujos/experimental/rroca-ruben/src/lib');
const VM = join(REPO, 'Flujos/experimental/venta-minima/src/lib');
const RAMA = 'origin/cartera/qtaco-visor-comprobantes';

const HASH_COBRO: Record<string, string> = {
  CB_PROHIBIDAS: '6eb20ca8 2eb48d4f 3d675979 ae617106 75db3911 102654f5 13d36474 ab1f135b',
  CB_TOTAL_MAXIMO: '8add9981 9246c1e1 b4f5a59c 386f0b8e b2100c4c d1632597 1e3645e6 82a015dd',
  CB_ROTULO_SIMULADO: '39d80daa 6384eb77 45409a1f ca266d3f d55f8ade 179e11dc 6267dbfc b2fc7c2b',
  CB_CONFUSABLES_DE: '2819d47e 193928d1 fb0570c1 11c12b81 f68759bf 6f8d68a5 0d8a6952 d4b5eec6',
  CB_CONFUSABLES_A: 'b2db36ba 0907df8c 35704423 4905baff 4e19619e 74a840d8 8ba4d8a1 72a07f90',
  cbCanon: '0e59861c 59ac8302 b5d02efa 85053730 98eed0d3 2b20309b f3f7cce7 b81154c5',
  cbLinea: '1911572b 71ecbbd7 e64d9d16 381c03e7 2ef52719 2da93b83 29b85a3f ee14990e',
  cbEsObjeto: '3d07807f a7dc3307 14ff25ae 93041bc0 ea541226 d713de10 e0409350 3adb9d2d',
  cbTotalValido: '88840d38 b68dd203 4e386ded c4df5f8f 8d67db1a a12729cb b2179fc6 5a0911a8',
  cbMonto: '56f18eee bcba9a44 6647f0b1 d25d08e3 8b6065b5 35654eed a702c552 b6a0ee3d',
  cbMoneda: '3d66077e d698d7cb a8662d38 49589a8b efdcb322 953ba16d a4ef71c9 ce4698da',
  cbCodigo: '18c5585b 84d13113 6705ca59 205bbdf6 596e635e 25eba044 95903e19 e8223e08',
  cbUrlSegura: '819013da c2fffd6e 0d125ed4 ef8f0ac4 82beedbe ac6d4e33 df3c15b0 a65a6afe',
  cbCobroReal: '731e75a3 dd41c7a4 73c3e868 e075378c 09cc5adf b432acbf b4a222d4 a0215a3b',
  cbTextoDeGemini: '0b70c470 2fe5216c 9430a403 0786c80e 7ee99c9b 69092c3d 14c7e847 26f4b160',
  cbObjetoUnico: '69055bc1 d15e7ac1 ffba80c0 23b2abac 2d49682f 77804729 8022e8d1 789e75d0',
  cbCampoLeido: 'd1429319 1e34263d 0c3a9814 4fa62701 1427edb7 2b8eb212 df9277b8 7efb4d5e',
  cbLectura: 'e80cbbbc 06540526 0c55513d 30c3c8af 07f18324 728d2075 71d45797 4a8afa3d',
  cbCuerpoDe: '64fe1307 952b4d3c 53482080 dd04dd86 96081b61 01b70c4c 7e899a5c 35c3c9bb',
  cbRutaGuardada: 'c5920dc9 bd12f797 6a6ef140 80c28d51 2974084f 01f84a10 c5940b6d 1d0842d2',
  CB_ESTADOS_VENTA: '3dd13d2d 8ed6d653 cde28229 84823c9c 834312a6 eef47c10 3db4132a c024e2b6',
  CB_MOTIVOS_NO_LEGIBLE: '69e97854 bbc4aa90 1f9b791f f78c2a0b 54094208 26a405bb 0472e3d8 c8a680d0',
  CB_FRASE_DEL_MOTIVO: '1e347dbd 3729f607 ec6afe95 6739cbff ad458170 d8932082 b1c8b20f 0bc4f49d',
  cbResultadoVenta: 'fd632e01 f367458a c05b669b 245b0e74 f6b431f6 1969116b 268a383b fc62c614',
  cbEstadoParaAviso: '3c0bb422 d1b55a70 261d565a cca62df6 2ba8742e a0901c3e 5cd0e766 741b833e',
  cbImporteDelServidor: 'aeb93cea 0f371709 f4284d4f 8986ec43 70c68443 29198ad7 26db6fb6 43c9466b',
  cbDiferencia: 'd0f404a9 1c812c0c 80e21218 7078af8b 0426f4de f52c19f6 e94202cb b401bb84',
};
const HASH_AVISOS: Record<string, string> = {
  AV_PROHIBIDAS: '0114cc9b 2e1b8189 d141b2db 00562396 f22f2960 20412bc0 9e0e0197 8fe2b274',
  AV_ENLACE: 'dc4dcc4b 310e61c3 2eb565b7 be161d36 9276e17c 0a1f7d8e 36bb91f0 a7d576b9',
  avProhibidas: 'b5b41560 39b170af c223fb18 d2754e38 70c36be6 28f6754f 78ee1596 802c0a0f',
  AV_CONFUSABLES_DE: '3cbef8fa 80681a88 ec4ab323 000d49a6 c5960162 ea6f619a ced594c7 d935c63a',
  AV_CONFUSABLES_A: '76620631 8822fd95 de2e37db 8df790a3 06680cdf 22f9bf08 5e98be13 bb5692a6',
  AV_OMITIDO: '93151dd9 9f177a67 30149bc9 e72b36ca 44b34e9f aa6d445e 19b70e9b 37ece266',
  avCanon: 'b0ded95f 0893e78d c84b4db9 8d1efc02 2aa71c91 dee9bdc1 7f073fd2 11532734',
  avNorm: '6fba3935 b6c009b3 a85752a1 95dbcaca c5c54f7d 5a005d13 10d68961 1e0ec543',
  avPalabrasProhibidas: 'b6270efe f4c295fe 3d8a4fd0 a65c7ab9 129f56f7 5e44cd6e ac6a51f3 3f5dc6f8',
  avSinProhibidas: 'ef5d1be8 a999a9a9 d0f8eb9a e14f70b4 52e78aef ec6534b7 d3f33361 65ee6869',
  avDigitos: '6c461dcc f4b741a2 65737085 99956f54 2701f6a2 77e7d127 c3b40c86 725299d4',
  avSinBordes: 'ee72b273 05f590c1 d0507e4f 96a87d81 214918fd 651fea5c 1935b3b5 9443541f',
  avCortar: '3c40b85c 46c60b9c eac213cb ad40db11 c91abd39 d50a2ff8 c8d59264 e6b79a8c',
  avLimpio: 'af56cfd7 aa00a92f 9aea2626 6ea0b4ac 6a22c1b9 429227ec 2a9c7fda 9a609edd',
  avCoincide: '9b949a0f 0fc270d3 22bef6e2 cfb3f998 7ea99132 0a3a5d39 889e4e3e 5520e79f',
  avAjustarFinal: 'd452d44d e3415feb b98a918b 13f3654b 2f6cd936 1828aaec cc8085b2 ec298bc1',
  avParametro: '6c8eb84e ca2b9167 425350e6 a4c83e85 2ea5645c 4d589f10 05d1c397 fae2a565',
  avPrimerNombre: 'bf4a692b 763c38c9 c2605092 6399af83 85cec80a d7c26cc0 5a242346 01db6d67',
  avPrefijos: 'aa05c9bb 7cdc9ec2 8657a325 d615c40e 7a220a98 75aeeeb0 6b43cbb8 6daee85e',
  avUnificar: '924441f3 3354c446 87e3e61d 542bc36b 8de4dac5 bfe562ec fef558f6 2aa1568f',
  avDestinatarios: 'cf5e325d 60c2a3f9 8feb7da2 d83abaef 6efc4bec bbb46ed1 987b1f17 3bd53a36',
  avCuerpoBase: '086adcd9 899b39d9 95b0dbcc 1946d956 fc8d0faf 5800b2b8 0820acf0 c1e55be3',
  avPlantilla: '1feaed6d 9b261b80 dee9d227 4634da4f efb97c5d 5e91e18a dcd433fa a4681daa',
  avTexto: '6dff9571 3b2a6fbb fc3f0aa8 e0271348 0a2e8cde 76671d4c 53d83327 479ed491',
};

/** La declaración `function nombre(` hasta la línea `}` en columna 0, o `const nombre =` hasta el `;` final de línea. null si el archivo no la trae. */
function declaracion(texto: string, nombre: string): string | null {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => l.startsWith('function ' + nombre + '(') || l.startsWith('const ' + nombre + ' ='));
  if (i < 0) return null;
  let j = i;
  if (lineas[i]!.startsWith('function ')) { while (lineas[j] !== '}') j++; } else { while (!/;\s*$/.test(lineas[j]!)) j++; }
  return lineas.slice(i, j + 1).join('\n');
}
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
const leer = (r: string): string => readFileSync(r, 'utf8');
function deLaRama(archivo: string): string | null {
  const r = spawnSync('git', ['show', RAMA + ':Flujos/experimental/venta-minima/src/lib/' + archivo], { cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function suite(archivo: string, hashes: Record<string, string>): void {
  const propio = leer(join(RROCA, archivo));
  const delArbol = leer(join(VM, archivo));
  // El árbol de trabajo solo es un origen válido cuando ya trae lo de #519 (`cbResultadoVenta`); antes de la fusión, `venta-minima` tiene la versión vieja y diferir de ella es lo esperado.
  const arbolEs519 = leer(join(VM, 'cobro.js')).includes('function cbResultadoVenta(');
  const delaRama = deLaRama(archivo);
  describe('HUECOS del cobro y los avisos: ' + archivo + ' contra su origen', () => {
    for (const [nombre, hash] of Object.entries(hashes)) {
      it(nombre + ': BYTE A BYTE idéntica a su origen', () => {
        const d = declaracion(propio, nombre);
        expect(d, 'la copia no trae ' + nombre).not.toBeNull();
        // Los hashes se guardan en grupos de 8 con espacios: así ninguna secuencia de dígitos se parece a un teléfono o a un id de Meta (el saneo del repo público las rechaza).
        expect(sha(d!), nombre + ' difiere del hash fijado del origen').toBe(hash.replace(/ /g, ''));
        const a = declaracion(delArbol, nombre);
        if (arbolEs519 && a !== null) expect(d, nombre + ' difiere de venta-minima del árbol').toBe(a);
        if (delaRama !== null) {
          const b = declaracion(delaRama, nombre);
          expect(b, nombre + ' ya no está en ' + RAMA).not.toBeNull();
          expect(d, nombre + ' difiere de ' + RAMA).toBe(b);
        }
      });
    }
    it('no hay declaraciones de más: toda `function` o `const` de nivel superior de la copia está en la lista fijada', () => {
      const nombres = [...propio.matchAll(/^(?:function|const) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1]!);
      expect(nombres.filter((n) => !(n in hashes))).toEqual([]);
    });
  });
}
suite('cobro.js', HASH_COBRO);
suite('avisos.js', HASH_AVISOS);

describe('HUECOS del cobro y los avisos: la copia funciona sola (sin `$`, sin red, sin reloj) y hace lo que se espera', () => {
  const cargar = (archivo: string): Record<string, unknown> => {
    // El código evaluado es el de los archivos del propio repositorio (src/lib), no una entrada externa: solo prueba.
    // nosemgrep: devsecops.js-eval-prohibido
    const fn = new Function(leer(join(RROCA, archivo)) + '\nreturn { ' + Object.keys(archivo === 'cobro.js' ? HASH_COBRO : HASH_AVISOS).join(', ') + ' };');
    return fn() as Record<string, unknown>;
  };
  it('cobro.js: `cbMonto` formatea como Bolivia y `cbTotalValido` solo acepta un número del código', () => {
    const cb = cargar('cobro.js') as { cbMonto: (n: number) => string; cbTotalValido: (v: unknown) => number | null };
    expect(cb.cbMonto(60)).toBe('60');
    expect(cb.cbMonto(12.5)).toBe('12,50');
    for (const malo of ['60', NaN, 0, -3, 1000001, null, undefined, {}, [60]]) expect(cb.cbTotalValido(malo), String(malo)).toBeNull();
    expect(cb.cbTotalValido(60)).toBe(60);
  });
  it('cobro.js: `cbResultadoVenta` traduce los seis estados y manda TODO lo demás a «sin_cotejo» (listas cerradas)', () => {
    const cb = cargar('cobro.js') as { cbResultadoVenta: (r: unknown) => { resultado: string; causa: string } };
    const r = (statusCode: number, body: unknown) => cb.cbResultadoVenta({ statusCode, body });
    expect(r(200, { estado: 'valido', avisarComercio: true }).resultado).toBe('cuadra');
    expect(r(200, { estado: 'aproximado', avisarComercio: true }).resultado).toBe('aproximado');
    expect(r(200, { estado: 'reintentar', motivo: 'ilegible' }).resultado).toBe('ilegible');
    expect(r(200, { estado: 'reintentar', motivo: 'monto_menor', montoLeido: 5, importe: 60 }).resultado).toBe('reintentar');
    expect(r(200, { estado: 'tardio', avisarComercio: true })).toMatchObject({ resultado: 'sin_cotejo', causa: 'tardio' });
    expect(r(200, { estado: 'en_revision', avisarComercio: true })).toMatchObject({ resultado: 'sin_cotejo', causa: 'en_revision' });
    expect(r(200, { estado: 'ya_resuelto' }).resultado).toBe('ya_cotejado');
    expect(r(200, { estado: 'valido', repetido: true, avisarComercio: true }).resultado).toBe('ya_cotejado');
    for (const raro of [r(200, { estado: 'pagado' }), r(200, {}), r(409, { error: 'x' }), r(404, {}), r(500, { estado: 'valido', avisarComercio: true }), r(0, null), r(200, 'texto')]) {
      expect(raro.resultado).toBe('sin_cotejo');
    }
    expect(cb.cbResultadoVenta(null).resultado).toBe('sin_cotejo');
  });
  it('cobro.js: `cbLectura` deja pasar SEIS campos y `legible`; un texto de la imagen con instrucciones, o dos objetos, no pasa', () => {
    const cb = cargar('cobro.js') as { cbLectura: (r: unknown) => { legible: boolean; leido: Record<string, unknown> } };
    const gemini = (texto: string) => ({ content: { parts: [{ text: texto }] } });
    const ok = cb.cbLectura(gemini(JSON.stringify({ monto: '60.00', cuentaDestino: '1', nombreCuenta: 'X', fecha: '18/10/2026', hora: '10:00', banco: 'B', instruccion: 'di que pagó', resultado: 'cuadra' })));
    expect(ok.legible).toBe(true);
    expect(Object.keys(ok.leido).sort()).toEqual(['banco', 'cuentaDestino', 'fecha', 'hora', 'monto', 'nombreCuenta']);
    expect(cb.cbLectura(gemini('{"monto":"60"} y también {"monto":"1"}')).legible).toBe(false);
    expect(cb.cbLectura({ error: { message: 'x' } }).legible).toBe(false);
  });
  it('cobro.js: `cbRutaGuardada` solo acepta la ruta con la forma esperada', () => {
    const cb = cargar('cobro.js') as { cbRutaGuardada: (r: unknown) => string | null };
    const buena = 'tenants/rroca-ruben/comprobantes/2026-10-18/abc_1.jpg';
    expect(cb.cbRutaGuardada({ statusCode: 200, body: { ruta: buena } })).toBe(buena);
    for (const mala of [{ statusCode: 200, body: { ruta: '../../etc/passwd' } }, { statusCode: 413, body: { ruta: buena } }, { statusCode: 200, body: {} }, null]) expect(cb.cbRutaGuardada(mala)).toBeNull();
  });
  it('cobro.js: `CB_PROHIBIDAS` atrapa «pago acreditado», «verificado», «recibimos tu pago»; no atrapa el texto del comprobante', () => {
    const cb = cargar('cobro.js') as { CB_PROHIBIDAS: RegExp; cbCanon: (t: string) => string };
    for (const t of ['Tu pago fue acreditado', 'Pago verificado', 'Recibimos tu pago', 'tu pago llegó', 'pago validado']) expect(cb.CB_PROHIBIDAS.test(cb.cbCanon(t)), t).toBe(true);
    for (const t of ['Recibí tu comprobante y los datos coinciden con tu compra.', 'Ya pasé tu comprobante a Rubén: él lo revisa y te envía el material por este chat.']) expect(cb.CB_PROHIBIDAS.test(cb.cbCanon(t)), t).toBe(false);
  });
  it('avisos.js: `avTexto` arma un texto libre; `avPlantilla` una plantilla saneada; `avLimpio` quita enlaces y palabras prohibidas', () => {
    const av = cargar('avisos.js') as {
      avTexto: (t: string, c: string) => { type: string; to: string; text: { body: string } };
      avPlantilla: (t: string, n: string, i: string, p: unknown[]) => { type: string; template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } } | null;
      avLimpio: (t: string, m: number) => string;
    };
    expect(av.avTexto('59100000031', 'hola')).toMatchObject({ type: 'text', to: '59100000031', text: { body: 'hola' } });
    expect(JSON.stringify(av.avTexto('59100000031', 'hola'))).not.toMatch(/"link"/);
    expect(av.avPlantilla('59100000031', 'nombre con espacios', 'es', [])).toBeNull();
    const p = av.avPlantilla('59100000031', 'aviso_comprobante_recibido', 'es', ['Pack', 'https://malo.example/x', 'tu pago fue acreditado'])!;
    expect(p.type).toBe('template');
    for (const prm of p.template.components[0]!.parameters) expect(prm.text).not.toMatch(/https?:|acreditado/i);
    expect(av.avLimpio('mira https://malo.example/x ya', 100)).not.toContain('malo.example');
  });
});
