import type {
  AlertRuleDto,
  CreateAlertRuleInput,
  NotificationDto,
  PublicStatusDto,
  StatusPageDto,
  StatusPageInput,
  UpdateAlertRuleInput,
} from '@pulseops/shared';
import { authedFetch, publicFetch } from './client';

export const alertsApi = {
  list: () => authedFetch<AlertRuleDto[]>('/alert-rules'),
  create: (input: CreateAlertRuleInput) =>
    authedFetch<AlertRuleDto>('/alert-rules', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateAlertRuleInput) =>
    authedFetch<AlertRuleDto>(`/alert-rules/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => authedFetch<void>(`/alert-rules/${id}`, { method: 'DELETE' }),
  test: (id: string) => authedFetch<NotificationDto>(`/alert-rules/${id}/test`, { method: 'POST' }),
};

export const notificationsApi = {
  list: () => authedFetch<NotificationDto[]>('/notifications'),
};

export const statusPageApi = {
  get: () => authedFetch<StatusPageDto | null>('/status-page'),
  save: (input: StatusPageInput) =>
    authedFetch<StatusPageDto>('/status-page', { method: 'PUT', body: JSON.stringify(input) }),
};

export const publicApi = {
  status: (slug: string) =>
    publicFetch<PublicStatusDto>(`/public/status/${encodeURIComponent(slug)}`),
};
