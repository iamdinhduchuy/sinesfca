import { MessageContent } from "@/api/sendMessage"

export interface IAPI {
  listenMqtt: (callback?: (err: Error | null, event: AppEvent) => any) => any
  sendMessage: (
    msg: string | MessageContent,
    threadID: string,
    replyToMessageID?: string) => Promise<any>
}