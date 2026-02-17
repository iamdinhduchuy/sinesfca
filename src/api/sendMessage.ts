import { Readable } from "stream";
import fs, { copySync } from "fs-extra";
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

export interface MessageContent {
  body?: string;
  attachment?: any | any[];
  sticker?: string | number;
  mentions?: Mention[];
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

  private async uploadAttachments(attachments: any[]): Promise<any[]> {
    const uploads = []

    for (const attachment of attachments) {
      const stream = toReadableStream(attachment)
      if (!stream)
        continue

      const form = {
        fb_dtsg: client.fb_dtsg,
        jazoest: client.jazoest,
        upload_1024: stream,
        voice_clip: String(isAudio(String((stream as any).path || ""))),
      }

      uploads.push(
        httpClient.postForm(
          `https://upload.facebook.com/ajax/mercury/upload.php`,
          form
        ).then(function (resData) {
          if (resData.data?.error) throw resData;
          if (!resData.data?.payload?.metadata?.[0]) {
            throw { error: "Upload failed: empty metadata" };
          }
          return resData.data.payload.metadata[0];
        }).catch(error => console.log(error))
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

      if (message.sticker) form["sticker_id"] = message.sticker;

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

    let rawData = response.data.trim();
    if (typeof rawData === "string" && rawData.startsWith("for (;;);")) {
      try {
        rawData = JSON.parse(rawData.replace("for (;;);", ""));
      } catch (e) {
        console.error("Lỗi parse JSON từ Facebook:", e);
        return null;
      }
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