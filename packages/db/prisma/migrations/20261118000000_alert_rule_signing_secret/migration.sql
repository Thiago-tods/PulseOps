-- Segredo de assinatura HMAC dos webhooks (cifrado na aplicação). Aditiva e reversível:
-- regras existentes ficam com NULL e continuam funcionando sem assinatura até o segredo ser gerado.
ALTER TABLE "alert_rules" ADD COLUMN "signing_secret" TEXT;
