const { SerialPort } = require('serialport');

async function main() {
  console.log('====================================================');
  console.log('       CÔNG CỤ KIỂM TRA KẾT NỐI CÂN RS232 / COM    ');
  console.log('====================================================\n');

  console.log('Đang quét các cổng COM trên máy tính...');
  const ports = await SerialPort.list();

  if (ports.length === 0) {
    console.log('❌ KHÔNG tìm thấy cổng COM nào trên máy tính!');
    console.log('👉 Gợi ý: Hãy kiểm tra đã cắm cáp USB-RS232 vào máy chưa, và đã cài driver (CH340/PL2303/FTDI) chưa.\n');
    return;
  }

  console.log('Các cổng COM tìm thấy:');
  ports.forEach((p, idx) => {
    console.log(`  [${idx + 1}] ${p.path} - ${p.friendlyName || p.manufacturer || 'Không rõ tên'}`);
  });
  console.log('');

  const targetPort = process.argv[2] || ports[0].path;
  const baudRate = Number(process.argv[3]) || 9600;

  console.log(`>>> Đang thử mở cổng: ${targetPort} ở tốc độ ${baudRate} baud (8-N-1)...`);

  const port = new SerialPort({
    path: targetPort,
    baudRate: baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    autoOpen: false
  });

  let byteCount = 0;
  let receivedAny = false;

  port.on('data', chunk => {
    receivedAny = true;
    byteCount += chunk.length;
    const ascii = chunk.toString('latin1').replace(/[\r\n]/g, match => match === '\r' ? '<CR>' : '<LF>\n');
    const hex = chunk.toString('hex').match(/.{1,2}/g).join(' ');
    console.log(`\n[NHẬN ${chunk.length} BYTES] (Tổng: ${byteCount} bytes)`);
    console.log(`  Dạng Ký tự: ${ascii}`);
    console.log(`  Dạng Hex  : ${hex}`);
  });

  port.on('error', err => {
    console.error(`❌ Lỗi cổng ${targetPort}:`, err.message);
    if (err.message.includes('Access denied')) {
      console.log('👉 Cổng COM này đang bị 1 phần mềm khác mở (như HCT Scale Helper hoặc FOSO Connector cũ). Hãy tắt phần mềm đó đi.');
    }
  });

  port.open(err => {
    if (err) {
      console.error(`❌ Không thể mở cổng ${targetPort}:`, err.message);
      return;
    }
    console.log(`✅ ĐÃ MỞ THÀNH CÔNG cổng ${targetPort}!`);
    try {
      port.set({ dtr: true, rts: true }, () => {});
      console.log('✅ Đã bật tín hiệu DTR/RTS để kích hoạt đầu cân.');
    } catch (_) {}

    console.log('\n⏳ Đang lắng nghe tín hiệu từ cân... (Hãy đặt hàng lên cân hoặc bấm nút Print trên cân)');
    console.log('Nhấn Ctrl + C để dừng kiểm tra.\n');

    setTimeout(() => {
      if (!receivedAny) {
        console.log('----------------------------------------------------');
        console.log('⚠️ Đã qua 10 giây mà CHƯA NHẬN ĐƯỢC BYTE NÀO TỪ CÂN!');
        console.log('Các nguyên nhân cần kiểm tra:');
        console.log('  1. Cáp nối: Cân có dùng cáp chéo (Null Modem: chân 2-3 chéo nhau) hay cáp thẳng?');
        console.log('  2. Cài đặt trên cân:');
        console.log('     - Cân đã bật chế độ gửi liên tục (Continuous) hoặc gửi ổn định (Stable) chưa?');
        console.log('     - Thử ấn nút "PRINT" trên mặt cân xem có nhảy byte không.');
        console.log('     - Cổng trên cân có phải Comm 1 không? Tốc độ baud có đúng 9600 không?');
        console.log('----------------------------------------------------');
      }
    }, 10000);
  });
}

main().catch(console.error);
