import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

// Carrega o .env da raiz sem sobrescrever variáveis já definidas (ex.: NODE_ENV=test).
try {
  const values = parseEnv(readFileSync(resolve(__dirname, '../../../.env'), 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    process.env[key] ??= value;
  }
} catch {
  // Sem .env (ex.: CI): os testes que dependem do banco são ignorados.
}
