import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcessWithInput } from '../src/kiro/kiro.service.js';

test('captura encerramento antecipado do processo sem EPIPE não tratado', async () => {
  await assert.rejects(
    runProcessWithInput(
      process.execPath,
      ['-e', 'process.exit(7)'],
      'x'.repeat(2 * 1024 * 1024),
      { cwd: process.cwd(), env: process.env, timeoutMs: 5_000 },
    ),
    /encerrou com código 7/,
  );
});
