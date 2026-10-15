const {app,BrowserWindow,ipcMain,globalShortcut,Tray,Menu,nativeImage} = require('electron');
const path = require('node:path');
const {load,save,validate} = require('./config');
const {ScaleReceiver} = require('./scale');
const {OutputManager} = require('./outputs');

let mainWindow, tray, config, quitting=false;
const receiver = new ScaleReceiver();
const history=[];
function log(msg) {const event={time:new Date().toLocaleTimeString('vi-VN'),message:msg};history.push(event);if(history.length>120)history.shift();publish();}
function snapshot() {return {config:{...config,apiToken:config.apiToken},state:receiver.status(),events:history.slice(-50),apiError:outputs.lastApiError};}
function publish(){if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send('scale:update',snapshot());}
const outputs=new OutputManager(log,publish);
receiver.on('event',log);
receiver.on('update',publish);
receiver.on('raw',raw=>{if(raw.trim()) log(`RAW: ${raw.slice(0,150)}`);});
receiver.on('weight',f=>{outputs.onWeight(f);publish();});
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (!globalShortcut.register('Control+Alt+W',()=>{
    outputs.hotkey(receiver.status().latest).catch(e=>log(`Phím tắt: ${e.message}`));
  })) log('Không đăng ký được Ctrl+Alt+W (bị ứng dụng khác dùng)');
}
async function applyConfig(next) {
  const previous=config; const valid=validate(next);
  // Restart TCP only when listening parameters change; on failure restore previous listener.
  const restart=!receiver.status().listening || !previous || ['connectionType','port','listenHost','allowedScaleIp','serialPath','serialBaudRate','serialDataBits','serialParity','serialStopBits'].some(key=>valid[key]!==previous[key]);
  if(restart) {
    try{await receiver.start(valid);}catch(e){ if(previous)await receiver.start(previous).catch(()=>{});throw e; }
  } else receiver.config=valid;
  config=save(app.getPath('userData'),valid);
  outputs.configure(config);
  registerHotkey();publish();return snapshot();
}
function buildWindow() {
  mainWindow = new BrowserWindow({width:970,height:790,minWidth:760,minHeight:630,
    title:'FOSO Scale Connector',backgroundColor:'#f4f8f6',show:!config.startMinimized,
    webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  mainWindow.loadFile(path.join(__dirname,'index.html'));
  mainWindow.on('close',e=>{if(!quitting){e.preventDefault();mainWindow.hide();}});
}
function createTray(){
  const icon=nativeImage.createFromPath(path.join(__dirname,'..','assets','icon.png'));
  tray=new Tray(icon);
  tray.setToolTip('FOSO Scale Connector');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'Mở FOSO Scale Connector',click:()=>mainWindow.show()},
    {label:'Tạm ngừng gõ bàn phím',click:()=>{config.keyboardArmed=false;save(app.getPath('userData'),config);publish();}},
    {type:'separator'}, {label:'Thoát',click:()=>{quitting=true;app.quit();}}
  ]));
  tray.on('double-click',()=>mainWindow.show());
}
app.whenReady().then(async()=>{
  config=load(app.getPath('userData'));
  // Always start disarmed after app launch (no accidental typing after reboot).
  config.keyboardArmed=false;
  outputs.configure(config);
  ipcMain.handle('get-state',()=>snapshot());
  ipcMain.handle('list-serial-ports',()=>ScaleReceiver.listSerialPorts());
  ipcMain.handle('save-config',(_event,next)=>applyConfig(next));
  ipcMain.handle('arm-keyboard',(_event,armed)=>{
    config.keyboardArmed=Boolean(armed);outputs.configure(config);publish();return snapshot();
  });
  ipcMain.handle('type-after-delay',async()=>{
    const f=receiver.status().latest;
    if(!f || !f.stable) throw Error('Chưa có số cân ổn định');
    // 3 seconds to focus target Excel/Web, then send keys.
    await new Promise(resolve=>setTimeout(resolve,3000));
    await outputs.hotkey(receiver.status().latest);return true;
  });
  ipcMain.handle('test-connection', async (_event, customConfig) => {
    if (customConfig) {
      try {
        await applyConfig(customConfig);
      } catch (e) {
        return {
          success: false,
          portOpen: false,
          bytesReceived: 0,
          rawSamples: [],
          message: `Không thể áp dụng cấu hình: ${e.message}`,
          suggestions: ['Kiểm tra cổng COM có tồn tại và chưa bị phần mềm khác sử dụng.']
        };
      }
    }
    return receiver.testConnection(4500);
  });
  buildWindow();createTray();registerHotkey();
  receiver.start(config).catch(e=>log(`Không mở được kết nối cân: ${e.message}`));
  setInterval(publish,1500);
});
app.on('before-quit',()=>{quitting=true;globalShortcut.unregisterAll();});
app.on('window-all-closed',()=>{});
