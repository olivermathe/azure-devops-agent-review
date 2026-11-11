import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCliArgs } from '../src/config/cli.js';

test('aceita Work Item específico por opção, atribuição ou argumento posicional', () => {
  assert.equal(parseCliArgs(['--work-item', '115528']).workItemId, 115528);
  assert.equal(parseCliArgs(['--work-item=115528']).workItemId, 115528);
  assert.equal(parseCliArgs(['-w', '115528']).workItemId, 115528);
  assert.equal(parseCliArgs(['115528']).workItemId, 115528);
});

test('rejeita ID inválido e argumentos desconhecidos', () => {
  assert.throws(() => parseCliArgs(['--work-item', 'abc']), /ID numérico positivo/);
  assert.throws(() => parseCliArgs(['--outro']), /Argumento desconhecido/);
});
