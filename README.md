# FELJ — Gestão de RNC

Aplicativo web para registro e acompanhamento de Registro de Não Conformidade (RNC), com interface em português e identidade visual corporativa FELJ.

## Acesso

- Aplicativo publicado pelo GitHub Pages: https://feljpcp-lab.github.io/felj-rnc/
- A equipe utiliza um código compartilhado. O código **não deve ser colocado neste repositório público**.
- A validação do código acontece no servidor Supabase por meio da Edge Function `rnc-api`.
- A tabela `public.rnc_registros` tem RLS habilitado e não concede acesso direto às roles públicas `anon` e `authenticated`; as operações passam pela função após a validação do código.
- A chave publishable presente no HTML é destinada ao cliente e não é uma chave administrativa. Nunca adicionar a chave `service_role` ao frontend ou ao repositório.

## Campos cobertos

Identificação e OS, cliente, desenho/peça/lote, emissor, componente, categoria Pareto, impacto de retrabalho e custo, disposição, setor que encontrou e setor responsável, descrição, ações corretivas e prazos, análise dos 5 porquês, causa raiz, ações preventivas e prazos, líderes, verificação de eficácia e encerramento.

## Recursos de gestão\n\n- Validação no servidor dos campos obrigatórios de abertura: emissor e disposição da peça.\n- Ações com descrição, responsável e prazo obrigatórios; evidência exigida para concluir uma ação.\n- Bloqueio de avanço para verificação/encerramento enquanto houver ações dinâmicas pendentes ou em andamento.\n- Reabertura automática da RNC para Em Andamento quando uma ação pendente for reaberta.\n- Anexos privados por RNC: JPG, PNG, WEBP e PDF, até 8 MB por arquivo; links temporários para visualização.\n- Histórico registra os campos alterados, com valores anteriores e novos, além dos eventos de ações.\n- Filtros na lista por cliente, OS, setor e período.\n- Alertas visuais para prazos vencidos e com vencimento nos próximos 3 dias.\n- Rotina de resumo diário ao PCP preparada para dias úteis às 08h (Sorocaba); permanece desativada até configurar `RESEND_API_KEY` e `MAIL_FROM` nos secrets da Edge Function.\n\n## Arquitetura

- Frontend estático: `index.html`
- Banco: Supabase PostgreSQL, tabela `rnc_registros`
- API protegida por código: Supabase Edge Function `rnc-api` (código versionado em `supabase/functions/rnc-api/index.ts`)
- Migrações do banco: `supabase/migrations/`\n- Anexos privados: bucket `rnc-anexos` e tabela `rnc_anexos`, acessados somente pela Edge Function.
- Não há contas individuais; o código compartilhado fica apenas na função do servidor, não no código HTML público.

## Segurança operacional

Compartilhe o código somente com a equipe autorizada. Se houver suspeita de divulgação, altere o código na função `rnc-api` e publique uma nova versão. Como o acesso ainda é feito por código compartilhado, o histórico registra quais campos mudaram e quando, mas não identifica com segurança qual pessoa fez cada alteração. Para atribuição individual, será necessário um cadastro pessoal ou confirmação do responsável em cada alteração.
