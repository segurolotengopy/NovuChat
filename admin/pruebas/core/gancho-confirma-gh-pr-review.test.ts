/**
 * `gh pr review` (aprobar, pedir cambios o comentar) cambia GitHub: el gancho
 * `.claude/hooks/acciones-sensibles.sh` lo manda a confirmación humana, igual
 * que `gh pr merge`. Sin esto, tras quitar el deny de `gh pr review*` de
 * settings.json, la única barrera sería el «ask» genérico de `gh *`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const salida = (command: string): { decision: string; motivo: string } => {
  const r = spawnSync('bash', [join(REPO, '.claude', 'hooks', 'acciones-sensibles.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: entornoDelEmulador(undefined),
  });
  if (!r.stdout.trim()) return { decision: 'nada', motivo: '' };
  const h = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: h.permissionDecision, motivo: h.permissionDecisionReason ?? '' };
};

describe('gh pr review pide confirmación humana', () => {
  it('pide confirmación en cualquier forma, con variables delante y con cuerpo', () => {
    for (const c of [
      'gh pr review 1 --approve',
      'gh pr review 1 --request-changes --body "falta una prueba"',
      'gh pr review 1 --comment -b "ok"',
      'GH_CONFIG_DIR=$HOME/.config/gh-pro gh pr review 1 --approve --body "x"',
    ]) {
      const r = salida(c);
      expect(r.decision, c).toBe('ask');
      expect(r.motivo, c).toContain('aprobación o revisión de un PR');
    }
  });

  it('no pide esta confirmación para leer un PR; fusionar sigue pidiéndola', () => {
    for (const c of ['gh pr view 1', 'gh pr list', 'gh pr diff 1']) {
      expect(salida(c).motivo, c).not.toContain('aprobación o revisión');
    }
    expect(salida('gh pr merge 1 --squash').decision).toBe('ask');
  });
});
