import listenMqttDefault from "./api/listenMqtt";
import sendMessage, { MessageContent } from "./api/sendMessage";
import { injectCookies } from "./clients/cookieJar"
import FacebookUtils from "./utils/FacebookUtils";
import logger from "./utils/log";

export default async function SinesFCALogin(cookies: string): Promise<API>;
export default async function SinesFCALogin(username: string, password: string, twoFA?: string): Promise<API>;


export default async function SinesFCALogin(
  arg1: string,
  arg2?: string,
  arg3?: string
): Promise<API> {

  const client: Client = {
    fb_dtsg: "",
    userID: "",
    token: {
      EAAB: "",
      EAAG: ""
    },
    lsd: "",
    jazoest: "",
    lastSeqID: "0",
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36',
    region: "PRN",
    mqttEndpoint: "",
    clientID: (Math.random() * 2147483647 | 0).toString(16)
  };

  if (typeof arg2 === 'undefined') {
    const cookies = arg1;
    await injectCookies(cookies);

    globalThis.client = client

    const authData = await FacebookUtils.getFullContext();

    if (!authData.status) {
      throw new Error(`Đăng nhập thất bại: ${authData.message}`);
    }

    client.fb_dtsg = authData.fb_dtsg || ""
    client.lsd = authData.lsd || ""
    client.token.EAAB = authData.token?.EAAB ?? ""
    client.token.EAAG = authData.token?.EAAG ?? ""
    client.userID = authData.uid || ""
    client.jazoest = authData.jazoest || ""
    client.lastSeqID = authData.lastSeqId || ""

  } else {
    // --- CASE 2: ĐĂNG NHẬP BẰNG USER/PASS/2FA ---
    const username = arg1;
    const password = arg2;
    const twoFA = arg3;

    console.log(`[Login] Đang đăng nhập tài khoản: ${username}`);

    throw new Error("Method đăng nhập User/Pass chưa được triển khai hoàn tất.");
  }

  // Sửa đoạn return trong SinesFCALogin
  return {
    listenMqtt: (callback?: (err: Error | null, event: AppEvent) => void) => {
      return listenMqttDefault(callback);
    },
    // Nếu bạn đã chuyển sendMessage sang Class MessageSender như trên:
    sendMessage: (msg: string | MessageContent, threadID: string, replyToMessageID?: string) => {
      return sendMessage(msg, threadID, replyToMessageID);
    }
  }
}