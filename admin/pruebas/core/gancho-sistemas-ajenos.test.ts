/**
 * EL GANCHO DE LAS PROHIBICIONES 5 Y 7 (`.claude/hooks/acciones-sensibles.sh`).
 *
 * La prohibición 5 de CLAUDE.md dice qué sistemas ajenos no se tocan y la 7
 * prohíbe la suscripción de la app de AAB1 (#260). El gancho las hace cumplir
 * sobre los comandos de Bash: niega cuando el comando NOMBRA un sistema ajeno
 * Y ADEMÁS ACTÚA (red, nube, GitHub, contenedores…). Nombrarlo para leer
 * documentación pasa. Revisión de seguridad del #260: los nombres del receptor
 * y `/subscriptions` no estaban.
 *
 * Límite honesto, el mismo del gancho: un script que recibe la app por
 * variable de entorno, sin nombrarla en el comando, no se ve acá.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const decision = (command: string): string => {
  const r = spawnSync('bash', [join(REPO, '.claude', 'hooks', 'acciones-sensibles.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: entornoDelEmulador(undefined),
  });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : 'nada';
};

describe('prohibiciones 5 y 7: los sistemas ajenos no se tocan', () => {
  it('niega actuar sobre el receptor de AAB1 por su nombre', () => {
    for (const c of [
      'gcloud run services describe receptor-clientes',
      'docker restart receptor-clientes',
      'ssh vm docker logs receptor-clientes',
      'curl -X DELETE "https://graph.facebook.com/v23.0/$APP/subscriptions" # app AAB1-WA-Prod',
      'curl -X POST "$G/$APP_ID/subscriptions" --data app=aab1-wa-prod',
      // Variantes del separador: Docker acepta guion bajo, y un agente puede escribir la app con espacios.
      'docker logs receptor_clientes',
      'gcloud run services describe "AAB1 WA Prod"',
    ]) expect(decision(c), c).toBe('deny');
  });

  it('`/subscriptions` junto a la app ajena niega aunque el comando no use un verbo de red conocido', () => {
    // Sin `curl`, `gh` ni `docker`: solo la línea `/subscriptions` de ACTUA los ve.
    for (const c of [
      `node -e "fetch(G+'/'+id+'/subscriptions',{method:'POST'})" # AAB1-WA-Prod`,
      `python3 -c "import requests; requests.delete(G+'/'+app+'/subscriptions')" # AAB1-WA-Prod`,
    ]) expect(decision(c), c).toBe('deny');
  });

  it('sigue negando lo de antes (la app de SeguroLoTengo, el otp-service y WhatsApp-Modular)', () => {
    for (const c of ['docker restart otp-service', 'gh repo clone segurolotengopy/WhatsApp-Modular', 'curl -X POST "$G/$APP/subscribed_apps" # Demo SeguroLo Tengo']) {
      expect(decision(c), c).toBe('deny');
    }
  });

  it('nombrarlos sin actuar pasa: leer la documentación o buscar en el repositorio', () => {
    for (const c of [
      'grep -n "receptor-clientes" CLAUDE.md',
      'cat docs/arquitectura/core.md | grep AAB1-WA-Prod',
      'git log --oneline -- CLAUDE.md',
    ]) expect(decision(c), c).not.toBe('deny');
  });

  it('las apps de NovuChat siguen pudiendo usar /subscriptions (scripts/webhook-meta.sh)', () => {
    expect(decision('curl -s "$G/$WA_APP_ID/subscriptions?access_token=x"')).not.toBe('deny');
  });

  it('«AAB1» a secas no niega: aparece en títulos y cuerpos de PR que documentan B8', () => {
    expect(decision('gh pr view 260 --json title # B8: receptor de AAB1')).not.toBe('deny');
  });
});
