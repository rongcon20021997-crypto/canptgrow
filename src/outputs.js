const {typeWeight} = require('./keyboard');
class OutputManager {
  constructor(log, update) { this.log=log; this.update=update; this.config=null;this.candidate=null;this.lastAuto=null;this.readyForNew=true;this.lastApi=0;this.apiInProgress=false;this.lastApiError='';this.typeInProgress=false; }
  configure(config) {this.config=config;this.candidate=null;this.lastAuto=null;this.readyForNew=true;}
  onWeight(frame) {
    const c=this.config;
    if (!c) return;
    // Do not treat unsteady or overloaded messages as valid measurements.
    if (frame.kg <= c.resetBelowKg) {this.readyForNew=true;this.candidate=null;return;}
    if (!frame.stable || frame.kg < c.minWeightKg) {this.candidate=null;return;}
    if (!this.candidate || Math.abs(this.candidate.kg-frame.kg)>c.deltaKg) this.candidate={kg:frame.kg,startedAt:Date.now()};
    const stableLongEnough = Date.now()-this.candidate.startedAt >= c.stableMs;
    if (!stableLongEnough) return;
    if (['api','both'].includes(c.outputMode)) this.postApi(frame).catch(e=>this.log(`API: ${e.message}`));
    if (!['keyboard','both'].includes(c.outputMode) || !c.keyboardArmed || c.keyboardTrigger !== 'stable') return;
    // One keystroke per loaded object. Return scale near zero to rearm.
    if (this.readyForNew && !this.typeInProgress) {
      this.readyForNew=false;
      this.type(frame.kg).catch(e=>this.log(`Keyboard: ${e.message}`));
    }
  }
  async type(kg) {
    if (this.typeInProgress) return;
    this.typeInProgress=true;
    try { const s=await typeWeight(kg,this.config.autoEnter);this.log(`Đã gõ ${s} kg vào cửa sổ đang chọn`); }
    finally {this.typeInProgress=false;this.update();}
  }
  async hotkey(frame) {
    if (!this.config.keyboardArmed || !['keyboard','both'].includes(this.config.outputMode)) throw Error('Chưa bật Keyboard Output');
    if (!frame?.stable || Date.now()-frame.time>this.config.staleMs || frame.kg < this.config.minWeightKg) throw Error('Chưa có trọng lượng ổn định mới');
    await this.type(frame.kg);
  }
  async postApi(frame) {
    if (!this.config.apiUrl || this.apiInProgress || Date.now()-this.lastApi<this.config.apiMinIntervalMs) return;
    this.lastApi=Date.now();this.apiInProgress=true;
    const ctrl = new AbortController(); const timeout=setTimeout(()=>ctrl.abort(),4000);
    try {
      const response=await fetch(this.config.apiUrl,{
        method:'POST',signal:ctrl.signal,headers:{'Content-Type':'application/json',...(this.config.apiToken?{'Authorization':`Bearer ${this.config.apiToken}`}:{})},
        body:JSON.stringify({scale_id:this.config.scaleId,weight_kg:frame.kg,stable:true,weight_type:frame.kind,measured_at:new Date(frame.time).toISOString()})
      });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      this.lastApiError='';this.log(`Đã gửi API: ${frame.kg.toFixed(3)} kg`);
    } catch(e) {this.lastApiError=e.message; throw e;}
    finally {clearTimeout(timeout);this.apiInProgress=false;this.update();}
  }
}
module.exports={OutputManager};
