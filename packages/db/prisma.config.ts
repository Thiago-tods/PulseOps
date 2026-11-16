import { defineConfig } from 'prisma/config';

// Placeholder apenas para `prisma validate`/`generate`, que não conectam ao banco.
// Migrações exigem DATABASE_URL real, definida localmente (nunca commitar).
const url =
  process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/pulseops';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
