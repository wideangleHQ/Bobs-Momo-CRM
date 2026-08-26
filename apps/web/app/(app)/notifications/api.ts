import { apiGet, apiPost, apiPut } from '@/lib/api';
import { qs } from '@/features/analytics/api';

export interface Notification {
  id: string;
  channel: string;
  eventKey: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationList {
  data: Notification[];
  meta: { page: number; pageSize: number; total: number };
}

export interface NotificationPreference {
  eventKey: string;
  channel: string;
  enabled: boolean;
  locked: boolean;
}

const ntf = ['notifications'] as const;

export const notificationKeys = {
  all: () => ntf,
  list: (f: Record<string, string | number | undefined>) => [...ntf, 'list', f] as const,
  unreadCount: () => [...ntf, 'unread-count'] as const,
  preferences: () => [...ntf, 'preferences'] as const,
};

export const listNotifications = (f: { page?: number; pageSize?: number }) =>
  apiGet<NotificationList>(`/notifications${qs({ ...f })}`);

export const markRead = (id: string) => apiPost<void>(`/notifications/${id}/read`);

export const markAllRead = () => apiPost<{ updated: number }>('/notifications/read-all');

export const fetchPreferences = () =>
  apiGet<{ data: NotificationPreference[] }>('/notifications/preferences');

export const savePreferences = (preferences: Array<Omit<NotificationPreference, 'locked'>>) =>
  apiPut<{ data: NotificationPreference[] }>('/notifications/preferences', { preferences });
