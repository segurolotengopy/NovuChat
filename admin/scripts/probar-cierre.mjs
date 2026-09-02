#!/usr/bin/env node
/**
 * Prueba `registrarCierre` firmando como lo hace n8n.
 *
 * Existe para poder verificar el endpoint SIN tocar n8n ni gastar un mensaje de
 * WhatsApp, y sobre todo para comprobar las tres cosas que no se ven mirando el
 * código: que la firma cierra, que un cierre sin referencia se rechaza, y que un
 * reintento NO cuenta dos veces —que es el defecto que se descubriría recién en
 * la factura.
 *
 * La clave sale del `.env` correspondiente y NUNCA se imprime.
 *
 *   node scripts/probar-cierre.mjs --env .env          # Demo A (cita)
 *   node scripts/probar-cierre.mjs --env .env.demo-b --tipo venta
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const args = process.argv.slice(2);
const leer = (bandera, porDefecto) => {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : porDefecto;
};

const ARCHIVO = leer('--env', '.env');
const TIPO = leer('--tipo', 'cita');
const URL_BASE = leer('--url', 'https://us-east1-novuchat-demo.cloudfunctions.net/registrarCierre');

const env = Object.fromEntries(
  readFileSync(new URL(ARCHIVO, new URL('../../', import.meta.url)), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const clave = env['NOVUCHAT_HMAC'];
const numero = env['WA_PHONE_ID'];
if (!clave || !numero) {
  console.error(`\nFaltan NOVUCHAT_HMAC o WA_PHONE_ID en ${ARCHIVO}.\n`);
  process.exit(1);
}

async function llamar(cuerpo, etiqueta) {
  const crudo = JSON.stringify(cuerpo);
  const marca = String(Date.now());
  const firma = createHmac('sha256', clave).update(`${marca}.`).update(crudo).digest('hex');
  const r = await fetch(URL_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-NovuChat-Numero': numero,
      'X-NovuChat-Timestamp': marca,
      'X-NovuChat-Signature': `sha256=${firma}`,
    },
    body: crudo,
  });
  let texto = await r.text();
  try { texto = JSON.stringify(JSON.parse(texto)); } catch { /* respuesta en texto plano */ }
  console.log(`  ${etiqueta}: HTTP ${r.status} · ${texto.slice(0, 160)}`);
  return r.status;
}

const referencia = `prueba_${Date.now()}`;
const base = {
  tipo: TIPO,
  referencia,
  telefono: env['WA_TO'] ?? '59170000001',
  detalle: TIPO === 'venta' ? 'Hamburguesa doble + gaseosa' : 'Manicure 11:30',
  nombreCliente: 'Cliente de prueba',
  ...(TIPO === 'venta' ? { monto: 43, moneda: 'BOB' } : {}),
};

console.log(`\nProbando registrarCierre · ${ARCHIVO} · tipo ${TIPO}\n`);
await llamar(base, 'cierre nuevo        ');
await llamar(base, 'MISMO cierre (reintento)');
await llamar({ ...base, referencia: '' }, 'sin referencia      ');
await llamar({ ...base, tipo: 'consulta', referencia: `x_${Date.now()}` }, 'tipo invalido       ');

// Firma mal: tiene que dar 401 aunque todo lo demás esté bien.
{
  const crudo = JSON.stringify(base);
  const marca = String(Date.now());
  const r = await fetch(URL_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-NovuChat-Numero': numero,
      'X-NovuChat-Timestamp': marca,
      'X-NovuChat-Signature': 'sha256=' + '0'.repeat(64),
    },
    body: crudo,
  });
  console.log(`  firma invalida      : HTTP ${r.status}`);
}
console.log();
