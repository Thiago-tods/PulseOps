import type {
  CheckDto,
  CreateMonitorInput,
  IncidentDto,
  MonitorDto,
  UpdateMonitorInput,
} from '@pulseops/shared';
import { authedFetch } from './client';

export const monitorsApi = {
  list: () => authedFetch<MonitorDto[]>('/monitors'),
  checks: (id: string, limit = 20) =>
    authedFetch<CheckDto[]>(`/monitors/${id}/checks?limit=${limit}`),
  create: (input: CreateMonitorInput) =>
    authedFetch<MonitorDto>('/monitors', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateMonitorInput) =>
    authedFetch<MonitorDto>(`/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => authedFetch<void>(`/monitors/${id}`, { method: 'DELETE' }),
};

export const incidentsApi = {
  list: () => authedFetch<IncidentDto[]>('/incidents'),
};
