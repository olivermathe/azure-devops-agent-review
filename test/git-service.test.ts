import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeAzureRemoteUrl } from '../src/git/git.service.js';

test('remove o username informativo da remoteUrl do Azure DevOps', () => {
  assert.equal(
    sanitizeAzureRemoteUrl('https://OrgName@dev.azure.com/OrgName/Projetos/_git/repo'),
    'https://dev.azure.com/OrgName/Projetos/_git/repo',
  );
});

test('bloqueia senha embutida e hosts externos', () => {
  assert.throws(
    () => sanitizeAzureRemoteUrl('https://user:secret@dev.azure.com/org/project/_git/repo'),
    /não pode conter senha/,
  );
  assert.throws(
    () => sanitizeAzureRemoteUrl('https://evil.example/org/project/_git/repo'),
    /Host de repositório não permitido/,
  );
});
