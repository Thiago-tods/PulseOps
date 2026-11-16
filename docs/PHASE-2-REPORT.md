# Relatório da Fase 2: autenticação e isolamento por organização

## O que foi implementado

**API (`/api/v1`)**

| Rota                           | Acesso           | Função                                                           |
| ------------------------------ | ---------------- | ---------------------------------------------------------------- |
| `POST /auth/register`          | público (5/min)  | Cria usuário, organização (papel OWNER) e sessão, numa transação |
| `POST /auth/login`             | público (10/min) | Autentica; resposta igual para e-mail inexistente e senha errada |
| `POST /auth/refresh`           | cookie (30/min)  | Rotaciona o refresh token; reuso revoga a família inteira        |
| `POST /auth/logout`            | cookie           | Revoga a família de sessões e limpa o cookie                     |
| `GET /auth/me`                 | autenticado      | Dados do usuário, organização e papel                            |
| `GET /organizations/current`   | autenticado      | Organização do usuário                                           |
| `PATCH /organizations/current` | OWNER, ADMIN     | Renomeia a organização (gera registro de auditoria)              |
| `GET /health`                  | público          | Health check                                                     |

**Decisões**

- **Senhas:** argon2id pelo `crypto.argon2` nativo do Node (m=19 MiB, t=2, p=1, sal de 16 bytes). Sem dependência nativa.
- **Access token:** JWT HS256 (`jose` 5.10), 15 min, em memória no frontend. Contém só o `sub`; organização e papel são lidos do banco a cada requisição, então mudança de papel e usuário desativado valem na hora.
- **Refresh token:** 256 bits aleatórios, só o SHA-256 vai ao banco; cookie `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` (e `Secure` em produção); rotação a cada uso e detecção de reuso.
- **Isolamento:** não existe `:id` de organização nas rotas. O `organizationId` vem sempre do banco, a partir do usuário autenticado.
- **Guards globais:** rate limit, depois autenticação (`@Public()` libera), depois papéis (`@Roles()`).
- **CSRF:** `SameSite=Strict` mais verificação do cabeçalho `Origin` nas rotas de sessão.
- **Frontend:** contexto de autenticação, rota protegida `/painel`, redirecionamento de quem já está logado, estados de carregamento e erro. Em desenvolvimento o Vite faz proxy de `/api`, mantendo a mesma origem.

## Verificações executadas

| Verificação                            | Resultado                                                              |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Lint, typecheck, build, Prettier       | OK                                                                     |
| Testes unitários                       | shared 2, api 10, worker 2, web 6: todos passaram                      |
| e2e da API contra o PostgreSQL 18 real | 13 passaram                                                            |
| Smoke com a API em processo real       | health 200; rotas protegidas 401; login inválido 401; payload ruim 400 |
| Dados de teste                         | removidos ao final (contagens voltaram a 0)                            |

Os e2e cobrem: cadastro, hash argon2id no banco, e-mail duplicado, login sem vazar existência, rotas protegidas, rotação e reuso de refresh, logout, origem bloqueada, isolamento entre duas organizações, papel VIEWER bloqueado e auditoria.

## Bugs encontrados e corrigidos durante a fase

- O guard global bloqueava o `GET /health`; ele passou a ser `@Public()`.
- `LOG_LEVEL=info` do `.env.example` era rejeitado pela API; agora é aceito como `log`.
- `jose` 6 é só ESM e não compila no projeto CommonJS; usado o 5.10.
- O client Prisma 7 usa `import()` dinâmico, então o Jest dos e2e roda com `--experimental-vm-modules`.

## Limitações conhecidas

- **Sem verificação de e-mail e sem recuperação de senha.** Por isso o cadastro com e-mail repetido responde 409 e revela que o e-mail existe. A solução completa depende de envio de e-mail (serviço externo).
- **Sem bloqueio por tentativas por conta**, só rate limit por IP.
- **Sem convites** (a tabela existe, a API não) e sem gestão de membros.
- **Deploy cross-site:** com frontend (Cloudflare Pages) e API (Render) em domínios diferentes, `SameSite=Strict` não envia o cookie. Será preciso domínio comum ou ajuste da estratégia antes do deploy.
- Os e2e gravam no banco `pulseops` local (com limpeza). Sem `DATABASE_URL`, eles são ignorados, como no CI atual.
- Não foi aberta a interface no navegador; o frontend foi validado por testes e build.

## Próxima etapa sugerida

Fase 3: CRUD de monitores com validação segura de URL (proteção contra SSRF) e escopo por organização.
