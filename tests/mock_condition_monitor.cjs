/* UI-only fake server. Production uses condition_monitor.py, tested independently. */
const C=require('../static/terminal-conditions.js');
exports.createMonitor=call=>{
 let run=null,sequence=null,generation=0,busy=false,revision=0;const ids=new Set();
 const event=(type,message)=>{run.events.push({id:revision++,type,message,at:Date.now()});run.events=run.events.slice(-100);};
 const snapshot=()=>({run:run?structuredClone({...run,revision,applied:{rows:sequence.rows,index:sequence.index,state:run.phase==='running'?'running':run.attempted?'finished':'stopped',settings:run.settings},structureState:sequence.structureState}):null});
 const finish=message=>{run.phase='finished';run.message=message;event('Finished',message);};
 const tick=async()=>{
  if(busy||!run)return;
  if(run.phase==='review'){if(Date.now()>run.review_expires*1000){run.review=null;finish('Finished: condition review expired.');}return;}
  if(run.phase!=='running')return;busy=true;const current=run;
  try{
   const step=sequence.rows[sequence.index],data=await call('/api/terminal/market',{symbol:run.symbol,timeframe:step?.mode==='CANDLE'?step.timeframe:'M1'});
   if(run!==current||run.phase!=='running')return;
   if(Date.now()/1000-data.quote_time>30)throw Error('Quote is stale.');
   const candles=step?.mode==='CANDLE'?data.bars.slice(0,-1).map(b=>({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4]})):[];
   const complete=sequence.done||sequence.observe({bid:data.bid,time:data.quote_time,candles});
   for(const e of sequence.events||[]){run.observations.push({...e,observed_at:Date.now(),quote_time:data.quote_time,bid:data.bid,candle:candles.at(-1)||null});if(e.type==='reset')event('Reset',e.reason==='quote-gap'?'without a fresh quote. Progress reset to step 1.':'Sequence timeout. Progress reset to step 1.');else{const r=run.rows[e.index];event('Step passed',`Step ${e.index+1}: ${C.rules[r.rule]} · ${e.structure?e.structure.level+' (BOS, swing '+e.structure.swing_time+')':r.level} · Bid ${data.bid}`);}}
   if(!complete){run.message=`Server monitoring · ${run.symbol} · step ${sequence.index+1} of ${sequence.rows.length}${sequence.structureState?' · '+sequence.structureState.status:''}. Continues while the browser is hidden.`;return;}
   run.attempted=true;run.phase='finishing';
   if(run.action==='ALERT'){finish('All conditions passed. Finished — click Start conditions to start again.');return;}
   const settings=run.settings,ticket=settings.ticket,plan=settings.autoPlan||{enabled:false};
   const body={symbol:run.symbol,side:ticket.side,order_kind:ticket['order-kind'],price:ticket['order-price'],volume:ticket.volume,sl:ticket.sl,tp:ticket.tp,condition_entry:true,condition_risk_auto:settings.sizing==='AUTO',expected_account:data.account,expected_server:data.server,condition_setup:{started:run.started,completed:Date.now(),action:run.action,rows:sequence.rows,settings,observations:run.observations,monitor:'local server'}};
   let result;
   if(plan.enabled){
    const market=await call('/api/terminal/market',{symbol:run.symbol,timeframe:plan.timeframe}),model=new C.Structure(plan.sensitivity);for(const b of market.bars.slice(0,-1))model.push({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4]});
    if(run!==current||run.phase!=='finishing')return;
    const swing=(body.side==='BUY'?model.lows:model.highs).at(-1);if(!swing||swing.broken)throw Error('A usable confirmed stop swing is unavailable.');
    const trigger=run.observations.findLast(e=>e.structure?.direction===(body.side==='BUY'?1:-1))?.structure;
    result=await call('/api/terminal/condition-plan',{...body,auto_plan:plan,stop_swing:{price:swing.price,time:swing.time,confirmed_time:swing.confirmed},retest_level:trigger?.level});
   }else{
    if(settings.sizing==='AUTO'){
     const entry=body.order_kind==='MARKET'?(body.side==='BUY'?data.ask:data.bid):Number(body.price),estimate=await call('/api/terminal/plan',{symbol:run.symbol,side:body.side,entry:entry+(body.side==='BUY'?1:-1)*20*(data.point||data.tick_size),stop:Number(body.sl),target:Number(body.tp),volume:data.volume_min});
     body.volume=Number((Math.floor(Math.min(data.volume_max,data.equity*.02/estimate.risk*data.volume_min)/data.volume_step)*data.volume_step).toFixed(8));
    }
    if(run!==current||run.phase!=='finishing')return;result=await call('/api/terminal/preview',body);
   }
   if(run!==current||run.phase!=='finishing')return;result.demo=data.demo;
   if(run.action==='REVIEW'){run.phase='review';run.review=result;run.review_expires=Date.now()/1000+result.expires_in;run.message='Conditions complete. Confirm the prepared order in Order. No order sent.';event('Review ready',run.message);return;}
   event('Order attempt','One submission');const sent=await call('/api/terminal/submit',{preview:result.preview});run.result=sent;finish(`Finished · broker ${sent.retcode}: ${sent.comment}. ${sent.journal_recorded?'Setup saved to journal.':''} No automatic retry.`);
  }catch(error){if(run===current){if(run.attempted)finish('Finished: '+error.message+' No automatic retry.');else{run.phase='stopped';run.message='Stopped: '+error.message;event('Stopped',run.message);}}}
  finally{busy=false;}
 };
 const timer=setInterval(tick,2000);timer.unref();
 return {
  async handle(endpoint,body){
   if(endpoint.endsWith('/start')){
    if(ids.has(body.request_id))return snapshot();ids.add(body.request_id);generation++;revision=0;
    sequence=new C.Sequence(body.rows,{timeout:Number(body.settings.timeout)*60,gap:Number(body.settings.gap)});
    run={id:'server-run-'+generation,generation,scope:JSON.stringify([body.expected_server,body.expected_account]),account:body.expected_account,server:body.expected_server,symbol:body.symbol,settings:structuredClone(body.settings),rows:sequence.rows,action:body.settings.action,phase:'running',attempted:false,started:Date.now(),events:[],observations:[],review:null,message:`Server monitoring · step ${sequence.rows.length?1:0} of ${sequence.rows.length}`};event('Started','Server monitor started');return snapshot();
   }
   if(endpoint.endsWith('/stop')&&run&&(!body.id||body.id===run.id)&&['running','review','finishing'].includes(run.phase)){run.phase='stopped';run.review=null;run.message=body.reason||'Stopped by user.';event('Stopped',run.message);}
   return snapshot();
  },
  submitted(body,result){if(run?.phase==='review'&&body.preview===run.review?.preview){run.review=null;finish('Finished · broker '+result.retcode);}},
  close(){clearInterval(timer);}
 };
};
