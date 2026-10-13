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

## Arquitetura

- Frontend estático: `index.html`
- Banco: Supabase PostgreSQL, tabela `rnc_registros`
- API protegida por código: Supabase Edge Function `rnc-api`
- Não há contas individuais; o código compartilhado fica apenas na função do servidor, não no código HTML público.

## Segurança operacional

Compartilhe o código somente com a equipe autorizada. Se houver suspeita de divulgação, altere o código na função `rnc-api` e publique uma nova versão. Como o acesso é compartilhado, não existe rastreabilidade individual de quem fez cada alteração.
