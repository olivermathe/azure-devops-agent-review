# Azure DevOps → Kiro CLI Code Review

CLI local, somente leitura, que encontra Work Items em uma coluna de board do Azure DevOps, resolve vínculos oficiais de Pull Requests e commits, prepara os diffs exatos e usa o Kiro CLI para gerar um relatório Markdown por Work Item e um índice consolidado.

## Requisitos

- Node.js 20+
- Git
- `kiro-cli` 3.x instalado e autenticado (`kiro-cli --version`)
- PAT do Azure DevOps com `Work Items (Read)` e `Code (Read)`

O aplicativo gráfico `kiro` e o terminal `kiro-cli` são executáveis diferentes. Esta ferramenta usa `kiro-cli chat --v3 --no-interactive`.

## Configuração

```bash
npm install
cp .env.example .env
```

Preencha o `.env`:

```dotenv
AZDO_ORG=StixFidelidade
AZDO_PROJECT=Projetos
AZDO_TEAM=Nome do Time
AZDO_BOARD=Nome do Board
AZDO_COLUMN=Code Review
AZDO_STATE=Active
AZDO_WORK_ITEM_TYPE=Task,Bug,User Story,Feature
AZDO_FILTER_BY_REPOSITORY_FIELD=false
AZDO_REPOSITORY_FIELD=URL Repository
AZDO_PR_TARGET_BRANCHES=*
AZDO_BOARD_COLUMN_FIELD=WEF_..._Kanban.Column
AZDO_AREA_PATH=
AZDO_PAT=
KIRO_API_KEY=
KIRO_CUSTOM_PROMPT_FILE=
TEAMS_NOTIFICATION_ENABLED=false
TEAMS_WEBHOOK_URL=
TEAMS_PAYLOAD_FORMAT=workflow-envelope
TEAMS_NOTIFY_ON_SUCCESS=true
TEAMS_NOTIFY_ON_ERROR=true
DRY_RUN=true
FORCE_REVIEW=false
```

`AZDO_WORK_ITEM_TYPE` aceita um tipo (`Task`), vários separados por vírgulas, ou `*`. Com `*`, a WIQL não filtra o tipo.

Com `AZDO_FILTER_BY_REPOSITORY_FIELD=true`, somente PRs e commits cujos repositórios aparecem no campo livre configurado em `AZDO_REPOSITORY_FIELD` são revisados. O campo aceita um nome, vários nomes separados por vírgula, espaço, ponto e vírgula ou linha, e URLs de repositório. Um campo vazio faz o Work Item ser ignorado por segurança. Use `false` para manter todos os vínculos Git oficiais.

`AZDO_PR_TARGET_BRANCHES` aceita `*` para qualquer destino ou uma lista como `main,release`. Os prefixos `refs/heads/` são opcionais. Quando uma lista é configurada, somente PRs com destino exato nessa lista são revisados; commits isolados são descartados porque não possuem branch de destino.

`AZDO_BOARD_COLUMN_FIELD` pode ficar vazio: a ferramenta obtém `fields.columnField.referenceName` da configuração do board pela API. A inspeção de campos `WEF_*_Kanban.Column` dos Work Items é mantida como fallback. Estado e coluna são filtrados separadamente.

`AZDO_BOARD` deve ser o nome ou ID de um board/backlog pertencente ao time, como `Stories`, `Features` ou `Epics`; normalmente ele não é o nome do time. Quando o valor não existe, a ferramenta lista os boards válidos. O mesmo ocorre para colunas inválidas.

`KIRO_API_KEY` é opcional se o `kiro-cli` já estiver autenticado por outro mecanismo suportado. Nunca é incluído em logs ou relatórios.

`KIRO_CUSTOM_PROMPT_FILE` é opcional. Quando preenchido, por exemplo com `./review-prompt.md`, o conteúdo do arquivo substitui os critérios e a estrutura padrão da análise técnica. O script ainda acrescenta o contexto do Work Item, PR, diff e as regras fixas de segurança. Use [review-prompt.example.md](./review-prompt.example.md) como base. Alterações no arquivo mudam automaticamente a chave do cache. Para manter a contagem consolidada, cada achado deve usar o rótulo `**Severidade:**`.

### Notificações no Microsoft Teams

Crie no canal um workflow baseado no gatilho **When a Teams webhook request is received** ou no modelo **Send webhook alerts to a channel**. Copie a URL gerada para `TEAMS_WEBHOOK_URL` e habilite `TEAMS_NOTIFICATION_ENABLED=true`.

O script publica um Adaptive Card 1.2 por Work Item, com status, severidades, links para Work Item e PR e o resultado técnico. Use `TEAMS_PAYLOAD_FORMAT=workflow-envelope` para o envelope oficial `type: message`; use `adaptive-card` quando a ação **Post card in a chat or channel** recebe diretamente o body do gatilho. Mensagens são limitadas antes do teto do Teams; conteúdo excedente é truncado. O DRY_RUN nunca envia notificações. Falhas no webhook usam retry com backoff e são registradas sem interromper outras revisões. A URL é um segredo: não a versione nem a compartilhe em logs.

## Execução

Primeiro faça a simulação. Ela consulta o Azure DevOps e resolve PRs/commits, mas não clona repositórios nem chama o Kiro:

```bash
npm run review
```

Depois altere `DRY_RUN=false` e execute novamente para revisar. Use `FORCE_REVIEW=true` somente quando quiser ignorar o cache local.

```text
reports/
├── index.md
├── workitem-12345.md
└── workitem-12346.md
```

O cache `.review-state.json` identifica a revisão por Work Item, repositório, PR/commit, SHA analisado e versão das regras. O arquivo e o `.env` estão no `.gitignore`.

## Segurança e comportamento

- Usa somente relações `ArtifactLink` oficiais; não associa PR por número no título.
- Revisa somente Pull Requests com status `active`; PRs abandonados ou concluídos são ignorados e registrados no relatório.
- Remove commits vinculados que já estejam cobertos por um PR vinculado.
- Normaliza a `remoteUrl` do Azure DevOps removendo o username informativo e faz clone HTTPS com o PAT apenas no header do processo Git, sem inserir credenciais na URL.
- Usa argumentos de processo separados e valida o host remoto antes do clone.
- Não executa scripts nem instala dependências do código analisado.
- Executa o Kiro em diretório temporário controlado, confiando somente `fs_read`; diff e contexto ficam em um arquivo temporário com permissão `0600`, removido após a análise. Nenhuma ferramenta de escrita ou shell é habilitada.
- Remove clones e diretórios temporários ao final, inclusive em falhas.
- Uma falha em um Work Item ou artefato não interrompe os demais.
- Diffs maiores que `MAX_DIFF_BYTES` falham explicitamente, em vez de produzir revisão parcial silenciosa.

## Desenvolvimento

```bash
npm run typecheck
npm test
npm run build
npm run check
```

Os testes usam dados locais; não chamam Azure DevOps, Git remoto ou IA.

## Limites do MVP

- A contagem consolidada depende de o Kiro emitir cada achado com o rótulo `Severidade:` solicitado no prompt.
- O diff de PR usa `merge-base(target, source)..source`; políticas específicas de merge do servidor podem exibir um diff ligeiramente diferente na interface.
- O estado é um JSON local. Execuções concorrentes compartilhando o mesmo arquivo não são suportadas.
- A validação final de permissões, nomes de board/campo e autenticação do Kiro depende do ambiente real.
