export enum MessageEventType {
  MESSAGE = "message",
  REPLY = "message_reply",
  UNSEND = "message_unsend",
  REACTION = "message_reaction",
  EVENT = "event",
  READ_RECEIPT = "read_receipt",
  TYPING = "typing",
  UNKNOWN = "unknown",
  PRESENCE = "presence"
}

interface BaseEvent {
  threadID: string;
  messageID: string;
  senderID: string;
  timestamp: number;
  isGroup: boolean;
}

export interface MessageEvent extends BaseEvent {
  type: MessageEventType.MESSAGE;
  body: string;
  args: string[];
  mentions: Record<string, string>;
  attachments: any[];
}

export interface TypingEvent {
  type: MessageEventType.TYPING;
  senderID: string;
  threadID: string;
  isTyping: boolean;
  timestamp: number;
}

export interface ReplyEvent extends Omit<MessageEvent, 'type'> {
  type: MessageEventType.REPLY;
  messageReply: {
    messageID: string;
    senderID: string;
    body: string;
    timestamp: number;
    attachments: any[];
  };
}

export interface UnsendEvent extends BaseEvent {
  type: MessageEventType.UNSEND;
  deletionTimestamp: number;
}

export interface ReactionEvent extends Omit<BaseEvent, 'isGroup'> {
  type: MessageEventType.REACTION;
  reaction: string | undefined;
  action: 'ADD' | 'REMOVE';
  userID: string
}

export interface LogEvent extends BaseEvent {
  type: MessageEventType.EVENT;
  logMessageType: string;
  logMessageData: any;
}

export interface PresenceEvent {
  type: MessageEventType.PRESENCE;
  userID: string;
  timestamp: number;
  statuses: {
    status: "active" | "idle";
    lastActiveTimestamp: number;
    capabilities: number;
  };
}

export type FacebookEvent = MessageEvent | ReplyEvent | UnsendEvent | ReactionEvent | LogEvent | PresenceEvent | TypingEvent;

const recentEvents = new Map<string, number>();

export class MessageParser {
  private static decodeClientPayload(payload: any): any {
    try {
      const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      return JSON.parse(buffer.toString('utf8'));
    } catch (e) { return null; }
  }

  private static isDuplicate(key: string): boolean {
    const now = Date.now();
    if (recentEvents.has(key) && now - recentEvents.get(key)! < 3000) {
      return true;
    }
    recentEvents.set(key, now);

    // Dọn dẹp cache định kỳ
    if (recentEvents.size > 100) {
      for (const [k, t] of recentEvents) {
        if (now - t > 5000) recentEvents.delete(k);
      }
    }
    return false;
  }

  private static parseMentions(body: string, data: any): Record<string, string> {
    const mentions: Record<string, string> = {};
    try {
      const mData = data?.prng ? JSON.parse(data.prng) : [];
      mData.forEach((m: any) => {
        mentions[m.i.toString()] = body.substring(m.o, m.o + m.l);
      });
    } catch (e) { }
    return mentions;
  }

  public static parse(topic: string, data: any): FacebookEvent[] {
    let events: FacebookEvent[] = [];
    if (topic === '/t_ms' && data?.deltas) {
      for (const delta of data.deltas) {
        const res = this.parseDelta(delta);
        if (res) {
          if (Array.isArray(res)) events.push(...(res as FacebookEvent[]));
          else events.push(res as FacebookEvent);
        }
      }
    }

    if (topic === '/orca_presence' && data?.list) {
      const presences = this.handlePresence(data.list)

      events.push(...presences)
    }

    if (topic === '/orca_typing_notifications' || data.type === "typ") {
      events.push(this.handleTyping(data));
    }

    return events;
  }

  private static parseDelta(delta: any): FacebookEvent | FacebookEvent[] | null {
    // Trường hợp ClientPayload đệ quy
    if (delta.class === 'ClientPayload') {
      const decoded = this.decodeClientPayload(delta.payload);
      return decoded?.deltas ? decoded.deltas.map((d: any) => this.parseDelta(d)).flat().filter(Boolean) : null;
    }

    // Reply delta
    if (delta.deltaMessageReply) {
      return this.handleReply(delta.deltaMessageReply);
    }

    // Unsend (Recall) delta
    if (delta.deltaRecallMessageData) {
      return this.handleUnsend(delta.deltaRecallMessageData);
    }

    // Message delta
    if (delta.class === 'NewMessage') {
      return this.handleMessage(delta);
    }

    // Reaction delta
    if (delta.class === 'MessageReaction' || delta.deltaMessageReaction) {
      const r = delta.deltaMessageReaction || delta;
      return this.handleReaction(r)
    }

    console.log(delta)

    // Các trường hợp khác cần xử lí
    return null;
  }

  private static handleMessage(delta: any): MessageEvent {
    const meta = delta.messageMetadata;
    const body = delta.body || "";
    return {
      type: MessageEventType.MESSAGE,
      threadID: (meta.threadKey.threadFbId || meta.threadKey.otherUserFbId).toString(),
      messageID: meta.messageId,
      senderID: meta.actorFbId.toString(),
      body: body,
      args: body.trim().split(/\s+/),
      mentions: this.parseMentions(body, delta.data),
      attachments: delta.attachments || [],
      timestamp: parseInt(meta.timestamp),
      isGroup: !!meta.threadKey.threadFbId
    };
  }

  private static handleReply(replyDelta: any): ReplyEvent {
    const msg = replyDelta.message;
    const replied = replyDelta.repliedToMessage;
    const base = this.handleMessage(msg);

    return {
      ...base,
      type: MessageEventType.REPLY,
      messageReply: {
        messageID: replied.messageMetadata.messageId,
        senderID: replied.messageMetadata.actorFbId.toString(),
        body: replied.body || "",
        timestamp: parseInt(replied.messageMetadata.timestamp),
        attachments: replied.attachments || []
      }
    };
  }

  private static handleReaction(reactionDelta: any): ReactionEvent | null {
    const threadID = (reactionDelta.threadKey.threadFbId || reactionDelta.threadKey.otherUserFbId).toString();
    const messageID = reactionDelta.messageId;
    const userID = (reactionDelta.userId || reactionDelta.senderId).toString();
    const reaction = reactionDelta.reaction;
    const action = (reactionDelta.action === 0) ? 'ADD' : 'REMOVE';

    // Tạo key để check trùng: messageId + userId + action + reaction
    const duplicateKey = `${messageID}_${userID}_${action}_${reaction || 'none'}`;
    if (this.isDuplicate(duplicateKey)) return null;

    return {
      type: MessageEventType.REACTION,
      threadID,
      messageID,
      senderID: userID,
      userID,
      reaction: reaction,
      action: action,
      timestamp: Date.now()
    } as ReactionEvent;
  }

  private static handleUnsend(recallDelta: any): UnsendEvent {
    return {
      type: MessageEventType.UNSEND,
      threadID: (recallDelta.threadKey.threadFbId || recallDelta.threadKey.otherUserFbId).toString(),
      messageID: recallDelta.messageID,
      senderID: recallDelta.senderID.toString(),
      timestamp: recallDelta.deletionTimestamp, // Thời điểm xóa
      deletionTimestamp: recallDelta.deletionTimestamp,
      isGroup: !!recallDelta.threadKey.threadFbId
    };
  }

  private static handlePresence(list: any): PresenceEvent[] {
    return list.map((item: any) => (
      {
        type: MessageEventType.PRESENCE,
        userID: item.u.toString(),
        timestamp: Date.now(),
        statuses: {
          status: item.p === 2 ? "active" : "idle",
          lastActiveTimestamp: item.l * 1000,
          capabilities: item.c || 0
        }
      }));
  }

  private static handleTyping(typing: any): TypingEvent {
    return {
      type: MessageEventType.TYPING,
      senderID: typing.sender_fbid?.toString(),
      threadID: typing.thread?.toString(),
      isTyping: typing.state === 1,
      timestamp: Date.now()
    }
  }
}