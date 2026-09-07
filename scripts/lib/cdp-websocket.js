import crypto from "node:crypto";
import net from "node:net";
import { EventEmitter } from "node:events";

export class CdpWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = new URL(url);
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString("base64");
      this.socket = net.createConnection(Number(this.url.port), this.url.hostname);
      this.socket.once("error", reject);
      this.socket.once("connect", () => {
        this.socket.write([
          `GET ${this.url.pathname}${this.url.search} HTTP/1.1`,
          `Host: ${this.url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"));
      });
      let handshake = Buffer.alloc(0);
      const onHandshake = (chunk) => {
        handshake = Buffer.concat([handshake, chunk]);
        const end = handshake.indexOf("\r\n\r\n");
        if (end < 0) return;
        const header = handshake.subarray(0, end).toString("utf8");
        if (!header.startsWith("HTTP/1.1 101")) return reject(new Error(`WebSocket handshake failed: ${header.split("\r\n")[0]}`));
        this.socket.off("data", onHandshake);
        this.socket.on("data", (data) => this.#consume(data));
        const remaining = handshake.subarray(end + 4);
        if (remaining.length) this.#consume(remaining);
        resolve(this);
      };
      this.socket.on("data", onHandshake);
    });
  }

  send(text) {
    this.socket.write(this.#frame(Buffer.from(text), 0x1));
  }

  close() {
    this.socket?.end(this.#frame(Buffer.alloc(0), 0x8));
  }

  #frame(payload, opcode) {
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    else if (payload.length < 65536) {
      header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0xfe; header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0xff; header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
    return Buffer.concat([header, mask, masked]);
  }

  #consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0], second = this.buffer[1];
      let length = second & 0x7f, offset = 2;
      if (length === 126) { if (this.buffer.length < 4) return; length = this.buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (this.buffer.length < 10) return; length = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
      const masked = Boolean(second & 0x80), maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + length) return;
      const mask = masked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskBytes;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      this.buffer = this.buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      const opcode = first & 0x0f, final = Boolean(first & 0x80);
      if (opcode === 0x9) { this.socket.write(this.#frame(payload, 0xa)); continue; }
      if (opcode === 0x8) { this.socket.end(); return; }
      if (opcode === 0x1 || opcode === 0x0) this.fragments.push(payload);
      if (final && this.fragments.length) {
        this.emit("message", { data: Buffer.concat(this.fragments).toString("utf8") });
        this.fragments = [];
      }
    }
  }
}
