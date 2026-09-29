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
 * Revisión de seguridad del #264 (LOW): el verbo cuenta como palabra de
 * comando, no dentro de un nombre de archivo (`docker-compose.yml`,
 * `docs/ssh-vm.md`), y el texto de un commit o de un PR (-m, --title, --body,
 * un heredoc con comillas) no cuenta como nombre. Todo lo que la shell ejecuta
 * —`$(…)`, la comilla invertida, un heredoc sin comillas— sigue contando.
 *
 * Límite honesto, el mismo del gancho: un script que recibe la app por
 * variable de entorno, sin nombrarla en el comando, no se ve acá; eso lo
 * cierra `scripts/lib/apps-ajenas.sh` (#265), y acá se pide confirmación.
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

describe('el verbo es una palabra de comando, no un pedazo de nombre de archivo (#264, LOW)', () => {
  it('un verbo dentro de un nombre de archivo no es una acción', () => {
    for (const c of [
      'grep -n receptor-clientes docker-compose.yml',
      'cat docs/ssh-vm.md | grep AAB1-WA-Prod',
      'ls docs/gh-pages/ | grep WhatsApp-Modular',
      'grep -rn otp-service docs/firebase.json.md',
      'sed -n 1,20p scripts/docker.sh.md # WhatsApp-Modular',
    ]) expect(decision(c), c).not.toBe('deny');
  });

  it('el verbo se sigue viendo con ruta, detrás de sudo/timeout/xargs, dentro de bash -c o de $(…)', () => {
    for (const c of [
      '/usr/bin/curl -X POST "$G/x" # AAB1-WA-Prod',
      'bash -c "docker restart receptor-clientes"',
      'sudo docker restart receptor-clientes',
      'timeout 5 docker restart receptor-clientes',
      'echo x | xargs curl -X POST # AAB1-WA-Prod',
      'x=$(curl -s $G/app) # AAB1-WA-Prod',
      'docker-compose restart receptor-clientes',
      'gh api -X DELETE repos/segurolotengopy/WhatsApp-Modular/hooks/1',
    ]) expect(decision(c), c).toBe('deny');
  });

  it('la instalación del canal no oficial se sigue negando (prohibición 1)', () => {
    for (const c of ['pip3 install baileys', 'npm install @whiskeysockets/baileys']) expect(decision(c), c).toBe('deny');
  });
});

describe('el texto de un commit o de un PR no es una acción (#264, LOW)', () => {
  it('el nombre en -m, --title, --body o un heredoc con comillas de git/gh pasa', () => {
    for (const c of [
      "gh pr create --title 'Gancho' --body '…receptor-clientes…'",
      'gh pr create --title "receptor-clientes: B8" --body-file cuerpo.md',
      'git commit -m "receptor-clientes y AAB1-WA-Prod: prohibiciones 5 y 7"',
      'gh pr create --title x --body="AAB1-WA-Prod"',
      "git commit -q -F - <<'EOF'\nreceptor-clientes y curl -X POST\nEOF",
      "gh pr create --title x --body-file - <<'EOF'\nAAB1-WA-Prod $(nada)\nEOF",
    ]) expect(decision(c), c).not.toBe('deny');
  });

  it('el emparejamiento sigue sobre el comando ENTERO: otro argumento u otro tramo niega', () => {
    for (const c of [
      'gh pr create --title x --body y && docker restart receptor-clientes',
      'gh pr create --repo segurolotengopy/WhatsApp-Modular --title x --body y',
      'gh pr create --title "a" --body "b" receptor-clientes',
    ]) expect(decision(c), c).toBe('deny');
  });

  it('un texto que la shell EJECUTA no se quita: $(…), comilla invertida, heredoc sin comillas', () => {
    for (const c of [
      'gh pr create --title x --body "$(curl -X POST $G/app/subscriptions) AAB1-WA-Prod"',
      'gh pr create --title x --body "`docker restart receptor-clientes`"',
      'git commit -F - <<EOF\n$(docker restart receptor-clientes)\nEOF',
    ]) expect(decision(c), c).toBe('deny');
  });

  it('con comillas sin cerrar no se puede partir: se decide sobre el comando crudo', () => {
    expect(decision('curl -s "$G/x" -H "sin cerrar # AAB1-WA-Prod')).toBe('deny');
  });
});

describe('las escrituras en Meta por script piden confirmación (#265)', () => {
  it.each([
    './scripts/verificar-meta.sh --env .env.x --desuscribir',
    './scripts/verificar-meta.sh --env .env.x --suscribir',
    './scripts/webhook-meta.sh --alta-meta --webhook-id r --env-cliente .env.x',
    './scripts/webhook-meta.sh --alta-waba --webhook-id r --env-cliente .env.x',
    './scripts/webhook-meta.sh --preparar --webhook-id r --flujo-id f',
    './scripts/webhook-meta.sh --cerrar --webhook-id r --flujo-id f',
  ])('%s', (c) => expect(decision(c)).toBe('ask'));

  it('los modos que solo leen no piden nada', () => {
    for (const c of ['./scripts/webhook-meta.sh --ver-meta --env-cliente .env.x', './scripts/webhook-meta.sh --probar --webhook-id r']) {
      expect(decision(c), c).toBe('nada');
    }
  });
});
