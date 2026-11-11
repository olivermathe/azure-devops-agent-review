# Azure DevOps → AI CLI Code Review

CLI local, somente leitura, que encontra Work Items em uma coluna de board do Azure DevOps, resolve vínculos oficiais de Pull Requests e commits, prepara os diffs exatos e usa Kiro CLI, Claude CLI ou Codex CLI para gerar resultados estruturados, relatórios Markdown, um relatório HTML consolidado e notificações no Teams.

## Requisitos

- Node.js 20+
- Git
- Uma das CLIs instalada e autenticada: `kiro-cli`, `claude` ou `codex`
- PAT do Azure DevOps com `Work Items (Read)` e `Code (Read)`
- Para clone SSH: chave pública cadastrada no Azure DevOps e autenticação SSH funcional

As revisões são sempre executadas de forma não interativa em um diretório temporário controlado, com acesso somente de leitura.

## Configuração

```bash
npm install
cp .env.example .env
```

Preencha o `.env`:

```dotenv
AZDO_ORG=OrgName
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
REVIEW_CLI=kiro
GIT_CLONE_PROTOCOL=https
KIRO_API_KEY=
REVIEW_CUSTOM_PROMPT_FILE=
TEAMS_NOTIFICATION_ENABLED=false
TEAMS_WEBHOOK_URL=
TEAMS_PAYLOAD_FORMAT=workflow-envelope
TEAMS_NOTIFY_ON_SUCCESS=true
TEAMS_NOTIFY_ON_ERROR=true
HTML_REPORT_ENABLED=true
DRY_RUN=true
FORCE_REVIEW=false
```

`AZDO_WORK_ITEM_TYPE` aceita um tipo (`Task`), vários separados por vírgulas, ou `*`. Com `*`, a WIQL não filtra o tipo.

Com `AZDO_FILTER_BY_REPOSITORY_FIELD=true`, somente PRs e commits cujos repositórios aparecem no campo livre configurado em `AZDO_REPOSITORY_FIELD` são revisados. O campo aceita um nome, vários nomes separados por vírgula, espaço, ponto e vírgula ou linha, e URLs de repositório. Um campo vazio faz o Work Item ser ignorado por segurança. Use `false` para manter todos os vínculos Git oficiais.

`AZDO_PR_TARGET_BRANCHES` aceita `*` para qualquer destino ou uma lista como `main,release`. Os prefixos `refs/heads/` são opcionais. Quando uma lista é configurada, somente PRs com destino exato nessa lista são revisados; commits isolados são descartados porque não possuem branch de destino.

`AZDO_BOARD_COLUMN_FIELD` pode ficar vazio: a ferramenta obtém `fields.columnField.referenceName` da configuração do board pela API. A inspeção de campos `WEF_*_Kanban.Column` dos Work Items é mantida como fallback. Estado e coluna são filtrados separadamente.

`AZDO_BOARD` deve ser o nome ou ID de um board/backlog pertencente ao time, como `Stories`, `Features` ou `Epics`; normalmente ele não é o nome do time. Quando o valor não existe, a ferramenta lista os boards válidos. O mesmo ocorre para colunas inválidas.

`KIRO_API_KEY` é opcional se o `kiro-cli` já estiver autenticado por outro mecanismo suportado. Nunca é incluído em logs ou relatórios.

`REVIEW_CLI` aceita `kiro`, `claude` ou `codex`. A CLI escolhida precisa estar instalada e autenticada na máquina. A escolha integra a chave do cache, portanto trocar de CLI produz uma nova revisão.

`GIT_CLONE_PROTOCOL` aceita `https` ou `ssh`. Em `https`, o PAT é enviado somente no header do processo Git. Em `ssh`, o script usa a `sshUrl` oficial retornada pela API do Azure DevOps e a chave SSH configurada na máquina; o PAT continua necessário para as consultas REST do Azure DevOps.

`REVIEW_CUSTOM_PROMPT_FILE` é opcional. Quando preenchido, por exemplo com `./review-prompt.md`, o conteúdo do arquivo substitui os critérios padrão da análise técnica. O nome antigo `KIRO_CUSTOM_PROMPT_FILE` continua aceito por compatibilidade. O script sempre acrescenta o contexto, as regras de segurança e o contrato JSON obrigatório; por isso o prompt personalizado deve definir o que analisar, não o formato da resposta. Use [review-prompt.example.md](./review-prompt.example.md) como base. Alterações no arquivo mudam automaticamente a chave do cache.

### Saída estruturada e relatórios

A CLI selecionada retorna um objeto JSON com resumo e achados validados. O script, e não o agente, transforma esse resultado em Markdown, Adaptive Cards do Teams e HTML. Uma resposta fora do contrato falha explicitamente para impedir relatórios parcialmente interpretados.

Com `HTML_REPORT_ENABLED=true`, o arquivo `reports/report.html` consolida todos os Work Items da execução. Cada achado é apresentado em um card com checkbox; as marcações são armazenadas pelo navegador em `localStorage` e permanecem locais naquela máquina e navegador. Use `false` para continuar gerando Markdown e Teams sem criar o HTML.

Cada achado estruturado deve apontar ao menos uma localização com arquivo e linha nova. Nos relatórios Markdown e HTML e no card do Teams, o script transforma essas localizações em links para a aba **Files** do PR, já selecionando o arquivo e o intervalo correspondente. Achados de commits isolados mantêm a localização textual, pois não possuem uma página de PR.

### Notificações no Microsoft Teams

Crie no canal um workflow baseado no gatilho **When a Teams webhook request is received** ou no modelo **Send webhook alerts to a channel**. Copie a URL gerada para `TEAMS_WEBHOOK_URL` e habilite `TEAMS_NOTIFICATION_ENABLED=true`.

O script publica Adaptive Cards 1.2 por Work Item, com links para Work Item e PR e os achados técnicos. Cada achado possui um checkbox visual `Revisado`; a marcação vale somente para a visualização atual no Teams e não é persistida nem compartilhada. Relatórios que excederiam o limite de 28 KB do Teams são divididos automaticamente em cards sequenciais menores que 24 KB. Quando a consulta não encontra nenhum Work Item, publica um card informando que não há tarefas para revisar; esse aviso independe de `TEAMS_NOTIFY_ON_SUCCESS`. Use `TEAMS_PAYLOAD_FORMAT=workflow-envelope` para o envelope oficial `type: message`; use `adaptive-card` quando a ação **Post card in a chat or channel** recebe diretamente o body do gatilho. O DRY_RUN nunca envia notificações. Falhas no webhook usam retry com backoff e são registradas sem interromper outras revisões. A URL é um segredo: não a versione nem a compartilhe em logs.

## Execução

Primeiro faça a simulação. Ela consulta o Azure DevOps e resolve PRs/commits, mas não clona repositórios nem chama a CLI de revisão:

```bash
npm run review
```

Depois altere `DRY_RUN=false` e execute novamente para revisar. Use `FORCE_REVIEW=true` somente quando quiser ignorar o cache local.

Para revisar um Work Item específico, independentemente da coluna, estado e tipo configurados:

```bash
npm run review -- --work-item 115528
# forma curta
npm run review -- 115528
```

Os filtros de `URL Repository`, status ativo do PR e branch de destino continuam sendo aplicados. O modo específico também respeita `DRY_RUN`, cache, relatórios e notificações do Teams.

```text
reports/
├── index.md
├── report.html
├── workitem-12345.md
└── workitem-12346.md
```

O cache `.review-state.json` identifica a revisão por Work Item, repositório, PR/commit, SHA analisado e versão das regras. O arquivo e o `.env` estão no `.gitignore`.

## Segurança e comportamento

- Usa somente relações `ArtifactLink` oficiais; não associa PR por número no título.
- Revisa somente Pull Requests com status `active`; PRs abandonados ou concluídos são ignorados e registrados no relatório.
- Remove commits vinculados que já estejam cobertos por um PR vinculado.
- No modo HTTPS, normaliza a `remoteUrl` do Azure DevOps e envia o PAT apenas no header do processo Git. No modo SSH, aceita somente a `sshUrl` oficial em `ssh.dev.azure.com`.
- Usa argumentos de processo separados e valida o host remoto antes do clone.
- Não executa scripts nem instala dependências do código analisado.
- Executa a CLI selecionada em diretório temporário controlado; diff e contexto ficam em um arquivo temporário com permissão `0600`, removido após a análise. Kiro e Claude recebem somente a ferramenta de leitura, e o Codex usa sandbox `read-only`.
- Remove clones e diretórios temporários ao final, inclusive em falhas.
- Uma falha em um Work Item ou artefato não interrompe os demais.
- Valida o JSON retornado pela CLI antes de gerar Markdown, HTML ou mensagens do Teams.
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

- A CLI precisa respeitar o contrato JSON obrigatório; respostas inválidas são rejeitadas e registradas como erro do artefato.
- O diff de PR usa `merge-base(target, source)..source`; políticas específicas de merge do servidor podem exibir um diff ligeiramente diferente na interface.
- O estado é um JSON local. Execuções concorrentes compartilhando o mesmo arquivo não são suportadas.
- A validação final de permissões, nomes de board/campo, autenticação da CLI e chave SSH depende do ambiente real.
