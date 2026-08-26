import { apiGet, apiPost } from '@/lib/api';
import { qs } from '@/features/analytics/api';

export type MessageScope = 'DIRECT' | 'OUTLET' | 'DEPARTMENT' | 'ALL';

export interface Conversation {
  key: string;
  scope: MessageScope;
  title: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  pinnedCount?: number;
}

export interface Message {
  id: string;
  scope: MessageScope;
  senderId: string;
  senderName?: string;
  recipientId?: string | null;
  outletId?: string | null;
  departmentId?: string | null;
  body: string;
  isPinned: boolean;
  createdAt: string;
  readAt?: string | null;
}

export interface MessageList {
  data: Message[];
  meta?: { page: number; pageSize: number; total: number };
}

export interface BroadcastBody {
  scope: Exclude<MessageScope, 'DIRECT'>;
  outletId?: string;
  departmentId?: string;
  body: string;
  pin?: boolean;
}

export interface BroadcastResult extends Message {
  recipientEstimate?: number;
}

export interface DepartmentOption {
  id: string;
  name: string;
  outletId?: string | null;
  outletCode?: string | null;
}

const msg = ['messages'] as const;

export const messagingKeys = {
  all: () => msg,
  conversations: () => [...msg, 'conversations'] as const,
  thread: (key: string, page: number) => [...msg, 'thread', key, page] as const,
  pinned: (key: string) => [...msg, 'pinned', key] as const,
  unreadCount: () => [...msg, 'unread-count'] as const,
  departments: () => [...msg, 'departments'] as const,
};

/** "outlet:3a9d..." from the conversation list, split into query parameters. */
export function parseConversationKey(key: string): {
  scope: MessageScope;
  outletId?: string;
  departmentId?: string;
  withUserId?: string;
} {
  const [head = '', id = ''] = key.split(':');
  switch (head.toLowerCase()) {
    case 'direct':
      return { scope: 'DIRECT', withUserId: id };
    case 'outlet':
      return { scope: 'OUTLET', outletId: id };
    case 'department':
      return { scope: 'DEPARTMENT', departmentId: id };
    default:
      return { scope: 'ALL' };
  }
}

export const listConversations = () => apiGet<{ data: Conversation[] }>('/messages/conversations');

export const listMessages = (key: string, page = 1) => {
  const parsed = parseConversationKey(key);
  return apiGet<MessageList>(`/messages${qs({ ...parsed, page, pageSize: 50 })}`);
};

export const listPinned = (key: string) => {
  const parsed = parseConversationKey(key);
  return apiGet<MessageList>(`/messages${qs({ ...parsed, pinned: 'true' })}`);
};

export const sendDirect = (recipientId: string, body: string) =>
  apiPost<Message>('/messages', { recipientId, body });

export const sendBroadcast = (body: BroadcastBody) =>
  apiPost<BroadcastResult>('/messages/broadcast', body);

export const markMessageRead = (id: string) => apiPost<void>(`/messages/${id}/read`);

export const pinMessage = (id: string, pinned: boolean) =>
  apiPost<Message>(`/messages/${id}/pin`, { pinned });

export const fetchUnreadCount = () => apiGet<{ count: number }>('/messages/unread-count');

export const listMessagingDepartments = () =>
  apiGet<{ data: DepartmentOption[] }>('/departments');
