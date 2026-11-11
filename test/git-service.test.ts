import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeAzureRemoteUrl, sanitizeAzureSshUrl } from '../src/git/git.service.js';

test('remove o username informativo da remoteUrl do Azure DevOps', () => {
  assert.equal(
    sanitizeAzureRemoteUrl('https://OrgName@dev.azure.com/OrgName/Projetos/_git/repo'),
    'https://dev.azure.com/OrgName/Projetos/_git/repo',
  );
});

test('aceita somente URLs SSH oficiais do Azure DevOps', () => {
  assert.equal(
    sanitizeAzureSshUrl('git@ssh.dev.azure.com:v3/Org/Projeto/repo'),
    'git@ssh.dev.azure.com:v3/Org/Projeto/repo',
  );
  assert.equal(
    sanitizeAzureSshUrl('ssh://git@ssh.dev.azure.com/v3/Org/Projeto/repo'),
    'ssh://git@ssh.dev.azure.com/v3/Org/Projeto/repo',
  );
  assert.throws(() => sanitizeAzureSshUrl('git@github.com:org/repo.git'), /não permitida/);
  assert.throws(() => sanitizeAzureSshUrl('git@ssh.dev.azure.com:v3/Org/Projeto/repo\n-oProxyCommand=evil'), /não permitida/);
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
