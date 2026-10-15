const EventEmitter = require('node:events');
const net = require('node:net');

// Đọc định dạng cân linh hoạt: SI-SMART, CAS, Yaohua, Ohaus, định dạng chuẩn hoặc số kèm đơn vị
function parseFrame(frame) {
  if (!frame) return null;
  const text = frame.trim();
  if (!text) return null;

  // 1. Chuẩn tài liệu: ST,NT,  1234.56kg hoặc ST,GS,+  12.34kg hoặc US,GS,...
  let m = /^([A-Za-z]{2})\s*,\s*([A-Za-z]{2})\s*,\s*([+-]?\s*[\d\s]+(?:\.[\d\s]+)?)\s*(kg|g|lb)?/i.exec(text);
  if (m) {
    const status = m[1].toUpperCase(), kind = m[2].toUpperCase();
    const rawNumStr = m[3].replace(/\s+/g, '');
    const rawValue = Number(rawNumStr);
    if (Number.isFinite(rawValue)) {
      const unit = (m[4] || 'kg').toLowerCase();
      const kg = unit === 'g' ? rawValue/1000 : unit === 'lb' ? rawValue*0.45359237 : rawValue;
      return { kg, status, kind, stable: status === 'ST', raw: text, time: Date.now() };
    }
  }

  // 2. Định dạng có tiền tố WN / WT / GW / NW (như WN:+0012.34kg hoặc WT: 12.34kg)
  m = /^(?:WN|WT|GW|NW|WW)\s*[:=]?\s*([+-]?\s*[\d\s]+(?:\.[\d\s]+)?)\s*(kg|g|lb)?/i.exec(text);
  if (m) {
    const rawValue = Number(m[1].replace(/\s+/g, ''));
    if (Number.isFinite(rawValue)) {
      const unit = (m[2] || 'kg').toLowerCase();
      const kg = unit === 'g' ? rawValue/1000 : unit === 'lb' ? rawValue*0.45359237 : rawValue;
      return { kg, status: 'ST', kind: 'NT', stable: true, raw: text, time: Date.now() };
    }
  }

  // 3. Chuẩn Yaohua XK3190 / A12: ww012.340kg
  m = /^ww\s*([+-]?\s*[\d\s]+(?:\.[\d\s]+)?)\s*(kg|g|lb)?/i.exec(text);
  if (m) {
    const rawValue = Number(m[1].replace(/\s+/g, ''));
    if (Number.isFinite(rawValue)) {
      const unit = (m[2] || 'kg').toLowerCase();
      const kg = unit === 'g' ? rawValue/1000 : unit === 'lb' ? rawValue*0.45359237 : rawValue;
      return { kg, status: 'ST', kind: 'NT', stable: true, raw: text, time: Date.now() };
    }
  }

  // 4. Định dạng số kèm đơn vị bất kỳ: ví dụ "+  12.340 kg", "= 12.34(kg)", "12.345 kg"
  m = /([+-]?\s*\d+(?:\.\d+)?)\s*(?:\(?\s*(kg|g|lb)\s*\)?)?/i.exec(text);
  if (m && m[1]) {
    const rawValue = Number(m[1].replace(/\s+/g, ''));
    if (Number.isFinite(rawValue) && rawValue >= 0) {
      const unit = (m[2] || 'kg').toLowerCase();
      const kg = unit === 'g' ? rawValue/1000 : unit === 'lb' ? rawValue*0.45359237 : rawValue;
      const isStable = !/US|OV/i.test(text);
      return { kg, status: isStable ? 'ST' : 'US', kind: 'NT', stable: isStable, raw: text, time: Date.now() };
    }
  }

  return null;
}
function normIp(ip) { return String(ip || '').replace(/^::ffff:/, ''); }

class ScaleReceiver extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.serial = null;
    this.clients = new Set();
    this.config = null;
    this.latest = null;
    this.lastError = '';
    this.lastActivity = 0;
    this.buffer = Buffer.alloc(0);
    this.source = '';
    this.totalBytesReceived = 0;
  }
  static async listSerialPorts() {
    const { SerialPort } = require('serialport');
    return (await SerialPort.list()).map(p => ({
      path:p.path, manufacturer:p.manufacturer || '', vendorId:p.vendorId || '', productId:p.productId || '',
      friendlyName: p.friendlyName || ''
    }));
  }
  async start(cfg) {
    await this.stop();
    this.config = cfg;
    this.lastError = '';
    if (cfg.connectionType === 'serial') return this.startSerial(cfg);
    return this.startTcp(cfg);
  }
  startTcp(cfg) {
    return new Promise((resolve, reject) => {
      const server = net.createServer(socket => this.onClient(socket));
      server.on('error', error => {
        this.lastError = error.message;
        this.emit('event', `Lỗi TCP: ${error.message}`);
        this.emit('update');
        if (!server.listening) reject(error);
      });
      server.listen(cfg.port, cfg.listenHost, () => {
        this.server = server;
        this.emit('event', `TCP đang nghe ${cfg.listenHost}:${cfg.port}`);
        this.emit('update'); resolve();
      });
    });
  }
  startSerial(cfg) {
    const { SerialPort } = require('serialport');
    return new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: cfg.serialPath,
        baudRate: cfg.serialBaudRate,
        dataBits: cfg.serialDataBits,
        stopBits: cfg.serialStopBits,
        parity: cfg.serialParity,
        autoOpen: false,
        rtscts: false,
        xon: false,
        xoff: false
      });
      this.serial = port;
      port.on('data', chunk => this.ingest(chunk, cfg.serialPath));
      port.on('error', error => {
        this.lastError = error.message;
        this.emit('event', `Lỗi RS232: ${error.message}`);
        this.emit('update');
      });
      port.on('close', () => {
        this.latest = null; this.buffer = Buffer.alloc(0);
        this.emit('event', `Đã đóng cổng ${cfg.serialPath}`);
        this.emit('update');
      });
      port.open(error => {
        if (error) {
          this.lastError = error.message;
          this.serial = null;
          this.emit('event', `Không mở được ${cfg.serialPath}: ${error.message}`);
          return reject(error);
        }
        try {
          port.set({ dtr: true, rts: true }, () => {});
        } catch (_) {}
        this.emit('event', `RS232 đã mở ${cfg.serialPath} · ${cfg.serialBaudRate} baud · 8N1`);
        this.emit('update'); resolve();
      });
    });
  }
  async stop() {
    for (const s of this.clients) s.destroy();
    this.clients.clear();
    const old = this.server; this.server = null;
    if (old) await new Promise(resolve => old.close(resolve));
    const oldSerial = this.serial; this.serial = null;
    if (oldSerial?.isOpen) await new Promise(resolve => oldSerial.close(() => resolve()));
    this.latest = null;
    this.buffer = Buffer.alloc(0);
    this.emit('update');
  }
  ingest(data, source) {
    this.lastActivity = Date.now();
    this.totalBytesReceived += data.length;
    this.emit('data-chunk', data);
    this.buffer = Buffer.concat([this.buffer, data]);

    // Hỗ trợ ngắt dòng bằng: \n (0x0A), \r (0x0D), hoặc ETX (0x03)
    while (true) {
      let idx = -1;
      for (let i = 0; i < this.buffer.length; i++) {
        const b = this.buffer[i];
        if (b === 0x0A || b === 0x0D || b === 0x03) {
          idx = i;
          break;
        }
      }
      if (idx < 0) break;

      const rawSlice = this.buffer.subarray(0, idx);
      let nextStart = idx + 1;
      // Nếu gặp cặp \r\n hoặc \n\r thì nuốt cả 2
      if (nextStart < this.buffer.length) {
        const c1 = this.buffer[idx];
        const c2 = this.buffer[nextStart];
        if ((c1 === 0x0D && c2 === 0x0A) || (c1 === 0x0A && c2 === 0x0D)) {
          nextStart++;
        }
      }
      this.buffer = this.buffer.subarray(nextStart);

      const line = rawSlice.toString('latin1').replace(/[\x00-\x1F\x7F]/g, ' ').trim();
      if (!line) continue;

      this.emit('raw', line);
      const parsed = parseFrame(line);
      if (parsed) {
        this.latest = {...parsed, sourceIp: source};
        this.emit('weight', this.latest);
      } else {
        this.emit('event', `RAW chưa nhận dạng: ${line.slice(0, 140)}`);
      }
    }
    if (this.buffer.length > 8192) {
      this.buffer = Buffer.alloc(0);
      this.emit('event', 'Xóa bộ đệm dữ liệu quá dài');
    }
    this.emit('update');
  }
  onClient(socket) {
    const ip = normIp(socket.remoteAddress);
    if (this.config.allowedScaleIp && ip !== this.config.allowedScaleIp) {
      this.emit('event', `Từ chối IP ${ip}`);
      socket.destroy(); return;
    }
    for (const c of this.clients) c.destroy();
    this.clients.clear(); this.clients.add(socket);
    this.buffer = Buffer.alloc(0); this.latest = null;
    this.emit('event', `Cân kết nối: ${ip}`); this.emit('update');
    socket.on('data', data => this.ingest(data, ip));
    socket.on('error', e => this.emit('event', `Socket: ${e.message}`));
    socket.on('close', () => {
      this.clients.delete(socket);
      this.latest = null; this.buffer = Buffer.alloc(0);
      this.emit('event', 'Cân ngắt kết nối'); this.emit('update');
    });
  }
  status() {
    const now = Date.now();
    const fresh = !!this.latest && now-this.latest.time <= (this.config?.staleMs || 7000);
    const serialMode = this.config?.connectionType === 'serial';
    return {
      type: serialMode ? 'serial' : 'tcp',
      listening: serialMode ? Boolean(this.serial?.isOpen) : Boolean(this.server?.listening),
      connected: serialMode ? Boolean(this.serial?.isOpen && fresh) : this.clients.size > 0,
      fresh, latest: fresh ? this.latest : null,
      lastActivity: this.lastActivity, error: this.lastError
    };
  }

  // Chẩn đoán kiểm tra kết nối trong timeoutMs
  async testConnection(timeoutMs = 5000) {
    const isSerial = this.config?.connectionType === 'serial';
    const target = isSerial ? (this.config?.serialPath || 'COM1') : `${this.config?.listenHost}:${this.config?.port}`;
    const isOpen = isSerial ? Boolean(this.serial?.isOpen) : Boolean(this.server?.listening);

    if (!isOpen) {
      return {
        success: false,
        portOpen: false,
        bytesReceived: 0,
        rawSamples: [],
        message: isSerial
          ? `Cổng ${target} chưa mở được. Lỗi: ${this.lastError || 'Cổng không khả dụng hoặc bị phần mềm khác chiếm'}.`
          : `Cổng TCP ${target} chưa lắng nghe. Lỗi: ${this.lastError || 'Chưa mở'}.`,
        suggestions: [
          'Kiểm tra cổng COM có đang bị phần mềm khác (HCT Smart Scale Helper, PuTTY,...) mở không.',
          'Kiểm tra Device Manager xem cổng COM có bị lỗi hay đổi số không (ví dụ COM1 sang COM3).',
          'Rút cáp USB-RS232 cắm lại và nhấn Quét cổng COM.'
        ]
      };
    }

    const rawSamples = [];
    let bytesCount = 0;
    let foundWeight = null;

    return new Promise(resolve => {
      const onChunk = chunk => { bytesCount += chunk.length; };
      const onRaw = line => { if (line && rawSamples.length < 5) rawSamples.push(line); };
      const onWeight = weight => { if (!foundWeight) foundWeight = weight; };

      this.on('data-chunk', onChunk);
      this.on('raw', onRaw);
      this.on('weight', onWeight);

      // Nếu vừa nhận cân hợp lệ gần nhất trong 2.5 giây
      if (this.latest && (Date.now() - this.latest.time < 2500)) {
        foundWeight = this.latest;
        rawSamples.push(this.latest.raw);
      }

      setTimeout(() => {
        this.removeListener('data-chunk', onChunk);
        this.removeListener('raw', onRaw);
        this.removeListener('weight', onWeight);

        if (foundWeight) {
          return resolve({
            success: true,
            portOpen: true,
            bytesReceived: bytesCount,
            rawSamples,
            weight: foundWeight,
            message: `KẾT NỐI THÀNH CÔNG! Đã nhận số cân: ${foundWeight.kg.toFixed(3)} kg (${foundWeight.stable ? 'Ổn định' : 'Chưa ổn định'}).`,
            suggestions: []
          });
        }

        if (bytesCount > 0) {
          return resolve({
            success: false,
            portOpen: true,
            bytesReceived: bytesCount,
            rawSamples,
            message: `Cổng ${target} đã nhận ${bytesCount} bytes dữ liệu nhưng chưa nhận dạng được số cân hợp lệ.`,
            suggestions: [
              'Xem các mẫu RAW vừa nhận ở khung Nhật ký bên dưới.',
              'Nếu nhận ra ký tự lạ/rác, hãy thử đổi Baud rate (ví dụ 9600, 4800, 2400).',
              'Kiểm tra cân xem đã chọn đúng Protocol 0 hoặc đơn vị kg/g chưa.'
            ]
          });
        }

        return resolve({
          success: false,
          portOpen: true,
          bytesReceived: 0,
          rawSamples: [],
          message: `Cổng ${target} đã mở sẵn sàng, nhưng KHÔNG NHẬN ĐƯỢC TÍN HIỆU NÀO trong ${timeoutMs/1000} giây.`,
          suggestions: [
            'Dây cáp RS232: Cân điện tử thường yêu cầu cáp chéo (Null Modem: chân 2 và 3 chéo nhau) thay vì cáp thẳng.',
            'Cài đặt trên đầu cân: Vào Comm Set trên cân xem đã bật chế độ Continuous (gửi liên tục) hoặc Stable Send chưa.',
            'Thử ấn nút "PRINT" trên mặt cân xem màn hình có nhận tín hiệu không.',
            'Kiểm tra đã cắm đúng cổng Comm 1# trên cân chưa (cổng Comm 2# thường dùng cho máy in).'
          ]
        });
      }, timeoutMs);
    });
  }
}
module.exports = { parseFrame, ScaleReceiver };
