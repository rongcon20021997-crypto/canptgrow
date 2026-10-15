const form=document.querySelector('#settings');
const get=id=>document.getElementById(id);
let settingDirty=false;let initialized=false;let hiddenLog=false;
function setForm(c) {
  for(const [key,val] of Object.entries(c)){
    const el=form.elements.namedItem(key);
    if(!el)continue;
    if(el.type==='checkbox')el.checked=Boolean(val);else el.value=String(val??'');
  }
  get('keyboardArmed').checked=Boolean(c.keyboardArmed);
  updateSections();
  updateConnectionSections();
}
function updateSections(){
  const mode=form.elements.outputMode.value;
  get('keyboardSettings').hidden=!['keyboard','both'].includes(mode);
  get('apiSettings').hidden=!['api','both'].includes(mode);
}
function updateConnectionSections() {
  const serial=form.elements.connectionType.value==='serial';
  get('serialSettings').hidden=!serial;
  get('tcpSettings').hidden=serial;
}
async function refreshPorts() {
  try {
    const ports=await window.scaleBridge.listSerialPorts();
    if (ports.length) {
      get('portsInfo').textContent='Cổng tìm thấy: '+ports.map(p=>p.path+(p.friendlyName?' ('+p.friendlyName+')':p.manufacturer?' ('+p.manufacturer+')':'')).join(', ');
      // Nếu cổng hiện tại là COM1 mặc định mà có cổng USB mới (COM3, COM4...), gợi ý tự điền
      const usbPort = ports.find(p=>p.path!=='COM1');
      if (usbPort && (!form.elements.serialPath.value || form.elements.serialPath.value==='COM1')) {
        form.elements.serialPath.value = usbPort.path;
      }
    } else {
      get('portsInfo').textContent='Không tìm thấy COM Port. Kiểm tra cáp/driver USB-RS232.';
    }
  } catch(err) {get('portsInfo').textContent='Lỗi quét COM: '+err.message;}
}
get('refreshPorts').addEventListener('click',refreshPorts);
form.elements.connectionType.addEventListener('change',()=>{updateConnectionSections();if(form.elements.connectionType.value==='serial') refreshPorts();});
function display(s) {
  if(!s)return;
  if(!initialized){setForm(s.config);initialized=true;if(s.config.connectionType==='serial')refreshPorts();}
  const {connected,listening,latest,fresh}=s.state;
  if (s.state.type === 'serial') {
    if (fresh && latest) {
      get('connection').textContent = '● Cân đang truyền số';
      get('connection').className = 'pill online';
    } else if (listening) {
      get('connection').textContent = '● COM đã mở (chờ dữ liệu)';
      get('connection').className = 'pill waiting';
    } else {
      get('connection').textContent = '● Cổng COM chưa mở';
      get('connection').className = 'pill';
    }
  } else {
    get('connection').textContent = connected ? '● Cân đã kết nối' : (listening ? '● Đang chờ cân TCP' : '● Chưa mở kết nối');
    get('connection').className = 'pill' + (connected ? ' online' : (listening ? ' waiting' : ''));
  }
  get('weight').textContent=fresh&&latest?latest.kg.toFixed(3):'---.---';
  get('weight-status').textContent=latest?(latest.stable?'✓ Trọng lượng ổn định':'Đang dao động / quá tải'):'Chưa có dữ liệu mới từ cân';
  get('stable').textContent=latest?(latest.stable?'Ổn định':'Chưa ổn định'):'---';
  get('kind').textContent=latest?latest.kind:'---';
  get('scale-ip').textContent=latest?latest.sourceIp:'---';
  get('keyboardArmed').checked=Boolean(s.config.keyboardArmed);
  if(!hiddenLog){get('log').replaceChildren();for(const e of [...s.events].reverse()){
    const line=document.createElement('div');line.className='logline';
    const time=document.createElement('span');time.className='logtime';time.textContent=e.time;
    line.append(time,document.createTextNode(e.message));get('log').appendChild(line);
  }}
}
function collect(){
  const values={};
  const numericKeys = new Set(['serialBaudRate','serialDataBits','serialStopBits','port','stableMs','resetBelowKg','minWeightKg','deltaKg','staleMs','apiMinIntervalMs']);
  for(const el of form.elements){
    if(!el.name) continue;
    if(el.type==='checkbox') values[el.name]=el.checked;
    else if(el.type==='number' || numericKeys.has(el.name)) values[el.name]=Number(el.value);
    else values[el.name]=el.value.trim();
  }
  return values;
}
form.addEventListener('submit',async e=>{
  e.preventDefault(); const btn=form.querySelector('[type=submit]');btn.disabled=true;
  try{const result=await window.scaleBridge.saveConfig(collect());setForm(result.config);get('saveStatus').textContent='✓ Đã lưu cấu hình thành công';}
  catch(err){get('saveStatus').textContent='Lỗi: '+err.message;}
  finally{btn.disabled=false;}
});
form.elements.outputMode.addEventListener('change',updateSections);
get('keyboardArmed').addEventListener('change',async e=>{
  try {display(await window.scaleBridge.armKeyboard(e.target.checked));}
  catch(err){alert(err.message);}
});
get('delayType').addEventListener('click',async()=>{
  get('saveStatus').textContent='Chuyển sang Excel/Web và chọn ô trong 3 giây...';
  try {await window.scaleBridge.typeAfterDelay();get('saveStatus').textContent='Đã gửi trọng lượng';}
  catch(err){get('saveStatus').textContent=err.message;}
});
get('btnTestConnection').addEventListener('click', async () => {
  const btn = get('btnTestConnection');
  const box = get('testBox');
  const title = get('testTitle');
  const badge = get('testBadge');
  const msg = get('testMessage');
  const samplesBox = get('testSamplesContainer');
  const samplesPre = get('testSamplesPre');
  const suggList = get('testSuggestionsList');

  btn.disabled = true;
  btn.textContent = '⏳ Đang kiểm tra...';
  box.hidden = false;
  box.className = 'test-result-box';
  title.textContent = 'Đang kiểm tra kết nối...';
  badge.className = 'test-badge loading';
  badge.textContent = 'Đang lắng nghe...';
  msg.textContent = 'Đang mở cổng và lắng nghe tín hiệu từ cân trong 5 giây (hãy đặt hàng lên cân hoặc bấm nút Print)...';
  samplesBox.hidden = true;
  suggList.hidden = true;
  suggList.replaceChildren();

  try {
    const config = collect();
    const res = await window.scaleBridge.testConnection(config);

    badge.className = 'test-badge ' + (res.success ? 'success' : (res.bytesReceived > 0 ? 'warning' : 'error'));
    badge.textContent = res.success ? 'Thành công' : (res.bytesReceived > 0 ? 'Có byte lạ' : 'Không có tín hiệu');
    box.className = 'test-result-box ' + (res.success ? 'success' : (res.bytesReceived > 0 ? 'warning' : 'error'));
    title.textContent = res.success ? '✓ Kết nối cân thành công' : 'Kết quả kiểm tra';
    msg.textContent = res.message;

    if (res.rawSamples && res.rawSamples.length > 0) {
      samplesBox.hidden = false;
      samplesPre.textContent = res.rawSamples.join('\n');
    }

    if (res.suggestions && res.suggestions.length > 0) {
      suggList.hidden = false;
      for (const item of res.suggestions) {
        const li = document.createElement('li');
        li.textContent = item;
        suggList.appendChild(li);
      }
    }
  } catch (err) {
    badge.className = 'test-badge error';
    badge.textContent = 'Lỗi';
    box.className = 'test-result-box error';
    title.textContent = 'Lỗi khi kiểm tra';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Kiểm tra kết nối';
  }
});
get('clearLog').addEventListener('click',()=>{hiddenLog=true;get('log').replaceChildren();setTimeout(()=>hiddenLog=false,3000);});
window.scaleBridge.onUpdate(display);
window.scaleBridge.getState().then(display).catch(err=>{get('saveStatus').textContent=err.message;});
