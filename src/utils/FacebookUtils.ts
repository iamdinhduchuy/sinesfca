interface DtsgResponse {
  status: boolean;
  data?: string; // fb_dtsg
  lsd?: string;
  message?: string;
}

interface FullContextResponse {
  status: boolean;
  fb_dtsg?: string;
  token?: {
    EAAG: string
    EAAB: string
  },
  jazoest?: string;
  lastSeqId?: string;
  uid?: string;
  lsd?: string;
  message?: string;
}

import { httpClient, jar } from '@/clients/cookieJar';
import logger from './log';

class FacebookUtils {
  constructor() { }

  /**
   * Thuật toán tính jazoest từ fb_dtsg
   */
  public generateJazoest(fb_dtsg: string): string {
    let sum = 0;
    for (let i = 0; i < fb_dtsg.length; i++) {
      sum += fb_dtsg.charCodeAt(i);
    }
    return '2' + sum;
  }

  /**
   * Trích xuất các tham số bảo mật từ HTML
   */
  public extractSecurityParams(html: string) {
    const fb_dtsg = html.match(/["']token["']\s*:\s*["']([^"']+)["']/)
      || html.match(/name="fb_dtsg" value="([^"]+)"/)?.[1];

    const lsd = html.match(/name="lsd" value="([^"]+)"/)?.[1]
      || html.match(/["']LSD["'],\[\],{"token":"([^"]+)"}/)?.[1];

    let jazoest = html.match(/name="jazoest" value="(\d+)"/)?.[1];

    const finalDtsg = typeof fb_dtsg === 'string' ? fb_dtsg : (Array.isArray(fb_dtsg) ? fb_dtsg[1] : null);

    if (finalDtsg && !jazoest) {
      jazoest = this.generateJazoest(finalDtsg);
    }

    const irisSeqID = (html.match(/irisSeqID":"([^"]+)"/) || [])[1]
      || (html.match(/"last_seq_id":"(\d+)"/) || [])[1];

    return {
      fb_dtsg: finalDtsg,
      lsd,
      jazoest,
      irisSeqID
    };
  }

  /**
   * Lấy Sequence ID qua GraphQL (Dùng khi irisSeqID từ HTML bị null hoặc bằng 0)
   */
  public async getSequenceId(userID: string, fb_dtsg: string): Promise<string> {
    try {
      const jazoest = this.generateJazoest(fb_dtsg);

      const payload = new URLSearchParams({
        av: userID,
        fb_api_caller_class: "RelayModern",
        fb_api_req_friendly_name: "MessengerGraphQLThreadlistFetcherQuery",
        doc_id: "3336396659757871",
        variables: JSON.stringify({
          "limit": 1,
          "before": null,
          "tags": ["INBOX"],
          "includeDeliveryReceipts": true,
          "includeSeqID": true
        }),
        fb_dtsg: fb_dtsg,
        jazoest: jazoest
      });

      const res = await httpClient.post("https://www.facebook.com/api/graphql/", payload.toString(), {
        headers: {
          'accept': '*/*',
          'content-type': 'application/x-www-form-urlencoded',
          'x-fb-friendly-name': 'MessengerGraphQLThreadlistFetcherQuery',
          'origin': 'https://www.facebook.com',
          'referer': 'https://www.facebook.com/messages/',
          'user-agent': client.userAgent
        }
      });

      const resData = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;

      console.log(resData)

      const seqId = resData.data?.viewer?.message_threads?.sync_sequence_id;

      return seqId ? seqId.toString() : "0";
    } catch (error: any) {
      console.error("[FacebookUtils] Lỗi Bước B:", error.message);
      return "0";
    }
  }

  public async getMqttConfig(html: string, userID: string): Promise<{ endpoint: string, region: string }> {
    const endpointMatch = html.match(/"endpoint":"([^"]+)"/);
    let mqttEndpoint: string;
    let region: string;

    if (endpointMatch) {
      mqttEndpoint = endpointMatch[1].replace(/\\\//g, "/");
      const url = new URL(mqttEndpoint);
      region = url.searchParams.get("region")?.toUpperCase() || "PRN";

      if (endpointMatch.input?.includes("601051028565049")) {
        console.warn("[FacebookUtils] Phát hiện cảnh báo endpoint đặc biệt (601051028565049)");
      }
    } else {
      region = "PRN";
      mqttEndpoint = `wss://edge-chat.facebook.com/chat?region=prn&sid=${userID}`;
    }

    return { endpoint: mqttEndpoint, region };
  }

  private async getFromBusiness(): Promise<string | null> {
    try {
      const res = await httpClient.get('https://business.facebook.com/content_management');
      const match = res.data.match(/\["DTSGInitialData",\[\],{"token":"([^"]+)"}/)
        || res.data.match(/"[\w]*dtsg[\w]*":\s*{"token":"([^"]+)"}/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Lấy fb_dtsg và lsd từ các nguồn khác nhau
   */
  public async getDtsg(): Promise<DtsgResponse> {
    try {
      const homeRes = await httpClient.get('https://www.facebook.com/');
      const params = this.extractSecurityParams(homeRes.data);

      if (params.fb_dtsg) {
        return {
          status: true,
          data: params.fb_dtsg,
          lsd: params.lsd,
          message: "Lấy thành công từ Facebook Home"
        };
      }

      const mRes = await httpClient.get('https://m.facebook.com/composer/m/?av=0');
      const mParams = this.extractSecurityParams(mRes.data);

      if (mParams.fb_dtsg) {
        return {
          status: true,
          data: mParams.fb_dtsg,
          lsd: mParams.lsd,
          message: "Lấy thành công từ Mobile Facebook"
        };
      }

      const bizDtsg = await this.getFromBusiness();
      if (bizDtsg) return { status: true, data: bizDtsg, message: "Lấy thành công từ Business" };

      return { status: false, message: 'Không tìm thấy token. Có thể bị Checkpoint.' };

    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  public async getTokenEAAG(): Promise<string | null> {
    try {
      const response = await httpClient.get('https://business.facebook.com/business_locations', {
        headers: { 'Referer': 'https://www.facebook.com/' }
      });
      const tokenMatch = response.data.match(/EAAG[a-zA-Z0-9]+/);
      return tokenMatch ? tokenMatch[0] : null;
    } catch (error) {
      return null;
    }
  }

  /**
 * Phương thức lấy Token EAAB/EAAI dự phòng khi EAAG bị null
 */
  public async getTokenEAAB(): Promise<string | null> {
    try {
      const response = await httpClient.get('https://www.facebook.com/adsmanager/manage/campaigns', {
        headers: { 'Referer': 'https://www.facebook.com/' }
      });

      const tokenMatch = response.data.match(/(EAA[a-zA-Z0-9]+)/);

      return tokenMatch ? tokenMatch[1] : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Hàm tổng hợp lấy toàn bộ Context
   */
  public async getFullContext(): Promise<FullContextResponse> {
    try {
      const homeRes = await httpClient.get('https://www.facebook.com/messages/');
      const params = this.extractSecurityParams(homeRes.data);

      if (!params.fb_dtsg) return { status: false, message: "Không tìm thấy DTSG" };

      let lastSeqId = params.irisSeqID;
      const cookies = await jar.getCookies('https://www.facebook.com');
      const uid = cookies.find(c => c.key === 'c_user')?.value;

      const mqttConfig = await this.getMqttConfig(homeRes.data, uid ?? "");

      client.region = mqttConfig.region
      client.mqttEndpoint = mqttConfig.endpoint

      if ((!lastSeqId || lastSeqId === "0") && uid) {
        logger("SequenceID từ HTML bằng 0, đang gọi GraphQL...", 'warn');
        lastSeqId = await this.getSequenceId(uid, params.fb_dtsg);
        logger(`lastSeqId: ${lastSeqId}`, 'info')
      }

      let access_token = await this.getTokenEAAG();
      if (!access_token) access_token = await this.getTokenEAAB();

      return {
        status: true,
        fb_dtsg: params.fb_dtsg,
        jazoest: params.jazoest,
        lastSeqId: lastSeqId,
        uid,
        lsd: params.lsd,
        token: { EAAB: access_token ?? "", EAAG: "" }
      };
    } catch (error: any) {
      return { status: false, message: error.message };
    }
  }

  public async checkHealthAccount(uid: string, access_token: string) {
    const checkToken = await httpClient.get(`https://graph.facebook.com/v19.0/${uid}`, {
      params: {
        fields: 'id,name,account_status',
        access_token: access_token
      }
    });

    console.log(checkToken)
  }
}

export default new FacebookUtils();