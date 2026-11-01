/* Trading workspace. All charts, drawings, settings and quotes stay local. */
(() => {
  'use strict';
  const el=name=>document.getElementById('terminal-'+name), A=window.TerminalAnalysis, L=window.LightweightCharts;
  if(!L||!A){el('status').textContent='Chart library did not load. Restart the app and refresh.';return;}
  const storageKey='tradetrace.terminal.v2';
  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}');if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};}catch(_){saved={};}
  const indicators=['sma','ema','bb','rsi','macd','volume-indicator'];
  let chart, main, overlays={}, primitive, priceLines=[], market=null, bars=[], symbols=[], quotes={}, scope='offline';
  let nextAutoConnect=0,autoReconnectBlocked=false;
  let loading=false, connecting=false, running=false, revision=0, ticketRevision=0, preview=null, submitting=false, reviewing=false, tool='cursor', pending=null, lastChartKey='', expiryTimer;
  let state={watch:[],drawings:{},alerts:[],views:{}};
  let orderDrag=null,editingPosition=null,editingOrder=null,draftPriceLines=[],draftSymbol='';
  const ticketHandleNodes=new Map(),brokerHandleNodes=new Map();
  let ticketDraftHidden=saved.ticketDraftHidden===true;
  let closeToken=null,closePosition=null,cancelOrder=null,closeOperation='close',closeRevision=0,closeLoading=false,closing=false,closeExpiryTimer;
  let selectedDrawing=-1,drawingDrag=null,selectedPriceLines=[];
  let ticketEstimate=null,ticketEstimateKey='',ticketEstimateContext='',ticketEstimateVersion=0,ticketEstimateTimer,ticketEstimateAt=0,ticketEstimatePending=false,ticketEstimateError='';
  let tradeTab='open',closedLoading=false,closedAt=0,closedScope='';
  let planEstimate=null,planEstimateKey='',planEstimateContext='',planEstimateRevision=0,planEstimateTimer,planEstimatePending=false,planEstimateAt=0;
  const workspaceKey=()=>JSON.stringify([scope,el('symbol').value,el('timeframe').value]);
  const drawingKey=()=>JSON.stringify([scope,el('symbol').value]);
  const status=message=>{el('status').textContent=message;};
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
  const safeList=value=>Array.isArray(value)?value:[];
  function persist(){
    saved.settings=layout();saved.workspaces={...(saved.workspaces||{}),[scope]:state};
    try{localStorage.setItem(storageKey,JSON.stringify(saved));el('save-state').textContent='Saved locally';}
    catch(_){el('save-state').textContent='Storage full or unavailable — changes are temporary';}
  }
  const panelDefaults={watch:190,ticket:260,activity:170};
  let panelSizes={...panelDefaults},panelDrag=null;
  for(const name of Object.keys(panelDefaults))if(Number.isFinite(saved.panelSizes?.[name]))panelSizes[name]=saved.panelSizes[name];
  const smallPanels=()=>matchMedia('(max-width:800px)').matches;
  function panelLimits(name){
    if(name==='activity')return [95,Math.max(95,Math.min(420,(el('pane').clientHeight||innerHeight-100)*.45))];
    return name==='watch'?[130,Math.max(130,Math.min(400,innerWidth*.28))]:[210,Math.max(210,Math.min(460,innerWidth*.35))];
  }
  function sizePanels(){
    for(const name of Object.keys(panelDefaults)){
      const [min,max]=panelLimits(name),size=Math.round(Math.max(min,Math.min(max,panelSizes[name])));
      el('pane').style.setProperty(name==='activity'?'--activity-height':`--${name}-width`,size+'px');
      const handle=el('resize-'+name);handle.setAttribute('aria-valuemin',Math.round(min));handle.setAttribute('aria-valuemax',Math.round(max));handle.setAttribute('aria-valuenow',size);
    }
    for(const [name,css] of [['watch','watch'],['ticket','ticket']])el('toggle-'+name).setAttribute('aria-expanded',String(smallPanels()?el('pane').classList.contains('mobile-'+css+'-open'):!el('pane').classList.contains(css+'-collapsed')));
  }
  function savePanels(){saved.panelSizes={...panelSizes};saved.panelCollapsed={watch:el('pane').classList.contains('watch-collapsed'),ticket:el('pane').classList.contains('ticket-collapsed')};persist();}
  for(const name of ['watch','ticket']){
    el('pane').classList.toggle(name+'-collapsed',saved.panelCollapsed?.[name]===true);
    el('toggle-'+name).onclick=()=>{const cls=smallPanels()?'mobile-'+name+'-open':name+'-collapsed';el('pane').classList.toggle(cls);if(smallPanels())el('pane').classList.remove('mobile-'+(name==='watch'?'ticket':'watch')+'-open');sizePanels();savePanels();};
  }
  for(const name of Object.keys(panelDefaults)){
    const handle=el('resize-'+name);
    handle.onpointerdown=event=>{if(event.button!==0)return;panelDrag={name,start:name==='activity'?event.clientY:event.clientX,value:Number(handle.getAttribute('aria-valuenow')),pointerId:event.pointerId};handle.setPointerCapture(event.pointerId);handle.classList.add('is-resizing');document.body.classList.add('terminal-resizing');document.body.style.cursor=name==='activity'?'row-resize':'col-resize';event.preventDefault();};
    handle.onpointermove=event=>{if(panelDrag?.name!==name)return;const delta=(name==='activity'?event.clientY:event.clientX)-panelDrag.start;const [min,max]=panelLimits(name);panelSizes[name]=Math.max(min,Math.min(max,panelDrag.value+(name==='watch'?delta:-delta)));sizePanels();};
    const finish=event=>{if(panelDrag?.name!==name)return;if(event.type==='pointercancel')panelSizes[name]=panelDrag.value;panelDrag=null;handle.classList.remove('is-resizing');document.body.classList.remove('terminal-resizing');document.body.style.cursor='';if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);sizePanels();savePanels();};
    handle.onpointerup=finish;handle.onpointercancel=finish;
    handle.ondblclick=()=>{panelSizes[name]=panelDefaults[name];sizePanels();savePanels();};
    handle.onkeydown=event=>{const vertical=name!=='activity';if(!(vertical?['ArrowLeft','ArrowRight','Home','End']:['ArrowUp','ArrowDown','Home','End']).includes(event.key))return;event.preventDefault();const [min,max]=panelLimits(name);panelSizes[name]=event.key==='Home'?min:event.key==='End'?max:Number(handle.getAttribute('aria-valuenow'))+((event.key==='ArrowRight'&&name==='watch')||((event.key==='ArrowLeft'||event.key==='ArrowUp')&&name!=='watch')?10:-10);sizePanels();savePanels();};
  }
  new ResizeObserver(()=>{if(!el('pane').hidden)sizePanels();}).observe(el('pane'));
  window.addEventListener('resize',sizePanels);sizePanels();
  function layout(){return {symbol:el('symbol').value,timeframe:el('timeframe').value,style:el('style').value,indicators:Object.fromEntries(indicators.map(name=>[name,el(name).checked]))};}
  function applyLayout(value){
    if(!value||typeof value!=='object')return;
    if(symbols.includes(value.symbol))el('symbol').value=value.symbol;
    if(validInterval(value.timeframe)){if(![...el('timeframe').options].some(o=>o.value===value.timeframe))el('timeframe').append(new Option(intervalName(value.timeframe),value.timeframe));el('timeframe').value=value.timeframe;}
    renderIntervals();
    if(['candles','line'].includes(value.style))el('style').value=value.style;
    for(const name of indicators)if(typeof value.indicators?.[name]==='boolean')el(name).checked=value.indicators[name];
  }
  const intervalLimits={S:60,M:1440,H:168,D:365,W:52,MN:12};
  const intervalUnits={S:['Seconds','second','s',1],M:['Minutes','minute','m',60],H:['Hours','hour','h',3600],D:['Days','day','D',86400],W:['Weeks','week','W',604800],MN:['Months','month','M',2629800]};
  const validInterval=code=>{const match=/^(MN|S|M|H|D|W)([1-9][0-9]{0,3})$/.exec(code||'');return match&&Number(match[2])<=intervalLimits[match[1]];};
  const intervalParts=code=>/^(MN|S|M|H|D|W)([1-9][0-9]*)$/.exec(code);
  const intervalLabel=code=>{const [,unit,n]=intervalParts(code);return n==='1'&&['D','W','MN'].includes(unit)?intervalUnits[unit][2]:n+intervalUnits[unit][2];};
  const intervalName=code=>{const [,unit,n]=intervalParts(code);return `${n} ${intervalUnits[unit][1]}${n==='1'?'':'s'}`;};
  const intervalDefaults={S:[1,5,10,15,30,45],M:[1,2,3,4,5,6,10,12,15,20,30,45],H:[1,2,3,4,6,8,12],D:[1],W:[1],MN:[1,3,6,12]};
  let customIntervals=safeList(saved.customIntervals).filter(validInterval),favoriteIntervals=safeList(saved.favoriteIntervals||['M1','M5','M15','M30','H1','H4','D1','W1']).filter(validInterval);
  function renderIntervals(){
    const current=el('timeframe').value||'M5';
    const codes=[...new Set([...Object.entries(intervalDefaults).flatMap(([unit,counts])=>counts.map(n=>unit+n)),...customIntervals,...(validInterval(current)?[current]:[])])];
    el('timeframe').replaceChildren(...codes.map(code=>new Option(intervalName(code),code)));el('timeframe').value=current;
    const buttonFor=code=>{const button=text('button',intervalLabel(code));button.type='button';button.dataset.interval=code;button.title=intervalName(code);button.classList.toggle('selected',current===code);button.setAttribute('aria-pressed',String(current===code));button.onclick=()=>chooseInterval(code);return button;};
    el('interval-favorites').replaceChildren(...[...new Set([...favoriteIntervals,...(!favoriteIntervals.includes(current)?[current]:[])])].map(buttonFor));
    el('interval-groups').replaceChildren(...Object.entries(intervalUnits).map(([unit,info])=>{
      const group=document.createElement('details');group.open=true;const title=text('summary',info[0].toUpperCase());group.append(title);
      const selectedCodes=codes.filter(code=>intervalParts(code)[1]===unit).sort((a,b)=>Number(intervalParts(a)[2])-Number(intervalParts(b)[2]));
      for(const code of selectedCodes){const row=text('div','','terminal-interval-row'),button=buttonFor(code);button.textContent=intervalName(code);const star=text('button',favoriteIntervals.includes(code)?'★':'☆','terminal-interval-star');star.type='button';star.title=(favoriteIntervals.includes(code)?'Unpin ':'Pin ')+intervalName(code);star.setAttribute('aria-label',star.title);star.setAttribute('aria-pressed',String(favoriteIntervals.includes(code)));star.onclick=()=>{if(favoriteIntervals.includes(code))favoriteIntervals=favoriteIntervals.filter(v=>v!==code);else if(favoriteIntervals.length<16)favoriteIntervals.push(code);else{el('custom-error').textContent='You can pin up to 16 favorite intervals.';return;}saved.favoriteIntervals=favoriteIntervals;persist();renderIntervals();};row.append(button,star);group.append(row);}return group;
    }));
  }
  function chooseInterval(code){
    if(!validInterval(code))return;if(![...el('timeframe').options].some(o=>o.value===code))el('timeframe').append(new Option(intervalName(code),code));
    el('timeframe').value=code;el('interval-menu').open=false;renderIntervals();selectionChanged();chart?.applyOptions({timeScale:{secondsVisible:code.startsWith('S'),timeVisible:!code.startsWith('MN')&&!code.startsWith('W')&&!code.startsWith('D')}});
  }
  el('custom-toggle').onclick=()=>{el('custom-interval').hidden=!el('custom-interval').hidden;};
  el('custom-unit').onchange=()=>{el('custom-count').max=intervalLimits[el('custom-unit').value];};
  el('custom-interval').onsubmit=event=>{event.preventDefault();const code=el('custom-unit').value+el('custom-count').value;if(!validInterval(code)){el('custom-error').textContent='Enter a whole interval within the selected unit’s limit.';return;}if(customIntervals.length>=30&&!customIntervals.includes(code)){el('custom-error').textContent='Maximum 30 custom intervals.';return;}if(!customIntervals.includes(code))customIntervals.push(code);saved.customIntervals=customIntervals;el('custom-error').textContent='';chooseInterval(code);};
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.terminal-interval-picker'))el('interval-menu').open=false;});
  el('interval-menu').addEventListener('keydown',event=>{if(event.key==='Escape'){el('interval-menu').open=false;event.stopPropagation();}});
  renderIntervals();
  applyLayout(saved.settings);
  function invalidate(clear=true){ticketRevision++;preview=null;clearTimeout(expiryTimer);el('submit').hidden=true;if(clear)el('order-summary').replaceChildren();updateTicket();}
  function updateTicket(){
    const fresh=market&&Date.now()/1000-market.quote_time<=30&&market.quote_time<=Date.now()/1000+5;
    el('preview').disabled=!market?.demo||!fresh||submitting||reviewing||closing||(autoDraftSizing()&&(!ticketEstimate?.auto_volume||ticketEstimate.key!==ticketEstimateKey||!!ticketEstimateError));
    el('alert-add').disabled=!market;
  }
  function cancelClose(hide=true){
    closeRevision++;clearTimeout(closeExpiryTimer);closeToken=null;closePosition=null;cancelOrder=null;closeLoading=false;el('close-confirm').hidden=true;
    if(hide)el('close-review').hidden=true;
  }
  function updateCloseButtons(){document.querySelectorAll('.terminal-close-action,.terminal-cancel-action').forEach(button=>button.disabled=!market?.demo||closing||closeLoading||submitting);}
  async function reviewClose(position){
    if(closing||closeLoading||submitting)return;cancelClose();closeOperation='close';el('close-heading').textContent='Close position · demo';el('close-confirm').textContent='Confirm close entire position';closeLoading=true;closePosition={...position};const version=closeRevision;
    el('close-review').hidden=false;el('close-summary').textContent=`Review closing #${position.ticket} · ${position.symbol} · ${position.type===0?'BUY':'SELL'} · entire ${position.volume} lots.`;
    el('close-status').textContent='Checking the position and current broker quote…';el('close-cancel').disabled=false;el('close-cancel').textContent='Cancel';updateCloseButtons();
    try{
      const result=await call('terminal/close-preview',{position:position.ticket});if(version!==closeRevision)return;
      closeToken=result.preview;const r=result.request;
      el('close-summary').textContent=`DEMO ${result.account} / ${result.server} · Close #${r.position} · ${r.symbol} · entire ${r.volume} lots at market (current closing quote ${r.price}).`;
      el('close-status').textContent='Execution price can change. This review expires in 60 seconds.';el('close-confirm').hidden=false;
      closeExpiryTimer=setTimeout(()=>{if(closeToken===result.preview){cancelClose(false);el('close-status').textContent='Review expired. Select Close on the position again.';}},result.expires_in*1000);
    }catch(error){if(version===closeRevision)el('close-status').textContent=error.message;}
    finally{if(version===closeRevision){closeLoading=false;updateCloseButtons();}}
  }
  async function reviewCancel(order){
    if(closing||closeLoading||submitting)return;cancelClose();closeOperation='cancel';cancelOrder={...order};closeLoading=true;const version=closeRevision;
    el('close-review').hidden=false;el('close-review').scrollIntoView({block:'nearest'});el('close-heading').textContent='Cancel pending order · demo';el('close-confirm').textContent='Confirm cancel pending order';el('close-cancel').textContent='Go back';el('close-cancel').disabled=false;
    el('close-summary').textContent=`Cancel pending #${order.ticket} · ${order.symbol} · ${order.volume} lots at ${order.price}.`;
    el('close-status').textContent='Checking the order is still pending…';updateCloseButtons();
    try{const result=await call('terminal/cancel-preview',{order:order.ticket});if(version!==closeRevision)return;closeToken=result.preview;
      el('close-summary').textContent=`DEMO ${result.account} / ${result.server} · Cancel pending #${result.request.order} · ${result.request.symbol}.`;
      el('close-status').textContent='The order may fill before cancellation reaches the broker. Review expires in 60 seconds.';el('close-confirm').hidden=false;
      closeExpiryTimer=setTimeout(()=>{if(closeToken===result.preview){cancelClose(false);el('close-status').textContent='Cancellation review expired. Review the pending order again.';}},result.expires_in*1000);
    }catch(error){if(version===closeRevision)el('close-status').textContent=error.message;}finally{if(version===closeRevision){closeLoading=false;updateCloseButtons();}}
  }
  el('close-cancel').onclick=()=>{if(!closing){cancelClose();updateCloseButtons();}};
  el('close-confirm').onclick=async()=>{
    if(!closeToken||closing||submitting)return;const token=closeToken,operation=closeOperation;closeToken=null;clearTimeout(closeExpiryTimer);closing=true;el('close-confirm').hidden=true;el('close-cancel').disabled=true;updateCloseButtons();updateTicket();
    el('close-status').textContent=operation==='cancel'?'Submitting cancellation once. Wait for the broker result.':'Submitting closure once. Wait for the broker result; do not retry automatically.';
    try{
      const result=await call('terminal/submit',{preview:token});
      const remaining=Number.isFinite(result.remaining_volume)?` Remaining open volume: ${result.remaining_volume} lots.`:' Remaining volume not yet verified.';
      el('close-status').textContent=operation==='cancel'?`Broker result ${result.retcode}: ${result.comment}. Check pending orders and open positions for final cancellation status. ${result.message}`:`Broker result ${result.retcode}: ${result.comment}. Executed ${result.volume} lots at ${result.price}. Order ${result.order}, deal ${result.deal}.${remaining} ${result.message}`;
    }catch(error){el('close-status').textContent=error.message+' Check MT5 positions and history before trying another close.';}
    finally{closing=false;closePosition=null;cancelOrder=null;el('close-cancel').disabled=false;el('close-cancel').textContent='Dismiss';updateCloseButtons();updateTicket();refresh();}
  };
  async function call(route,body={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{const response=await fetch('/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Replay-Token':document.querySelector('meta[name="replay-token"]').content},body:JSON.stringify(body),signal:controller.signal});
      const value=await response.json();if(!response.ok)throw Error(value.error||'Request failed');return value;
    }catch(error){if(error.name==='AbortError')throw Error('Request timed out. For order submission, check MT5 positions/history before retrying.');throw error;}finally{clearTimeout(timeout);}
  }
  function inferredKind(){
    if(el('order-kind').value==='MARKET')return 'MARKET';
    const price=Number(el('order-price').value),side=el('side').value,quote=side==='BUY'?market?.ask:market?.bid;
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(quote)||price===quote)return null;
    return side==='BUY'?(price<quote?'LIMIT':'STOP'):(price>quote?'LIMIT':'STOP');
  }
  const entryReference=()=>editingPosition?editingPosition.price_open:el('order-kind').value==='MARKET'?(el('side').value==='BUY'?market?.ask:market?.bid):Number(el('order-price').value);
  function seedPendingEntry(){
    if(!market||el('order-kind').value==='MARKET'||Number(el('order-price').value)>0)return;
    const side=el('side').value,quote=side==='BUY'?market.ask:market.bid,gap=Math.max(market.stops_distance||0,(market.tick_size||10**-market.digits)*2);
    el('order-price').value=planPrice(quote+(side==='BUY'?1:-1)*gap).toFixed(market.digits);
  }
  function draftLevels(){
    if(ticketDraftHidden||!market||!main||!el('show-ticket').checked)return [];
    return [{field:'order-price',title:el('order-kind').value==='MARKET'?'Market entry':'Draft entry',color:'#e4bd70'}, {field:'sl',title:'Stop loss',color:'#ef7385'},{field:'tp',title:'Take profit',color:'#43c9a0'}].flatMap(level=>{
      const price=level.field==='order-price'?entryReference():Number(el(level.field).value);
      return Number.isFinite(price)&&price>0?[{...level,price,y:main.priceToCoordinate(price)}]:[];
    });
  }
  function dragProtectionPrice(field,price){
    if(field==='order-price')return planPrice(price);
    const reference=el('order-kind').value==='MARKET'?(el('side').value==='BUY'?market.bid:market.ask):entryReference();
    const tick=market.tick_size||10**-market.digits,gap=Math.max(market.stops_distance||0,tick)+tick;
    const below=el('side').value==='BUY'?field==='sl':field==='tp';
    return planPrice(Math.max(tick,below?Math.min(price,reference-gap):Math.max(price,reference+gap)));
  }
  function startTicketDrag(event,field,addY=null){
    if(!market||submitting||closing||event.button!==0||(editingPosition&&field==='order-price'))return;
    const original=el(field).value,originalMode=el('order-kind').value;
    if(field==='order-price'&&originalMode==='MARKET'){el('order-kind').value='PENDING';el('order-price').value='';seedPendingEntry();}
    if(addY!==null){const price=main.coordinateToPrice(addY);if(price>0)el(field).value=dragProtectionPrice(field,price).toFixed(market.digits);}
    selectDrawing(-1);invalidate();orderDrag={field,original,originalMode,pointerId:event.pointerId};ticketDraftHidden=false;saved.ticketDraftHidden=false;el('chart').focus({preventScroll:true});el('chart').setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();updateOrderHint();syncDraftLines();
  }
  function dismissTicketDraft(){
    finishOrderDrag(true);const wasEditing=!!(editingOrder||editingPosition);if(wasEditing)endOrderEdit();
    for(const field of ['order-price','sl','tp'])el(field).value='';
    ticketDraftHidden=true;saved.ticketDraftHidden=true;invalidate();updateOrderHint();syncDraftLines();persist();
    if(wasEditing)el('order-summary').textContent='Amendment discarded. The broker order was not changed.';
  }
  function renderBrokerHandles(size){
    const items=[];
    if(market&&bars.length){
      for(const position of market.positions||[])if(position.symbol===el('symbol').value)items.push({key:'position:'+position.ticket,kind:'position',item:position,price:position.price_open,color:'#78a7ff'});
      for(const order of market.orders||[])if(order.symbol===el('symbol').value)items.push({key:'order:'+order.ticket,kind:'order',item:order,price:order.price,color:'#e4bd70'});
    }
    const keep=new Set(items.map(item=>item.key));for(const [key,node] of brokerHandleNodes)if(!keep.has(key)){node.remove();brokerHandleNodes.delete(key);}
    const placed=[];
    for(const entry of items){
      const y=main.priceToCoordinate(entry.price);if(!Number.isFinite(y))continue;
      let top=Math.max(0,Math.min(size.height-25,y-12));while(placed.some(p=>Math.abs(p-top)<27)&&top+27<size.height-25)top+=27;placed.push(top);
      let node=brokerHandleNodes.get(entry.key);
      if(!node){node=document.createElement('div');node.className='terminal-broker-label';const label=text('span',''),button=text('button','×');button.type='button';button.onclick=()=>node._kind==='position'?reviewClose(node._item):reviewCancel(node._item);node.append(label,button);el('ticket-handles').append(node);brokerHandleNodes.set(entry.key,node);}
      node._kind=entry.kind;node._item=entry.item;node.style.setProperty('--level-color',entry.color);node.style.top=top+'px';node.style.left='10px';
      const outside=y<0?'↑ ':y>size.height?'↓ ':'';
      node.firstChild.textContent=entry.kind==='position'?`${outside}#${entry.item.ticket} · ${entry.item.volume} · ${entry.item.profit>=0?'+':''}${Number(entry.item.profit).toFixed(2)} ${market.currency}`:`${outside}Pending #${entry.item.ticket} · ${entry.item.volume}`;
      node.firstChild.onclick=()=>entry.kind==='position'?beginPositionEdit(node._item):beginOrderEdit(node._item);node.firstChild.style.cursor='pointer';node.firstChild.tabIndex=0;node.firstChild.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();node.firstChild.click();}};node.firstChild.setAttribute('role','button');
      node.firstChild.title=`Click to edit · ${entry.kind==='position'?'Open position':'Broker pending order'} · entry ${entry.price}`;
      const button=node.lastChild;button.disabled=!market.demo||closing||closeLoading||submitting;
      if(entry.kind==='position'){button.dataset.chartClose=entry.item.ticket;delete button.dataset.chartCancel;button.title='Close position';button.setAttribute('aria-label','Close position '+entry.item.ticket);}else{button.dataset.chartCancel=entry.item.ticket;delete button.dataset.chartClose;button.title='Cancel pending order';button.setAttribute('aria-label','Cancel pending order '+entry.item.ticket);}
    }
  }
  function renderTicketHandles(size){
    const levels=draftLevels(),entry=levels.find(level=>level.field==='order-price'),items=[];
    if(entry&&Number.isFinite(entry.y)){
      const left=Math.max(44,Math.min(size.width-174,size.width*.65)),clampY=y=>Math.max(0,Math.min(size.height-26,y-12));
      for(const level of levels)if(Number.isFinite(level.y)&&(editingPosition||(level.y>=0&&level.y<=size.height)))items.push({...level,left,top:clampY(level.y),add:false});
      if(editingPosition||(entry.y>=0&&entry.y<=size.height))for(const [field,label,color] of [['sl','SL','#ef7385'],['tp','TP','#43c9a0']])if(!Number(el(field).value)){
        const below=el('side').value==='BUY'?field==='sl':field==='tp',y=Math.max(15,Math.min(size.height-15,Math.max(45,Math.min(size.height-45,entry.y))+(below?34:-34)));
        items.push({field,title:label,color,left:left-38,top:clampY(y),add:true,addY:y});
      }
    }
    const labels=items.filter(item=>!item.add).sort((a,b)=>a.top-b.top);for(let i=1;i<labels.length;i++)labels[i].top=Math.max(labels[i].top,labels[i-1].top+28);for(let i=labels.length-1;i>=0;i--)labels[i].top=Math.min(labels[i].top,size.height-26-(labels.length-1-i)*28);
    const keys=new Set(items.map(item=>item.field));for(const [key,node] of ticketHandleNodes)if(!keys.has(key)){node.remove();ticketHandleNodes.delete(key);}
    for(const item of items){
      let node=ticketHandleNodes.get(item.field);
      if(!node){node=document.createElement('div');const grip=text('button','');grip.type='button';grip.dataset.ticketGrip=item.field;grip.onpointerdown=event=>startTicketDrag(event,item.field,node._addY);node.append(grip);const remove=text('button','×');remove.type='button';remove.dataset.ticketRemove=item.field;remove.onclick=()=>{if(item.field==='order-price'){dismissTicketDraft();return;}el(item.field).value='';updateOrderKind();};node.append(remove);el('ticket-handles').append(node);ticketHandleNodes.set(item.field,node);}
      node._addY=item.add?item.addY:null;node.className='terminal-ticket-handle'+(item.add?' is-adder':'');node.style.setProperty('--level-color',item.color);node.style.top=item.top+'px';
      const grip=node.firstChild,price=Number.isFinite(item.price)?item.price.toFixed(market.digits):'';
      const sizing=autoDraftSizing()?(ticketEstimateError?'2% equity · '+ticketEstimateError:!Number(el('sl').value)?'2% equity · add SL':ticketEstimate?.auto_volume?`${ticketEstimate.auto_volume} lots · 2% equity`:'2% equity · sizing…'):`${el('volume').value||'0'} lots`;
      grip.disabled=!!editingPosition&&item.field==='order-price';
      let label=item.add?item.title:item.field==='order-price'?`${el('side').value} ${el('order-kind').value==='MARKET'?'Market':inferredKind()||'Pending'} @ ${price} · ${sizing}`:`${item.title} @ ${price}`;
      if(!item.add&&item.field!=='order-price'&&Number.isFinite(ticketEstimate?.[item.field])&&!(autoDraftSizing()&&ticketEstimateError))label=`${item.field.toUpperCase()} @ ${price} · ${estimateMoney(ticketEstimate[item.field],ticketEstimate.currency)}`;
      if(grip.textContent!==label)grip.textContent=label;
      grip.title=item.add?'Drag to add '+(item.field==='sl'?'stop loss':'take profit'):'Drag to change '+item.title.toLowerCase();grip.dataset.ticketAdd=item.add?item.field:'';if(!item.add&&item.field!=='order-price')grip.title+=` · Price ${item.price.toFixed(market.digits)} · Estimated gross P/L; excludes fees${ticketEstimate?.key!==ticketEstimateKey?' · Updating estimate':''}`;
      if(!item.add&&item.field==='order-price'&&autoDraftSizing()&&ticketEstimateError)grip.title+=' · '+ticketEstimateError;
      node.lastChild.hidden=item.add;node.lastChild.title=item.field==='order-price'?'Dismiss draft (no broker order changed)':'Remove '+(item.field==='sl'?'stop loss':'take profit');node.lastChild.setAttribute('aria-label',item.field==='order-price'?'Dismiss order draft':'Remove '+(item.field==='sl'?'stop loss':'take profit'));
      node.style.left=Math.max(0,Math.min(item.left,size.width-node.offsetWidth-4))+'px';
    }
  }
  function autoDraftSizing(){return el('condition-sizing')?.value==='AUTO'&&!editingPosition&&!editingOrder;}
  function draftEstimateBody(){
    if(!market||ticketDraftHidden||!el('show-ticket').checked)return null;
    const body={symbol:el('symbol').value,side:el('side').value,entry:entryReference(),volume:Number(el('volume').value),sl:Number(el('sl').value),tp:Number(el('tp').value)};
    if(autoDraftSizing()){body.risk_auto=true;body.volume=market.volume_min;body.equity=market.equity;if(!body.sl)return null;}
    return Object.values(body).filter(v=>typeof v==='number').every(Number.isFinite)&&body.entry>0&&body.volume>0&&body.sl>=0&&body.tp>=0&&(body.sl||body.tp)?body:null;
  }
  function estimateMoney(value,currency){return `${value>=0?'+':'−'}${Math.abs(value).toFixed(2)} ${currency}`;}
  function renderTicketEstimate(){
    const body=draftEstimateBody(),node=el('ticket-estimate');node.hidden=!body&&!autoDraftSizing();
    const show=message=>{if(node.textContent!==message)node.textContent=message;};
    if(!body){show(autoDraftSizing()?'2% equity sizing: add a valid stop loss to calculate lots.':'');return;}
    if(body.risk_auto&&ticketEstimateError){show(`2% equity: ${ticketEstimateError} No valid automatic lot size for this draft.`);return;}
    const stale=ticketEstimate&&ticketEstimate.key!==ticketEstimateKey;
    const parts=['tp','sl'].filter(field=>body[field]>0).map(field=>{
      const value=ticketEstimate?.[field];return `${field.toUpperCase()}: ${Number.isFinite(value)?estimateMoney(value,ticketEstimate.currency):'unavailable'}`;
    });
    const sizing=body.risk_auto&&ticketEstimate?.auto_volume?`2% equity · ${ticketEstimate.auto_volume} lots · Budget ${ticketEstimate.risk_budget.toFixed(2)} ${ticketEstimate.currency} · Modeled risk ${ticketEstimate.modeled_risk.toFixed(2)} ${ticketEstimate.currency}. `:'';
    node.title=stale?'Updating · showing the last completed estimate':'';
    show(ticketEstimate?`${sizing}Est. ${parts.join(' · ')}${ticketEstimateError?' · '+ticketEstimateError+' (previous estimate)':''}. Excludes commission, swap and slippage.`:ticketEstimateError||'Estimating SL / TP amounts…');
  }
  function queueTicketEstimate(){
    const automatic=autoDraftSizing();el('volume').disabled=automatic||!!editingPosition||!!editingOrder;
    for(const name of ['volume-down','volume-up'])el(name).disabled=automatic||!!editingPosition||!!editingOrder;
    const body=draftEstimateBody(),context=JSON.stringify([scope,body?.symbol,body?.side,editingPosition?.ticket||editingOrder?.ticket||'draft']);
    if(context!==ticketEstimateContext||!body){clearTimeout(ticketEstimateTimer);ticketEstimateVersion++;ticketEstimate=null;ticketEstimateKey='';ticketEstimateAt=0;ticketEstimatePending=false;ticketEstimateError='';ticketEstimateContext=context;}
    if(!body){renderTicketEstimate();updateTicket();return;}
    const key=JSON.stringify([scope,body]);
    const unchanged=key===ticketEstimateKey;ticketEstimateKey=key;
    if(ticketEstimatePending||(unchanged&&Date.now()-ticketEstimateAt<15000)){renderTicketEstimate();return;}
    ticketEstimatePending=true;const version=ticketEstimateVersion;renderTicketEstimate();
    // Sample the latest pointer position at a bounded rate. New pointer moves
    // never postpone the timer or discard a completed sample during a drag.
    ticketEstimateTimer=setTimeout(async()=>{
      const sample=draftEstimateBody();if(version!==ticketEstimateVersion||!sample)return;
      const sampleKey=JSON.stringify([scope,sample]);
      try{
        let sizing={};
        if(sample.risk_auto){
          const direction=sample.side==='BUY'?1:-1;
          if(direction*(sample.entry-sample.sl)<=0)throw Error('Stop loss must be on the correct side of entry for 2% sizing.');
          const adverse=sample.entry+direction*20*(market.point||market.tick_size);
          const basis=await call('terminal/estimate',{...sample,entry:adverse,tp:0});
          if(version!==ticketEstimateVersion)return;
          if(JSON.stringify([basis.server,basis.account])!==scope)throw Error('Account changed. Reconnect MT5.');
          const loss=-basis.sl,budget=sample.equity*.02;
          if(!Number.isFinite(loss)||loss<=0||!Number.isFinite(budget)||budget<=0)throw Error('Broker risk estimate unavailable.');
          const volume=Number((Math.floor(Math.min(market.volume_max,budget/loss*sample.volume)/market.volume_step)*market.volume_step).toFixed(8));
          if(volume<market.volume_min)throw Error(`Minimum ${market.volume_min} lots risks ${loss.toFixed(2)} ${basis.currency}; 2% budget is ${budget.toFixed(2)} ${basis.currency}.`);
          sizing={auto_volume:volume,risk_budget:budget,modeled_risk:loss*volume/sample.volume};
        }
        const result=await call('terminal/estimate',{...sample,volume:sizing.auto_volume||sample.volume});if(version!==ticketEstimateVersion)return;
        if(JSON.stringify([result.server,result.account])!==scope)throw Error('Account changed. Reconnect MT5.');
        ticketEstimate={...result,...sizing,key:sampleKey};ticketEstimateAt=Date.now();ticketEstimatePending=false;ticketEstimateError='';
        if(sizing.auto_volume&&sampleKey===ticketEstimateKey&&Number(el('volume').value)!==sizing.auto_volume){el('volume').value=sizing.auto_volume;invalidate(false);}
      }catch(error){if(version!==ticketEstimateVersion)return;ticketEstimatePending=false;ticketEstimateAt=Date.now();ticketEstimateError=error.message;}
      renderTicketEstimate();renderTicketHandles(chart.paneSize(0));primitive?.update();updateTicket();
      if(sampleKey!==ticketEstimateKey){ticketEstimateAt=0;queueTicketEstimate();}
    },orderDrag?100:250);
  }
  function syncDraftLines(){
    queueTicketEstimate();if(!main)return;
    const levels=draftLevels();while(draftPriceLines.length>levels.length)main.removePriceLine(draftPriceLines.pop());
    levels.forEach((level,i)=>{const options={price:level.price,color:level.color,title:level.title,axisLabelVisible:true,lineVisible:true,lineWidth:2,lineStyle:L.LineStyle.Dashed};if(draftPriceLines[i])draftPriceLines[i].applyOptions(options);else draftPriceLines.push(main.createPriceLine(options));});renderTicketHandles(chart.paneSize(0));primitive?.update();
  }
  function draftLevelHit(p){const levels=draftLevels();return levels.filter(level=>(!editingPosition||level.field!=='order-price')&&Number.isFinite(level.y)&&Math.abs(level.y-p.y)<=7).sort((a,b)=>Math.abs(a.y-p.y)-Math.abs(b.y-p.y))[0]||null;}
  function pendingLevelHit(p){
    if(!market?.demo)return null;
    for(const order of [...(market.orders||[])].reverse()){
      if(order.symbol!==el('symbol').value||![2,3,4,5].includes(order.type))continue;
      for(const [key,field] of [['price','order-price'],['sl','sl'],['tp','tp']])if(order[key]>0&&Math.abs(main.priceToCoordinate(order[key])-p.y)<=6)return {order,field};
    }return null;
  }
  function endOrderEdit(){
    editingOrder=null;editingPosition=null;el('order-price').disabled=false;el('ticket-editing').hidden=true;el('ticket-edit-cancel').hidden=true;el('side').disabled=false;el('volume').disabled=false;
    document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.disabled=false);el('preview').textContent='Review demo order';invalidate();
  }
  function beginOrderEdit(order){
    if(!market?.demo||submitting||closing||order.symbol!==el('symbol').value)return false;
    editingPosition=null;el('order-price').disabled=false;editingOrder={...order};if(smallPanels())el('pane').classList.add('mobile-ticket-open');else el('pane').classList.remove('ticket-collapsed');sizePanels();selectDrawing(-1);el('order-kind').value='PENDING';el('side').value=[2,4].includes(order.type)?'BUY':'SELL';
    el('order-price').value=order.price;el('sl').value=order.sl||'';el('tp').value=order.tp||'';el('volume').value=order.volume;
    el('side').disabled=true;el('volume').disabled=true;document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.disabled=true);
    el('ticket-editing').hidden=false;el('ticket-editing').textContent=`Amending pending #${order.ticket} · changes are not sent until confirmed.`;el('ticket-edit-cancel').hidden=false;el('preview').textContent='Review pending amendment';el('show-ticket').checked=true;updateOrderKind();return true;
  }
  function beginPositionEdit(position){
    if(!market?.demo||submitting||closing||position.symbol!==el('symbol').value)return false;
    editingOrder=null;editingPosition={...position};if(smallPanels())el('pane').classList.add('mobile-ticket-open');else el('pane').classList.remove('ticket-collapsed');sizePanels();selectDrawing(-1);el('order-kind').value='MARKET';el('side').value=position.type===0?'BUY':'SELL';
    el('order-price').value=position.price_open;el('order-price').disabled=true;el('volume').value=position.volume;el('sl').value=position.sl||'';el('tp').value=position.tp||'';
    el('side').disabled=true;el('volume').disabled=true;document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.disabled=true);
    el('ticket-editing').hidden=false;el('ticket-editing').textContent=`Editing position #${position.ticket} · only SL / TP will change after confirmation.`;el('ticket-edit-cancel').hidden=false;el('preview').textContent='Review position SL / TP';el('show-ticket').checked=true;updateOrderKind();return true;
  }
  el('ticket-edit-cancel').onclick=()=>{endOrderEdit();el('order-price').value='';el('sl').value='';el('tp').value='';updateOrderKind();};
  function finishOrderDrag(cancel=false){
    if(!orderDrag)return;const drag=orderDrag;orderDrag=null;if(cancel){el(drag.field).value=drag.original;el('order-kind').value=drag.originalMode||el('order-kind').value;}
    if(el('chart').hasPointerCapture(drag.pointerId))el('chart').releasePointerCapture(drag.pointerId);updateOrderKind();
  }
  function currentDrawings(){return safeList(state.drawings[drawingKey()]);}
  const drawingPoint=p=>({x:A.timeToCoordinate(bars,p.time,intervalSeconds(),index=>chart.timeScale().logicalToCoordinate(index)),y:main.priceToCoordinate(p.price)});
  const isPosition=item=>['long-position','short-position'].includes(item?.type);
  const planPrice=price=>{const tick=market?.tick_size||10**-(market?.digits??5);return Number((Math.round(price/tick)*tick).toFixed(market?.digits??5));};
  function positionHandles(item){const a=drawingPoint(item.a),b=drawingPoint(item.b),c=drawingPoint(item.c);return [{anchor:'a',...a},{anchor:'b',x:a.x,y:b.y},{anchor:'c',x:a.x,y:c.y},{anchor:'width',x:b.x,y:a.y}];}
  function updatePositionPlan(item,force=false){
    const metrics=A.positionMetrics(item);el('position-plan').hidden=!metrics;
    if(!metrics){clearTimeout(planEstimateTimer);planEstimateRevision++;planEstimateKey='';planEstimateContext='';planEstimatePending=false;planEstimateAt=0;planEstimate=null;return;}
    el('plan-title').textContent=(metrics.side==='BUY'?'Long':'Short')+' position plan';
    if(force||!el('plan-form').contains(document.activeElement)){
      for(const name of ['entry','stop','target'])el('plan-'+name).value=metrics[name].toFixed(market?.digits??5);
      el('plan-volume').value=item.volume||market?.volume_min||.01;
    }
    el('plan-volume').min=market?.volume_min||.01;el('plan-volume').max=market?.volume_max||100;el('plan-volume').step=market?.volume_step||.01;
    el('plan-metrics').textContent=`Risk/Reward 1:${metrics.ratio.toFixed(2)} · Target +${metrics.reward.toFixed(market?.digits??5)} (${metrics.rewardPercent.toFixed(2)}%) · Stop −${metrics.risk.toFixed(market?.digits??5)} (${metrics.riskPercent.toFixed(2)}%)`;
    const body={symbol:el('symbol').value,side:metrics.side,entry:metrics.entry,stop:metrics.stop,target:metrics.target,volume:item.volume||market?.volume_min||.01};
    const context=JSON.stringify([scope,body.symbol,body.side,selectedDrawing]);
    if(context!==planEstimateContext){planEstimateContext=context;planEstimate=null;planEstimateAt=0;}
    // A new quote timestamp alone does not change the estimate. Refresh unchanged
    // prices periodically for account-currency conversions, keeping prior values visible.
    const key=JSON.stringify([scope,body,metrics.side==='BUY'?market?.bid:market?.ask]);
    if(key===planEstimateKey&&(planEstimatePending||Date.now()-planEstimateAt<15000))return;
    clearTimeout(planEstimateTimer);planEstimateKey=key;planEstimatePending=true;const version=++planEstimateRevision;
    if(!planEstimate)el('plan-estimate').textContent='Calculating hypothetical account-currency amounts…';
    el('plan-estimate-state').textContent=planEstimate?'Updating · showing last completed estimate':'';
    el('plan-estimate-state').title='';
    planEstimateTimer=setTimeout(async()=>{try{
      const result=await call('terminal/plan',body);if(version!==planEstimateRevision)return;
      if(JSON.stringify([result.server,result.account])!==scope)throw Error('Account changed. Reconnect MT5.');
      planEstimate=result;planEstimateAt=Date.now();planEstimatePending=false;
      const mark=Number.isFinite(result.mark_to_market)?` · Hypothetical P&L ${result.mark_to_market.toFixed(2)} ${result.currency}`:'';
      const stale=Date.now()/1000-result.quote_time>30?' · Last quote is stale':'';
      const message=`Estimated loss at stop ${result.risk.toFixed(2)} ${result.currency} · Profit at target ${result.reward.toFixed(2)} ${result.currency}${mark}${stale}. ${result.note}`;
      if(el('plan-estimate').textContent!==message)el('plan-estimate').textContent=message;
      el('plan-estimate-state').textContent='';primitive?.update();
    }catch(error){if(version===planEstimateRevision){planEstimatePending=false;planEstimateAt=0;if(!planEstimate)el('plan-estimate').textContent=error.message;el('plan-estimate-state').textContent=planEstimate?'Refresh unavailable · showing last completed estimate':'';el('plan-estimate-state').title=error.message;}}},300);
  }
  function updateSelectionPrices(forcePlanFields=false){
    const item=currentDrawings()[selectedDrawing];
    const metrics=A.positionMetrics(item);
    const levels=metrics?[{title:'Entry',price:metrics.entry},{title:'Stop loss',price:metrics.stop},{title:'Take profit',price:metrics.target}]:!item?[]:item.type==='fib'?[0,.236,.382,.5,.618,.786,1].map(r=>({title:`Fib ${r}`,price:item.a.price+(item.b.price-item.a.price)*r})):item.type==='level'?[{title:'Level',price:item.a.price}]:[{title:item.type==='rectangle'?'Corner A':'Anchor A',price:item.a.price},{title:item.type==='rectangle'?'Corner B':'Anchor B',price:item.b.price}];
    if(main){while(selectedPriceLines.length>levels.length)main.removePriceLine(selectedPriceLines.pop());levels.forEach((level,i)=>{const options={...level,title:'',color:'#70e4c2',axisLabelColor:'#70e4c2',axisLabelTextColor:'#10241f',axisLabelVisible:true,lineVisible:false,lineWidth:1};if(selectedPriceLines[i])selectedPriceLines[i].applyOptions(options);else selectedPriceLines.push(main.createPriceLine(options));});}
    updatePositionPlan(item,forcePlanFields);
    el('selection-values').hidden=!levels.length;
    el('selection-values').replaceChildren(...levels.map(level=>{const label=text('span',`${level.title}: ${Number(level.price).toFixed(market?.digits??5)}`);label.dataset.price=level.price;return label;}));
  }
  function selectDrawing(index){selectedDrawing=index;el('delete-drawing').disabled=index<0;updateSelectionPrices(true);primitive?.update();el('tool-hint').textContent=index>=0?'Drawing selected · drag to move · drag handles to resize · Delete removes · Escape deselects':'Click a drawing to select · drag empty space to pan';}
  function removeSelectedDrawing(){if(selectedDrawing<0)return;state.drawings[drawingKey()]=currentDrawings().filter((_,i)=>i!==selectedDrawing);selectDrawing(-1);persist();}
  function drawingHit(p){
    const list=currentDrawings(),selected=list[selectedDrawing];
    if(isPosition(selected)){for(const handle of positionHandles(selected))if(handle.x!==null&&handle.y!==null&&Math.hypot(p.x-handle.x,p.y-handle.y)<=9)return {index:selectedDrawing,anchor:handle.anchor};}
    if(selected&&!isPosition(selected))for(const anchor of ['a','b']){if(!selected[anchor])continue;const point=drawingPoint(selected[anchor]);if(point.x!==null&&point.y!==null&&Math.hypot(p.x-point.x,p.y-point.y)<=9)return {index:selectedDrawing,anchor};}
    for(let i=list.length-1;i>=0;i--){const item=list[i];if(item?.a&&(isPosition(item)?(()=>{const a=drawingPoint(item.a),b=drawingPoint(item.b),c=drawingPoint(item.c);return a.x!==null&&b.x!==null&&[a.y,b.y,c.y].every(Number.isFinite)&&p.x>=Math.min(a.x,b.x)-7&&p.x<=Math.max(a.x,b.x)+7&&p.y>=Math.min(b.y,c.y)-7&&p.y<=Math.max(b.y,c.y)+7;})():A.hitDrawing(item.type,drawingPoint(item.a),item.b?drawingPoint(item.b):null,p)))return {index:i,anchor:null};}
    return null;
  }
  function pointerPoint(event){const rect=el('chart').getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
  function finishDrawingDrag(cancel=false){
    if(!drawingDrag)return;const drag=drawingDrag;drawingDrag=null;
    if(cancel)drag.list[drag.index]=drag.original;else persist();
    if(el('chart').hasPointerCapture(drag.pointerId))el('chart').releasePointerCapture(drag.pointerId);
    updateSelectionPrices();primitive?.update();
  }
  const intervalSeconds=()=>{const [,unit,n]=intervalParts(el('timeframe').value);return intervalUnits[unit][3]*Number(n);};
  const drawingTime=logical=>A.logicalToTime(bars,logical,intervalSeconds());
  const drawingLogical=time=>A.timeToLogical(bars,time,intervalSeconds());
  function visibleDrawingRange(){const range=chart?.timeScale().getVisibleLogicalRange();return range&&bars.length?{from:drawingTime(range.from),to:drawingTime(range.to)}:null;}
  function restoreDrawingRange(range){if(range&&Number.isFinite(range.from)&&Number.isFinite(range.to)&&range.from<range.to)chart.timeScale().setVisibleLogicalRange({from:drawingLogical(range.from),to:drawingLogical(range.to)});}
  class DrawingPrimitive {
    attached({requestUpdate}){this.requestUpdate=requestUpdate;}
    detached(){this.requestUpdate=null;}
    updateAllViews(){}
    paneViews(){return [{zOrder:()=> 'top',renderer:()=>({draw:target=>target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>renderDrawings(ctx,mediaSize))})}];}
    update(){this.requestUpdate?.();}
  }
  function renderDrawings(ctx,size){
    if(!chart||!main)return;
    const point=drawingPoint;
    ctx.save();ctx.font='11px Segoe UI';ctx.lineWidth=1.3;
    for(const [drawingIndex,item] of currentDrawings().entries()){
      if(!item?.a)continue;const a=point(item.a),b=item.b?point(item.b):null;
      const selected=drawingIndex===selectedDrawing;
      if(a.y===null)continue;ctx.lineWidth=selected?2.5:1.3;ctx.strokeStyle=selected?'#70e4c2':'#e4bd70';ctx.fillStyle=ctx.strokeStyle;ctx.setLineDash([]);
      const horizontal=(y,label)=>{ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(size.width,y);ctx.stroke();ctx.fillText(label,8,y-5);};
      if(item.type==='level'){ctx.setLineDash([5,4]);horizontal(a.y,item.a.price.toFixed(market?.digits??5));}
      else if(isPosition(item)&&b&&a.x!==null&&b.x!==null){
        const metrics=A.positionMetrics(item),c=point(item.c);if(!metrics||![a.y,b.y,c.y].every(Number.isFinite))continue;
        const x=Math.min(a.x,b.x),width=Math.abs(b.x-a.x);
        ctx.fillStyle='rgba(40,184,155,.20)';ctx.fillRect(x,Math.min(a.y,b.y),width,Math.abs(a.y-b.y));
        ctx.fillStyle='rgba(232,79,104,.20)';ctx.fillRect(x,Math.min(a.y,c.y),width,Math.abs(a.y-c.y));
        for(const [y,color] of [[b.y,'#29b99b'],[c.y,'#ef7385'],[a.y,'#a5b4cc']]){ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+width,y);ctx.stroke();}
        ctx.strokeStyle=selected?'#70e4c2':'#4f6978';ctx.strokeRect(x,Math.min(b.y,c.y),width,Math.abs(b.y-c.y));
        const label=(content,y,color)=>{ctx.font='bold 10px Segoe UI';const labelWidth=Math.min(size.width-8,ctx.measureText(content).width+12),labelX=Math.max(4,Math.min(size.width-labelWidth-4,x+4)),labelY=Math.max(4,Math.min(size.height-20,y));ctx.fillStyle=color;ctx.fillRect(labelX,labelY,labelWidth,18);ctx.fillStyle='#ffffff';ctx.fillText(content,labelX+6,labelY+12,labelWidth-12);};
        label(`Target: ${metrics.reward.toFixed(market?.digits??5)} (${metrics.rewardPercent.toFixed(2)}%)${selected&&planEstimate?' · '+planEstimate.reward.toFixed(2)+' '+planEstimate.currency:''}`,b.y<a.y?b.y-22:b.y+4,'#098e79');
        label(`Stop: ${metrics.risk.toFixed(market?.digits??5)} (${metrics.riskPercent.toFixed(2)}%)${selected&&planEstimate?' · '+planEstimate.risk.toFixed(2)+' '+planEstimate.currency:''}`,c.y<a.y?c.y-22:c.y+4,'#bd3c54');
        label(`${metrics.side==='BUY'?'Long':'Short'} · R/R ${metrics.ratio.toFixed(2)} · ${item.volume||.01} lots${selected&&Number.isFinite(planEstimate?.mark_to_market)?' · Est. P&L '+planEstimate.mark_to_market.toFixed(2)+' '+planEstimate.currency:''}`,a.y-9,'#31465c');
      }
      else if(b&&a.x!==null&&b.x!==null&&b.y!==null){
        if(item.type==='trend'){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
        if(item.type==='rectangle'){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);ctx.fillStyle='rgba(228,189,112,.10)';ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);}
        if(item.type==='fib')for(const ratio of [0,.236,.382,.5,.618,.786,1]){const y=a.y+(b.y-a.y)*ratio;ctx.strokeStyle=ratio===.5||ratio===.618?'#70e4c2':'#8a9cb6';ctx.beginPath();ctx.moveTo(Math.min(a.x,b.x),y);ctx.lineTo(Math.max(a.x,b.x),y);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillText(`${ratio} · ${(item.a.price+(item.b.price-item.a.price)*ratio).toFixed(market?.digits??5)}`,Math.min(a.x,b.x)+5,y-4);}
      }
      if(selected){ctx.setLineDash([]);for(const p of (isPosition(item)?positionHandles(item):[a,b].filter(Boolean))){if(p.x===null||p.y===null)continue;ctx.fillStyle='#0d1420';ctx.strokeStyle='#70e4c2';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();ctx.stroke();}}
    }
    renderTicketHandles(size);renderBrokerHandles(size);
    if(pending){const p=point(pending);if(p.x!==null&&p.y!==null){ctx.fillStyle='#70e4c2';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();}}
    ctx.restore();
  }
  function buildChart(){
    const range=visibleDrawingRange();chart?.remove();priceLines=[];selectedPriceLines=[];draftPriceLines=[];overlays={};
    chart=L.createChart(el('chart'),{autoSize:true,layout:{background:{type:L.ColorType.Solid,color:'#0d1420'},textColor:'#8e9eb4',fontFamily:'Segoe UI, Arial',fontSize:11,attributionLogo:true,panes:{separatorColor:'#263143',separatorHoverColor:'#415671',enableResize:true}},grid:{vertLines:{color:'#192335'},horzLines:{color:'#192335'}},rightPriceScale:{borderColor:'#29364b',minimumWidth:74},timeScale:{borderColor:'#29364b',timeVisible:true,secondsVisible:el('timeframe').value.startsWith('S'),rightOffset:24,barSpacing:7},crosshair:{mode:L.CrosshairMode.Normal},localization:{locale:'en-US'}});
    const priceFormat={type:'price',precision:market?.digits??5,minMove:market?.tick_size||10**-(market?.digits??5)};
    main=chart.addSeries(el('style').value==='line'?L.LineSeries:L.CandlestickSeries,el('style').value==='line'?{color:'#78a7ff',lineWidth:2,priceFormat}:{upColor:'#43c9a0',downColor:'#ef7385',wickUpColor:'#43c9a0',wickDownColor:'#ef7385',borderVisible:false,priceFormat});
    const line=(name,color,pane=0,title=name)=>{overlays[name]=chart.addSeries(L.LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,title,priceFormat:pane===0?priceFormat:{type:'price',precision:name==='rsi'?2:6,minMove:name==='rsi'?.01:.000001}},pane);};
    if(el('sma').checked)line('sma','#e4bd70',0,'SMA 20');if(el('ema').checked)line('ema','#a994ef',0,'EMA 50');
    if(el('bb').checked){line('bbMiddle','#657ba4',0,'BB 20');line('bbUpper','#577da6',0,'BB upper');line('bbLower','#577da6',0,'BB lower');}
    let pane=0;
    if(el('rsi').checked){line('rsi','#ae97f3',++pane,'RSI 14');overlays.rsi.applyOptions({autoscaleInfoProvider:()=>({priceRange:{minValue:0,maxValue:100}})});for(const value of [30,70])overlays.rsi.createPriceLine({price:value,color:'#59647b',lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:true,title:String(value)});}
    if(el('macd').checked){line('macd','#78a7ff',++pane,'MACD');line('signal','#e4bd70',pane,'Signal');overlays.histogram=chart.addSeries(L.HistogramSeries,{priceLineVisible:false,lastValueVisible:false,title:'MACD histogram'},pane);}
    if(el('volume-indicator').checked)overlays.volume=chart.addSeries(L.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false,title:'Tick volume'},++pane);
    el('chart').closest('.terminal-chart-area').style.height=(420+pane*120)+'px';
    chart.panes().forEach((p,i)=>p.setStretchFactor(i===0?4:1));
    primitive=new DrawingPrimitive();main.attachPrimitive(primitive);
    // Handle drawing anchors directly; chart click gestures can suppress quick clicks.
    el('chart').onpointerup=event=>{
      if(tool==='cursor'||!market||event.button!==0)return;
      const rect=el('chart').getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,size=chart.paneSize(0);
      if(x<0||y<0||x>size.width||y>size.height)return;
      const logical=chart.timeScale().coordinateToLogical(x),time=logical===null?null:drawingTime(logical);
      const price=main.coordinateToPrice(y);if(typeof time!=='number'||price===null)return;
      const p={time,price},list=currentDrawings();
      if(isPosition({type:tool})){
        const direction=tool==='long-position'?1:-1,span=Math.abs(main.coordinateToPrice(0)-main.coordinateToPrice(size.height)),risk=Math.min(p.price*.25,Math.max(span*.1,(market.tick_size||.00001)*10));
        const item={type:tool,a:{time,price:planPrice(price)},b:{time:drawingTime(logical+25),price:planPrice(price+direction*risk*2)},c:{time,price:planPrice(price-direction*risk)},volume:Number(el('volume').value)||market.volume_min};
        if(!A.positionMetrics(item)){el('tool-hint').textContent='Choose a positive entry price with room for stop and target.';return;}list.push(item);
      }
      else if(tool==='level')list.push({type:tool,a:p});else if(!pending){pending=p;primitive.update();el('tool-hint').textContent='Choose the second anchor · Escape cancels';return;}else{list.push({type:tool,a:pending,b:p});pending=null;}
      state.drawings[drawingKey()]=list;persist();setTool('cursor');selectDrawing(list.length-1);primitive.update();
    };
    const showIndicatorValues=event=>{
      const values=Object.entries(overlays).flatMap(([name,series])=>{const point=event.seriesData.get(series);if(!Number.isFinite(point?.value))return [];const precision=name==='volume'?0:name==='rsi'?2:['macd','signal','histogram'].includes(name)?6:market?.digits??5;return [`${series.options().title||name}: ${point.value.toFixed(precision)}`];});
      el('indicator-values').textContent=values.join(' · ');
    };
    chart.subscribeClick(showIndicatorValues);
    chart.subscribeCrosshairMove(event=>{
      const point=event.seriesData.get(main);if(point){const value='open'in point?`O ${format(point.open)}  H ${format(point.high)}  L ${format(point.low)}  C ${format(point.close)}`:`Close ${format(point.value)}`;el('ohlc').textContent=value;}
      showIndicatorValues(event);
    });
    let saveTimer;chart.timeScale().subscribeVisibleLogicalRangeChange(()=>{clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(market&&lastChartKey===workspaceKey()){const visible=visibleDrawingRange();if(visible){state.views[workspaceKey()]=visible;persist();}}},300);});
    if(bars.length)renderMarket(range);
  }
  const format=value=>Number(value).toFixed(market?.digits??5);
  function renderMarket(range){
    if(!main)return;
    if(!bars.length){el('chart-empty').hidden=false;el('chart-empty').replaceChildren(text('span','No candle history available.'),text('small','Try another market or interval in MT5.'));return;}
    const first=lastChartKey!==workspaceKey();const visible=range||(!first?visibleDrawingRange():state.views[workspaceKey()]);
    main.applyOptions({priceFormat:{type:'price',precision:market.digits,minMove:market.tick_size||10**-market.digits}});
    for(const name of ['sma','ema','bbMiddle','bbUpper','bbLower'])overlays[name]?.applyOptions({priceFormat:{type:'price',precision:market.digits,minMove:market.tick_size||10**-market.digits}});
    main.setData(el('style').value==='line'?bars.map(b=>({time:b.time,value:b.close})):bars);
    const input=A.values(bars),put=(name,series)=>overlays[name]?.setData(A.points(bars,series));
    put('sma',A.sma(input,20));put('ema',A.ema(input,50));
    if(overlays.bbMiddle){const bb=A.bollinger(input);put('bbMiddle',bb.middle);put('bbUpper',bb.upper);put('bbLower',bb.lower);}
    if(overlays.rsi)put('rsi',A.rsi(input));
    if(overlays.macd){const macd=A.macd(input);put('macd',macd.line);put('signal',macd.signal);overlays.histogram.setData(A.points(bars,macd.histogram).map(p=>({...p,color:p.value>=0?'#43c9a080':'#ef738580'})));}
    overlays.volume?.setData(bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'#43c9a060':'#ef738560'})));
    for(const line of priceLines)main.removePriceLine(line);priceLines=[];
    const priceLine=(price,color,title)=>{if(price>0)priceLines.push(main.createPriceLine({price,color,lineWidth:1,lineStyle:L.LineStyle.Dashed,axisLabelVisible:true,title}));};
    priceLine(market.ask,'#ef7385','ASK');
    for(const p of market.positions.filter(p=>p.symbol===el('symbol').value&&p.ticket!==editingPosition?.ticket)){priceLine(p.price_open,'#a994ef',`#${p.ticket}`);priceLine(p.sl,'#ef7385','SL');priceLine(p.tp,'#43c9a0','TP');}
    for(const order of market.orders||[])if(order.symbol===el('symbol').value){priceLine(order.price,'#e4bd70',`Pending #${order.ticket}`);priceLine(order.sl,'#ef7385',`#${order.ticket} SL`);priceLine(order.tp,'#43c9a0',`#${order.ticket} TP`);}
    if(first){if(visible&&visible.from<visible.to)restoreDrawingRange(visible);else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,bars.length-110),to:bars.length+24});}
    else if(range)restoreDrawingRange(range);
    lastChartKey=workspaceKey();updateOrderHint();syncDraftLines();updateSelectionPrices();primitive.update();el('chart-empty').hidden=true;
  }
  function setTool(value){finishDrawingDrag(true);selectDrawing(-1);tool=value;pending=null;document.querySelectorAll('[data-drawing]').forEach(b=>{b.classList.toggle('selected',b.dataset.drawing===value);b.setAttribute('aria-pressed',String(b.dataset.drawing===value));});chart?.applyOptions({handleScroll:value==='cursor',handleScale:{axisPressedMouseMove:true,mouseWheel:value==='cursor',pinch:value==='cursor'}});el('chart').style.cursor=value==='cursor'?'crosshair':'copy';el('tool-hint').textContent=value==='cursor'?'Scroll to zoom · click drawings to select · drag empty space to pan':value==='level'?'Click anywhere in the price pane to place a level':isPosition({type:value})?'Click to place entry · drag entry, target, stop or width handles':'Click two anchors · Escape cancels';primitive?.update();}
  function clearMarket(){stopConditions('Stopped: connection or chart selection changed.');finishOrderDrag(true);if(draftSymbol&&draftSymbol!==el('symbol').value){endOrderEdit();for(const field of ['order-price','sl','tp'])el(field).value='';}draftSymbol=el('symbol').value;if(!closing)cancelClose();market=null;queueTicketEstimate();bars=[];renderTicketHandles(chart.paneSize(0));renderBrokerHandles(chart.paneSize(0));lastChartKey='';invalidate();pending=null;main?.setData([]);for(const series of Object.values(overlays))series.setData([]);for(const line of priceLines)main.removePriceLine(line);priceLines=[];el('chart-empty').hidden=false;el('chart-empty').replaceChildren(text('span','Loading broker candles…'));el('ohlc').textContent='';el('bid').textContent='BID —';el('ask').textContent='ASK —';el('positions').replaceChildren();}
  function selectionChanged(){revision++;clearMarket();setTool('cursor');persist();renderWatchlist();refresh();}
  function chooseSymbol(symbol){if(!symbols.includes(symbol))return;el('symbol').value=symbol;el('search').value='';el('search-results').hidden=true;selectionChanged();}
  function renderWatchlist(){
    const rows=state.watch.map(symbol=>{const row=text('div','',symbol===el('symbol').value?'terminal-watch-row active':'terminal-watch-row');const button=text('button','');button.type='button';button.append(text('strong',symbol),text('small',quotes[symbol]?String(quotes[symbol].bid):'—'));button.onclick=()=>chooseSymbol(symbol);const remove=text('button','×');remove.type='button';remove.title='Remove '+symbol;remove.onclick=()=>{state.watch=state.watch.filter(s=>s!==symbol);persist();renderWatchlist();};row.append(button,remove);return row;});
    el('watchlist').replaceChildren(...(rows.length?rows:[text('p','Add markets using search or ＋ Add.')]));
  }
  el('search').oninput=()=>{const query=el('search').value.trim().toLowerCase();el('search-results').hidden=!query;el('search-results').replaceChildren(...symbols.filter(s=>s.toLowerCase().includes(query)).slice(0,25).map(symbol=>{const button=text('button',symbol);button.type='button';button.onclick=()=>{if(!state.watch.includes(symbol)&&state.watch.length<20)state.watch.push(symbol);chooseSymbol(symbol);};return button;}));};
  el('pin').onclick=()=>{const symbol=el('symbol').value;if(!symbol)return;if(!state.watch.includes(symbol)){if(state.watch.length>=20){status('Watchlist supports up to 20 markets. Remove one to add another.');return;}state.watch.push(symbol);persist();renderWatchlist();}};
  function renderAlerts(){el('alert-list').replaceChildren(...state.alerts.map(alert=>{const row=text('div','',alert.fired?'terminal-alert fired':'terminal-alert');row.append(text('strong',`${alert.symbol} ${alert.direction==='above'?'≥':'≤'} ${alert.price}`),text('small',alert.fired?'Triggered '+new Date(alert.fired).toLocaleTimeString():'Armed'));const button=text('button','×');button.type='button';button.title='Remove alert';button.onclick=()=>{state.alerts=state.alerts.filter(a=>a.id!==alert.id);persist();renderAlerts();};row.append(button);return row;}));}
  el('alert-form').onsubmit=event=>{event.preventDefault();if(!market)return;const price=Number(el('alert-price').value);if(!Number.isFinite(price)||price<=0)return;if(state.alerts.length>=20){status('Remove an alert before adding another (maximum 20).');return;}state.alerts.push({id:crypto.randomUUID(),symbol:el('symbol').value,price,direction:el('alert-direction').value,fired:null});persist();renderAlerts();};
  function checkAlerts(){let changed=false;for(const alert of state.alerts){const quote=quotes[alert.symbol];if(alert.fired||!quote||Date.now()/1000-quote.time>30||quote.time>Date.now()/1000+5)continue;if(alert.direction==='above'?quote.bid>=alert.price:quote.bid<=alert.price){alert.fired=Date.now();changed=true;}}if(changed){persist();renderAlerts();}}
  async function connectWorkspace(auto=false){
    if(connecting||(auto&&autoReconnectBlocked))return;connecting=true;nextAutoConnect=Date.now()+10000;el('start').disabled=true;el('start').textContent='Connecting…';if(!auto)autoReconnectBlocked=false;
    try{
      if(auto&&window.mt5Startup)await window.mt5Startup;
      status('Connecting to your running MT5 terminal…');const session=await call('session');if(!session.connected){const account=await call('connect',{path:document.getElementById('path').value||document.getElementById('terminals').value});if(typeof showAccount==='function')showAccount(account);}
      const data=await call('terminal/symbols');const nextScope=JSON.stringify([data.server,data.account]);
      if(scope!==nextScope){invalidate();scope=nextScope;const source=saved.workspaces?.[scope]||{};state={watch:safeList(source.watch).filter(s=>typeof s==='string').slice(0,20),drawings:source.drawings&&typeof source.drawings==='object'?source.drawings:{},alerts:safeList(source.alerts).filter(a=>a&&typeof a.symbol==='string'&&Number.isFinite(a.price)).slice(0,20),views:source.views&&typeof source.views==='object'?source.views:{}};state.drawings=A.shareDrawingTimeframes(state.drawings,scope);quotes={};}
      symbols=data.symbols;el('symbol').replaceChildren(...symbols.map(name=>new Option(name,name)));el('symbol').disabled=!symbols.length;
      if(!symbols.length)throw Error('Your broker returned no symbols. Check MT5 connection.');
      if(!state.watch.length)state.watch=(data.visible?.length?data.visible:symbols).slice(0,6);state.watch=state.watch.filter(s=>symbols.includes(s));
      applyLayout(saved.settings);if(!el('symbol').value)el('symbol').value=state.watch[0]||symbols[0];
      renderWatchlist();renderAlerts();running=true;selectionChanged();
    }catch(error){el('feed').textContent='Waiting for MT5';status(error.message+(auto?' · Will retry automatically.':''));}finally{connecting=false;el('start').disabled=false;el('start').textContent=running?'Reconnect MT5':'Connect & load markets';}
  }
  async function refresh(){
    if(loading||!running||drawingDrag||orderDrag||el('pane').hidden||document.hidden)return;
    loading=true;const version=revision;
    try{
      const symbol=el('symbol').value,timeframe=el('timeframe').value;
      const next=await call('terminal/market',{symbol,timeframe});if(version!==revision||drawingDrag||orderDrag)return;
      if(JSON.stringify([next.server,next.account])!==scope){autoReconnectBlocked=true;running=false;clearMarket();throw Error('MT5 account changed. Connect again to load its workspace.');}
      market=next;bars=next.bars.map(b=>({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]||0}));
      const stale=Date.now()/1000-next.quote_time>30;
      el('feed').textContent=stale?'Last available quotes':next.demo?'Demo · connected':'Live · analysis';el('feed').classList.toggle('online',!stale);
      el('chart-title').textContent=`${symbol} · ${intervalLabel(timeframe)}`;el('ticket-symbol').textContent=symbol;
      el('bid').textContent='BID '+format(next.bid);el('ask').textContent='ASK '+format(next.ask);el('quote-time').textContent=(stale?'STALE · ':'')+new Date(next.quote_time*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
      el('account').replaceChildren(text('strong',`${next.demo?'DEMO':'LIVE · analysis only'} · ${next.account}`),text('small',next.server),...['balance','equity','margin_free'].map(name=>text('div',`${name==='margin_free'?'Free margin':name[0].toUpperCase()+name.slice(1)}  ${Number(next[name]).toFixed(2)} ${next.currency}`)));
      el('volume').min=next.volume_min;el('volume').max=next.volume_max;el('volume').step=next.volume_step;el('volume-info').textContent=`${next.volume_min}–${next.volume_max} lots · step ${next.volume_step} · spread ${format(next.ask-next.bid)}`;
      el('position-count').textContent=next.positions.length;
      if(closeToken&&closePosition&&!closing){const current=next.positions.find(p=>p.ticket===closePosition.ticket);if(!current||current.volume!==closePosition.volume||current.type!==closePosition.type||current.symbol!==closePosition.symbol){cancelClose(false);el('close-status').textContent='Position changed or is no longer open. Review it again before closing.';}}
      const rows=next.positions.map(p=>{const row=document.createElement('tr');for(const value of [p.ticket,p.symbol,p.type===0?'BUY':'SELL',p.volume,p.price_open,p.price_current,p.sl||'—',p.tp||'—',p.profit])row.append(text('td',value));row.lastChild.className=p.profit>=0?'gain':'loss';const action=document.createElement('td'),edit=text('button','Edit SL / TP');edit.type='button';edit.dataset.editPosition=p.ticket;edit.disabled=!next.demo||p.symbol!==symbol||submitting||closing;edit.onclick=()=>beginPositionEdit(p);action.append(edit);const button=text('button','Close','terminal-close-action');button.type='button';button.dataset.position=p.ticket;button.title=next.demo?'Review closing this entire position':'Closing through this app is currently demo-account only';button.disabled=!next.demo||closing||closeLoading||submitting;button.onclick=()=>reviewClose(p);action.append(button);row.append(action);return row;});
      el('positions').replaceChildren(...(rows.length?rows:[(()=>{const row=document.createElement('tr'),cell=text('td','No open positions.');cell.colSpan=10;row.append(cell);return row;})()]));
      if(editingPosition&&!next.positions.some(p=>p.ticket===editingPosition.ticket)){endOrderEdit();for(const field of ['order-price','sl','tp'])el(field).value='';el('order-summary').textContent='Position is no longer open. No amendment sent.';}
      const orders=next.orders||[];el('pending-count').textContent=orders.length;
      if(editingOrder&&!orders.some(order=>order.ticket===editingOrder.ticket)){endOrderEdit();for(const field of ['order-price','sl','tp'])el(field).value='';el('order-summary').textContent='The order is no longer pending. Check positions before creating another order.';}
      if(closeToken&&cancelOrder&&!closing&&!orders.some(o=>o.ticket===cancelOrder.ticket)){cancelClose(false);el('close-status').textContent='Order is no longer pending. Check whether it filled in open positions.';}
      const orderNames={2:'BUY LIMIT',3:'SELL LIMIT',4:'BUY STOP',5:'SELL STOP',6:'BUY STOP LIMIT',7:'SELL STOP LIMIT'};
      el('orders').replaceChildren(...(orders.length?orders.map(order=>{const row=document.createElement('tr');for(const value of [order.ticket,order.symbol,orderNames[order.type]||order.type,order.volume,order.price,order.sl||'—',order.tp||'—'])row.append(text('td',value));const cell=document.createElement('td'),button=text('button','Cancel','terminal-cancel-action');button.type='button';button.dataset.order=order.ticket;button.disabled=!next.demo||closing||closeLoading||submitting;button.onclick=()=>reviewCancel(order);const edit=text('button','Edit');edit.type='button';edit.dataset.editOrder=order.ticket;edit.disabled=!next.demo||order.symbol!==el('symbol').value||![2,3,4,5].includes(order.type)||submitting||closing;edit.onclick=()=>beginOrderEdit(order);cell.append(edit,button);row.append(cell);return row;}):[(()=>{const row=document.createElement('tr'),cell=text('td','No pending orders.');cell.colSpan=8;row.append(cell);return row;})()]));
      if(tradeTab==='closed'&&(closedScope!==scope||Date.now()-closedAt>15000))loadClosed();
      updateTicket();renderMarket();status(stale?'Market is quiet or closed. Showing the latest available broker candles.':`${symbol} · ${bars.length} broker candles · ${next.interval_note||'Drawings and layouts save locally'}`);
      await checkConditions(next,version);
      const quoteSymbols=[...new Set([...state.watch,...state.alerts.filter(a=>!a.fired).map(a=>a.symbol)])];
      if(quoteSymbols.length){try{const result=await call('terminal/quotes',{symbols:quoteSymbols});if(version===revision){if(JSON.stringify([result.server,result.account])!==scope)throw Error('Account changed. Reconnect MT5.');quotes=result.quotes;renderWatchlist();checkAlerts();}}catch(error){if(version===revision)status('Chart loaded; watchlist quotes unavailable: '+error.message);}}
    }catch(error){if(version===revision){el('feed').textContent='Disconnected';el('feed').classList.remove('online');status(error.message);stopConditions('Stopped: market connection lost.');running=false;nextAutoConnect=Date.now()+10000;market=null;invalidate();}}
    finally{loading=false;if(version!==revision)refresh();}
  }
  async function loadClosed(){
    if(!market||closedLoading)return;closedLoading=true;const expectedScope=scope;
    if(closedScope!==scope){closedAt=0;el('closed').replaceChildren();}
    el('closed-status').textContent='Loading closed positions from MT5…';
    try{
      const result=await call('terminal/closed',{});if(scope!==expectedScope)return;
      if(JSON.stringify([result.server,result.account])!==scope)throw Error('Account changed. Reconnect MT5.');
      const rows=result.positions.map(p=>{const row=document.createElement('tr');
        for(const value of [p.id,p.symbol,p.side,p.volume,Number(p.entry).toLocaleString('en-US',{maximumFractionDigits:8}),Number(p.exit).toLocaleString('en-US',{maximumFractionDigits:8}),new Date(p.end).toISOString().replace('T',' ').slice(0,19),`${Number(p.net).toFixed(2)} ${result.currency}`])row.append(text('td',value));
        row.lastChild.className=p.net>=0?'gain':'loss';return row;});
      if(!rows.length){const row=document.createElement('tr'),cell=text('td','No supported closed positions in the last 30 days.');cell.colSpan=8;row.append(cell);rows.push(row);}
      el('closed').replaceChildren(...rows);el('closed-status').textContent=result.note;closedAt=Date.now();closedScope=scope;
    }catch(error){if(scope===expectedScope){el('closed-status').textContent=error.message;closedAt=Date.now();}}finally{closedLoading=false;}
  }
  function selectTradeTab(name,focus=false){
    tradeTab=name;for(const tab of ['open','pending','closed']){const active=tab===name;el('panel-'+tab).hidden=!active;el('tab-'+tab).setAttribute('aria-selected',String(active));el('tab-'+tab).tabIndex=active?0:-1;}
    if(focus)el('tab-'+name).focus();if(name==='closed'&&(closedScope!==scope||Date.now()-closedAt>15000))loadClosed();
  }
  for(const name of ['open','pending','closed']){
    el('tab-'+name).onclick=()=>selectTradeTab(name);
    el('tab-'+name).onkeydown=event=>{const names=['open','pending','closed'],index=names.indexOf(name);if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();selectTradeTab(names[event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3],true);}};
  }
  el('start').onclick=()=>connectWorkspace();
  el('settings').onclick=()=>{const open=document.body.classList.toggle('terminal-connection-open');el('settings').setAttribute('aria-expanded',String(open));document.getElementById('connection-settings').open=open;if(open)document.querySelector('.connection').scrollIntoView({block:'start'});};
  el('symbol').onchange=selectionChanged;el('timeframe').onchange=()=>chooseInterval(el('timeframe').value);
  for(const name of [...indicators,'style'])el(name).onchange=()=>{buildChart();setTool(tool);persist();};
  document.querySelectorAll('[data-drawing]').forEach(button=>button.onclick=()=>setTool(button.dataset.drawing));
  el('plan-form').onsubmit=event=>{
    event.preventDefault();const item=currentDrawings()[selectedDrawing];if(!isPosition(item))return;
    const updated=structuredClone(item);updated.a.price=planPrice(Number(el('plan-entry').value));updated.b.price=planPrice(Number(el('plan-target').value));updated.c.price=planPrice(Number(el('plan-stop').value));updated.volume=Number(el('plan-volume').value);
    if(!A.positionMetrics(updated)||!Number.isFinite(updated.volume)||updated.volume<=0){el('plan-estimate').textContent='Long: stop < entry < target. Short: target < entry < stop. Enter positive lot volume.';return;}
    currentDrawings()[selectedDrawing]=updated;persist();updateSelectionPrices(true);primitive?.update();
  };
  el('plan-ticket').onclick=()=>{
    const item=currentDrawings()[selectedDrawing],metrics=A.positionMetrics(item);if(!metrics)return;
    endOrderEdit();invalidate();el('side').value=metrics.side;el('sl').value=metrics.stop.toFixed(market?.digits??5);el('tp').value=metrics.target.toFixed(market?.digits??5);el('volume').value=item.volume||market.volume_min;
    if(el('order-kind').value!=='MARKET')el('order-price').value=metrics.entry.toFixed(market?.digits??5);updateOrderKind();
    el('order-summary').textContent=el('order-kind').value==='MARKET'?'Plan levels copied. This ticket uses the current market price, not the planned entry. Review before submitting.':'Plan entry, SL/TP and volume copied to the pending ticket. Review its type and broker checks before submitting.';
  };
  el('delete-drawing').onclick=removeSelectedDrawing;
  el('undo').onclick=()=>{selectDrawing(-1);state.drawings[drawingKey()]=currentDrawings().slice(0,-1);pending=null;persist();primitive?.update();};el('clear').onclick=()=>{selectDrawing(-1);state.drawings[drawingKey()]=[];pending=null;persist();primitive?.update();};
  el('fit').onclick=()=>chart.timeScale().fitContent();el('latest').onclick=()=>chart.timeScale().scrollToRealTime();
  el('layout-save').onclick=()=>{saved.namedLayout=layout();persist();status('Layout saved. Use Restore layout to return to these settings.');};
  el('layout-restore').onclick=()=>{if(!saved.namedLayout){status('Save a layout first.');return;}applyLayout(saved.namedLayout);selectionChanged();buildChart();status('Saved layout restored.');};
  el('pane').addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;if(event.key==='Escape'){finishOrderDrag(true);setTool('cursor');}if((event.key==='Delete'||event.key==='Backspace')&&selectedDrawing>=0){event.preventDefault();removeSelectedDrawing();}});
  function updateOrderHint(){
    if(market){el('sell-quote').textContent=Number(market.bid).toFixed(market.digits);el('buy-quote').textContent=Number(market.ask).toFixed(market.digits);}
    document.querySelectorAll('[data-ticket-side]').forEach(button=>{button.setAttribute('aria-pressed',String(button.dataset.ticketSide===el('side').value));button.disabled=!!(editingOrder||editingPosition)||submitting||closing;});
    el('volume-down').disabled=!!(editingOrder||editingPosition);el('volume-up').disabled=!!(editingOrder||editingPosition);
    const isPending=el('order-kind').value!=='MARKET',kind=inferredKind();el('pending-entry').hidden=!isPending&&!editingPosition;el('order-price').required=isPending;
    document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.ticketMode===el('order-kind').value)));
    el('inferred-type').textContent=isPending&&kind?(kind==='LIMIT'?'Limit':'Stop'):'';
    el('order-hint').textContent=editingPosition?'Entry and volume are fixed. Drag or type SL / TP; × removes protection. Review to apply.':!isPending?'Drag SL / TP handles from the entry line to add protection.':!kind?'Drag the entry line or type its price.':`${el('side').value} ${kind} · GTC · Drag lines to adjust.`;
  }
  function updateOrderKind(){ticketDraftHidden=false;saved.ticketDraftHidden=false;seedPendingEntry();updateOrderHint();invalidate();syncDraftLines();}
  for(const side of ['SELL','BUY'])document.querySelector(`[data-ticket-side="${side}"]`).onclick=()=>{if(editingOrder||editingPosition||submitting||closing)return;el('side').value=side;updateOrderKind();};
  for(const field of ['sl','tp'])el('clear-'+field).onclick=()=>{el(field).value='';updateOrderKind();};
  for(const [id,direction] of [['volume-down',-1],['volume-up',1]])el(id).onclick=()=>{if(editingOrder||editingPosition)return;const min=market?.volume_min||.01,max=market?.volume_max||100,step=market?.volume_step||.01;el('volume').value=Number(Math.max(min,Math.min(max,(Number(el('volume').value)||min)+direction*step)).toFixed(8));updateOrderKind();};
  el('order-kind').onchange=updateOrderKind;el('side').onchange=updateOrderKind;
  document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.onclick=()=>{el('order-kind').value=button.dataset.ticketMode;updateOrderKind();});
  el('show-ticket').onchange=()=>{syncDraftLines();};
  el('ticket').oninput=()=>{ticketDraftHidden=false;saved.ticketDraftHidden=false;updateOrderHint();invalidate();syncDraftLines();};
  el('ticket').onsubmit=async event=>{
    event.preventDefault();if(submitting||reviewing||closing)return;invalidate();reviewing=true;updateTicket();const version=ticketRevision;
    const body={symbol:el('symbol').value,side:el('side').value,order_kind:el('order-kind').value,price:el('order-price').value,volume:el('volume').value,sl:el('sl').value,tp:el('tp').value};
    try{const result=await call(editingPosition?'terminal/position-preview':editingOrder?'terminal/modify-preview':'terminal/preview',editingPosition?{position:editingPosition.ticket,sl:body.sl,tp:body.tp}:editingOrder?{order:editingOrder.ticket,price:body.price,sl:body.sl,tp:body.tp}:body);if(version!==ticketRevision)return;preview=result.preview;
      const r=result.request;const kind=result.order_kind||inferredKind()||body.order_kind;el('order-summary').replaceChildren(text('strong',`DEMO ${result.account} / ${result.server}`),text('p',editingPosition?`AMEND position #${editingPosition.ticket} · SL ${r.sl||'none'} · TP ${r.tp||'none'}. Entry and volume remain fixed.`:editingOrder?`AMEND pending #${editingOrder.ticket} · entry ${r.price} · SL ${r.sl||'none'} · TP ${r.tp||'none'}. Original broker type and expiration are preserved.`:`${body.side} ${kind} · ${r.volume} lots ${r.symbol} ${body.order_kind==='MARKET'?'at market (quote '+r.price+')':'at entry '+r.price+' · Good Till Cancelled'}. SL ${r.sl||'none'} · TP ${r.tp||'none'}.`));el('submit').hidden=false;
      expiryTimer=setTimeout(()=>{if(preview===result.preview){invalidate(false);el('order-summary').append(text('p','Preview expired. Review again.'));}},result.expires_in*1000);
    }catch(error){if(version===ticketRevision)el('order-summary').textContent=error.message;}finally{reviewing=false;updateTicket();}
  };
  el('submit').onclick=async()=>{
    if(!preview||submitting||closing)return;const token=preview;invalidate(false);submitting=true;updateTicket();
    try{const result=await call('terminal/submit',{preview:token});el('order-summary').replaceChildren(text('strong',`Broker result ${result.retcode}: ${result.comment}`),text('p',result.operation==='position-sltp'?`Position SL / TP amendment result. ${result.message}`:result.operation==='modify'?`Pending amendment result for order ${result.order}. Check the broker order list for final levels. ${result.message}`:result.operation==='pending'?`Pending order ${result.order}. Broker result determines acceptance; this is not a filled position. ${result.message}`:`Order ${result.order} · deal ${result.deal} · filled ${result.volume} at ${result.price}. ${result.message}`));if(result.operation==='pending'){selectTradeTab('pending');for(const field of ['order-price','sl','tp'])el(field).value='';updateOrderHint();syncDraftLines();}}
    catch(error){el('order-summary').textContent=error.message+' Check MT5 before retrying.';}finally{submitting=false;updateTicket();refresh();}
  };
  el('journal').onclick=()=>{if(typeof allowJournalSwitch==='function'&&!allowJournalSwitch())return;document.getElementById('journal-search').value=el('symbol').value;showJournalView('journal');};
  el('sync-journal').onclick=async()=>{if(typeof task!=='function')return;await task(async()=>{await loadHistory();status('Closed trades synced to your journal for the selected history dates.');});};
  // Capture selected-object drags before the chart can interpret them as panning.
  el('chart').addEventListener('pointerdown',event=>{
    if(tool!=='cursor'||!market||event.button!==0)return;
    const p=pointerPoint(event),size=chart.paneSize(0);if(p.x<0||p.y<0||p.x>size.width||p.y>size.height)return;
    const hit=drawingHit(p),draft=draftLevelHit(p),broker=pendingLevelHit(p),position=(market.positions||[]).filter(item=>item.symbol===el('symbol').value).flatMap(item=>['sl','tp'].map(field=>({position:item,field,y:item[field]>0?main.priceToCoordinate(item[field]):null}))).find(item=>Number.isFinite(item.y)&&Math.abs(item.y-p.y)<=6);
    if(!submitting&&!closing&&!hit&&!draft&&!broker&&position&&market.demo){if(beginPositionEdit(position.position))startTicketDrag(event,position.field);return;}
    if(!submitting&&!closing&&!hit&&(draft||broker)){
      const field=draft?.field||broker.field;if(!draft&&!beginOrderEdit(broker.order))return;
      startTicketDrag(event,field);return;
    }
    selectDrawing(hit?.index??-1);
    if(!hit)return;
    el('chart').focus({preventScroll:true});event.preventDefault();event.stopImmediatePropagation();
    const list=currentDrawings(),original=structuredClone(list[hit.index]);
    drawingDrag={...hit,list,original,pointerId:event.pointerId,logical:chart.timeScale().coordinateToLogical(p.x),price:main.coordinateToPrice(p.y)};
    el('chart').setPointerCapture(event.pointerId);
  },true);
  el('chart').addEventListener('pointermove',event=>{
    if(!market||tool!=='cursor')return;
    const p=pointerPoint(event);
    if(orderDrag){event.preventDefault();event.stopImmediatePropagation();const size=chart.paneSize(0),price=main.coordinateToPrice(Math.max(0,Math.min(size.height,p.y)));if(price>0){el(orderDrag.field).value=dragProtectionPrice(orderDrag.field,price).toFixed(market.digits);updateOrderKind();}el('chart').style.cursor='ns-resize';return;}
    if(!drawingDrag){const size=chart.paneSize(0);el('chart').style.cursor=p.x>=0&&p.y>=0&&p.x<size.width&&p.y<size.height&&draftLevelHit(p)||pendingLevelHit(p)?'ns-resize':drawingHit(p)?'move':'crosshair';return;}
    event.preventDefault();event.stopImmediatePropagation();
    const drag=drawingDrag,size=chart.paneSize(0),x=Math.max(0,Math.min(size.width,p.x)),y=Math.max(0,Math.min(size.height,p.y));
    const logical=chart.timeScale().coordinateToLogical(x),price=main.coordinateToPrice(y);if(logical===null||price===null)return;
    const updated=structuredClone(drag.original);
    if(isPosition(updated)&&drag.anchor){
      const direction=updated.type==='long-position'?1:-1,tick=market.tick_size||10**-market.digits;
      if(drag.anchor==='width')updated.b.time=Math.max(updated.a.time+intervalSeconds(),drawingTime(logical));
      else if(drag.anchor==='a'){const low=Math.min(updated.b.price,updated.c.price)+tick,high=Math.max(updated.b.price,updated.c.price)-tick;updated.a.price=planPrice(Math.max(low,Math.min(high,price)));}
      else if(drag.anchor==='b')updated.b.price=planPrice(direction===1?Math.max(updated.a.price+tick,price):Math.max(tick,Math.min(updated.a.price-tick,price)));
      else updated.c.price=planPrice(direction===1?Math.max(tick,Math.min(updated.a.price-tick,price)):Math.max(updated.a.price+tick,price));
    }else if(drag.anchor)updated[drag.anchor]={time:drawingTime(logical),price};
    else for(const name of ['a','b','c'])if(updated[name])updated[name]={time:drawingTime(drawingLogical(drag.original[name].time)+logical-drag.logical),price:isPosition(updated)?planPrice(drag.original[name].price+price-drag.price):drag.original[name].price+price-drag.price};
    if(isPosition(updated)&&!A.positionMetrics(updated))return;
    drag.list[drag.index]=updated;updateSelectionPrices();el('chart').style.cursor='grabbing';primitive?.update();
  },true);
  el('chart').addEventListener('pointerup',event=>{if(orderDrag){event.preventDefault();event.stopImmediatePropagation();finishOrderDrag();return;}if(!drawingDrag)return;event.preventDefault();event.stopImmediatePropagation();finishDrawingDrag();},true);
  el('chart').addEventListener('pointercancel',()=>{finishOrderDrag(true);finishDrawingDrag(true);},true);
  const C=window.TerminalConditions;
  let conditionRun=null,conditionBusy=false,conditionDraftScope='';
  const conditionMessage=message=>{el('condition-status').textContent=message;};
  const conditionStorage=()=>`tradetrace.conditions.v1:${scope}:${el('symbol').value}`;
  function stopConditions(message){conditionRun=null;if(el('condition-status'))conditionMessage(message);}
  function conditionRows(){return [...el('condition-list').children].map(row=>Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,['level','low','high'].includes(input.dataset.field)?Number(input.value):input.value])));}
  function saveConditions(){try{localStorage.setItem(conditionStorage(),JSON.stringify({rows:conditionRows(),sizing:el('condition-sizing').value,timeout:el('condition-timeout').value,gap:el('condition-gap').value}));}catch(_){conditionMessage('Cannot save condition draft locally.');}}
  function conditionRow(value={rule:'TRADED_ABOVE',mode:'LIVE',timeframe:'H1',level:0,low:0,high:0}){
    const row=text('div','','terminal-condition-row');
    const add=(title,name,options)=>{const label=text('label',title),input=document.createElement(options?'select':'input');input.dataset.field=name;input.setAttribute('aria-label',title);if(options)for(const [code,label] of options)input.append(new Option(label,code));else{input.type='number';input.step='any';input.min='0';}input.value=value[name];label.append(input);row.append(label);return input;};
    const rule=add('Rule','rule',Object.entries(C.rules)),mode=add('Evaluate','mode',[['LIVE','Live Bid'],['CANDLE','Completed candle']]),tf=add('Timeframe','timeframe',C.frames.map(f=>[f,f]));
    const level=add('Price level','level'),low=add('Zone low','low'),high=add('Zone high','high');
    const update=()=>{if(C.candleOnly(rule.value))mode.value='CANDLE';mode.disabled=C.candleOnly(rule.value);tf.parentNode.hidden=mode.value==='LIVE';level.parentNode.hidden=C.zone(rule.value);low.parentNode.hidden=high.parentNode.hidden=!C.zone(rule.value);saveConditions();};
    row.onchange=update;
    for(const [label,action] of [['↑',()=>{if(row.previousElementSibling)row.before(row.previousElementSibling);}],['↓',()=>{if(row.nextElementSibling)row.after(row.nextElementSibling);}],['Remove',()=>row.remove()]]){const button=text('button',label);button.type='button';button.setAttribute('aria-label',label==='↑'?'Move condition up':label==='↓'?'Move condition down':'Remove condition');button.onclick=()=>{action();saveConditions();};row.append(button);}
    el('condition-list').append(row);update();return row;
  }
  function restoreConditions(){
    const key=conditionStorage();if(conditionDraftScope===key)return;conditionDraftScope=key;stopConditions('Stopped. Review the restored draft and start when ready.');
    let value={};try{value=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
    el('condition-list').replaceChildren();el('condition-action').value='ALERT';
    el('condition-sizing').value=value.sizing==='AUTO'?'AUTO':'MANUAL';
    for(const name of ['timeout','gap'])el('condition-'+name).value=Number.isFinite(Number(value[name]))&&Number(value[name])>=0?value[name]:(name==='gap'?300:0);
    if(Array.isArray(value.rows))for(const row of value.rows)if(row&&typeof row==='object')conditionRow(row);
  }
  el('condition-add').onclick=()=>{restoreConditions();conditionRow();};
  for(const name of ['sizing','timeout','gap'])el('condition-'+name).addEventListener('change',saveConditions);
  el('condition-sizing').addEventListener('change',()=>{ticketEstimateVersion++;ticketEstimatePending=false;clearTimeout(ticketEstimateTimer);ticketEstimate=null;ticketEstimateKey='';ticketEstimateAt=0;updateOrderKind();});
  el('condition-action').onchange=()=>{el('condition-start').textContent=el('condition-action').value==='AUTO'?'Arm automatic demo entry':el('condition-action').value==='REVIEW'?'Start conditions for review':'Start conditions';if(conditionRun)stopConditions('Stopped: entry mode changed. Start to apply your draft.');};
  el('conditions-panel').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT')event.preventDefault();});
  el('condition-stop').onclick=()=>stopConditions('Stopped. No future condition order will be sent. Check MT5 for any request already submitted.');
  const conditionContextValid=run=>conditionRun===run&&run.scope===scope&&run.symbol===el('symbol').value&&!document.hidden&&!el('pane').hidden;
  async function conditionComplete(run){
    if(!conditionContextValid(run)||run.attempted)return;run.attempted=true;
    conditionMessage('All conditions passed.');
    if(run.action==='ALERT'){conditionRun=null;return;}
    conditionBusy=true;
    try{
      if(submitting||reviewing||closing||editingOrder||editingPosition)throw Error('Ticket is busy. No entry attempted.');
      const next=await call('terminal/market',{symbol:run.symbol,timeframe:'M1'});
      if(!conditionContextValid(run))return;
      if(JSON.stringify([next.server,next.account])!==run.scope)throw Error('Account changed.');
      if(!next.demo)throw Error('Condition execution is demo-account only.');
      const body={...run.ticket,condition_entry:true,condition_risk_auto:run.sizing==='AUTO',expected_account:next.account,expected_server:next.server};
      if(run.sizing==='AUTO'){
        const entry=body.order_kind==='MARKET'?(body.side==='BUY'?next.ask:next.bid):Number(body.price);
        const adverse=entry+(body.side==='BUY'?1:-1)*20*(next.point||next.tick_size);
        const estimate=await call('terminal/plan',{symbol:run.symbol,side:body.side,entry:adverse,stop:Number(body.sl),target:Number(body.tp),volume:next.volume_min});
        if(!conditionContextValid(run))return;
        if(JSON.stringify([estimate.server,estimate.account])!==run.scope||!Number.isFinite(estimate.risk)||estimate.risk<=0)throw Error('Risk estimate unavailable.');
        const raw=Math.min(next.volume_max,next.equity*.02/estimate.risk*next.volume_min);
        body.volume=Number((Math.floor(raw/next.volume_step)*next.volume_step).toFixed(8));
        if(body.volume<next.volume_min)throw Error('Minimum lot exceeds the 2% risk budget.');
      }
      const result=await call('terminal/preview',body);
      if(!conditionContextValid(run))return;
      if(JSON.stringify([result.server,result.account])!==run.scope)throw Error('Account changed during review.');
      if(run.action==='REVIEW'){
        invalidate();preview=result.preview;
        el('order-summary').textContent=`CONDITIONS COMPLETE · DEMO ${result.account} / ${result.server} · ${body.side} ${result.order_kind} · ${result.request.volume} lots ${body.symbol} at ${result.request.price} · SL ${result.request.sl} · TP ${result.request.tp}. Frozen settings from Start; confirm below.`;
        el('submit').hidden=false;expiryTimer=setTimeout(()=>{if(preview===result.preview){invalidate(false);el('order-summary').append(text('p','Condition review expired. Start again.'));}},result.expires_in*1000);
        conditionRun=null;conditionMessage('Finished. Confirm the prepared order in the ticket.');return;
      }
      // Consume this arm before the only send. Unknown outcomes are never retried.
      conditionRun=null;submitting=true;invalidate();updateTicket();
      const sent=await call('terminal/submit',{preview:result.preview});
      conditionMessage(`Finished · broker ${sent.retcode}: ${sent.comment}. Order ${sent.order}, deal ${sent.deal}. Check MT5 for final status.`);
    }catch(error){conditionRun=null;conditionMessage(`Stopped: ${error.message} No automatic retry. Check MT5 before rearming.`);}
    finally{conditionBusy=false;submitting=false;updateTicket();}
  }
  el('condition-start').onclick=async()=>{
    if(conditionBusy||submitting||reviewing||closing)return;
    try{
      if(!market||document.hidden||el('pane').hidden)throw Error('Connect and open Terminal first.');
      const rows=C.validate(conditionRows()),action=el('condition-action').value;
      const timeout=Number(el('condition-timeout').value)*60,gap=Number(el('condition-gap').value);
      if(!Number.isFinite(timeout)||!Number.isFinite(gap)||timeout<0||gap<0)throw Error('Timeout and quote gap must be nonnegative.');
      if(action!=='ALERT'&&(!market.demo||editingOrder||editingPosition))throw Error('Use a new demo order ticket for condition entries.');
      const ticket={symbol:el('symbol').value,side:el('side').value,order_kind:el('order-kind').value,price:el('order-price').value,volume:el('volume').value,sl:el('sl').value,tp:el('tp').value};
      if(action!=='ALERT'&&(!(Number(ticket.sl)>0)||!(Number(ticket.tp)>0)))throw Error('Enter SL and TP in the order ticket first.');
      stopConditions('');saveConditions();invalidate();
      conditionRun={scope,symbol:ticket.symbol,action,ticket,sizing:el('condition-sizing').value,sequence:new C.Sequence(rows,{timeout,gap}),attempted:false};
      conditionMessage(`${action==='AUTO'?'DEMO ORDER ARMED':action==='REVIEW'?'Review preparation running':'Alerts running'} · step ${rows.length?1:0} of ${rows.length}. Draft edits require Start again.`);
      if(!rows.length)await conditionComplete(conditionRun);
    }catch(error){conditionMessage(error.message);}
  };
  async function checkConditions(next,version){
    restoreConditions();const run=conditionRun;if(!run||run.attempted||conditionBusy)return;
    if(!conditionContextValid(run)){stopConditions('Stopped: monitoring context changed.');return;}
    const now=Date.now()/1000;if(next.quote_time<now-30||next.quote_time>now+5){stopConditions('Stopped: quote is stale.');return;}
    const step=run.sequence.rows[run.sequence.index];let candles=[];
    if(step?.mode==='CANDLE'){
      try{
        const data=step.timeframe===el('timeframe').value?next:await call('terminal/market',{symbol:run.symbol,timeframe:step.timeframe});
        if(!conditionContextValid(run)||version!==revision)return;
        if(JSON.stringify([data.server,data.account])!==run.scope)throw Error('Account changed.');
        // The final bar is forming; only prior bars can satisfy candle rules.
        candles=data.bars.slice(0,-1).map(b=>({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4]}));
        if(candles.length<2)throw Error('Not enough completed candles.');
      }catch(error){stopConditions('Stopped: '+error.message);return;}
    }
    if(run.sequence.observe({bid:next.bid,time:next.quote_time,candles}))await conditionComplete(run);
    else conditionMessage(`${run.action==='AUTO'?'DEMO ORDER ARMED':'Monitoring'} · step ${run.sequence.index+1} of ${run.sequence.rows.length}. Draft edits require Start again.`);
  }

  buildChart();setTool('cursor');
  new MutationObserver(()=>{if(!el('pane').hidden){if(!running)connectWorkspace(true);else refresh();}}).observe(el('pane'),{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopConditions('Stopped: browser is hidden. Start again when ready.');else refresh();});
  new MutationObserver(()=>{if(el('pane').hidden)stopConditions('Stopped: Terminal is hidden.');}).observe(el('pane'),{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('DOMContentLoaded',()=>connectWorkspace(true));
  setInterval(()=>{if(!running&&!connecting&&!autoReconnectBlocked&&!document.hidden&&!el('pane').hidden&&Date.now()>=nextAutoConnect)connectWorkspace(true);else refresh();},2000);
})();
