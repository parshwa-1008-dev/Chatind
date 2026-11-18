export type User = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string | null;
  about?: string;
  lastSeenAt?: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  type: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  createdAt: string;
  sender: User;
  attachments: { id: string; url: string; originalName: string; contentType: string; size: number }[];
  receipts?: { userId: string; readAt: string }[];
};

export type Conversation = {
  id: string;
  type: "DIRECT" | "GROUP";
  title?: string | null;
  updatedAt: string;
  members: { userId: string; role: "ADMIN" | "MEMBER"; user: User }[];
  messages: (Message & { sender: Pick<User, "id" | "displayName"> })[];
};
