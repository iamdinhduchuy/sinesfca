
import stream from "stream";

interface InternalReadable extends stream.Stream {
  _read: Function;
  _readableState: object;
}

function padZeros(val: any, len?: number) {
  val = String(val);
  len = len || 2;
  while (val.length < len) val = "0" + val;
  return val;
}

class Utils {
  constructor() { }

  getHeaders(url: string, options: any, customHeader: any) {
    var headers: any = {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: "https://www.facebook.com/",
      Host: url.replace("https://", "").split("/")[0],
      Origin: "https://www.facebook.com",
      "user-agent": (options.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.114 Safari/537.36"),
      Connection: "keep-alive",
      "sec-fetch-site": 'same-origin',
      "sec-fetch-mode": 'cors'
    };
    if (customHeader) Object.assign(headers, customHeader);
    if (client && client.region) headers["X-MSGR-Region"] = client.region;

    return headers;
  }

  getType(obj: any) {
    return Object.prototype.toString.call(obj).slice(8, -1);
  }

  isReadableStream(obj: any): obj is InternalReadable {
    return (
      obj instanceof stream.Stream &&
      typeof (obj as any)._read === "function" &&
      typeof (obj as any)._readableState === "object"
    );
  }

  convert = {
    binaryToDecimal(data: string) {
      var ret = "";
      while (data !== "0") {
        var end = 0;
        var fullName = "";
        var i = 0;
        for (; i < data.length; i++) {
          end = 2 * end + parseInt(data[i], 10);
          if (end >= 10) {
            fullName += "1";
            end -= 10;
          } else fullName += "0";
        }
        ret = end.toString() + ret;
        data = fullName.slice(fullName.indexOf("1"));
      }
      return ret;
    },
  }

  generate = {
    generateTimestampRelative() {
      var d = new Date();
      return d.getHours() + ":" + padZeros(d.getMinutes());
    }
  }
}

export default new Utils()