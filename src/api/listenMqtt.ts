import { Transform, TransformCallback } from 'stream';
import WebSocket from 'ws';
import Duplexify from 'duplexify';
import { jar } from '@/clients/cookieJar';
import mqtt from 'mqtt';
import zlib from 'zlib'
import logger from '@/utils/log';
import { MessageParser } from '@/utils/MessageParse';

class MQTTDecoder {
  public static decodePayload(payload: Buffer): object | null {
    try {
      let data = payload;
      if (payload[0] === 0x78) {
        data = zlib.inflateSync(payload);
      }
      const jsonObj = this.extractJSON(data);
      if (jsonObj) return jsonObj;
      return { binaryData: data.toString('hex'), length: data.length };
    } catch (error) {
      console.error("[Decoder] Lỗi khi giải mã gói tin:", error);
      return null;
    }
  }

  private static extractJSON(buffer: Buffer): object | null {
    const str = buffer.toString('utf-8');
    try {
      return JSON.parse(str)
    } catch (error) {
      return null
    }
  }
}

interface MqttStream extends NodeJS.ReadWriteStream {
  socket?: WebSocket;
  setReadable(stream: any): void;
  setWritable(stream: any): void;
  destroy(err?: Error): void;
}

/**
 * Xử lý dữ liệu đi từ MQTT Client -> WebSocket
 */
function buildProxy(socket: WebSocket): Transform {
  return new Transform({
    objectMode: false,
    transform(chunk, enc, next) {
      if (socket.readyState === WebSocket.OPEN) {
        const data = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, 'utf8');

        socket.send(data);
      }
      next();
    }
  });
}


/**
 * Ghép nối WebSocket và Proxy thành một luồng Duplex cho MQTT
 */
function buildStream(options: any, socket: WebSocket, proxy: Transform): MqttStream {
  const stream = (Duplexify as any)(undefined, undefined, options) as MqttStream;
  stream.socket = socket;

  let pingInterval: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (pingInterval) clearInterval(pingInterval);
  };

  socket.onopen = () => {
    stream.setReadable(proxy);
    stream.setWritable(proxy);
    stream.emit('connect');

    pingInterval = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 30000);
  };

  socket.onmessage = (event) => {
    const data = Buffer.isBuffer(event.data)
      ? event.data
      : event.data instanceof ArrayBuffer
        ? Buffer.from(event.data)
        : Buffer.from(event.data as string, 'utf8');
    (stream as any).push(data);
  };

  socket.onclose = () => {
    cleanup()
    stream.destroy();
  };

  socket.onerror = (err) => {
    cleanup()
    stream.destroy(err as any);
  };

  return stream;
}

export default async function listenMqtt(callback?: (error: Error | null, event: AppEvent) => void) {
  const sessionID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
  const lastSeqId = client.lastSeqID;
  const GUID = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

  const cookies = await jar.getCookieString("https://www.facebook.com");
  let host;
  if (client.mqttEndpoint) {
    host = `${client.mqttEndpoint}&sid=${sessionID}&cid=${GUID}`;
  } else if (client.region) {
    host = `wss://edge-chat.facebook.com/chat?region=${client.region.toLowerCase()}&sid=${sessionID}&cid=${GUID}`;
  } else {
    host = `wss://edge-chat.facebook.com/chat?sid=${sessionID}&cid=${GUID}`;
  }

  logger(`Tiến hành kết nối tới host ${host}...`, 'info')

  const username = {
    u: client.userID,
    s: sessionID,
    chat_on: true,
    fg: false,
    d: GUID,
    ct: 'websocket',
    aid: '219994525426954',
    aids: null,
    mqtt_sid: '',
    cp: 3,
    ecp: 10,
    st: [],
    pm: [],
    dc: '',
    no_auto_fg: true,
    gas: null,
    pack: [],
    p: null,
    php_override: "",
    gp: '|null|null',
    ' Mỹ': '1'
  };

  const options = {
    clientId: 'mqttwsclient',
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    username: JSON.stringify(username),
    clean: true,
    wsOptions: {
      headers: {
        Cookie: cookies,
        Origin: 'https://www.facebook.com',
        'User-Agent': client.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36',
        Referer: 'https://www.facebook.com/',
        Host: new URL(host).hostname,
      },
      origin: 'https://www.facebook.com',
      protocolVersion: 13,
      binaryType: 'arraybuffer',
    },
    keepalive: 60,
    reschedulePings: true,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
  };

  const mqttClient = new (mqtt as any).Client(() => {
    const ws = new WebSocket(host, {
      headers: {
        'Cookie': cookies,
        'Origin': 'https://www.facebook.com',
        'User-Agent': client.userAgent,
        'Referer': 'https://www.facebook.com/',
        'Host': 'edge-chat.facebook.com',
      }
    });
    const proxy = buildProxy(ws)
    return buildStream(options, ws, proxy);
  }, options);

  mqttClient.on('connect', () => {
    logger(`Đã kết nối tới MQTT thành công!`,'success')

    mqttClient.subscribe(['/ls_req', '/ls_resp', '/legacy_web', '/t_ms', '/thread_typing', '/orca_presence', '/notify_disconnect']);
    const queue = {
      sync_api_version: 11,
      max_deltas_able_to_process: 1000,
      delta_batch_size: 500,
      encoding: 'JSON',
      entity_fbid: client.userID,
      initial_titan_sequence_id: lastSeqId,
      device_params: null,
      force_full_resync: false,
      filter_type: "ALWAY_FILTER"
    };
    mqttClient.publish("/messenger_sync_create_queue", JSON.stringify(queue), { qos: 1 });
  });

  mqttClient.on('reconnect', () => logger(`Đang thử cố kết nối lại...`, 'info'));
  mqttClient.on('offline', () => logger(`Trạng thái của MQTT đang offline!`, 'warn'));
  mqttClient.on('error', (err: any) => {
    console.log(err)
    if (err.code) console.log("[MQTT] Error Code:", err.code);
    logger(`Đã xảy ra lỗi trong MQTT!`, 'error')
  });

  mqttClient.on('close', () => {
    logger(`Kết nối tới MQTT đã bị ngắt!`, 'error')
  });

  mqttClient.on('message', (topic: string, payload: Buffer) => {
    const decoded = MQTTDecoder.decodePayload(payload);

    if (!decoded) return;

    console.dir(decoded, {depth: null})

    const events = MessageParser.parse(topic, decoded);

    events.forEach(event => {
      // if (event.irisSeqId) {
      //   client.lastSeqID = event.irisSeqId.toString();
      //   logger(`Đã cập nhật seqID lại!`, 'success')
      // }

      console.log(`[EVENT RECEIVED] Type: ${event.type} | `, event);

      if (callback) callback(null, event);
    });
  })

  return mqttClient;
}