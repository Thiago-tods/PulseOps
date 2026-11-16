# Webhooks do PulseOps

Quando um incidente abre ou é resolvido (ou quando você usa "Enviar teste"), o PulseOps envia um `POST` JSON para o
webhook configurado na regra de alerta. O formato é compatível com Slack e Discord (campos `text` e `content`).

## Requisição

```
POST <sua URL>
content-type: application/json
user-agent: PulseOps-Webhook/1.0
x-pulseops-event: INCIDENT_OPENED | INCIDENT_RESOLVED | TEST
x-pulseops-delivery: <id da notificação>
x-pulseops-signature: t=<unix em segundos>,v1=<hex>
```

```json
{
  "event": "INCIDENT_OPENED",
  "text": "🔴 API principal está indisponível",
  "content": "🔴 API principal está indisponível",
  "incident": {
    "id": "…",
    "title": "…",
    "status": "INVESTIGATING",
    "startedAt": "2026-01-01T12:00:00.000Z",
    "resolvedAt": null
  },
  "monitor": { "id": "…", "name": "API principal", "url": "https://…" },
  "sentAt": "2026-01-01T12:00:05.000Z"
}
```

- A resposta deve ser `2xx`. Qualquer outro status (ou erro de rede) é tentado de novo com intervalo crescente, até
  5 vezes; depois a notificação fica como "Falhou" no painel.
- Redirecionamentos **não** são seguidos (o corpo nunca é reenviado a outro destino).
- `x-pulseops-delivery` identifica a notificação. A entrega é "pelo menos uma vez": se a sua resposta se perder, o
  mesmo `delivery` pode chegar de novo. Guarde os ids já processados se precisar de idempotência.

## Assinatura (HMAC-SHA256)

Cada regra tem um **segredo de assinatura** (`whsec_…`), exibido **uma única vez** ao criar a regra ou ao gerar um
novo segredo ("Novo segredo"). Depois disso ele fica apenas cifrado no servidor. Guarde-o no seu receptor.

O cabeçalho `x-pulseops-signature` traz `t=<timestamp>,v1=<assinatura>`, onde:

```
v1 = hex( HMAC-SHA256( segredo, "<t>.<corpo bruto da requisição>" ) )
```

Para verificar:

1. Leia o **corpo bruto** (antes de interpretar o JSON).
2. Separe `t` e `v1` do cabeçalho.
3. Recuse se `|agora - t| > 300` segundos (protege contra repetição de requisições capturadas).
4. Calcule o HMAC e compare em **tempo constante**.

### Exemplo em Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const received = Buffer.from(parts.v1 ?? '', 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
```

### Regras anteriores à assinatura

Regras criadas antes deste recurso não têm segredo e continuam enviando **sem** o cabeçalho de assinatura. Use
"Gerar segredo" na regra para ativá-la. Gerar um novo segredo invalida o anterior imediatamente.

## Segurança do destino

- A URL do webhook é tratada como segredo: fica cifrada no banco (AES-256-GCM), nunca volta inteira pela API
  (só o servidor, mascarado) e não aparece em logs, auditoria ou mensagens de erro.
- O destino é validado ao cadastrar **e** a cada envio (somente `http`/`https` públicos, sem credenciais na URL,
  portas 80, 443, 8080 e 8443; endereços privados, locais e de metadados são recusados, inclusive após redirecionar
  ou resolver o DNS).
- Os destinos não recebem segredos do PulseOps, só o corpo acima. Note que o corpo inclui o nome e a URL do
  monitor.
