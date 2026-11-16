// Cifra (ou recifra com a chave atual) os destinos e segredos de webhook gravados no banco.
//
// Usos: migrar regras antigas em texto puro e concluir uma rotação de chave.
//   Simulação (padrão, não grava nada):  node scripts/reencrypt-webhooks.mjs
//   Aplicar:                              node scripts/reencrypt-webhooks.mjs --apply
//
// Variáveis: DATABASE_URL, WEBHOOK_ENCRYPTION_KEY (chave atual) e, numa rotação,
// WEBHOOK_ENCRYPTION_KEY_PREVIOUS (chave antiga). Nunca imprime destinos nem segredos, só contagens.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createPrismaClient, SecretBox, SECRET_CONTEXT } = require('../packages/db');

const apply = process.argv.includes('--apply');
const { DATABASE_URL, WEBHOOK_ENCRYPTION_KEY, WEBHOOK_ENCRYPTION_KEY_PREVIOUS } = process.env;
if (!DATABASE_URL || !WEBHOOK_ENCRYPTION_KEY) {
  console.error('Defina DATABASE_URL e WEBHOOK_ENCRYPTION_KEY.');
  process.exit(1);
}

const previous = (WEBHOOK_ENCRYPTION_KEY_PREVIOUS ?? '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);
const box = new SecretBox(WEBHOOK_ENCRYPTION_KEY, previous);
const db = createPrismaClient(DATABASE_URL, { poolMax: 1 });

try {
  const rules = await db.alertRule.findMany({
    select: { id: true, target: true, signingSecret: true },
  });
  let targets = 0;
  let secrets = 0;
  for (const rule of rules) {
    const data = {};
    if (box.needsReencryption(rule.target)) {
      const plain = box.decrypt(rule.target, SECRET_CONTEXT.alertRuleTarget, {
        allowLegacyPlaintext: true,
      });
      data.target = box.encrypt(plain, SECRET_CONTEXT.alertRuleTarget);
      targets += 1;
    }
    if (rule.signingSecret && box.needsReencryption(rule.signingSecret)) {
      const plain = box.decrypt(rule.signingSecret, SECRET_CONTEXT.alertRuleSigningSecret);
      data.signingSecret = box.encrypt(plain, SECRET_CONTEXT.alertRuleSigningSecret);
      secrets += 1;
    }
    if (apply && Object.keys(data).length > 0) {
      await db.alertRule.update({ where: { id: rule.id }, data });
    }
  }
  console.log(
    `${apply ? 'Aplicado' : 'Simulação'}: ${rules.length} regra(s); ${targets} destino(s) e ${secrets} segredo(s) ${apply ? 'recifrados' : 'a recifrar'}.`,
  );
  if (!apply && targets + secrets > 0) console.log('Rode com --apply para gravar.');
} finally {
  await db.$disconnect();
}
