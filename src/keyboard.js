const {execFile} = require('node:child_process');

// Windows SendKeys: types a number into whichever application currently has keyboard focus.
// Intentionally never changes focus or launches Excel. Requires the user to arm output.
function typeWeight(kg, autoEnter) {
  return new Promise((resolve,reject) => {
    if (process.platform !== 'win32') return reject(new Error('Keyboard Output chỉ chạy trên Windows'));
    if (!Number.isFinite(kg) || kg < 0) return reject(new Error('Giá trị kg không hợp lệ'));
    const value = kg.toFixed(3);
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      `[System.Windows.Forms.SendKeys]::SendWait('${value}')`,
      ...(autoEnter ? ["[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"] : [])
    ].join('; ');
    const encoded = Buffer.from(script,'utf16le').toString('base64');
    execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],
      {timeout:5000,windowsHide:true},(err,stdout,stderr)=> err ? reject(new Error(stderr || err.message)):resolve(value));
  });
}
module.exports = {typeWeight};
