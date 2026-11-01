/* Ordered, observed-price conditions. No broker actions in this module. */
(function(root){
  'use strict';
  const rules={ZONE_ENTER:'Enters zone',ZONE_TOUCH:'Is in / touches zone',TRADED_ABOVE:'Trades above level',TRADED_BELOW:'Trades below level',SWEEP_ABOVE_REJECT:'Sweeps above, returns below',SWEEP_BELOW_RECLAIM:'Sweeps below, returns above',CLOSE_ABOVE:'Candle closes above',CLOSE_BELOW:'Candle closes below',CROSS_ABOVE:'First candle close above',CROSS_BELOW:'First candle close below',CLOSE_IN_ZONE:'Candle closes inside zone'};
  const frames=['M1','M5','M15','M30','H1','H4','D1'];
  const zone=r=>['ZONE_ENTER','ZONE_TOUCH','CLOSE_IN_ZONE'].includes(r);
  const candleOnly=r=>r.startsWith('CLOSE_')||r.startsWith('CROSS_');
  function fieldErrors(row){
    const errors={},positive=value=>Number.isFinite(value)&&value>0;
    if(!Object.hasOwn(rules,row.rule))errors.rule='Choose a valid rule.';
    if(!['LIVE','CANDLE'].includes(row.mode))errors.mode='Choose Live Bid or completed candles.';
    if(!frames.includes(row.timeframe))errors.timeframe='Choose a supported timeframe.';
    if(row.mode==='LIVE'&&typeof row.rule==='string'&&candleOnly(row.rule))errors.mode='This rule requires completed candles.';
    if(zone(row.rule)){
      if(!positive(row.low))errors.low='Enter a positive zone low.';
      if(!positive(row.high))errors.high='Enter a positive zone high.';
      if(positive(row.low)&&positive(row.high)&&row.low>=row.high){errors.low='Zone low must be below zone high.';errors.high='Zone high must be above zone low.';}
    }else if(!positive(row.level))errors.level='Enter a positive price level.';
    return errors;
  }
  function validate(rows){
    for(const [i,r] of rows.entries()){
      const errors=fieldErrors(r);if(Object.keys(errors).length)throw Error(`Condition ${i+1}: ${Object.values(errors)[0]}`);
    }
    return rows;
  }
  function matches(r,p,b,memory){
    if(r.mode==='LIVE'&&r.rule==='SWEEP_ABOVE_REJECT'){if(b.close>r.level)memory.above=true;return !!memory.above&&b.close<r.level;}
    if(r.mode==='LIVE'&&r.rule==='SWEEP_BELOW_RECLAIM'){if(b.close<r.level)memory.below=true;return !!memory.below&&b.close>r.level;}
    const overlaps=x=>x.low<=r.high&&x.high>=r.low;
    switch(r.rule){
      case 'ZONE_ENTER':return overlaps(b)&&!overlaps(p);
      case 'ZONE_TOUCH':return overlaps(b);
      case 'TRADED_ABOVE':return b.high>r.level;
      case 'TRADED_BELOW':return b.low<r.level;
      case 'SWEEP_ABOVE_REJECT':return b.high>r.level&&b.close<r.level;
      case 'SWEEP_BELOW_RECLAIM':return b.low<r.level&&b.close>r.level;
      case 'CLOSE_ABOVE':return b.close>r.level;
      case 'CLOSE_BELOW':return b.close<r.level;
      case 'CROSS_ABOVE':return p.close<=r.level&&b.close>r.level;
      case 'CROSS_BELOW':return p.close>=r.level&&b.close<r.level;
      case 'CLOSE_IN_ZONE':return b.close>=r.low&&b.close<=r.high;
      default:return false;
    }
  }
  class Sequence{
    constructor(rows,{timeout=0,gap=300}={}){this.rows=structuredClone(validate(rows));this.timeout=timeout;this.gap=gap;this.reset();this.done=!rows.length;}
    reset(){if(this.done)return;this.index=0;this.memory={};this.previous=null;this.lastTime=null;this.started=null;this.candle=null;this.done=false;}
    observe({bid,time,candles=[]}){
      this.events=[];
      if(this.done||!Number.isFinite(bid)||bid<=0||!Number.isFinite(time))return false;
      if(this.lastTime!==null&&time<=this.lastTime)return false;
      if(this.lastTime!==null&&this.gap>0&&time-this.lastTime>this.gap){const seconds=time-this.lastTime;this.reset();this.events.push({type:'reset',reason:'quote-gap',seconds});}
      if(this.started!==null&&this.timeout>0&&time-this.started>this.timeout){const seconds=time-this.started;this.reset();this.events.push({type:'reset',reason:'timeout',seconds});}
      this.lastTime=time;
      const r=this.rows[this.index];if(!r)return false;
      const latest=candles.at(-1);
      if(this.previous===null){this.previous=bid;this.candle=latest?.time??null;return false;}
      let p={low:this.previous,high:this.previous,close:this.previous},b={low:bid,high:bid,close:bid};this.previous=bid;
      if(r.mode==='CANDLE'){
        if(candles.length<2)return false;
        if(this.candle===null){this.candle=latest.time;return false;}
        if(latest.time<=this.candle)return false;
        this.candle=latest.time;[p,b]=candles.slice(-2);
      }
      if(!matches(r,p,b,this.memory))return false;
      if(this.index===0)this.started=time;
      this.events.push({type:'passed',index:this.index});
      this.index++;this.memory={};this.candle=null;
      this.done=this.index===this.rows.length;
      return this.done;
    }
  }
  const api={rules,frames,zone,candleOnly,fieldErrors,validate,matches,Sequence};
  if(typeof module==='object')module.exports=api;else root.TerminalConditions=api;
})(typeof window==='object'?window:globalThis);
