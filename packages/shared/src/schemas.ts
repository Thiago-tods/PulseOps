import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(10).max(128),
  organizationName: z.string().trim().min(2).max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSec: number;
  timestamp: string;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  organization: OrganizationDto;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
}

const monitorFields = {
  name: z.string().trim().min(2).max(100),
  url: z.string().trim().min(1).max(2048),
  method: z.enum(['GET', 'HEAD']),
  intervalSec: z.number().int().min(300).max(86_400),
  timeoutMs: z.number().int().min(1000).max(30_000),
  expectedStatus: z.number().int().min(100).max(599),
  failureThreshold: z.number().int().min(1).max(10),
};

export const createMonitorSchema = z.object({
  name: monitorFields.name,
  url: monitorFields.url,
  method: monitorFields.method.default('GET'),
  intervalSec: monitorFields.intervalSec.default(300),
  timeoutMs: monitorFields.timeoutMs.default(10_000),
  expectedStatus: monitorFields.expectedStatus.default(200),
  failureThreshold: monitorFields.failureThreshold.default(2),
});
export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

// Sem defaults: em PATCH só os campos enviados são alterados.
export const updateMonitorSchema = z
  .object({
    name: monitorFields.name.optional(),
    url: monitorFields.url.optional(),
    method: monitorFields.method.optional(),
    intervalSec: monitorFields.intervalSec.optional(),
    timeoutMs: monitorFields.timeoutMs.optional(),
    expectedStatus: monitorFields.expectedStatus.optional(),
    failureThreshold: monitorFields.failureThreshold.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo para atualizar',
  });
export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

export interface MonitorDto {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: number;
  failureThreshold: number;
  enabled: boolean;
  lastCheck: CheckDto | null;
  createdAt: string;
  updatedAt: string;
}

export type CheckStatusDto = 'UP' | 'DOWN' | 'TIMEOUT' | 'ERROR';

export interface CheckDto {
  status: CheckStatusDto;
  httpStatus: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

export interface IncidentDto {
  id: string;
  title: string;
  status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
  severity: 'MINOR' | 'MAJOR' | 'CRITICAL';
  monitorId: string | null;
  monitorName: string | null;
  startedAt: string;
  resolvedAt: string | null;
}

// ---------------------------------------------------------------- alertas e notificações

export const createAlertRuleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  // Somente webhook por enquanto; o envio de e-mail depende de um serviço SMTP externo.
  channel: z.literal('WEBHOOK').default('WEBHOOK'),
  target: z.string().trim().min(1).max(2048),
  monitorId: z.uuid().nullable().default(null),
});
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;

export const updateAlertRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    target: z.string().trim().min(1).max(2048).optional(),
    monitorId: z.uuid().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Informe ao menos um campo para atualizar',
  });
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;

export interface AlertRuleDto {
  id: string;
  name: string;
  channel: 'EMAIL' | 'WEBHOOK';
  /** URL mascarada: o caminho e a query costumam conter segredos e nunca são devolvidos. */
  targetPreview: string;
  monitorId: string | null;
  monitorName: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface NotificationDto {
  id: string;
  event: 'INCIDENT_OPENED' | 'INCIDENT_RESOLVED' | 'TEST';
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError: string | null;
  ruleName: string | null;
  incidentTitle: string | null;
  createdAt: string;
  sentAt: string | null;
}

// ---------------------------------------------------------------- página de status

const RESERVED_SLUGS = [
  'api',
  'admin',
  'status',
  'painel',
  'entrar',
  'cadastro',
  'monitores',
  'alertas',
  'www',
  'app',
  'login',
  'static',
  'assets',
];

export const statusPageSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
      'Use de 3 a 40 letras minúsculas, números ou hífen',
    )
    .refine((s) => !RESERVED_SLUGS.includes(s), 'Este endereço é reservado'),
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).nullable().default(null),
  isPublic: z.boolean().default(false),
  monitors: z
    .array(
      z.object({
        monitorId: z.uuid(),
        displayName: z.string().trim().min(1).max(100).nullable().default(null),
      }),
    )
    .max(50)
    .default([]),
});
export type StatusPageInput = z.infer<typeof statusPageSchema>;

export interface StatusPageDto {
  slug: string;
  title: string;
  description: string | null;
  isPublic: boolean;
  monitors: { monitorId: string; displayName: string | null }[];
}

export type PublicMonitorState = 'UP' | 'DOWN' | 'PAUSED' | 'UNKNOWN';
export type OverallStatus = 'OPERATIONAL' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE' | 'UNKNOWN';

/** Dados da página pública: sem URLs, ids internos, mensagens de erro ou dados da organização. */
export interface PublicStatusDto {
  title: string;
  description: string | null;
  overall: OverallStatus;
  updatedAt: string;
  monitors: {
    name: string;
    state: PublicMonitorState;
    uptime30d: number | null;
    lastCheckedAt: string | null;
  }[];
  incidents: {
    title: string;
    status: 'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';
    startedAt: string;
    resolvedAt: string | null;
  }[];
}
