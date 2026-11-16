# Relatório da Fase 1.1

## Ambiente

Windows 11 Pro, Node 26.13.0, npm 11.20.0, Git 2.56.0. `E:\PulseOps` estava vazio. PostgreSQL 18.6: serviço
`postgresql-x64-18` ativo, porta 5432 (por `postgresql.conf`; 16 usa 5434 e 17 usa 5433). Na fase inicial não houve conexão
ao banco; depois foi feita a migração (ver atualização no fim).

## Compatibilidade (campo `engines` / documentação)

- NestJS 11.2.10: `node >= 20`. CLI do Nest não usado (build com `tsc`).
- Prisma 7.10.1 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`): `^20.19 || ^22.12 || >=24`, o que inclui
  Node 26 pelo `engines`. A documentação consultada lista Node 26 apenas para o Prisma 8 (ainda RC), então o
  suporte oficial do 7 no Node 26 **não está confirmado**. Para PostgreSQL 18, a documentação do Prisma 8
  indica só o mínimo (15); **não confirmado** para o Prisma 7. Validação real depende da primeira conexão.
- Vite 8.3.8 e plugin-react 6.3.0: `^20.19 || >=22.12`. Vitest 5.1.0 e jsdom 31: aceitam `>=26`.
- Jest 30.5.2 aceita `>=24`; ts-jest 29.4.15 suporta Jest 30 e TypeScript `<7`.
- TypeScript 6.0.3 (typescript-eslint 8.72.2 exige `<6.1`; o `latest` 7.x não é suportado por ele).
- ESLint 10.15.0; zod 4.6.7; React 19.3.1; React Router 7.18.5.
- `npm ls --all` sem erros. Nenhum aviso de peer dependency.

## Verificações executadas

| Verificação                  | Resultado                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| `npm install`                | OK (755 pacotes). 3 install scripts não executados (`allowScripts`)      |
| `prisma validate`            | OK                                                                       |
| `prisma generate`            | OK (client em `packages/db/src/generated`, ignorado pelo Git)            |
| `typecheck`                  | OK                                                                       |
| `lint` (ESLint)              | OK após corrigir regex dos configs do Jest                               |
| `format:check` (Prettier)    | OK                                                                       |
| `build`                      | OK (shared, db, api, worker, web)                                        |
| Testes unitários             | shared 2, api 3, worker 2, web 3: todos passaram                         |
| Teste e2e da API (supertest) | 2 passaram                                                               |
| Smoke manual                 | API respondeu `GET /api/v1/health`; **worker e web não foram iniciados** |
| `npm audit --omit=dev`       | 0 vulnerabilidades                                                       |

## Não executado

Testes automatizados com banco, execução do CI no GitHub,
deploy, commits.

## Pendências

- Primeira migração (e SQL manual do índice parcial de incidentes).
- Autenticação, multi-tenant, monitores, executor seguro (SSRF), worker real, retenção.
- Confirmar suporte do Prisma 7 com Node 26 e PostgreSQL 18 na prática.

## Autorizações adicionais necessárias

Criar banco e usuário de desenvolvimento no PostgreSQL 18 (com credenciais fornecidas por você, localmente),
executar a primeira migração e, depois, commits/remoto Git.

## Próxima etapa

Fase 2: banco (migração inicial) e autenticação com isolamento por organização.

## Atualiza��o: banco

A migra��o inicial foi aplicada no banco local `pulseops` (PostgreSQL 18.6). Verificado: `migrate status` atualizado, 15 tabelas, �ndice parcial presente e consulta via client Prisma 7 + adapter-pg funcionando. Isso confirma o Prisma 7.10.1 com PostgreSQL 18.6 e Node 26.13 neste ambiente (verifica��o pr�tica, n�o suporte oficial).

## Atualização: banco

A migração inicial foi aplicada no banco local `pulseops` (PostgreSQL 18.6). Verificado: `migrate status` atualizado, 15 tabelas, índice parcial presente e consulta via client Prisma 7 + adapter-pg funcionando. Isso confirma, na prática, o Prisma 7.10.1 com PostgreSQL 18.6 e Node 26.13 neste ambiente (não é suporte oficial).
