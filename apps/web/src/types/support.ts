export const SUPPORT_TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export const SUPPORT_TICKET_PRIORITIES = ["low", "normal", "high"] as const;
export const SUPPORT_TICKET_CATEGORIES = [
    "account",
    "gameplay",
    "store",
    "rewards",
    "bug",
    "report",
    "other",
] as const;

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];
export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

export interface SupportTicketActorView {
    id: number;
    username: string;
    role: string;
}

export interface SupportTicketMessageView {
    id: number;
    body: string;
    isInternal: boolean;
    createdAt: string;
    author: SupportTicketActorView | null;
}

export interface SupportTicketView {
    id: number;
    subject: string;
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    status: SupportTicketStatus;
    createdAt: string;
    updatedAt: string;
    lastMessageAt: string;
    lastPublicReplyAt: string | null;
    closedAt: string | null;
    user: SupportTicketActorView;
    assignedAdmin: SupportTicketActorView | null;
    messages: SupportTicketMessageView[];
}

export interface SupportDeskResponse {
    tickets: SupportTicketView[];
}

export interface SupportAdminOption {
    id: number;
    username: string;
}

export interface SupportAdminListResponse {
    tickets: SupportTicketView[];
    total: number;
    page: number;
    pages: number;
    assignableAdmins: SupportAdminOption[];
}

