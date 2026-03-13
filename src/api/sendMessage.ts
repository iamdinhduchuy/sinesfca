import { Readable } from "stream";
import fs from "fs-extra";
import { httpClient, jar } from "@/clients/cookieJar";
import { URLSearchParams } from "url";
import utils from "@/utils";
import logger from "@/utils/log";
import path from "path";
import FormData from "form-data";

export interface Mention {
  tag: string;
  id: string;
  fromIndex?: number;
}

export interface MessageLocation {
  latitude: number;
  longitude: number;
  current?: boolean;
}

export type EmojiSize = "small" | "medium" | "large";

export interface MessageContent {
  body?: string;
  attachment?: any | any[];
  sticker?: string | number;
  mentions?: Mention[];
  url?: string;
  location?: MessageLocation;
  emoji?: string;
  emojiSize?: EmojiSize;
}

export interface SentMessageInfo {
  threadID: string;
  messageID: string;
  timestamp: number;
}

function toReadableStream(value: any) {
  if (utils.isReadableStream(value)) return value;

  if (Buffer.isBuffer(value)) {
    const r = new Readable();
    r._read = () => { };
    r.push(value);
    r.push(null);
    (r as any).path = "buffer.bin";
    return r;
  }

  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return null;
    return fs.createReadStream(value);
  }
  return null;
}

function isAudio(p: string) {
  return [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"].some(ext => p.toLowerCase().endsWith(ext));
}

export class MessageSender {
  constructor() { }

  private async getShareAttachmentParams(url: string): Promise<string> {
    const params = new URLSearchParams();
    params.append("image_height", "960");
    params.append("image_width", "960");
    params.append("uri", url);
    params.append("__a", "1");
    params.append("__user", client.userID);
    if (client.fb_dtsg) {
      params.append("fb_dtsg", client.fb_dtsg);
    }
    if (client.jazoest) {
      params.append("jazoest", client.jazoest);
    }
    if (client.lsd) {
      params.append("lsd", client.lsd);
    }

    const response = await httpClient.post(
      "https://www.facebook.com/message_share_attachment/fromURI/",
      params.toString(),
      {
        jar,
        responseType: "text",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": "https://www.facebook.com/",
          "Origin": "https://www.facebook.com",
          "User-Agent": client.userAgent,
          "X-Requested-With": "XMLHttpRequest"
        }
      }
    );

    const responseData = this.parseFacebookResponse(response.data);
    if (responseData?.error) {
      throw responseData;
    }

    const shareParams = responseData?.payload?.share_data?.share_params;
    if (!shareParams) {
      throw new Error("Invalid url");
    }

    return shareParams;
  }

  private applyLocation(message: MessageContent, form: Record<string, any>): void {
    if (!message.location) {
      return;
    }

    if (message.location.latitude == null || message.location.longitude == null) {
      throw new Error("location property needs both latitude and longitude");
    }

    form["location_attachment[coordinates][latitude]"] = message.location.latitude;
    form["location_attachment[coordinates][longitude]"] = message.location.longitude;
    form["location_attachment[is_current_location]"] = !!message.location.current;
  }

  private applyEmoji(message: MessageContent, form: Record<string, any>): void {
    if (message.emojiSize != null && message.emoji == null) {
      throw new Error("emoji property is empty");
    }

    if (!message.emoji) {
      return;
    }

    const emojiSize = message.emojiSize ?? "medium";
    if (!["small", "medium", "large"].includes(emojiSize)) {
      throw new Error("emojiSize property is invalid");
    }

    if (form["body"]) {
      throw new Error("body is not empty");
    }

    form["body"] = message.emoji;
    form["tags[0]"] = `hot_emoji_size:${emojiSize}`;
  }

  private async applyUrl(message: MessageContent, form: Record<string, any>): Promise<void> {
    if (!message.url) {
      return;
    }

    form["shareable_attachment[share_type]"] = "100";
    form["shareable_attachment[share_params]"] = await this.getShareAttachmentParams(message.url);
  }

  private extractUploadMetadata(metadata: any): any[] {
    if (Array.isArray(metadata)) {
      return metadata.filter(Boolean);
    }

    if (metadata && typeof metadata === "object") {
      return Object.values(metadata).filter(Boolean);
    }

    return [];
  }

  private parseFacebookResponse(data: any): any {
    if (typeof data !== "string") {
      return data;
    }

    const trimmed = data.trim();
    if (trimmed.startsWith("for (;;);")) {
      return JSON.parse(trimmed.replace("for (;;);", ""));
    }

    return JSON.parse(trimmed);
  }

  private async uploadAttachments(attachments: any[]): Promise<any[]> {
    const uploads = []

    for (const attachment of attachments) {
      const stream = toReadableStream(attachment)
      if (!stream)
        continue

      const form = new FormData();
      form.append("__a", "1");
      form.append("__user", client.userID);
      if (client.fb_dtsg) {
        form.append("fb_dtsg", client.fb_dtsg);
      }
      if (client.jazoest) {
        form.append("jazoest", client.jazoest);
      }
      if (client.lsd) {
        form.append("lsd", client.lsd);
      }
      form.append("upload_1024", stream, {
        filename: path.basename(String((stream as any).path || "upload.bin")),
      });
      form.append("voice_clip", String(isAudio(String((stream as any).path || ""))));

      uploads.push(
        httpClient.post(
          `https://upload.facebook.com/ajax/mercury/upload.php`,
          form,
          {
            jar,
            responseType: "text",
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            headers: {
              ...form.getHeaders(),
              "Accept": "*/*",
              "Referer": "https://www.facebook.com/",
              "Origin": "https://www.facebook.com",
              "User-Agent": client.userAgent,
              "X-Requested-With": "XMLHttpRequest"
            }
          }
        ).then((response) => {
          const responseData = this.parseFacebookResponse(response.data);

          if (responseData?.error) {
            throw responseData;
          }

          const metadata = this.extractUploadMetadata(responseData?.payload?.metadata);
          if (!metadata[0]) {
            throw {
              error: "Upload failed: empty metadata",
              response: responseData,
            };
          }
          return metadata[0];
        }).catch(error => {
          console.error("[UploadAttachment FAILED]:", error?.response || error?.response?.data || error?.message || error);
          return null;
        })
      )
    }

    const results = await Promise.all(uploads);
    return results.filter(Boolean);
  }

  private handleMentions(body: string, mentions: Mention[], form: any): void {
    const emptyChar = "\u200E";
    let newBody = body;
    if (!newBody.startsWith(emptyChar)) newBody = emptyChar + newBody;
    form["body"] = newBody;

    mentions.forEach((mention, i) => {
      const fromIndex = mention.fromIndex || 0;
      const offset = newBody.indexOf(mention.tag, fromIndex);

      if (offset !== -1) {
        form[`profile_xmd[${i}][offset]`] = offset;
        form[`profile_xmd[${i}][length]`] = mention.tag.length;
        form[`profile_xmd[${i}][id]`] = mention.id;
        form[`profile_xmd[${i}][type]`] = "p";
      }
    });
  }

  private getSignatureID() {
    return Math.floor(Math.random() * 2147483648).toString(16);
  }

  private generateThreadingID(clientID: string) {
    var k = Date.now();
    var l = Math.floor(Math.random() * 4294967295);
    var m = clientID;
    return "<" + k + ":" + l + "-" + m + "@mail.projektitan.com>";
  }

  // private generateOfflineThreadingID() {
  //   var ret = Date.now();
  //   var value = Math.floor(Math.random() * 4294967295);
  //   var str = ("0000000000000000000000" + value.toString(2)).slice(-22);
  //   var msgs = ret.toString(2) + str;
  //   return utils.convert.binaryToDecimal(msgs);
  // }

  public async sendMessage(
    msg: string | MessageContent,
    threadID: string,
    replyToMessageID?: string
  ): Promise<any> {
    try {
      const message: MessageContent = typeof msg === "string" ? { body: msg } : msg;
      const messageAndOTID = Math.floor(Math.random() * 1000000000000000).toString();

      const form: any = {
        client: "mercury",
        action_type: "ma-type:user-generated-message",
        author: "fbid:" + client.userID,
        timestamp: Date.now(),
        timestamp_absolute: "Today",
        timestamp_relative: utils.generate.generateTimestampRelative(),
        timestamp_time_passed: "0",
        fb_dtsg: client.fb_dtsg,
        jazoest: client.jazoest,
        is_unread: false,
        is_cleared: false,
        is_forward: false,
        is_filtered_content: false,
        is_filtered_content_bh: false,
        is_filtered_content_account: false,
        is_filtered_content_quasar: false,
        is_filtered_content_invalid_app: false,
        is_spoof_warning: false,
        source: "source:chat:web",
        "source_tags[0]": "source:chat",
        body: message.body ? message.body.toString().replace("\ufe0f".repeat(40), "   ") : "",
        html_body: false,
        ui_push_phase: "V3",
        status: "0",
        offline_threading_id: messageAndOTID,
        message_id: messageAndOTID,
        threading_id: this.generateThreadingID(client.clientID),
        "ephemeral_ttl_mode:": "0",
        manual_retry_cnt: "0",
        signatureID: this.getSignatureID(),
      };
      if (threadID.length <= 14) {
        form["specific_to_list[0]"] = `fbid:${threadID}`;
        form["specific_to_list[1]"] = `fbid:${globalThis.client.userID}`;
        form["other_user_fbid"] = threadID;
      } else {
        form["thread_fbid"] = threadID;
      }

      if (replyToMessageID) form["replied_to_message_id"] = replyToMessageID;

      this.applyLocation(message, form);

      if (message.sticker) form["sticker_id"] = message.sticker;

      this.applyEmoji(message, form);

      if (message.mentions) this.handleMentions(form.body, message.mentions, form);

      if (message.attachment) {
        const files = await this.uploadAttachments(
          Array.isArray(message.attachment) ? message.attachment : [message.attachment]
        );
        files.forEach((file, i) => {
          const type = Object.keys(file)[0]; // photo_id, video_id...
          form[`${type}s[${i}]`] = file[type];
        });
        form["has_attachment"] = true;
      }

      await this.applyUrl(message, form);

      return await this.executeSend(form)

    } catch (error: any) {
      console.error("[SendMessage FAILED]:", error?.response?.data || error.message);
      logger(`Lỗi khi cố gắng gửi tin nhắn!`, 'error')
    }
  }

  private async executeSend(form: any): Promise<SentMessageInfo | null> {
    const params = new URLSearchParams();
    for (const key in form) {
      params.append(key, form[key]);
    }

    const response = await httpClient.post(
      "https://www.facebook.com/messaging/send/",
      params.toString(),
      {
        jar: jar,
        responseType: 'text',
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Referer": "https://www.facebook.com/",
          "Origin": "https://www.facebook.com",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "X-Requested-With": "XMLHttpRequest"
        }
      }
    );

    let rawData: any;
    try {
      rawData = this.parseFacebookResponse(response.data);
    } catch (e) {
      console.error("Lỗi parse JSON từ Facebook:", e);
      return null;
    }

    const actions = rawData?.payload?.actions || [];
    const sentAction = actions.find((v: any) => v.message_id);

    if (sentAction) {
      const result = {
        threadID: sentAction.thread_fbid || sentAction.thread_id,
        messageID: sentAction.message_id,
        timestamp: sentAction.timestamp,
      };

      console.log("[SendMessage] Gửi thành công! ID:", result.messageID);
      return result;
    }

    return {
      threadID: form.thread_fbid || form["specific_to_list[0]"]?.replace("fbid:", ""),
      messageID: form.offline_threading_id,
      timestamp: Date.now(),
    };
  }
}

const sender = new MessageSender();
// Bind 'this' để đảm bảo hàm vẫn truy cập được các private method bên trong class
export default sender.sendMessage.bind(sender);