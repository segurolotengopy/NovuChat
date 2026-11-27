/**
 * `gh api` que ESCRIBE sobre revisiones o fusiones de un PR cambia GitHub igual
 * que `gh pr review|merge`: el gancho `.claude/hooks/acciones-sensibles.sh` lo
 * manda a confirmación humana. Hueco hallado por la revisión de seguridad del
 * PR #1148: se aprobaba y fusionaba por la API sin pasar por CONFIRMAR.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './entorno-del-hijo.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MOTIVO = 'Cambia GitHub por la API: aprobación, revisión o fusión de un PR.';
const salida = (command: string): { decision: string; motivo: string } => {
  const r = spawnSync('bash', [join(REPO, '.claude', 'hooks', 'acciones-sensibles.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: entornoDelEmulador(undefined),
  });
  if (!r.stdout.trim()) return { decision: 'nada', motivo: '' };
  const h = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: h.permissionDecision, motivo: h.permissionDecisionReason ?? '' };
};

describe('gh api que escribe revisiones o fusiones de un PR pide confirmación humana', () => {
  it('pide confirmación con cualquier forma de método de escritura o de campos', () => {
    for (const c of [
      'gh api -X POST repos/x/y/pulls/1/reviews -f event=APPROVE',
      'gh api -XPOST repos/x/y/pulls/1/reviews',
      'gh api --method=PUT repos/x/y/pulls/1/merge',
      'gh api --method PUT repos/x/y/pulls/1/merge',
      'gh api -x put repos/x/y/pulls/1/merge',
      'gh api -X PUT repos/x/y/pulls/1/merge -f merge_method=squash',
      'gh api -X PUT repos/x/y/pulls/1/merge',
      'gh api -X POST repos/x/y/pulls/1/reviews/22/events -f event=APPROVE',
      'gh api --method DELETE repos/x/y/pulls/1/reviews/22',
      'gh api -X PUT repos/x/y/pulls/1/reviews/22/dismissals -f message=x',
      'gh api -X PATCH repos/x/y/pulls/1/reviews/22 -f body=x',
      'gh api repos/x/y/pulls/1/reviews -f event=APPROVE',
      'gh api repos/x/y/pulls/1/reviews -F event=APPROVE',
      'gh api repos/x/y/pulls/1/reviews -fevent=APPROVE',
      'gh api repos/x/y/pulls/1/reviews --field event=APPROVE',
      'gh api repos/x/y/pulls/1/merge --raw-field merge_method=squash',
      'gh api repos/x/y/pulls/1/reviews --input cuerpo.json',
      'GH_CONFIG_DIR=$HOME/.config/gh-pro gh api -X POST repos/x/y/pulls/1/reviews -f event=APPROVE',
      'gh api -H "Accept: application/vnd.github+json" -X POST repos/x/y/pulls/1/reviews -f event=APPROVE',
      'gh api graphql -f query=\'mutation { mergePullRequest(input:{pullRequestId:"X"}) { clientMutationId } }\'',
      'gh api graphql -f query=\'mutation { addPullRequestReview(input:{pullRequestId:"X",event:APPROVE}) { clientMutationId } }\'',
      'gh api graphql -f query=\'mutation { submitPullRequestReview(input:{pullRequestId:"X",event:APPROVE}) { clientMutationId } }\'',
      'gh api graphql -f query=\'mutation { enablePullRequestAutoMerge(input:{pullRequestId:"X"}) { clientMutationId } }\'',
      'gh api graphql -f query=@mutacion.graphql',
    ]) {
      const r = salida(c);
      expect(r.decision, c).toBe('ask');
      expect(r.motivo, c).toContain(MOTIVO);
    }
  });

  it('no aplica esta regla a lecturas', () => {
    for (const c of [
      'gh api repos/x/y/pulls/1/reviews',
      'gh api repos/x/y/pulls/1/merge',
      'gh api -X GET repos/x/y/pulls/1/reviews',
      'gh api --method GET repos/x/y/pulls/1/reviews',
      'gh api --method=get repos/x/y/pulls/1/reviews/22',
      'gh api repos/x/y/pulls/1 --jq .state',
      'gh api graphql -f query=\'query { viewer { login } }\'',
    ]) {
      expect(salida(c).motivo, c).not.toContain(MOTIVO);
    }
  });

  it('gh pr review y gh pr merge siguen pidiendo confirmación', () => {
    expect(salida('gh pr review 1 --approve').decision).toBe('ask');
    expect(salida('gh pr merge 1 --squash').decision).toBe('ask');
  });
});
