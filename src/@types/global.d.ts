import { FacebookEvent, MessageEventType } from "@/utils/MessageParse"
import { IAPI } from "./api"

declare global {
  var client: Client

  type AppEvent = FacebookEvent;

  interface API extends IAPI {}
  interface Client extends IClient {}
}

export {}