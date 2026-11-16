# Relatório da Fase 3: monitores e proteção contra SSRF

## O que foi implementado

**Pacote `@pulseops/http-guard`** (Node puro, usado pela API e, na próxima fase, pelo worker)

- `isPublicIp`: só aceita IPs públicos. Bloqueia loopback, redes privadas, CGNAT, link-local (inclui `169.254.169.254`), multicast, documentação e reservadas, em IPv4 e IPv6. Extrai e valida o IPv4 embutido em endereços IPv4-mapped (`::ffff:a.b.c.d`) e NAT64; bloqueia 6to4, ULA e site-local.
- `validateTargetUrl`: apenas `http`/`https`, sem usuário/senha, portas 80, 443, 8080 e 8443, no máximo 2048 caracteres, sem nomes internos (`localhost`, `.local`, `.internal`, `.lan`, nomes sem ponto etc.). Formas ofuscadas de IP (`2130706433`, `0x7f000001`, `0177.0.0.1`, `127.1`) são normalizadas pelo parser e bloqueadas.
- `safeRequest`: resolve o DNS uma única vez por salto, **rejeita se qualquer endereço resolvido for privado**, conecta ao IP já validado (o socket nunca resolve DNS de novo, o que impede DNS rebinding) mantendo SNI e certificado do nome original, segue no máximo 3 redirecionamentos manualmente **revalidando cada destino**, aplica um tempo limite total e nunca lê o corpo da resposta. Falhas voltam como código (`BLOCKED_TARGET`, `DNS_ERROR`, `TIMEOUT`, `TOO_MANY_REDIRECTS`, `CONNECTION_ERROR`, `TLS_ERROR`).

**API `/api/v1/monitors`**

| Rota                                    | Papéis               |
| --------------------------------------- | -------------------- |
| `GET /monitors`, `GET /monitors/:id`    | qualquer papel       |
| `POST /monitors`, `PATCH /monitors/:id` | OWNER, ADMIN, MEMBER |
| `DELETE /monitors/:id`                  | OWNER, ADMIN         |

- Toda consulta filtra por `organizationId` (vindo do banco). Id de outra organização responde 404.
- URL validada no cadastro e na edição (estática + DNS atual). Falha de DNS não rejeita; a checagem definitiva ocorre a cada execução.
- Padrões: GET, 300 s, timeout 10 s, status esperado 200, limiar de 2 falhas. Intervalo mínimo 300 s; apenas GET e HEAD.
- Limite de 20 monitores por organização (`MAX_MONITORS_PER_ORG`), nomes únicos por organização, `organizationId` no corpo é ignorado, PATCH altera só os campos enviados, auditoria de criação, alteração e exclusão.

**Frontend:** página `/monitores` com lista, cadastro, pausar/retomar e excluir (com confirmação). Formulário e botões respeitam o papel do usuário. Estados de carregamento, vazio e erro.

## Verificações executadas

| Verificação                            | Resultado                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, build, Prettier       | OK                                                                                                                |
| Testes unitários                       | shared 2, http-guard 80, api 10, worker 2, web 9: todos passaram                                                  |
| e2e da API contra o PostgreSQL 18 real | 41 passaram (13 de autenticação, 28 de monitores)                                                                 |
| `safeRequest` na rede real             | `example.com` HTTP 200; `localhost`, `169.254.169.254` e `2130706433` bloqueados; domínio inexistente `DNS_ERROR` |
| `npm audit --omit=dev`                 | 0 vulnerabilidades                                                                                                |
| Dados de teste                         | removidos (banco com 0 usuários, organizações e monitores)                                                        |

Os testes do `http-guard` usam um servidor local e um resolvedor injetado para provar: redirecionamento para `10.0.0.5` e `169.254.169.254` bloqueado, esquema `file://` em redirecionamento bloqueado, rebinding com endereço misto rejeitado, e uma única resolução DNS por salto.

## Limitações conhecidas

- **Nenhuma verificação é executada ainda.** Os monitores são só cadastros; o worker que chama `safeRequest` é a próxima fase.
- A proteção em duas camadas depende de `safeRequest` ser sempre usado na execução. Não use `fetch` direto para alvos de monitores.
- IPv6 que apontem para IPv4 via 6to4 é bloqueado por inteiro (decisão conservadora).
- Portas restritas a 80, 443, 8080 e 8443; outras exigem ampliar `DEFAULT_ALLOWED_PORTS`.
- A janela entre o DNS do cadastro e o da execução é coberta pela checagem a cada execução.
- Não foi aberta a interface no navegador; o frontend foi validado por testes e build.

## Próxima etapa sugerida

Fase 4: worker real. Agendar os monitores pela tabela `worker_tasks`, executar `safeRequest`, gravar `monitor_checks`, abrir e resolver incidentes e aplicar a retenção de 30 dias.
