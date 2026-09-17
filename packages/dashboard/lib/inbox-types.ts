interface Pagination { page: number; size: number; hasMore: boolean }
export interface InboxChat {
  isRead: boolean; isMuted: boolean; unreadMessagesCount: number;
  user: { uuid: string; handle: string; displayName: string; nickname: string | null; isTopSpender: boolean };
  lastMessage: { text: string | null; type: string; senderRole: string; hasMedia: boolean | null; hasGif: boolean; sentAt: string | null } | null;
}
export interface InboxMessage {
  uuid: string; text: string | null; sentAt: string | null; type: string;
  sender: { uuid: string; handle: string }; isRead: boolean;
  sentByUserId: string | null; appUuid: string | null;
  hasMedia: boolean | null; mediaType: string | null; mediaUuids: string[];
  gif: { id: string; title: string | null; format: string } | null;
  pricing: { USD: { price: number } } | null; purchasedAt: string | null;
  tipSource: string | null;
}
export interface InboxObservation {
  connectionId: string; userUuid: string | null; observedAt: string;
  inbox: { kind: 'chats'; data: InboxChat[]; pagination: Pagination }
    | { kind: 'messages'; data: InboxMessage[]; pagination: Pagination };
}
