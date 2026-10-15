const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('scaleBridge',{
  getState:()=>ipcRenderer.invoke('get-state'),
  listSerialPorts:()=>ipcRenderer.invoke('list-serial-ports'),
  saveConfig:config=>ipcRenderer.invoke('save-config',config),
  armKeyboard:armed=>ipcRenderer.invoke('arm-keyboard',armed),
  typeAfterDelay:()=>ipcRenderer.invoke('type-after-delay'),
  testConnection:cfg=>ipcRenderer.invoke('test-connection',cfg),
  onUpdate:callback=>{const cb=(_e,v)=>callback(v);ipcRenderer.on('scale:update',cb);return()=>ipcRenderer.removeListener('scale:update',cb);}
});
