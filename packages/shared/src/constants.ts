export const API_PREFIX = 'api/v1';
export const DEFAULT_MONITOR_INTERVAL_SEC = 300; // 5 minutos
export const CHECK_RETENTION_DAYS = 30;
export const ALLOWED_HTTP_METHODS = ['GET', 'HEAD'] as const;
export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;

export type Role = (typeof ROLES)[number];
export type HttpMethod = (typeof ALLOWED_HTTP_METHODS)[number];
