const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  connectionType: 'tcp', listenHost: '0.0.0.0', port: 55555, allowedScaleIp: '',
  serialPath: 'COM1', serialBaudRate: 9600, serialDataBits: 8, serialParity: 'none', serialStopBits: 1,
  outputMode: 'keyboard', autoEnter: true, keyboardArmed: false,
  keyboardTrigger: 'stable', stableMs: 0, resetBelowKg: 0.05,
  minWeightKg: 0.05, deltaKg: 0.005, staleMs: 7000,
  apiUrl: '', apiToken: '', apiMinIntervalMs: 1500,
  scaleId: 'SCALE-001', startMinimized: false
};

function configPath(userData) { return path.join(userData, 'config.json'); }
function validate(input) {
  const cfg = { ...DEFAULTS, ...input };
  cfg.port = Number(cfg.port);
  cfg.serialBaudRate = Number(cfg.serialBaudRate);
  cfg.serialDataBits = Number(cfg.serialDataBits);
  cfg.serialStopBits = Number(cfg.serialStopBits);
  cfg.serialPath = String(cfg.serialPath || '').trim().toUpperCase();

  if (!['tcp', 'serial'].includes(cfg.connectionType)) throw Error('Chọn TCP hoặc RS232');
  if (!/^(COM\d{1,3}|\\\\\\.\\COM\d{1,3})$/i.test(cfg.serialPath)) throw Error('COM Port không hợp lệ (VD: COM3)');
  if (![1200,2400,4800,9600,19200,38400,57600,115200].includes(cfg.serialBaudRate)) throw Error('Baud rate không hợp lệ');
  if (![7,8].includes(cfg.serialDataBits) || !['none','even','odd'].includes(cfg.serialParity) || ![1,2].includes(cfg.serialStopBits)) throw Error('Cấu hình RS232 không hợp lệ');
  if (!['0.0.0.0', '127.0.0.1'].includes(cfg.listenHost) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.listenHost)) throw Error('IP lắng nghe không hợp lệ');
  if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) throw Error('Port phải từ 1024 đến 65535');
  if (cfg.allowedScaleIp && !/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.allowedScaleIp)) throw Error('IP cân không hợp lệ');
  if (!['keyboard', 'api', 'both', 'none'].includes(cfg.outputMode)) throw Error('Chế độ đầu ra không hợp lệ');
  if (!['stable', 'hotkey'].includes(cfg.keyboardTrigger)) throw Error('Kiểu nhập không hợp lệ');
  for (const key of ['stableMs','resetBelowKg','minWeightKg','deltaKg','staleMs','apiMinIntervalMs']) {
    cfg[key] = Number(cfg[key]);
    if (!Number.isFinite(cfg[key]) || cfg[key] < 0) throw Error(`Giá trị ${key} không hợp lệ`);
  }
  if ((cfg.outputMode === 'api' || cfg.outputMode === 'both') && !/^https:\/\//i.test(cfg.apiUrl)) throw Error('API URL phải bắt đầu bằng https://');
  if (cfg.apiUrl && !/^https?:\/\//i.test(cfg.apiUrl)) throw Error('API URL không hợp lệ');
  if (!/^[\w-]{1,60}$/.test(cfg.scaleId)) throw Error('Mã cân chỉ chứa chữ, số, _ và -');
  cfg.autoEnter = Boolean(cfg.autoEnter); cfg.keyboardArmed = Boolean(cfg.keyboardArmed);
  cfg.startMinimized = Boolean(cfg.startMinimized);
  return cfg;
}
function load(userData) {
  try { return validate({...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(userData), 'utf8'))}); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Config invalid', e); return {...DEFAULTS}; }
}
function save(userData, cfg) {
  const verified = validate(cfg);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(configPath(userData), JSON.stringify(verified, null, 2), {mode:0o600});
  return verified;
}
module.exports = { DEFAULTS, load, save, validate };
