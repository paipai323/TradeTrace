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
  let conditionDrag=null;
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
    renderMonitorList();
    el('setup-new').disabled=conditionBusy||submitting||reviewing||closing;
    el('condition-start').disabled=!conditionDraftValid||conditionBusy||submitting||reviewing||closing;
    renderConditionComparison();
    el('condition-stop').disabled=!serverMonitorActive()&&!conditionBusy;
    const fresh=market&&Date.now()/1000-market.quote_time<=30&&market.quote_time<=Date.now()/1000+5;
    el('preview').disabled=!market||!fresh||submitting||reviewing||closing||(autoDraftSizing()&&(!ticketEstimate?.auto_volume||ticketEstimate.key!==ticketEstimateKey||!!ticketEstimateError));
    el('alert-add').disabled=!market;
  }
  function cancelClose(hide=true){
    closeRevision++;clearTimeout(closeExpiryTimer);closeToken=null;closePosition=null;cancelOrder=null;closeLoading=false;el('close-confirm').hidden=true;
    if(hide)el('close-review').hidden=true;
  }
  function updateCloseButtons(){document.querySelectorAll('.terminal-close-action,.terminal-cancel-action').forEach(button=>button.disabled=!market||closing||closeLoading||submitting);}
  async function reviewClose(position){
    if(closing||closeLoading||submitting)return;cancelClose();closeOperation='close';el('close-heading').textContent=`Close position · ${market?.demo?'DEMO':'LIVE'}`;el('close-confirm').textContent='Confirm close entire position';closeLoading=true;closePosition={...position};const version=closeRevision;
    el('close-review').hidden=false;el('close-summary').textContent=`Review closing #${position.ticket} · ${position.symbol} · ${position.type===0?'BUY':'SELL'} · entire ${position.volume} lots.`;
    el('close-status').textContent='Checking the position and current broker quote…';el('close-cancel').disabled=false;el('close-cancel').textContent='Cancel';updateCloseButtons();
    try{
      const result=await call('terminal/close-preview',{position:position.ticket});if(version!==closeRevision)return;
      closeToken=result.preview;const r=result.request;
      el('close-summary').textContent=`${result.demo===false?'LIVE':result.demo===true?'DEMO':market?.demo?'DEMO':'LIVE'} ${result.account} / ${result.server} · Close #${r.position} · ${r.symbol} · entire ${r.volume} lots at market (current closing quote ${r.price}).`;
      el('close-status').textContent='Execution price can change. This review expires in 60 seconds.';el('close-confirm').hidden=false;
      closeExpiryTimer=setTimeout(()=>{if(closeToken===result.preview){cancelClose(false);el('close-status').textContent='Review expired. Select Close on the position again.';}},result.expires_in*1000);
    }catch(error){if(version===closeRevision)el('close-status').textContent=error.message;}
    finally{if(version===closeRevision){closeLoading=false;updateCloseButtons();}}
  }
  async function reviewCancel(order){
    if(closing||closeLoading||submitting)return;cancelClose();closeOperation='cancel';cancelOrder={...order};closeLoading=true;const version=closeRevision;
    el('close-review').hidden=false;el('close-review').scrollIntoView({block:'nearest'});el('close-heading').textContent=`Cancel pending order · ${market?.demo?'DEMO':'LIVE'}`;el('close-confirm').textContent='Confirm cancel pending order';el('close-cancel').textContent='Go back';el('close-cancel').disabled=false;
    el('close-summary').textContent=`Cancel pending #${order.ticket} · ${order.symbol} · ${order.volume} lots at ${order.price}.`;
    el('close-status').textContent='Checking the order is still pending…';updateCloseButtons();
    try{const result=await call('terminal/cancel-preview',{order:order.ticket});if(version!==closeRevision)return;closeToken=result.preview;
      el('close-summary').textContent=`${result.demo===false?'LIVE':result.demo===true?'DEMO':market?.demo?'DEMO':'LIVE'} ${result.account} / ${result.server} · Cancel pending #${result.request.order} · ${result.request.symbol}.`;
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
      const button=node.lastChild;button.disabled=!market||closing||closeLoading||submitting;
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
      const rr=draftRiskReward();if(!item.add&&item.field==='order-price'&&rr!==null)label+=` · RR 1:${rr.toFixed(2)}`;
      if(grip.textContent!==label)grip.textContent=label;
      grip.title=item.add?'Drag to add '+(item.field==='sl'?'stop loss':'take profit'):'Drag to change '+item.title.toLowerCase();grip.dataset.ticketAdd=item.add?item.field:'';if(!item.add&&item.field!=='order-price')grip.title+=` · Price ${item.price.toFixed(market.digits)} · Estimated gross P/L; excludes fees${ticketEstimate?.key!==ticketEstimateKey?' · Updating estimate':''}`;
      if(!item.add&&item.field==='order-price'&&rr!==null)grip.title+=' · Risk/reward by entry-to-SL/TP price distances; excludes fees and slippage';
      if(!item.add&&item.field==='order-price'&&autoDraftSizing()&&ticketEstimateError)grip.title+=' · '+ticketEstimateError;
      node.lastChild.hidden=item.add;node.lastChild.title=item.field==='order-price'?'Dismiss draft (no broker order changed)':'Remove '+(item.field==='sl'?'stop loss':'take profit');node.lastChild.setAttribute('aria-label',item.field==='order-price'?'Dismiss order draft':'Remove '+(item.field==='sl'?'stop loss':'take profit'));
      node.style.left=Math.max(0,Math.min(item.left,size.width-node.offsetWidth-4))+'px';
    }
  }
  function autoDraftSizing(){return !el('auto-plan-enabled')?.checked&&el('condition-sizing')?.value==='AUTO'&&!editingPosition&&!editingOrder;}
  function draftEstimateBody(){
    if(!market||ticketDraftHidden||!el('show-ticket').checked)return null;
    const body={symbol:el('symbol').value,side:el('side').value,entry:entryReference(),volume:Number(el('volume').value),sl:Number(el('sl').value),tp:Number(el('tp').value)};
    if(autoDraftSizing()){body.risk_auto=true;body.volume=market.volume_min;body.equity=market.equity;if(!body.sl)return null;}
    return Object.values(body).filter(v=>typeof v==='number').every(Number.isFinite)&&body.entry>0&&body.volume>0&&body.sl>=0&&body.tp>=0&&(body.sl||body.tp)?body:null;
  }
  function draftRiskReward(){
    const entry=entryReference(),sl=Number(el('sl').value),tp=Number(el('tp').value),direction=el('side').value==='BUY'?1:-1;
    if(![entry,sl,tp].every(value=>Number.isFinite(value)&&value>0))return null;
    const risk=direction*(entry-sl),reward=direction*(tp-entry);return risk>0&&reward>0?reward/risk:null;
  }
  function estimateMoney(value,currency){return `${value>=0?'+':'−'}${Math.abs(value).toFixed(2)} ${currency}`;}
  function renderTicketEstimate(){
    const body=draftEstimateBody(),node=el('ticket-estimate');node.hidden=!body&&!autoDraftSizing();
    const show=message=>{if(node.textContent!==message)node.textContent=message;};
    if(!body){node.hidden=false;show(!market?'Connect MT5 to calculate risk.':readAutoPlan().enabled?'Automatic condition plan: SL, TP and lots are calculated when conditions pass.':ticketDraftHidden&&(Number(el('sl').value)>0||Number(el('tp').value)>0)?'Order levels are hidden. Edit the Order ticket to preview its risk.':autoDraftSizing()?'2% equity sizing: add a valid stop loss to calculate lots.':'Add SL / TP to calculate risk and reward.');return;}
    if(body.risk_auto&&ticketEstimateError){show(`2% equity: ${ticketEstimateError} No valid automatic lot size for this draft.`);return;}
    const stale=ticketEstimate&&ticketEstimate.key!==ticketEstimateKey;
    const parts=['tp','sl'].filter(field=>body[field]>0).map(field=>{
      const value=ticketEstimate?.[field];return `${field.toUpperCase()}: ${Number.isFinite(value)?estimateMoney(value,ticketEstimate.currency):'unavailable'}`;
    });
    const sizing=body.risk_auto&&ticketEstimate?.auto_volume?`2% equity · ${ticketEstimate.auto_volume} lots · Budget ${ticketEstimate.risk_budget.toFixed(2)} ${ticketEstimate.currency} · Modeled risk ${ticketEstimate.modeled_risk.toFixed(2)} ${ticketEstimate.currency}. `:'';
    node.title=stale?'Updating · showing the last completed estimate':'';
    show(ticketEstimate?`${sizing}Est. ${parts.join(' · ')}${draftRiskReward()!==null?' · RR 1:'+draftRiskReward().toFixed(2):''}${ticketEstimateError?' · '+ticketEstimateError+' (previous estimate)':''}. Excludes commission, swap and slippage.`:ticketEstimateError||'Estimating SL / TP amounts…');
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
    if(!market)return null;
    for(const order of [...(market.orders||[])].reverse()){
      if(order.symbol!==el('symbol').value||![2,3,4,5].includes(order.type))continue;
      for(const [key,field] of [['price','order-price'],['sl','sl'],['tp','tp']])if(order[key]>0&&Math.abs(main.priceToCoordinate(order[key])-p.y)<=6)return {order,field};
    }return null;
  }
  function endOrderEdit(){
    editingOrder=null;editingPosition=null;el('order-price').disabled=false;el('ticket-editing').hidden=true;el('ticket-edit-cancel').hidden=true;el('side').disabled=false;el('volume').disabled=false;
    document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.disabled=false);el('preview').textContent='Review order';invalidate();
  }
  function beginOrderEdit(order){
    selectSetupTab('order');
    if(!el('setup-builder').open)el('quick-editor').open=true;
    if(!market||submitting||closing||order.symbol!==el('symbol').value)return false;
    editingPosition=null;el('order-price').disabled=false;editingOrder={...order};if(smallPanels())el('pane').classList.add('mobile-ticket-open');else el('pane').classList.remove('ticket-collapsed');sizePanels();selectDrawing(-1);el('order-kind').value='PENDING';el('side').value=[2,4].includes(order.type)?'BUY':'SELL';
    el('order-price').value=order.price;el('sl').value=order.sl||'';el('tp').value=order.tp||'';el('volume').value=order.volume;
    el('side').disabled=true;el('volume').disabled=true;document.querySelectorAll('[data-ticket-mode]').forEach(button=>button.disabled=true);
    el('ticket-editing').hidden=false;el('ticket-editing').textContent=`Amending pending #${order.ticket} · changes are not sent until confirmed.`;el('ticket-edit-cancel').hidden=false;el('preview').textContent='Review pending amendment';el('show-ticket').checked=true;updateOrderKind();return true;
  }
  function beginPositionEdit(position){
    selectSetupTab('order');
    if(!el('setup-builder').open)el('quick-editor').open=true;
    if(!market||submitting||closing||position.symbol!==el('symbol').value)return false;
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
    el('drawing-condition').disabled=!item||!['level','rectangle'].includes(item.type);
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
    renderConditionPreviews(ctx,size);
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
  function setTool(value){finishConditionDrag(true);conditionPick=null;finishDrawingDrag(true);selectDrawing(-1);tool=value;pending=null;document.querySelectorAll('[data-drawing]').forEach(b=>{b.classList.toggle('selected',b.dataset.drawing===value);b.setAttribute('aria-pressed',String(b.dataset.drawing===value));});chart?.applyOptions({handleScroll:value==='cursor',handleScale:{axisPressedMouseMove:true,mouseWheel:value==='cursor',pinch:value==='cursor'}});el('chart').style.cursor=value==='cursor'?'crosshair':'copy';el('tool-hint').textContent=value==='cursor'?'Scroll to zoom · click drawings to select · drag empty space to pan':value==='level'?'Click anywhere in the price pane to place a level':isPosition({type:value})?'Click to place entry · drag entry, target, stop or width handles':'Click two anchors · Escape cancels';primitive?.update();}
  function clearMarket(){finishConditionDrag(true);conditionPick=null;detachConditions('Stopped: connection or chart selection changed.');finishOrderDrag(true);if(draftSymbol&&draftSymbol!==el('symbol').value){endOrderEdit();for(const field of ['order-price','sl','tp'])el(field).value='';}draftSymbol=el('symbol').value;if(!closing)cancelClose();market=null;queueTicketEstimate();bars=[];renderTicketHandles(chart.paneSize(0));renderBrokerHandles(chart.paneSize(0));lastChartKey='';invalidate();pending=null;main?.setData([]);for(const series of Object.values(overlays))series.setData([]);for(const line of priceLines)main.removePriceLine(line);priceLines=[];el('chart-empty').hidden=false;el('chart-empty').replaceChildren(text('span','Loading broker candles…'));el('ohlc').textContent='';el('bid').textContent='BID —';el('ask').textContent='ASK —';el('positions').replaceChildren();}
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
    if(loading||!running||drawingDrag||orderDrag||conditionDrag||el('pane').hidden||document.hidden)return;
    loading=true;const version=revision;
    try{
      const symbol=el('symbol').value,timeframe=el('timeframe').value;
      const next=await call('terminal/market',{symbol,timeframe});if(version!==revision||drawingDrag||orderDrag||conditionDrag)return;
      if(JSON.stringify([next.server,next.account])!==scope){autoReconnectBlocked=true;running=false;clearMarket();throw Error('MT5 account changed. Connect again to load its workspace.');}
      market=next;rememberStructureHistory(timeframe,next);loadStructureDrafts();bars=next.bars.map(b=>({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]||0}));
      const stale=Date.now()/1000-next.quote_time>30;
      el('feed').textContent=stale?'Last available quotes':next.demo?'Demo · connected':'Live · connected';el('feed').classList.toggle('online',!stale);
      el('chart-title').textContent=`${symbol} · ${intervalLabel(timeframe)}`;el('ticket-symbol').textContent=symbol;
      el('bid').textContent='BID '+format(next.bid);el('ask').textContent='ASK '+format(next.ask);el('quote-time').textContent=(stale?'STALE · ':'')+new Date(next.quote_time*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
      el('account').replaceChildren(text('strong',`${next.demo?'DEMO':'LIVE'} · ${next.account}`),text('small',next.server),...['balance','equity','margin_free'].map(name=>text('div',`${name==='margin_free'?'Free margin':name[0].toUpperCase()+name.slice(1)}  ${Number(next[name]).toFixed(2)} ${next.currency}`)));
      el('volume').min=next.volume_min;el('volume').max=next.volume_max;el('volume').step=next.volume_step;el('volume-info').textContent=`${next.volume_min}–${next.volume_max} lots · step ${next.volume_step} · spread ${format(next.ask-next.bid)}`;
      el('position-count').textContent=next.positions.length;
      if(closeToken&&closePosition&&!closing){const current=next.positions.find(p=>p.ticket===closePosition.ticket);if(!current||current.volume!==closePosition.volume||current.type!==closePosition.type||current.symbol!==closePosition.symbol){cancelClose(false);el('close-status').textContent='Position changed or is no longer open. Review it again before closing.';}}
      const rows=next.positions.map(p=>{const row=document.createElement('tr');for(const value of [p.ticket,p.symbol,p.type===0?'BUY':'SELL',p.volume,p.price_open,p.price_current,p.sl||'—',p.tp||'—',p.profit])row.append(text('td',value));row.lastChild.className=p.profit>=0?'gain':'loss';const action=document.createElement('td'),edit=text('button','Edit SL / TP');edit.type='button';edit.dataset.editPosition=p.ticket;edit.disabled=p.symbol!==symbol||submitting||closing;edit.onclick=()=>beginPositionEdit(p);action.append(edit);const button=text('button','Close','terminal-close-action');button.type='button';button.dataset.position=p.ticket;button.title='Review closing this entire position';button.disabled=closing||closeLoading||submitting;button.onclick=()=>reviewClose(p);action.append(button);row.append(action);return row;});
      el('positions').replaceChildren(...(rows.length?rows:[(()=>{const row=document.createElement('tr'),cell=text('td','No open positions.');cell.colSpan=10;row.append(cell);return row;})()]));
      if(editingPosition&&!next.positions.some(p=>p.ticket===editingPosition.ticket)){endOrderEdit();for(const field of ['order-price','sl','tp'])el(field).value='';el('order-summary').textContent='Position is no longer open. No amendment sent.';}
      const orders=next.orders||[];el('pending-count').textContent=orders.length;
      if(editingOrder&&!orders.some(order=>order.ticket===editingOrder.ticket)){endOrderEdit();for(const field of ['order-price','sl','tp'])el(field).value='';el('order-summary').textContent='The order is no longer pending. Check positions before creating another order.';}
      if(closeToken&&cancelOrder&&!closing&&!orders.some(o=>o.ticket===cancelOrder.ticket)){cancelClose(false);el('close-status').textContent='Order is no longer pending. Check whether it filled in open positions.';}
      const orderNames={2:'BUY LIMIT',3:'SELL LIMIT',4:'BUY STOP',5:'SELL STOP',6:'BUY STOP LIMIT',7:'SELL STOP LIMIT'};
      el('orders').replaceChildren(...(orders.length?orders.map(order=>{const row=document.createElement('tr');for(const value of [order.ticket,order.symbol,orderNames[order.type]||order.type,order.volume,order.price,order.sl||'—',order.tp||'—'])row.append(text('td',value));const cell=document.createElement('td'),button=text('button','Cancel','terminal-cancel-action');button.type='button';button.dataset.order=order.ticket;button.disabled=closing||closeLoading||submitting;button.onclick=()=>reviewCancel(order);const edit=text('button','Edit');edit.type='button';edit.dataset.editOrder=order.ticket;edit.disabled=order.symbol!==el('symbol').value||![2,3,4,5].includes(order.type)||submitting||closing;edit.onclick=()=>beginOrderEdit(order);cell.append(edit,button);row.append(cell);return row;}):[(()=>{const row=document.createElement('tr'),cell=text('td','No pending orders.');cell.colSpan=8;row.append(cell);return row;})()]));
      if(tradeTab==='closed'&&(closedScope!==scope||Date.now()-closedAt>15000))loadClosed();
      updateTicket();renderMarket();status(stale?'Market is quiet or closed. Showing the latest available broker candles.':`${symbol} · ${bars.length} broker candles · ${next.interval_note||'Drawings and layouts save locally'}`);
      await checkConditions(next,version);
      const quoteSymbols=[...new Set([...state.watch,...state.alerts.filter(a=>!a.fired).map(a=>a.symbol)])];
      if(quoteSymbols.length){try{const result=await call('terminal/quotes',{symbols:quoteSymbols});if(version===revision){if(JSON.stringify([result.server,result.account])!==scope)throw Error('Account changed. Reconnect MT5.');quotes=result.quotes;renderWatchlist();checkAlerts();}}catch(error){if(version===revision)status('Chart loaded; watchlist quotes unavailable: '+error.message);}}
    }catch(error){if(version===revision){el('feed').textContent='Disconnected';el('feed').classList.remove('online');status(error.message);detachConditions('Stopped: market connection lost.');running=false;nextAutoConnect=Date.now()+10000;market=null;invalidate();}}
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
    selectSetupTab('order');
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
  el('pane').addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;if(event.key==='Escape'){finishConditionDrag(true);conditionPick=null;finishOrderDrag(true);setTool('cursor');}if((event.key==='Delete'||event.key==='Backspace')&&selectedDrawing>=0){event.preventDefault();removeSelectedDrawing();}});
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
  el('ticket').oninput=event=>{if(!['terminal-order-price','terminal-volume','terminal-sl','terminal-tp'].includes(event.target.id))return;ticketDraftHidden=false;saved.ticketDraftHidden=false;updateOrderHint();invalidate();syncDraftLines();};
  el('ticket').onsubmit=async event=>{
    event.preventDefault();if(submitting||reviewing||closing)return;invalidate();reviewing=true;updateTicket();const version=ticketRevision;
    const body={symbol:el('symbol').value,side:el('side').value,order_kind:el('order-kind').value,price:el('order-price').value,volume:el('volume').value,sl:el('sl').value,tp:el('tp').value};
    try{const result=await call(editingPosition?'terminal/position-preview':editingOrder?'terminal/modify-preview':'terminal/preview',editingPosition?{position:editingPosition.ticket,sl:body.sl,tp:body.tp}:editingOrder?{order:editingOrder.ticket,price:body.price,sl:body.sl,tp:body.tp}:body);if(version!==ticketRevision)return;preview=result.preview;
      const r=result.request;const kind=result.order_kind||inferredKind()||body.order_kind;el('order-summary').replaceChildren(text('strong',`${result.demo===false?'LIVE':result.demo===true?'DEMO':market?.demo?'DEMO':'LIVE'} ${result.account} / ${result.server}`),text('p',editingPosition?`AMEND position #${editingPosition.ticket} · SL ${r.sl||'none'} · TP ${r.tp||'none'}. Entry and volume remain fixed.`:editingOrder?`AMEND pending #${editingOrder.ticket} · entry ${r.price} · SL ${r.sl||'none'} · TP ${r.tp||'none'}. Original broker type and expiration are preserved.`:`${body.side} ${kind} · ${r.volume} lots ${r.symbol} ${body.order_kind==='MARKET'?'at market (quote '+r.price+')':'at entry '+r.price+' · Good Till Cancelled'}. SL ${r.sl||'none'} · TP ${r.tp||'none'}.`));el('submit').textContent=`Confirm & send ${(result.demo??market?.demo)?'demo':'LIVE'} order`;el('submit').hidden=false;
      expiryTimer=setTimeout(()=>{if(preview===result.preview){invalidate(false);el('order-summary').append(text('p','Preview expired. Review again.'));}},result.expires_in*1000);
    }catch(error){if(version===ticketRevision)el('order-summary').textContent=error.message;}finally{reviewing=false;updateTicket();}
  };
  el('submit').onclick=async()=>{
    if(!preview||submitting||closing)return;const token=preview;invalidate(false);submitting=true;updateTicket();
    try{const result=await call('terminal/submit',{preview:token});el('order-summary').replaceChildren(text('strong',`Broker result ${result.retcode}: ${result.comment}`),text('p',result.operation==='position-sltp'?`Position SL / TP amendment result. ${result.message}`:result.operation==='modify'?`Pending amendment result for order ${result.order}. Check the broker order list for final levels. ${result.message}`:result.operation==='pending'?`Pending order ${result.order}. Broker result determines acceptance; this is not a filled position. ${result.message}`:`Order ${result.order} · deal ${result.deal} · filled ${result.volume} at ${result.price}. ${result.message}`));if(result.journal_warning)el('order-summary').append(text('p',result.journal_warning));else if(result.journal_recorded)el('order-summary').append(text('p','Condition setup saved to journal.'));if(result.operation==='pending'){selectTradeTab('pending');for(const field of ['order-price','sl','tp'])el(field).value='';updateOrderHint();syncDraftLines();}}
    catch(error){el('order-summary').textContent=error.message+' Check MT5 before retrying.';}finally{submitting=false;updateTicket();refresh();}
  };
  el('journal').onclick=()=>{if(typeof allowJournalSwitch==='function'&&!allowJournalSwitch())return;document.getElementById('journal-search').value=el('symbol').value;showJournalView('journal');};
  el('sync-journal').onclick=async()=>{if(typeof task!=='function')return;await task(async()=>{await loadHistory();status('Closed trades synced to your journal for the selected history dates.');});};
  // Capture selected-object drags before the chart can interpret them as panning.
  el('chart').addEventListener('pointerdown',event=>{
    if(tool!=='cursor'||!market||event.button!==0)return;
    const p=pointerPoint(event),size=chart.paneSize(0);if(p.x<0||p.y<0||p.x>size.width||p.y>size.height)return;
    if(pickConditionPrice(event,p))return;
    const conditionHit=conditionLineHit(p);if(conditionHit&&!drawingHit(p)){startConditionDrag(event,conditionHit);return;}
    const hit=drawingHit(p),draft=draftLevelHit(p),broker=pendingLevelHit(p),position=(market.positions||[]).filter(item=>item.symbol===el('symbol').value).flatMap(item=>['sl','tp'].map(field=>({position:item,field,y:item[field]>0?main.priceToCoordinate(item[field]):null}))).find(item=>Number.isFinite(item.y)&&Math.abs(item.y-p.y)<=6);
    if(!submitting&&!closing&&!hit&&!draft&&!broker&&position&&market){if(beginPositionEdit(position.position))startTicketDrag(event,position.field);return;}
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
    if(conditionDrag){moveConditionDrag(event);return;}
    if(orderDrag){event.preventDefault();event.stopImmediatePropagation();const size=chart.paneSize(0),price=main.coordinateToPrice(Math.max(0,Math.min(size.height,p.y)));if(price>0){el(orderDrag.field).value=dragProtectionPrice(orderDrag.field,price).toFixed(market.digits);updateOrderKind();}el('chart').style.cursor='ns-resize';return;}
    if(!drawingDrag&&conditionLineHit(p)){el('chart').style.cursor='ns-resize';return;}
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
  el('chart').addEventListener('pointerup',event=>{if(conditionDrag){event.preventDefault();event.stopImmediatePropagation();finishConditionDrag();return;}if(orderDrag){event.preventDefault();event.stopImmediatePropagation();finishOrderDrag();return;}if(!drawingDrag)return;event.preventDefault();event.stopImmediatePropagation();finishDrawingDrag();},true);
  el('chart').addEventListener('pointercancel',()=>{finishConditionDrag(true);finishOrderDrag(true);finishDrawingDrag(true);},true);
  const C=window.TerminalConditions;
  let conditionRun=null,conditionBusy=false,conditionDraftScope='',conditionFinished='',conditionLastResult='',conditionApplied=null,conditionDraftValid=true;
  const conditionMessage=message=>{if(el('condition-status').textContent!==message)el('condition-status').textContent=message;const phase=serverMonitorActive()?(serverMonitor.phase==='review'?'Review':'Running'):serverMonitor?.phase==='saved'?'Saved':serverMonitor?.phase==='stopped'&&serverMonitor.interruption?.enabled?'Interrupted':conditionFinished?(conditionFinished.startsWith('Invalidated')?'Invalidated':conditionFinished.startsWith('Skipped')?'Skipped':'Finished'):conditionBusy?'Finishing':message.startsWith('Stopped')?'Stopped':'Draft';el('setup-phase').textContent=phase;el('setup-phase').dataset.phase=phase.toLowerCase();el('condition-stop').disabled=!serverMonitorActive()&&!conditionBusy;el('setup-new').disabled=conditionBusy||submitting||reviewing||closing;};
  const conditionStorage=()=>`tradetrace.conditions.v1:${scope}:${el('symbol').value}`;
  function detachConditions(message){serverStateKey='' ;if(serverMonitorActive()){conditionMessage(`${serverMonitor.symbol} · server monitoring continues. Reconnecting the display does not stop it.`);return;}conditionRun=null;if(conditionApplied?.state==='running')conditionApplied.state='stopped';if(el('condition-status'))conditionMessage(conditionFinished||message);renderConditionProgress();}
  function conditionRows(){return [...el('condition-list').children].map(row=>({id:row.dataset.conditionId,visible:row.dataset.visible!=='false',...Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input=>[input.dataset.field,['level','low','high','sensitivity'].includes(input.dataset.field)?Number(input.value):input.value]))}));}
  function saveConditions(){recordConditionUndo();try{localStorage.setItem(conditionStorage(),JSON.stringify({rows:conditionRows(),sizing:el('condition-sizing').value,autoPlan:readAutoPlan(),invalidation:readInvalidation(),entryQuality:readEntryQuality(),monitoring:readMonitorSettings(),timeout:el('condition-timeout').value,gap:el('condition-gap').value,finished:conditionFinished,lastResult:conditionLastResult,applied:conditionApplied?.state==='finished'?conditionApplied:null,showLevels:el('condition-show-levels').checked,showZones:el('condition-show-zones').checked}));}catch(_){conditionMessage('Cannot save condition draft locally.');}updateConditionSummaries();primitive?.update();}
  function conditionRow(value={rule:'TRADED_ABOVE',mode:'LIVE',timeframe:'H1',level:0,low:0,high:0}){
    const row=text('div','','terminal-condition-row');row.dataset.visible=String(value.visible!==false);row.dataset.conditionId=typeof value.id==='string'&&value.id&&!([...el('condition-list').children].some(item=>item.dataset.conditionId===value.id))?value.id:crypto.randomUUID();
    const header=text('div','','terminal-condition-row-header'),summary=text('button','','terminal-condition-summary'),editor=text('div','','terminal-condition-editor');summary.type='button';summary.setAttribute('aria-expanded','true');summary.onclick=()=>selectCondition(selectedConditionRow===row?null:row);const badge=text('span','Draft','terminal-condition-progress');badge.dataset.progress='draft';badge.setAttribute('aria-label','Condition progress');const duplicate=text('button','⧉','terminal-condition-duplicate');duplicate.type='button';duplicate.title='Duplicate condition';duplicate.setAttribute('aria-label','Duplicate condition');duplicate.onclick=event=>{event.stopPropagation();duplicateCondition(row);};header.append(summary,badge,duplicate);row.append(header,editor);
    row.onfocusin=event=>{if(event.target.matches('[data-field]'))conditionHistoryGroup={label:'Edit '+event.target.getAttribute('aria-label'),recorded:false};if(!event.target.closest('.terminal-condition-summary'))selectCondition(row);};row.onfocusout=event=>{if(event.target.matches('[data-field]'))conditionHistoryGroup=null;};row.onclick=event=>{if(row.isConnected&&!event.target.closest('.terminal-condition-summary'))selectCondition(row);};
    const visibility=text('label','Show on chart'),check=document.createElement('input');check.type='checkbox';check.checked=value.visible!==false;check.setAttribute('aria-label','Show condition on chart');check.onchange=()=>{row.dataset.visible=String(check.checked);saveConditions();};visibility.prepend(check);header.append(visibility);
    const add=(title,name,options)=>{const label=text('label',title),input=document.createElement(options?'select':'input');input.dataset.field=name;input.setAttribute('aria-label',title);if(options)for(const [code,label] of options)input.append(new Option(label,code));else{input.type='number';input.step='any';input.min='0';}input.value=value[name];label.append(input);if(!options&&name!=='sensitivity'){const pick=text('button','Pick on chart');pick.type='button';pick.onclick=()=>{setTool('cursor');selectCondition(row);conditionPick={row,field:name};if(el('setup-builder').open)closeSetupBuilder(true);el('tool-hint').textContent='Click the chart to set condition '+name+' · Escape cancels';};label.append(pick);}editor.append(label);return input;};
    const rule=add('Rule','rule',Object.entries(C.rules)),mode=add('Evaluate','mode',[['LIVE','Live Bid'],['CANDLE','Completed candle']]),tf=add('Timeframe','timeframe',C.frames.map(f=>[f,f]));
    value={sensitivity:2,...value};
    const sensitivity=add('Swing candles each side','sensitivity');sensitivity.min='1';sensitivity.max='10';sensitivity.step='1';
    const structureNote=text('p','','terminal-muted');editor.append(structureNote);
    const level=add('Price level','level'),low=add('Zone low','low'),high=add('Zone high','high');
    const update=()=>{conditionPick=null;if(C.candleOnly(rule.value))mode.value='CANDLE';mode.disabled=C.candleOnly(rule.value);tf.parentNode.hidden=mode.value==='LIVE';level.parentNode.hidden=C.zone(rule.value)||C.structure(rule.value);sensitivity.disabled=!C.structure(rule.value);sensitivity.parentNode.hidden=structureNote.hidden=!C.structure(rule.value);structureNote.textContent='Confirmed swings only. A swing needs '+sensitivity.value+' closed candles to its right. Wicks do not count as breaks.';low.parentNode.hidden=high.parentNode.hidden=!C.zone(rule.value);saveConditions();};
    row.onchange=event=>{const apply=()=>{if(event.target===rule){if(C.zone(rule.value))seedConditionZone(row);else if(!C.structure(rule.value))seedConditionLevel(row);}update();};if(event.target.matches('select[data-field]'))conditionHistoryTransaction('Edit '+event.target.getAttribute('aria-label'),apply);else apply();};row.oninput=event=>{if(event.target.tagName!=='SELECT'){structureNote.textContent='Confirmed swings only. A swing needs '+sensitivity.value+' closed candles to its right. Wicks do not count as breaks.';saveConditions();}};
    for(const [label,action] of [['↑',()=>{if(row.previousElementSibling)row.previousElementSibling.before(row);}],['↓',()=>{if(row.nextElementSibling)row.nextElementSibling.after(row);}],['Remove',()=>row.remove()]]){const button=text('button',label);button.type='button';button.setAttribute('aria-label',label==='↑'?'Move condition up':label==='↓'?'Move condition down':'Remove condition');button.onclick=event=>{event.stopPropagation();conditionHistoryTransaction(label==='Remove'?'Remove condition':label==='↑'?'Move condition up':'Move condition down',action);};editor.append(button);}
    el('condition-list').append(row);selectCondition(row);update();return row;
  }
  function restoreConditions(){
    const key=conditionStorage();if(conditionDraftScope===key)return;conditionHistorySuspended=true;conditionDraftScope=key;
    let value={};try{value=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
    restoreConditionEvents();
    const applied=value.applied;conditionApplied=applied?.state==='finished'&&Array.isArray(applied.rows)&&applied.index===applied.rows.length?applied:null;
    conditionLastResult=typeof value.lastResult==='string'?value.lastResult:typeof value.finished==='string'?value.finished:'';renderSetupResult();
    conditionFinished=typeof value.finished==='string'?value.finished:'';detachConditions('Stopped. Review the restored draft and start when ready.');
    selectedConditionRow=null;conditionPick=null;
    el('condition-show-levels').checked=value.showLevels!==false;el('condition-show-zones').checked=value.showZones!==false;
    el('condition-list').replaceChildren();el('condition-action').value='ALERT';
    el('condition-sizing').value=value.sizing==='AUTO'?'AUTO':'MANUAL';setAutoPlan(value.autoPlan);setInvalidation(value.invalidation);setEntryQuality(value.entryQuality);setMonitorSettings(value.monitoring);
    for(const name of ['timeout','gap'])el('condition-'+name).value=Number.isFinite(Number(value[name]))&&Number(value[name])>=0?value[name]:(name==='gap'?300:0);
    if(Array.isArray(value.rows))for(const row of value.rows)if(row&&typeof row==='object')conditionRow(row);
    resetConditionUndo();renderConditionValidation();if(conditionEvents.length)logConditionEvent('Restored','Saved draft restored. Monitoring was not resumed.');
  }
  for(const id of ['condition-show-levels','condition-show-zones'])el(id).onchange=()=>{finishConditionDrag(true);conditionPick=null;saveConditions();};
  el('condition-add').onclick=()=>{restoreConditions();conditionHistoryTransaction('Add condition',()=>{const row=conditionRow();seedConditionLevel(row);});};
  for(const name of ['sizing','timeout','gap'])el('condition-'+name).addEventListener('change',saveConditions);
  for(const name of ['timeout','gap'])el('condition-'+name).addEventListener('input',renderConditionValidation);
  el('condition-sizing').addEventListener('change',()=>{ticketEstimateVersion++;ticketEstimatePending=false;clearTimeout(ticketEstimateTimer);ticketEstimate=null;ticketEstimateKey='';ticketEstimateAt=0;invalidate();syncDraftLines();});
  el('condition-action').onchange=()=>{syncConditionStartLabel();renderConditionComparison();};
  el('conditions-panel').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT')event.preventDefault();});
  const monitorEstimates=new Map(),monitorEstimateOpen=new Set();let monitorEstimateBusy='';
  let serverRegistryId='',serverSnapshotRevision=-1,serverMonitors=[],selectedMonitorId=null,serverMonitor=null,serverPollBusy=false,serverReviewShown='',serverStateKey='',serverDetachedId='';
  function serverMonitorActive(){return !!serverMonitor&&['running','review','finishing'].includes(serverMonitor.phase);}
  function receiveServerConditions(payload){
    if(payload.storage_warning!==undefined){const warning=el('monitor-storage-status');if(warning.textContent!==payload.storage_warning)warning.textContent=payload.storage_warning;warning.hidden=!payload.storage_warning;}
    if(payload.registry_id){
      if(payload.registry_id===serverRegistryId&&payload.snapshot_revision<serverSnapshotRevision)return;
      if(serverRegistryId&&payload.registry_id!==serverRegistryId){serverMonitors=[];monitorEstimates.clear();monitorEstimateOpen.clear();serverMonitor=null;selectedMonitorId=null;serverStateKey='';invalidate();}
      serverRegistryId=payload.registry_id;serverSnapshotRevision=payload.snapshot_revision;
    }
    if(Array.isArray(payload.runs)){serverMonitors=payload.runs;const ids=new Set(serverMonitors.map(run=>run.id));for(const id of monitorEstimates.keys())if(!ids.has(id)){monitorEstimates.delete(id);monitorEstimateOpen.delete(id);}}
    else if(payload.run){const index=serverMonitors.findIndex(r=>r.id===payload.run.id);if(index<0)serverMonitors.push(payload.run);else serverMonitors[index]=payload.run;}
    if(selectedMonitorId===null&&payload.run)selectedMonitorId=payload.run.id;
    const run=selectedMonitorId===null?payload.run:serverMonitors.find(r=>r.id===selectedMonitorId)||null;
    renderMonitorList();
    // Runs remain in server memory after Stop/finish. An empty reply arriving
    // after a Start response belongs to an earlier poll, not a stopped setup.
    if(!run&&serverMonitor&&!Array.isArray(payload.runs))return;
    if(run&&serverMonitor&&run.id===serverMonitor.id&&(run.generation<serverMonitor.generation||run.generation===serverMonitor.generation&&run.revision<serverMonitor.revision))return;
    serverMonitor=run||null;
    if(!run){conditionRun=null;if(conditionApplied?.state==='running'){conditionApplied.state='stopped';conditionMessage('Server has no active setup. Review and Start explicitly.');}updateTicket();return;}
    const active=serverMonitorActive(),same=run.scope===scope&&run.symbol===el('symbol').value&&run.id!==serverDetachedId;
    if(run.id===serverDetachedId&&!active){conditionRun=null;updateTicket();return;}
    conditionRun=active?{...run,sequence:{rows:run.rows,index:run.applied.index,structureState:run.structureState}}:null;
    const eventKey='tradetrace.serverConditionEvents:'+run.id;
    let seen=-1;try{seen=Number(localStorage.getItem(eventKey)??-1);}catch(_){}
    for(const event of run.events||[])if(event.id>seen){logConditionEvent(event.type,event.message,run);seen=event.id;}
    try{localStorage.setItem(eventKey,String(seen));}catch(_){}
    const key=JSON.stringify([scope,el('symbol').value,run.id,run.phase,run.message,run.applied,run.structureState,run.review?.preview]);
    if(key!==serverStateKey){
      serverStateKey=key;
      if(same){
        conditionApplied=run.applied;conditionFinished=['finished','invalidated','skipped'].includes(run.phase)?run.message:'';
        if(['finished','invalidated','skipped'].includes(run.phase)){conditionLastResult=run.message;renderSetupResult();}
        saveConditions();renderConditionProgress();
      }
      conditionMessage((same?'':`${run.symbol} · account ${run.account} · `)+run.message);
      el('setup-phase').textContent=run.phase==='review'?'Review':run.phase==='running'?'Running':run.phase==='saved'?'Saved':run.phase==='stopped'?(run.interruption?.enabled?'Interrupted':'Stopped'):run.phase==='invalidated'?'Invalidated':run.phase==='skipped'?'Skipped':'Finished';
    }
    if(run.phase==='review'&&same&&run.review&&run.review.preview!==serverReviewShown){
      const result=run.review;serverReviewShown=result.preview;
      selectSetupTab('order');invalidate();
      el('side').value=run.settings.ticket.side;el('order-kind').value=result.order_kind==='MARKET'?'MARKET':'PENDING';
      el('order-price').value=result.order_kind==='MARKET'?'':result.request.price;
      for(const field of ['volume','sl','tp'])el(field).value=result.request[field];
      ticketDraftHidden=false;updateOrderHint();syncDraftLines();preview=result.preview;
      const r=result.request;el('order-summary').textContent=`CONDITIONS COMPLETE · ${result.demo?'DEMO':'LIVE'} ${result.account} / ${result.server} · ${run.settings.ticket.side} ${result.order_kind} · ${r.volume} lots ${r.symbol} at ${r.price} · SL ${r.sl} · TP ${r.tp}. Frozen server setup; confirm below.`;
      if(result.calculation)el('order-summary').append(text('p',autoPlanSummary(result.calculation)));
      el('submit').textContent=`Confirm & send ${result.demo?'demo':'LIVE'} order`;el('submit').hidden=false;
      expiryTimer=setTimeout(()=>{if(preview===result.preview){invalidate(false);el('order-summary').append(text('p','Condition review expired. Start explicitly for a new setup.'));}},Math.max(0,run.review_expires*1000-Date.now()));
      if(el('setup-builder').open){el('builder-manual-review').open=true;setBuilderStep('review');}
      el('submit').scrollIntoView({block:'nearest'});
    }
    if(run.phase!=='review'&&preview&&preview===serverReviewShown)invalidate(false);
    updateTicket();
  }
  async function pollServerConditions(){
    if(serverPollBusy)return;serverPollBusy=true;
    try{receiveServerConditions(await call('terminal/conditions/status',selectedMonitorId?{id:selectedMonitorId}:{}));}
    catch(error){if(serverMonitorActive())conditionMessage('Server status unavailable. Monitoring status is unknown; verify the TradeTrace server and MT5. '+error.message);}
    finally{serverPollBusy=false;}
  }
  async function stopServerConditions(reason='Stopped by user. Already submitted orders remain in MT5.'){
    const id=serverMonitor?.id;if(!id)return true;
    try{const result=await call('terminal/conditions/stop',{id,reason});receiveServerConditions(result);if(result.run&&['running','review','finishing'].includes(result.run.phase)){conditionMessage('A different server setup is active. Stop it before clearing this draft.');return false;}return true;}
    catch(error){conditionMessage('Stop not confirmed. The server may still be monitoring. Check the server and retry Stop. '+error.message);return false;}
  }
  async function stopBeforeDraft(reason){if(conditionBusy||submitting||reviewing||closing)return false;conditionBusy=true;updateTicket();try{return await stopServerConditions(reason);}finally{conditionBusy=false;updateTicket();}}
  el('condition-stop').onclick=()=>stopServerConditions();
  el('condition-start').onclick=async()=>{
    if(conditionBusy||submitting||reviewing||closing)return;
    try{
      if(!market)throw Error('Connect MT5 first.');
      const checks=setupReadiness(),blocked=checks.find(item=>item.state==='blocked');if(blocked)throw Error(blocked.message);
      const rows=C.validate(conditionRows()),settings=conditionComparisonSettings();
      if(readMonitorSettings().group_policy==='FIRST_ENTRY'&&!readMonitorSettings().group)throw Error('Name a linked group for first-entry cancellation.');
      conditionBusy=true;updateTicket();invalidate();
      const result=await call('terminal/conditions/start',{request_id:crypto.randomUUID(),multiple:true,replace_id:serverMonitor?.scope===scope&&serverMonitor.symbol===el('symbol').value&&serverMonitor.id!==serverDetachedId?serverMonitor.id:null,...readMonitorSettings(),symbol:el('symbol').value,expected_account:market.account,expected_server:market.server,rows,settings});
      conditionFinished='';serverStateKey='';selectedMonitorId=result.run?.id||selectedMonitorId;serverDetachedId='';receiveServerConditions(result);
    }catch(error){logConditionEvent('Start blocked',error.message);conditionMessage('Start not confirmed: '+error.message);await pollServerConditions();}
    finally{conditionBusy=false;updateTicket();}
  };
  async function checkConditions(){restoreConditions();await pollServerConditions();}


  let selectedConditionRow=null,conditionPick=null;
  const conditionHandleNodes=new Map();
  const conditionInput=(row,field)=>row.querySelector(`[data-field="${field}"]`);
  function seedConditionLevel(row){
    if(!market||!main)return;
    const input=conditionInput(row,'level');if(Number(input.value)>0)return;
    const size=chart.paneSize(0),p1=main.coordinateToPrice(0),p2=main.coordinateToPrice(size.height);
    const top=Math.max(p1,p2),bottom=Math.min(p1,p2),margin=(top-bottom)*.05;
    const inside=value=>Number.isFinite(value)&&value>0&&value>=bottom+margin&&value<=top-margin;
    const low=Number(conditionInput(row,'low').value),high=Number(conditionInput(row,'high').value),middle=(low+high)/2;
    const center=low>0&&high>low&&inside(middle)?middle:inside(market.bid)?market.bid:Number.isFinite(top+bottom)&&top>bottom?(top+bottom)/2:market.bid;
    const price=planPrice(center);if(price>0)input.value=price.toFixed(market.digits);
  }
  function seedConditionZone(row){
    if(!market||!main)return;
    const lowInput=conditionInput(row,'low'),highInput=conditionInput(row,'high');
    let low=Number(lowInput.value),high=Number(highInput.value);
    if(low>0&&high>0)return;
    const tick=market.tick_size||10**-market.digits,size=chart.paneSize(0);
    const p1=main.coordinateToPrice(0),p2=main.coordinateToPrice(size.height);
    const top=Math.max(p1,p2),bottom=Math.min(p1,p2);
    const span=Number.isFinite(top-bottom)&&top>bottom?top-bottom:Math.max(Math.abs(market.ask-market.bid)*4,tick*20);
    const half=Math.max(tick*2,span*.06);
    if(low>0)high=planPrice(low+half*2);
    else if(high>0)low=planPrice(Math.max(tick,high-half*2));
    else{
      const level=Number(conditionInput(row,'level').value),inside=value=>Number.isFinite(value)&&value>=bottom+half&&value<=top-half;
      const center=inside(level)?level:inside(market.bid)?market.bid:Number.isFinite(top+bottom)&&top>bottom?(top+bottom)/2:market.bid;
      low=planPrice(Math.max(tick,center-half));high=planPrice(center+half);
    }
    if(low>0&&high>low){lowInput.value=low.toFixed(market.digits);highInput.value=high.toFixed(market.digits);}
  }
  function selectCondition(row){
    selectedConditionRow=row;
    for(const item of el('condition-list').children){item.classList.toggle('active',item===row);item.querySelector('.terminal-condition-editor').hidden=item!==row;item.querySelector('.terminal-condition-summary').setAttribute('aria-expanded',String(item===row));}
    primitive?.update();
  }
  const structureHistories=new Map(),structureRequests=new Map();
  const structureKey=tf=>JSON.stringify([scope,el('symbol').value,tf]);
  function rememberStructureHistory(tf,data){
    const key=structureKey(tf),candles=data.bars.slice(0,-1).map(b=>({time:b[0]/1000,open:b[1],high:b[2],low:b[3],close:b[4]}));
    const prior=structureHistories.get(key);if(prior?.last===candles.at(-1)?.time){prior.fetched=Date.now();prior.formingTime=data.bars.at(-1)?.[0]/1000;prior.quoteTime=data.quote_time;return;}
    structureHistories.set(key,{candles,last:candles.at(-1)?.time,formingTime:data.bars.at(-1)?.[0]/1000,quoteTime:data.quote_time,fetched:Date.now(),analyses:new Map()});
    if(structureHistories.size>40)structureHistories.delete(structureHistories.keys().next().value);
  }
  function draftStructure(row){
    const key=structureKey(row.timeframe),history=structureHistories.get(key);
    if(!history)return {status:'Loading completed candles',bias:0};
    if(history.error)return {status:history.error,bias:0};
    if(!history.analyses.has(row.sensitivity)){const model=new C.Structure(row.sensitivity);for(const candle of history.candles)model.push(candle);history.analyses.set(row.sensitivity,model);}
    return history.analyses.get(row.sensitivity).snapshot(row.rule);
  }
  function loadStructureDrafts(){
    if(!market)return;
    const guard=readInvalidation(),frames=conditionRows().filter(row=>C.structure(row.rule)).map(row=>row.timeframe);if(guard.enabled&&guard.source==='SWING')frames.push(guard.timeframe);
    if(serverMonitor?.scope===scope&&serverMonitor.symbol===el('symbol').value&&serverMonitor.phase==='running'){const active=serverMonitor.rows[serverMonitor.applied.index];if(active?.mode==='CANDLE')frames.push(active.timeframe);}
    for(const tf of new Set(frames)){
      if(tf===el('timeframe').value)continue;
      const key=structureKey(tf);if(structureRequests.has(key)||Date.now()-(structureHistories.get(key)?.fetched||0)<1500)continue;
      const requestScope=scope,symbol=el('symbol').value;structureRequests.set(key,true);
      call('terminal/market',{symbol,timeframe:tf}).then(data=>{
        if(scope!==requestScope||el('symbol').value!==symbol||JSON.stringify([data.server,data.account])!==scope)return;
        rememberStructureHistory(tf,data);renderConditionComparison();primitive?.update();
      }).catch(()=>{if(scope===requestScope&&el('symbol').value===symbol)structureHistories.set(key,{error:'Completed candles unavailable; check broker history',fetched:Date.now()});}).finally(()=>structureRequests.delete(key));
    }
  }
  function matchingAppliedCondition(row,index){return serverMonitor?.id!==serverDetachedId&&serverMonitor?.scope===scope&&serverMonitor.symbol===el('symbol').value&&conditionSignature(row)===conditionSignature(serverMonitor.rows[index])&&(!row?.id||row.id===serverMonitor.rows[index]?.id);}
  function renderConditionWaiting(){
    let message='';const run=serverMonitor;
    if(run&&run.id!==serverDetachedId&&run.scope===scope&&run.symbol===el('symbol').value&&run.phase==='running'){
      const row=run.rows[run.applied.index],history=row?structureHistories.get(structureKey(row.timeframe)):null;
      message=C.waitingDescription(row,run.structureState,{digits:market?.digits,now:Date.now()/1000,formingTime:history?.formingTime,quoteTime:history?.quoteTime});
      if(row&&conditionSignature(conditionRows()[run.applied.index])!==conditionSignature(row))message+=' Uses applied settings; draft edits are not active.';
    }
    for(const id of ['condition-waiting','monitor-waiting']){const node=el(id);if(node.textContent!==message)node.textContent=message;node.hidden=!message;}
  }
  function conditionChartItems(){
    if(!market||!main||conditionDraftScope!==conditionStorage())return [];
    const drafts=conditionRows(),items=[...el('condition-list').children].flatMap((row,index)=>{
      if(row.dataset.visible==='false')return [];
      const rule=conditionInput(row,'rule').value,zone=C.zone(rule);
      if(C.structure(rule)){
        const draft=drafts[index];if(Object.keys(C.fieldErrors(draft)).length)return [];
        if(!el('condition-show-levels').checked&&row!==selectedConditionRow)return [];
        const applied=matchingAppliedCondition(draft,index),passed=applied&&index<serverMonitor.applied.index?serverMonitor.observations?.findLast(event=>event.type==='passed'&&event.index===index&&event.structure):null;
        const active=applied&&serverMonitor.phase==='running'&&serverMonitor.applied.index===index&&serverMonitor.structureState;
        const model=passed?{level:passed.structure.level,broken:false}:active?serverMonitor.structureState:draftStructure(draft),price=model.level,y=price?main.priceToCoordinate(price):null;
        const levelState=passed?'passed':active?'tracking':'draft',behavior=passed?'Passed · fixed':active?'Tracking · may move':'Draft preview · may move';
        return price>0&&!model.broken&&Number.isFinite(y)?[{row,index,field:'structure',price,y,color:passed?'#70d7b7':'#bba2ff',readonly:true,levelState,label:`${C.rules[rule]} ${conditionInput(row,'timeframe').value} · ${behavior}`}]:[];
      }
      if(!(zone?el('condition-show-zones'):el('condition-show-levels')).checked&&row!==selectedConditionRow)return [];
      const low=Number(conditionInput(row,'low').value),high=Number(conditionInput(row,'high').value);
      if(zone&&!(low>0&&high>low))return [];
      const color=row===selectedConditionRow?'#e4bd70':'#78a7ff';
      return (zone?['low','high','zone']:['level']).flatMap(field=>{
        const price=field==='zone'?(low+high)/2:Number(conditionInput(row,field).value),y=main.priceToCoordinate(price);
        const applied=matchingAppliedCondition(drafts[index],index),passed=applied&&index<serverMonitor.applied.index;
        return price>0&&Number.isFinite(y)?[{row,index,field,price,y,color,low,high,levelState:passed?'passed':applied?'fixed':'draft',behavior:passed?'Passed · fixed':applied?'Applied · fixed at Start':'Draft'}]:[];
      });
    });
    const applied=serverMonitor?.id!==serverDetachedId&&serverMonitor?.scope===scope&&serverMonitor.symbol===el('symbol').value&&(['running','review'].includes(serverMonitor.phase)||serverMonitor.phase==='invalidated')?serverMonitor.invalidation:null;
    const guard=applied?.enabled?applied:invalidationPreview(),y=guard.level?main.priceToCoordinate(guard.level):null;
    if(el('invalidation-visible').checked&&guard.enabled&&guard.level>0&&Number.isFinite(y))items.push({row:null,index:-1,field:'invalidation',price:guard.level,y,color:'#ff7888',readonly:true,guard:true,levelState:applied?'frozen':'draft',label:`${applied?'Frozen at Start · cancellation':'Draft cancellation'} ${guard.direction==='BELOW'?'≤':'≥'}`});
    return items;
  }
  function renderConditionPreviews(ctx,size){
    const items=conditionChartItems(),visible=new Set();
    ctx.save();ctx.lineWidth=1;ctx.setLineDash([5,4]);
    for(const item of items){
      if(item.field==='zone'){
        const top=main.priceToCoordinate(item.high),bottom=main.priceToCoordinate(item.low);
        if(Number.isFinite(top)&&Number.isFinite(bottom)){ctx.fillStyle=item.row===selectedConditionRow?'rgba(228,189,112,.10)':'rgba(120,167,255,.08)';ctx.fillRect(0,Math.max(0,top),size.width,Math.max(0,Math.min(size.height,bottom)-Math.max(0,top)));}
      }else if(item.y>=0&&item.y<=size.height){ctx.strokeStyle=item.color;ctx.beginPath();ctx.moveTo(0,item.y);ctx.lineTo(size.width,item.y);ctx.stroke();}
      if(item.y<0||item.y>size.height)continue;
      const key=`${item.index}:${item.field}`;visible.add(key);
      let button=conditionHandleNodes.get(key);
      if(!button){button=text('button','','terminal-condition-handle');button.type='button';button.dataset.conditionGrip=item.field;button.onpointerdown=event=>startConditionDrag(event,button._condition);el('ticket-handles').append(button);conditionHandleNodes.set(key,button);}
      button.dataset.levelState=item.levelState||'draft';button._condition=item;button.style.setProperty('--condition-color',item.color);
      button.style.top=Math.max(0,Math.min(size.height-25,item.y-12))+'px';
      const label=item.guard?`${item.label} · ${item.price.toFixed(market.digits)}`:`C${item.index+1} ${item.readonly?item.label:item.field==='zone'?'Move zone':item.field==='level'?'Level':item.field==='low'?'Zone low':'Zone high'}${!item.readonly?' · '+item.behavior:''} · ${item.price.toFixed(market.digits)}`;
      if(button.textContent!==label)button.textContent=label;
      button.style.left=Math.max(0,Math.min(item.field==='zone'?180:8,size.width-button.offsetWidth-4))+'px';
      button.title=item.guard?(item.levelState==='frozen'?'Frozen cancellation from Start; later swings and draft edits do not move it. ':'Draft cancellation recalculated when Start is clicked. ')+'Click to inspect settings. Not an order stop loss.':item.readonly?(item.levelState==='passed'?'Passed break price, fixed from the recorded signal. ':item.levelState==='tracking'?'Tracking: this level may change as confirmed swings form. ':'Draft preview only, not the active server tracker. ')+'Calculated confirmed swing. A completed candle close is required; wicks do not count.':'Drag to change this condition draft. Start is required to apply changes to monitoring.';button.style.cursor=item.readonly?'pointer':'';
    }
    for(const [key,node] of conditionHandleNodes)if(!visible.has(key)){node.remove();conditionHandleNodes.delete(key);}
    ctx.restore();
  }
  function conditionLineHit(p){return conditionChartItems().filter(item=>!item.readonly&&item.row===selectedConditionRow&&item.field!=='zone'&&Math.abs(item.y-p.y)<=6).sort((a,b)=>Math.abs(a.y-p.y)-Math.abs(b.y-p.y))[0];}
  function startConditionDrag(event,item){
    if(event.button!==0||!market||!item)return;if(item.readonly){event.preventDefault();event.stopPropagation();if(item.guard){if(!el('quick-editor').open){openSetupBuilder('entry');if(!el('setup-builder').classList.contains('builder-advanced'))el('builder-mode').click();}el('invalidation-settings').open=true;if(!el('invalidation-level').disabled)el('invalidation-level').focus();}else selectCondition(item.row);return;}
    setTool('cursor');selectCondition(item.row);selectDrawing(-1);
    const original=Object.fromEntries(['level','low','high'].map(field=>[field,conditionInput(item.row,field).value]));
    const y=event.clientY-el('chart').getBoundingClientRect().top;
    conditionDrag={...item,original,scopeKey:conditionStorage(),offset:main.coordinateToPrice(y)-item.price,pointerId:event.pointerId};
    el('chart').focus({preventScroll:true});el('chart').setPointerCapture(event.pointerId);event.preventDefault();event.stopImmediatePropagation();
    el('tool-hint').textContent='Editing condition draft · Escape cancels · Start applies changes';
  }
  function moveConditionDrag(event){
    const drag=conditionDrag,size=chart.paneSize(0),y=Math.max(0,Math.min(size.height,event.clientY-el('chart').getBoundingClientRect().top));
    const price=planPrice(main.coordinateToPrice(y)-drag.offset),tick=market.tick_size||10**-market.digits;
    if(price<=0)return;
    if(drag.field==='zone'){
      const delta=price-drag.price,low=planPrice(Number(drag.original.low)+delta),high=planPrice(Number(drag.original.high)+delta);
      if(low<=0||high<=low)return;
      conditionInput(drag.row,'low').value=low.toFixed(market.digits);conditionInput(drag.row,'high').value=high.toFixed(market.digits);
    }else{
      if(drag.field==='low'&&price>=Number(conditionInput(drag.row,'high').value)-tick/2)return;
      if(drag.field==='high'&&price<=Number(conditionInput(drag.row,'low').value)+tick/2)return;
      conditionInput(drag.row,drag.field).value=price.toFixed(market.digits);
    }
    primitive?.update();event.preventDefault();event.stopImmediatePropagation();
  }
  function finishConditionDrag(cancel=false){
    if(!conditionDrag)return;const drag=conditionDrag;conditionDrag=null;
    if(cancel)for(const [field,value] of Object.entries(drag.original))conditionInput(drag.row,field).value=value;
    if(el('chart').hasPointerCapture(drag.pointerId))el('chart').releasePointerCapture(drag.pointerId);
    if(drag.scopeKey===conditionStorage())saveConditions();primitive?.update();
  }
  function pickConditionPrice(event,p){
    if(!conditionPick)return false;
    const {row,field}=conditionPick,price=planPrice(main.coordinateToPrice(p.y));
    if(price>0){conditionInput(row,field).value=price.toFixed(market.digits);saveConditions();}
    conditionPick=null;event.preventDefault();event.stopImmediatePropagation();return true;
  }

  function selectSetupTab(name,focus=false){
    if(el('setup-builder').open){setBuilderStep(name==='order'?'entry':'conditions');return;}
    for(const tab of ['order','conditions']){
      const selected=tab===name,button=el('setup-tab-'+tab);
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
      el(tab==='order'?'setup-order-panel':'conditions-panel').hidden=!selected;
      if(selected&&focus)button.focus();
    }
    el('ticket').scrollTop=0;
  }
  for(const name of ['order','conditions']){
    const button=el('setup-tab-'+name);button.onclick=()=>selectSetupTab(name);
    button.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();selectSetupTab(event.key==='Home'?'order':event.key==='End'?'conditions':name==='order'?'conditions':'order',true);}};
  }
  function updateConditionSummaries(){
    for(const [index,row] of [...el('condition-list').children].entries()){
      const value=field=>conditionInput(row,field)?.value||'',zone=C.zone(value('rule'));
      const prices=C.structure(value('rule'))?`${value('sensitivity')} each side`:zone?`${value('low')||'…'}–${value('high')||'…'}`:value('level')||'…';
      const summary=`${index+1}. ${C.rules[value('rule')]||'Choose rule'} · ${prices} · ${value('mode')==='LIVE'?'Bid':value('timeframe')}`;
      const button=row.querySelector('.terminal-condition-summary');if(button.textContent!==summary)button.textContent=summary;
    }
    loadStructureDrafts();
    el('condition-empty').hidden=el('condition-list').children.length>0;renderConditionProgress();renderConditionValidation();
  }
  function renderSetupResult(){
    el('setup-last-result').hidden=!conditionLastResult;
    if(el('setup-last-result-text').textContent!==conditionLastResult)el('setup-last-result-text').textContent=conditionLastResult;
  }
  function clearSetupDraft(){
    if(conditionBusy||submitting||reviewing||closing){conditionMessage('Wait for the current broker request to finish before creating a new draft.');return;}
    finishConditionDrag(true);conditionPick=null;
    if(conditionFinished)conditionLastResult=conditionFinished;
    conditionFinished='';conditionRun=null;conditionApplied=null;selectedConditionRow=null;el('condition-list').replaceChildren();
    el('condition-action').value='ALERT';setAutoPlan();setInvalidation();setEntryQuality();setMonitorSettings();el('condition-start').textContent='Start conditions';
    endOrderEdit();dismissTicketDraft();el('volume').value=market?.volume_min||.01;
    logConditionEvent('New draft','New setup draft created. Monitoring stopped and automatic entry is off.');
    conditionMessage('Draft. Configure conditions and order, then Start.');
    saveConditions();renderSetupResult();selectSetupTab('conditions');if(el('setup-builder').open)el('builder-templates').open=true;
  }
  el('setup-new').onclick=async()=>{if(conditionBusy||submitting||reviewing||closing)return;serverDetachedId=serverMonitor?.id||'';if(await stopBeforeDraft('Stopped: new setup draft requested. Already submitted orders remain in MT5.'))clearSetupDraft();};
  const conditionSignature=row=>JSON.stringify(['rule','mode','timeframe','level','low','high','sensitivity'].map(key=>key==='sensitivity'&&!C.structure(row?.rule)?null:row?.[key]));
  function renderConditionProgress(){
    const draft=conditionRows();
    for(const [index,row] of [...el('condition-list').children].entries()){
      const badge=row.querySelector('.terminal-condition-progress');if(!badge)continue;
      const appliedIndex=conditionApplied?.rows.findIndex(item=>item?.id===row.dataset.conditionId)??-1;
      let label='Draft',kind='draft',hint='Not applied. Start conditions to monitor this rule.';
      if(appliedIndex>=0){
        const unchanged=appliedIndex===index&&conditionSignature(draft[index])===conditionSignature(conditionApplied.rows[appliedIndex]);
        if(!unchanged){label='Edited';kind='edited';hint=`Draft differs from applied step ${appliedIndex+1}. Monitoring uses the frozen setup from Start.`;}
        else if(appliedIndex<conditionApplied.index){label='Passed';kind='passed';hint=`Applied step ${appliedIndex+1} has passed.`;}
        else if(conditionApplied.state==='running'){label=appliedIndex===conditionApplied.index?'Watching':'Waiting';kind=label.toLowerCase();hint=label==='Watching'?'This is the only step currently being monitored.':'Waiting for earlier steps to pass.';}
        else{label='Stopped';kind='stopped';hint='Monitoring is stopped. Start conditions to begin a new run.';}
      }
      if(badge.textContent!==label)badge.textContent=label;badge.dataset.progress=kind;badge.title=hint;
    }
    renderConditionComparison();
  }
  el('drawing-condition').onclick=()=>{
    const drawing=currentDrawings()[selectedDrawing];if(!drawing||!['level','rectangle'].includes(drawing.type))return;
    const level=planPrice(drawing.a.price),low=drawing.b?planPrice(Math.min(drawing.a.price,drawing.b.price)):0,high=drawing.b?planPrice(Math.max(drawing.a.price,drawing.b.price)):0;
    if(drawing.type==='rectangle'&&(!(low>0)||high<=low)){status('The zone needs two different positive prices before it can become a condition.');return;}
    if(drawing.type==='level'&&!(level>0)){status('Choose a positive price level.');return;}
    restoreConditions();
    const row=conditionRow({rule:drawing.type==='level'?'TRADED_ABOVE':'ZONE_ENTER',mode:'LIVE',timeframe:C.frames.includes(el('timeframe').value)?el('timeframe').value:'H1',level:drawing.type==='level'?level:0,low,high,visible:true});
    if(smallPanels())el('pane').classList.add('mobile-ticket-open');else el('pane').classList.remove('ticket-collapsed');sizePanels();
    setTool('cursor');selectSetupTab('conditions');selectCondition(row);if(!el('quick-editor').open)openSetupBuilder('conditions');
    row.scrollIntoView({block:'nearest'});
    el('tool-hint').textContent='Condition draft copied from drawing. Choose its rule, then Start to apply.';
  };

  let conditionEvents=[],conditionEventScope='';
  const eventStorage=(run=null)=>`tradetrace.conditionEvents.v1:${run?.scope||scope}:${run?.symbol||el('symbol').value}`;
  function readConditionEvents(key){
    try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(item=>item&&Number.isFinite(item.at)&&Number.isFinite(new Date(item.at).getTime())&&typeof item.type==='string'&&typeof item.message==='string').slice(-100):[];}catch(_){return [];}
  }
  function renderConditionEvents(){
    el('condition-event-count').textContent=String(conditionEvents.length);
    el('condition-event-empty').hidden=conditionEvents.length>0;
    el('condition-events').replaceChildren(...[...conditionEvents].reverse().map(event=>{
      const row=text('li','','terminal-condition-event'),time=text('time',new Date(event.at).toLocaleTimeString());time.dateTime=new Date(event.at).toISOString();time.title=new Date(event.at).toLocaleString();
      row.append(time,text('strong',event.type),text('span',event.message));return row;
    }));
  }
  function restoreConditionEvents(){conditionEventScope=eventStorage();conditionEvents=readConditionEvents(conditionEventScope);renderConditionEvents();}
  function logConditionEvent(type,message,run=null){
    const key=eventStorage(run),current=key===eventStorage();
    if(current&&conditionEventScope!==key){conditionEventScope=key;conditionEvents=readConditionEvents(key);}
    const events=current?conditionEvents:readConditionEvents(key);
    events.push({at:Date.now(),type,message:String(message).slice(0,1500)});if(events.length>100)events.splice(0,events.length-100);
    try{localStorage.setItem(key,JSON.stringify(events));}catch(_){}
    if(current)renderConditionEvents();
  }
  function renderConditionValidation(){
    const rows=conditionRows();let invalid=0;
    for(const [index,row] of [...el('condition-list').children].entries()){
      const errors=C.fieldErrors(rows[index]),hasErrors=Object.keys(errors).length>0;
      if(hasErrors)invalid++;row.classList.toggle('has-errors',hasErrors);
      let warning=row.querySelector('.terminal-condition-invalid');
      if(!warning){warning=text('span','!','terminal-condition-invalid');warning.setAttribute('aria-label','Condition needs attention');row.querySelector('.terminal-condition-row-header').append(warning);}
      warning.hidden=!hasErrors;warning.title=Object.values(errors).join(' ');
      for(const field of ['rule','mode','timeframe','level','low','high','sensitivity']){
        const input=conditionInput(row,field);let note=input.parentElement.querySelector(`[data-error-for="${field}"]`);
        if(!note){note=text('small','','terminal-condition-field-error');note.dataset.errorFor=field;note.id=`condition-${row.dataset.conditionId}-${field}-error`;input.parentElement.append(note);input.setAttribute('aria-describedby',note.id);}
        const message=errors[field]||'';if(note.textContent!==message)note.textContent=message;note.hidden=!message;input.setAttribute('aria-invalid',String(!!message));
      }
    }
    let timingInvalid=false;
    for(const name of ['timeout','gap']){
      const input=el('condition-'+name),value=Number(input.value),valid=input.value.trim()!==''&&Number.isFinite(value)&&value>=0;
      let note=el('condition-'+name+'-error');if(!note){note=text('small','','terminal-condition-field-error');note.id='terminal-condition-'+name+'-error';input.parentElement.append(note);input.setAttribute('aria-describedby',note.id);}
      note.textContent=valid?'':'Enter zero (off) or a positive number.';note.hidden=valid;input.setAttribute('aria-invalid',String(!valid));timingInvalid||=!valid;
    }
    conditionDraftValid=invalid===0&&!timingInvalid;
    const summary=el('condition-validation-summary');summary.hidden=conditionDraftValid;
    const message=invalid?`${invalid} condition${invalid===1?' needs':'s need'} attention. Open Conditions to fix the highlighted fields.`:'Check the timing and reset settings.';
    if(summary.textContent!==message)summary.textContent=message;
    el('condition-start').disabled=!conditionDraftValid||conditionBusy||submitting||reviewing||closing;renderConditionComparison();
  }

  let conditionUndoStack=[],conditionHistoryBaseline=null,conditionHistoryGroup=null,conditionHistorySuspended=false;
  const conditionDraftSnapshot=()=>({rows:structuredClone(conditionRows()),selectedId:selectedConditionRow?.dataset.conditionId||null});
  function renderConditionUndo(){
    const button=el('condition-undo');button.disabled=!conditionUndoStack.length;
    button.title=conditionUndoStack.length?`Undo: ${conditionUndoStack.at(-1).label}. Draft only; running setup is unchanged.`:'No condition draft changes to undo.';
  }
  function resetConditionUndo(){
    conditionUndoStack=[];conditionHistoryGroup=null;conditionHistoryBaseline=conditionDraftSnapshot();conditionHistorySuspended=false;renderConditionUndo();
  }
  function recordConditionUndo(){
    if(conditionHistorySuspended)return;
    const current=conditionDraftSnapshot();
    if(conditionHistoryBaseline&&JSON.stringify(current.rows)!==JSON.stringify(conditionHistoryBaseline.rows)){
      if(!conditionHistoryGroup?.recorded){
        const selectedId=conditionHistoryBaseline.rows.some(row=>row.id===current.selectedId)?current.selectedId:conditionHistoryBaseline.selectedId;
        conditionUndoStack.push({...structuredClone(conditionHistoryBaseline),selectedId,label:conditionHistoryGroup?.label||'Edit conditions'});
        if(conditionUndoStack.length>30)conditionUndoStack.shift();
        if(conditionHistoryGroup)conditionHistoryGroup.recorded=true;
      }
    }
    conditionHistoryBaseline=current;renderConditionUndo();
  }
  function conditionHistoryTransaction(label,action){
    const previous=conditionHistoryGroup;conditionHistoryGroup={label,recorded:false};
    try{action();saveConditions();}finally{conditionHistoryGroup=previous;}
  }
  function duplicateCondition(row){
    const original=conditionRows().find(item=>item.id===row.dataset.conditionId);if(!original)return;
    conditionHistoryTransaction('Duplicate condition',()=>{
      const copy=conditionRow({...structuredClone(original),id:crypto.randomUUID()});row.after(copy);selectCondition(copy);
    });
    logConditionEvent('Duplicated','Condition copied into an independent draft row. Monitoring was not changed.');
  }
  function undoConditionEdit(){
    if(conditionDrag){finishConditionDrag(true);return;}
    if(!conditionUndoStack.length)return;
    conditionPick=null;conditionHistoryGroup=null;
    const previous=conditionUndoStack.pop();conditionHistorySuspended=true;
    try{
      selectedConditionRow=null;el('condition-list').replaceChildren();
      for(const row of previous.rows)conditionRow(row);
      selectCondition([...el('condition-list').children].find(row=>row.dataset.conditionId===previous.selectedId)||el('condition-list').firstElementChild||null);
      saveConditions();
    }finally{conditionHistorySuspended=false;conditionHistoryBaseline=conditionDraftSnapshot();renderConditionUndo();}
    logConditionEvent('Draft undo',`${previous.label} undone. Running setup and broker orders were not changed.`);
  }
  el('condition-undo').onclick=undoConditionEdit;
  el('pane').addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.shiftKey||event.key.toLowerCase()!=='z'||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    const conditionContext=el('conditions-panel').contains(event.target)||(event.target===el('chart')&&selectedDrawing<0&&selectedConditionRow);
    if(conditionContext&&(conditionUndoStack.length||conditionDrag)){event.preventDefault();undoConditionEdit();}
  });
  renderConditionUndo();

  let conditionComparisonKey='';
  function conditionComparisonSettings(){
    return {action:el('condition-action').value,sizing:el('condition-sizing').value,autoPlan:readAutoPlan(),invalidation:readInvalidation(),entryQuality:readEntryQuality(),monitoring:readMonitorSettings(),timeout:el('condition-timeout').value,gap:el('condition-gap').value,ticket:Object.fromEntries(['side','order-kind','order-price','volume','sl','tp'].map(name=>[name,el(name).value]))};
  }
  function comparisonPrice(value){const n=Number(value);return Number.isFinite(n)&&n>0?n.toLocaleString('en-US',{maximumFractionDigits:8}):'Not set';}
  function comparisonSettings(settings){
    if(!settings)return null;const ticket=settings.ticket||{};
    const timing=(value,unit)=>value===''||!Number.isFinite(Number(value))||Number(value)<0?'Invalid':Number(value)===0?'Off':`${Number(value)} ${unit}`;
    const result={action:{ALERT:'Alerts only',REVIEW:'Prepare for review',AUTO:'Automatic entry'}[settings.action]||'Not set',sizing:settings.sizing==='AUTO'?'2% equity':'Manual lots',side:ticket.side||'Not set',kind:ticket['order-kind']==='PENDING'?'Pending':'Market',entry:ticket['order-kind']==='PENDING'?comparisonPrice(ticket['order-price']):'Market quote',volume:settings.sizing==='AUTO'?'Auto (2% equity)':comparisonPrice(ticket.volume),sl:comparisonPrice(ticket.sl),tp:comparisonPrice(ticket.tp),timeout:timing(settings.timeout,'min'),gap:timing(settings.gap,'s'),invalidation:invalidationDescription(settings.invalidation),quality:qualityDescription(settings.entryQuality),monitoring:settings.monitoring?`${settings.monitoring.name||'Automatic name'} · ${settings.monitoring.group||'No linked group'} · ${settings.monitoring.group_policy==='FIRST_ENTRY'?'First entry stops others':'All may enter'}`:'Independent setup',plan:settings.autoPlan?.enabled?`${settings.autoPlan.entry} · ${settings.autoPlan.timeframe} swing ${settings.autoPlan.sensitivity} · buffer ${settings.autoPlan.buffer} ticks · ${settings.autoPlan.rr}R · ${settings.autoPlan.risk}% risk · expiry ${settings.autoPlan.expiry} min`:'Off'};
    if(settings.autoPlan?.enabled){const plan=settings.autoPlan;Object.assign(result,{sizing:`Automatic ${plan.risk}% equity`,kind:plan.entry==='RETEST'?'Retest limit':'Market',entry:plan.entry==='RETEST'?'Matching BOS/MS break':'Market quote at completion',volume:'Calculate at completion',sl:`${plan.timeframe} confirmed swing + ${plan.buffer} ticks`,tp:`${plan.rr}R price distance`});}
    return result;
  }
  function comparisonCondition(row){
    if(!row)return '—';const price=C.structure(row.rule)?`${row.sensitivity} candles each side`:C.zone(row.rule)?`${comparisonPrice(row.low)} – ${comparisonPrice(row.high)}`:comparisonPrice(row.level);
    return `${C.rules[row.rule]||'Choose rule'} · ${price} · ${row.mode==='LIVE'?'Live Bid':row.timeframe+' candle'}`;
  }
  function renderConditionComparison(){
    renderConditionPreview();renderInvalidationControls();renderEntryQualityControls();renderSetupReadiness();renderBuilderSummary();renderConditionWaiting();
    const applied=conditionApplied,draft=conditionRows(),currentSettings=comparisonSettings(conditionComparisonSettings()),appliedSettings=comparisonSettings(applied?.settings);
    const key=JSON.stringify([applied,draft.map(({visible,...row})=>row),currentSettings]);if(key===conditionComparisonKey)return;conditionComparisonKey=key;
    const pairs=[];let changes=0;
    for(const [index,row] of (applied?.rows||[]).entries()){
      const draftIndex=draft.findIndex(item=>item.id===row.id),current=draft[draftIndex];
      const edited=current&&conditionSignature(row)!==conditionSignature(current),moved=current&&draftIndex!==index;
      const change=!current?'removed':edited?'changed':moved?'moved':'unchanged';if(change!=='unchanged')changes++;
      pairs.push({row,current,index,draftIndex,change,moved});
    }
    for(const [draftIndex,current] of draft.entries())if(!(applied?.rows||[]).some(row=>row.id===current.id)){pairs.push({row:null,current,index:-1,draftIndex,change:applied?'added':'draft',moved:false});if(applied)changes++;}
    const settings=Object.entries(currentSettings).map(([field,value])=>({field,value,previous:appliedSettings?.[field],changed:!!appliedSettings&&appliedSettings[field]!==value}));
    const settingsChanges=settings.filter(item=>item.changed).length,total=changes+settingsChanges;
    el('condition-comparison-count').textContent=!applied?'No applied setup':total?`${total} unapplied change${total===1?'':'s'}`:'Draft matches applied';
    const state=applied?.state;
    el('condition-comparison-status').textContent=!applied?'No applied setup yet. Start conditions to capture the rules and settings.':state==='running'?`Applied setup is running at step ${Math.min(applied.index+1,applied.rows.length)} of ${applied.rows.length}.`:`Applied setup is ${state==='finished'?'finished':'stopped'}. No monitoring is active.`;
    const fragment=document.createDocumentFragment();
    for(const pair of pairs){
      const card=text('section','','terminal-condition-comparison-card');card.dataset.comparisonChange=pair.change;
      const heading=pair.change==='draft'?'Draft only':pair.change==='unchanged'?'Unchanged':pair.change==='removed'?'Removed from draft':pair.change==='added'?'Added to draft':pair.change==='moved'?'Reordered':pair.moved?'Changed and reordered':'Changed';
      card.append(text('strong',heading));const columns=text('div','','terminal-condition-comparison-columns');
      for(const side of ['applied','draft']){
        const cell=text('div');cell.dataset.comparisonSide=side;
        const original=side==='applied',row=original?pair.row:pair.current,index=original?pair.index:pair.draftIndex;
        let progress='';if(original&&row)progress=index<applied.index?' · Passed':state==='running'&&index===applied.index?' · Watching':state==='running'?' · Waiting':' · Stopped';
        cell.append(text('small',`${original?'Applied':'Draft'}${row?' #'+(index+1):''}${progress}`),text('p',comparisonCondition(row)));columns.append(cell);
      }
      card.append(columns);fragment.append(card);
    }
    if(!pairs.length)fragment.append(text('p','No conditions in this setup.','terminal-muted'));
    el('condition-comparison-rows').replaceChildren(fragment);
    const table=el('condition-comparison-settings');table.replaceChildren();
    if(applied&&!appliedSettings){el('condition-comparison-settings-note').textContent='This older setup has no saved order/timing snapshot. Start a new run to capture one.';return;}
    el('condition-comparison-settings-note').textContent='Order and timing settings from Start. Order fields are inactive in alerts-only mode.';
    const head=document.createElement('thead'),header=document.createElement('tr');for(const name of ['Setting','Applied','Draft'])header.append(text('th',name));head.append(header);table.append(head);
    const body=document.createElement('tbody'),labels={action:'Action',sizing:'Sizing',side:'Side',kind:'Order',entry:'Entry',volume:'Lots',sl:'Stop loss',tp:'Take profit',timeout:'Timeout',gap:'Quote gap',plan:'Automatic plan',invalidation:'Invalidation',quality:'Entry quality',monitoring:'Monitoring'};
    for(const item of settings){const row=document.createElement('tr');row.dataset.setting=item.field;row.dataset.changed=String(item.changed);row.append(text('th',labels[item.field]),text('td',item.previous??'—'),text('td',item.value));body.append(row);}table.append(body);
  }

  const templateStorage='tradetrace.conditionTemplates.v1';
  function readConditionTemplates(){try{const value=JSON.parse(localStorage.getItem(templateStorage)||'[]');return Array.isArray(value)?value.filter(item=>item&&typeof item.id==='string'&&typeof item.name==='string'&&Array.isArray(item.rows)).slice(0,30):[];}catch(_){return [];}}
  let conditionTemplates=readConditionTemplates();
  const templateMessage=message=>{el('condition-template-status').textContent=message;};
  function renderConditionTemplates(selected=el('condition-template-select').value){
    const select=el('condition-template-select');select.replaceChildren(new Option('Choose a template…',''),...conditionTemplates.map(item=>new Option(`${item.name} · ${item.symbol||'saved symbol'}`,item.id)));
    select.value=conditionTemplates.some(item=>item.id===selected)?selected:'';
    el('condition-template-load').disabled=!select.value;el('condition-template-delete').disabled=!select.value;
  }
  function persistConditionTemplates(next,selected){localStorage.setItem(templateStorage,JSON.stringify(next));conditionTemplates=next;renderConditionTemplates(selected);}
  el('condition-template-select').onchange=()=>{const item=conditionTemplates.find(item=>item.id===el('condition-template-select').value);if(item)el('condition-template-name').value=item.name;renderConditionTemplates();};
  el('condition-template-save').onclick=()=>{
    try{
      const name=el('condition-template-name').value.trim();if(!name||name.length>60)throw Error('Enter a template name of 1–60 characters.');
      const rows=C.validate(conditionRows());if(!rows.length)throw Error('Add at least one valid condition before saving.');
      const settings=conditionComparisonSettings();if(entryQualityErrors(settings.entryQuality,rows).length)throw Error(entryQualityErrors(settings.entryQuality,rows)[0]);if(autoPlanErrors(settings.autoPlan).length)throw Error(autoPlanErrors(settings.autoPlan)[0]);if(invalidationErrors(settings.invalidation||{enabled:false}).length)throw Error(invalidationErrors(settings.invalidation)[0]);if(![settings.timeout,settings.gap].every(value=>value!==''&&Number.isFinite(Number(value))&&Number(value)>=0))throw Error('Fix the timing settings before saving.');
      const prices=rows.filter(row=>!C.structure(row.rule)).flatMap(row=>C.zone(row.rule)?[row.low,row.high]:[row.level]);if(settings.invalidation?.enabled&&settings.invalidation.source==='LEVEL')prices.push(settings.invalidation.level);const anchor=prices.length?(Math.min(...prices)+Math.max(...prices))/2:(market?.bid||0);
      const previous=conditionTemplates.find(item=>item.name.toLowerCase()===name.toLowerCase());if(!previous&&conditionTemplates.length>=30)throw Error('The template library is full (30 templates). Remove one before saving another.');
      const template={id:previous?.id||crypto.randomUUID(),name,symbol:el('symbol').value,rows:structuredClone(rows),settings:structuredClone(settings),anchor,updated:Date.now()};
      persistConditionTemplates([...conditionTemplates.filter(item=>item.id!==template.id),template].sort((a,b)=>a.name.localeCompare(b.name)),template.id);
      logConditionEvent('Template saved',`${name} saved locally. Running setup was not changed.`);templateMessage(`Saved “${name}”. Loads as an inactive, alert-only draft.`);
    }catch(error){templateMessage(error.message);}
  };
  async function loadConditionTemplate(template,reposition=false){
    try{
      if(conditionBusy||submitting||reviewing||closing)throw Error('Wait for the current broker request to finish before loading a template.');
      if(!template)throw Error('Choose a saved template.');
      if(!market)throw Error('Connect a market before loading a template.');
      if(!reposition&&template.symbol!==el('symbol').value)throw Error(`Saved prices belong to ${template.symbol}. Choose Reposition for this chart when changing symbols.`);
      const rows=structuredClone(template.rows);C.validate(rows);const settings=template.settings||{},ticket=settings.ticket||{};if(entryQualityErrors(settings.entryQuality,rows).length)throw Error(entryQualityErrors(settings.entryQuality,rows)[0]);if(autoPlanErrors(settings.autoPlan||{enabled:false}).length)throw Error(autoPlanErrors(settings.autoPlan)[0]);if(invalidationErrors(settings.invalidation||{enabled:false}).length)throw Error(invalidationErrors(settings.invalidation)[0]);
      if(![settings.timeout,settings.gap].every(value=>value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0))throw Error('This template has invalid timing settings.');
      let ratio=1;
      if(reposition){
        const size=chart.paneSize(0),p1=main.coordinateToPrice(0),p2=main.coordinateToPrice(size.height),center=(p1+p2)/2;
        if(!(Number.isFinite(center)&&center>0&&Number.isFinite(template.anchor)&&template.anchor>0))throw Error('Load visible chart prices before repositioning this template.');ratio=center/template.anchor;
      }
      const price=value=>Number(value)>0?(reposition?planPrice(Number(value)*ratio):Number(value)):0;
      for(const row of rows){row.id=crypto.randomUUID();if(reposition&&!C.structure(row.rule)){if(C.zone(row.rule)){row.low=price(row.low);row.high=planPrice(Math.max(price(row.high),row.low+(market.tick_size||10**-market.digits)));row.level=0;}else{row.level=price(row.level);row.low=0;row.high=0;}}}
      C.validate(rows);
      serverDetachedId=serverMonitor?.id||'';if(!await stopBeforeDraft('Stopped: template load requested. Already submitted orders remain in MT5.')){templateMessage('Stop not confirmed. Draft unchanged. Check server status.');return false;}
      conditionHistoryTransaction('Load template',()=>{
        clearSetupDraft();
        el('condition-sizing').value=settings.sizing==='AUTO'?'AUTO':'MANUAL';setAutoPlan(settings.autoPlan);setEntryQuality(settings.entryQuality?{...settings.entryQuality,target:price(settings.entryQuality.target),max_distance:settings.entryQuality.max_distance*ratio}:undefined);setMonitorSettings(settings.monitoring);setInvalidation(settings.invalidation?{...settings.invalidation,level:settings.invalidation.source==='LEVEL'?price(settings.invalidation.level):settings.invalidation.level}:undefined);
        for(const name of ['timeout','gap'])el('condition-'+name).value=settings[name];
        el('side').value=ticket.side==='SELL'?'SELL':'BUY';el('order-kind').value=ticket['order-kind']==='PENDING'?'PENDING':'MARKET';
        el('volume').value=Number(ticket.volume)>0?Number(ticket.volume):market.volume_min;
        for(const [field,saved] of [['order-price','order-price'],['sl','sl'],['tp','tp']])el(field).value=price(ticket[saved])||'';
        for(const row of rows)conditionRow(row);
      });
      updateOrderHint();invalidate();syncDraftLines();selectSetupTab('conditions');
      conditionMessage(`Draft loaded from “${template.name}”. Monitoring stopped; automatic entry off. Review conditions and Order before Start.`);
      logConditionEvent('Template loaded',`${template.name} loaded as an inactive alert-only draft with ${reposition?'repositioned':'saved'} prices.`);
      templateMessage(`Loaded “${template.name}”${reposition?' near the current chart':''}. Review prices before Start.`);return true;
    }catch(error){templateMessage(error.message);return false;}
  }
  el('condition-template-load').onclick=()=>loadConditionTemplate(conditionTemplates.find(item=>item.id===el('condition-template-select').value),el('condition-template-prices').value==='REPOSITION');
  el('condition-template-delete').onclick=()=>{
    try{const template=conditionTemplates.find(item=>item.id===el('condition-template-select').value);if(!template)return;persistConditionTemplates(conditionTemplates.filter(item=>item.id!==template.id),'');templateMessage(`Removed “${template.name}”. Current draft and monitoring were not changed.`);}catch(error){templateMessage(error.message);}
  };
  function renderConditionPreview(){
    const phrase=row=>{
      if(Object.keys(C.fieldErrors(row)).length)return 'This condition needs valid fields before it can be previewed';
      if(C.structure(row.rule))return `${C.rules[row.rule]} on ${row.timeframe}: a candle closes ${row.rule.endsWith('_UP')?'above a confirmed swing high':'below a confirmed swing low'}, ${row.rule.startsWith('BOS')?'continuing':'changing'} structure direction, using ${row.sensitivity} candles each side`;
      const live=row.mode==='LIVE',candle=`a newly closed ${row.timeframe} candle`,level=comparisonPrice(row.level),zone=`${comparisonPrice(row.low)}–${comparisonPrice(row.high)}`;
      switch(row.rule){
        case 'ZONE_ENTER':return live?`Bid enters ${zone} from outside`:`${candle} overlaps ${zone} after the previous candle range was outside`;
        case 'ZONE_TOUCH':return live?`Bid is inside ${zone}`:`${candle} touches ${zone}`;
        case 'TRADED_ABOVE':return live?`Bid trades above ${level}`:`${candle} has a high above ${level}`;
        case 'TRADED_BELOW':return live?`Bid trades below ${level}`:`${candle} has a low below ${level}`;
        case 'SWEEP_ABOVE_REJECT':return live?`Bid trades above ${level}, then returns below it while this step is active`:`${candle} has a high above ${level} and closes below it`;
        case 'SWEEP_BELOW_RECLAIM':return live?`Bid trades below ${level}, then returns above it while this step is active`:`${candle} has a low below ${level} and closes above it`;
        case 'CLOSE_ABOVE':return `${candle} closes above ${level}`;
        case 'CLOSE_BELOW':return `${candle} closes below ${level}`;
        case 'CROSS_ABOVE':return `${candle} closes above ${level} after the previous close was at or below it`;
        case 'CROSS_BELOW':return `${candle} closes below ${level} after the previous close was at or above it`;
        case 'CLOSE_IN_ZONE':return `${candle} closes inside ${zone}`;
      }
    };
    const rows=conditionRows(),action=el('condition-action').value;
    const outcome=action==='AUTO'?'attempt one order and finish, without automatic retries':action==='REVIEW'?'prepare an order for your confirmation':'show an alert and finish';
    const message=rows.length?`${rows.map((row,index)=>(index?'Then ':'')+phrase(row)).join('. ')}. When all steps pass, ${outcome}.`:`No conditions. Start will immediately ${outcome}.`;
    const plan=readAutoPlan(),description=plan.enabled&&action!=='ALERT'?` Automatic trade plan: ${plan.entry==='RETEST'?'limit retest of the matching structure break':'market entry'}, SL from a confirmed ${plan.timeframe} swing with ${plan.buffer} ticks buffer, TP ${plan.rr}R, lots for ${plan.risk}% equity${plan.entry==='RETEST'?', broker expiry '+plan.expiry+' minutes':''}.`:'';
    const node=el('condition-preview-text');const guard=readInvalidation(),cancel=guard.enabled?' Cancel the waiting setup if '+invalidationDescription(guard)+'. This guard is checked before entry and remains active during review.':'';if(node.textContent!==message+description+cancel+(readEntryQuality().enabled?' Entry quality: '+qualityDescription(readEntryQuality())+'.':''))node.textContent=message+description+cancel+(readEntryQuality().enabled?' Entry quality: '+qualityDescription(readEntryQuality())+'.':'');
  }
  renderConditionTemplates();

  function starterSettings(){
    const key=el('condition-starter').value,retest=key.endsWith('_RETEST'),rule=retest?key.slice(0,-7):key;
    return {key,rule,retest,side:rule.endsWith('_UP')?'BUY':'SELL',timeframe:el('condition-starter-frame').value,risk:Number(el('condition-starter-risk').value)};
  }
  function renderStarter(){
    const preset=starterSettings(),valid=Number.isFinite(preset.risk)&&preset.risk>=.01&&preset.risk<=2;
    const trigger=preset.rule.startsWith('MS')?'a change in structure direction':'continuation of the current structure direction';
    el('condition-starter-description').textContent=`${preset.side} · wait for ${trigger} on ${preset.timeframe}, then ${preset.retest?'place a limit at the broken swing level (30-minute broker expiry)':'use market entry'}. Confirmed swings: 2 candles each side. Invalidation: cancel if the starting confirmed swing is breached (10-tick buffer). Automatic SL beyond the latest confirmed ${preset.side==='BUY'?'low':'high'} + 10 broker ticks; TP 2R; lots for ${preset.risk}% modeled equity risk. Adjust buffer and risk for your symbol. These are starting settings, not tested strategies.`;
    el('condition-starter-load').disabled=!valid||!C.frames.includes(preset.timeframe);
  }
  for(const name of ['starter','starter-frame','starter-risk'])el('condition-'+name).addEventListener(name==='starter-risk'?'input':'change',renderStarter);
  el('condition-starter-load').onclick=async()=>{
    const preset=starterSettings();
    if(!Number.isFinite(preset.risk)||preset.risk<.01||preset.risk>2||!C.frames.includes(preset.timeframe))return;
    if(!C.structure(preset.rule)){el('condition-starter-status').textContent='Choose a valid starter setup.';return;}
    const name=el('condition-starter').selectedOptions[0].textContent;
    const template={name,symbol:el('symbol').value,anchor:market?.bid||0,
      rows:[{rule:preset.rule,mode:'CANDLE',timeframe:preset.timeframe,sensitivity:2,level:0,low:0,high:0,visible:true}],
      settings:{action:'ALERT',sizing:'MANUAL',timeout:'0',gap:'300',invalidation:{enabled:true,source:'SWING',direction:preset.side==='BUY'?'BELOW':'ABOVE',level:0,timeframe:preset.timeframe,sensitivity:2,buffer:10,visible:true},
        autoPlan:{enabled:true,entry:preset.retest?'RETEST':'MARKET',timeframe:preset.timeframe,sensitivity:2,buffer:10,rr:2,risk:preset.risk,expiry:30},
        ticket:{side:preset.side,'order-kind':'MARKET','order-price':'',volume:market?.volume_min||.01,sl:'',tp:''}}};
    if(await loadConditionTemplate(template)){
      el('condition-starter-status').textContent=`Loaded “${name}” for ${template.symbol}. Inactive, alerts only. Next: inspect Automatic trade plan settings; choose Prepare order for review, then Start when ready. Save a named template to keep your changes.`;
      el('auto-plan').open=true;el('condition-preview').open=true;el('invalidation-settings').open=true;if(el('setup-builder').open)el('builder-templates').open=false;
    }else el('condition-starter-status').textContent=el('condition-template-status').textContent;
  };
  renderStarter();


  function setupReadiness(){
    const checks=[],add=(name,state,message)=>checks.push({name,state,message}),trade=el('condition-action').value!=='ALERT';
    const fresh=market&&Date.now()/1000-market.quote_time<=30&&market.quote_time<=Date.now()/1000+5;
    const monitoring=readMonitorSettings();if(monitoring.group_policy==='FIRST_ENTRY'&&!monitoring.group)add('Linked setups','blocked','Name a linked group for first-entry cancellation.');
    add('Quotes',fresh?'ready':'blocked',!market?'Connect MT5 and load this market.':fresh?'Current broker quote available.':'Quote is stale. Wait for a fresh quote or reconnect.');
    const rows=conditionRows(),invalid=rows.map((row,index)=>Object.keys(C.fieldErrors(row)).length?index+1:0).filter(Boolean);
    add('Conditions',conditionDraftValid?'ready':'blocked',invalid.length?`Fix highlighted fields in condition ${invalid.join(', ')}.`:!conditionDraftValid?'Fix timeout or quote-gap settings.':rows.length?`${rows.length} valid condition${rows.length===1?'':'s'}, in order.`:'No conditions: Start acts immediately.');
    for(const [index,row] of rows.entries())if(C.structure(row.rule)&&!Object.keys(C.fieldErrors(row)).length){const info=draftStructure(row);add(`Structure step ${index+1}`,'waiting',`${row.timeframe} · ${info.status}. Only a new close while this step is active can pass.`);}
    const guard=readInvalidation();if(guard.enabled){const errors=invalidationErrors(guard);for(const error of errors)add('Invalidation','blocked',error);if(!errors.length){const calculated=invalidationPreview();add('Invalidation',calculated.error?'blocked':calculated.level?'ready':'waiting',calculated.error|| (calculated.level?`Cancel if Bid is ${calculated.direction==='BELOW'?'at/below':'at/above'} ${comparisonPrice(calculated.level)}. Swing levels freeze at Start.`:'Waiting for cancellation swing history. The server requires a usable swing at Start.'));}}
    if(trade){
      for(const error of entryQualityErrors(readEntryQuality(),rows))add('Entry quality','blocked',error);
      if(readEntryQuality().enabled)add('Entry quality','pending',qualityDescription(readEntryQuality())+' Checked at execution; failure skips without retry.');
      add('Trading permissions',market?.trading_allowed===false?'blocked':market?.trading_allowed===true?'ready':'pending',market?.trading_allowed===false?'Enable account trading, Algo Trading and external Python trading in MT5.':market?.trading_allowed===true?'MT5 trading permissions enabled.':'Permissions will be checked by MT5 before execution.');
      if(readAutoPlan().enabled){
        for(const error of autoPlanErrors(readAutoPlan()))add('Automatic plan','blocked',error);
        if(readAutoPlan().entry==='RETEST'&&!rows.some(row=>C.structure(row.rule)&&row.rule.endsWith(el('side').value==='BUY'?'_UP':'_DOWN')))add('Retest','blocked','Add a matching bullish/bearish BOS or MS condition for this order side.');
        add('Automatic plan','pending',`${readAutoPlan().entry==='RETEST'?'Retest limit':'Market'} · swing-based SL · ${readAutoPlan().rr}R target · ${readAutoPlan().risk}% modeled equity risk. Prices and lots are calculated when conditions pass.`);
      }else{
      const sl=Number(el('sl').value),tp=Number(el('tp').value),pending=el('order-kind').value!=='MARKET',entry=Number(el('order-price').value),buy=el('side').value==='BUY';
      const reference=pending?entry:buy?market?.bid:market?.ask,distance=market?.stops_distance||0;
      const protection=Number.isFinite(sl)&&Number.isFinite(tp)&&sl>0&&tp>0&&reference>0&&(buy?sl<reference-distance&&tp>reference+distance:sl>reference+distance&&tp<reference-distance);
      add('SL / TP',protection?'ready':'blocked',protection?'Protection is on the correct side of entry at current broker distance.':'Set positive SL and TP on the correct sides of entry in Order, respecting broker stop distance.');
      if(pending)add('Pending entry',Number.isFinite(entry)&&entry>0?'ready':'blocked',Number.isFinite(entry)&&entry>0?`${buy?'BUY':'SELL'} ${inferredKind()||'pending'} at ${comparisonPrice(entry)}; broker validates distance at execution.`:'Enter a positive pending entry price in Order.');
      if(el('condition-sizing').value==='AUTO'){
        const valid=Number.isFinite(market?.equity)&&market.equity>0;
        add('Sizing',valid?'pending':'blocked',valid?'2% equity: lots are calculated when conditions pass; minimum lots and risk budget are checked then.':'2% sizing needs positive account equity.');
      }else{
        const volume=Number(el('volume').value),step=market?.volume_step,units=volume/step;
        const valid=market&&Number.isFinite(volume)&&volume>=market.volume_min&&volume<=market.volume_max&&step>0&&Math.abs(units-Math.round(units))<1e-6;
        add('Sizing',valid?'ready':'blocked',valid?`${volume} lots within broker limits.`:`Enter lots within ${market?.volume_min??'broker minimum'}–${market?.volume_max??'broker maximum'}, step ${step||'as specified by broker'}, in Order.`);
      }
      }
      if(editingOrder||editingPosition)add('Ticket','blocked','Finish or discard the amendment; conditions require a new order ticket.');
    }else add('Order fields','ready','Alert only: SL / TP, lots and trading permissions are not required.');
    if(conditionBusy||submitting||reviewing||closing)add('Busy','blocked','Wait for the current order request or review to finish.');
    return checks;
  }
  function renderSetupReadiness(){
    const checks=setupReadiness(),blocked=checks.filter(item=>item.state==='blocked'),action=el('condition-action').value;
    const type=market?.demo?'DEMO':'LIVE',account=market?`${type} · ${market.account} · ${market.server}`:'No connected account';
    const outcome=action==='AUTO'?`Start arms one automatic ${type} order attempt when all steps pass. No retries.`:action==='REVIEW'?'Start monitors the steps, then prepares an order. Your confirmation is required to send.':'Start monitors the steps, then shows an alert. No order is sent.';
    const set=(id,value)=>{if(el(id).textContent!==value)el(id).textContent=value;};
    set('setup-readiness-account',account);el('setup-readiness-account').dataset.live=String(!!market&&!market.demo);
    set('setup-readiness-action',outcome);
    set('setup-readiness-state',blocked.length?`${blocked.length} to fix`:'Ready to start');
    const next=blocked[0],waiting=checks.find(item=>item.name==='Invalidation'&&item.state==='waiting');
    set('builder-readiness',next?'Next: '+next.message:waiting?'Next: '+waiting.message:!conditionRows().length?'Next: Add a condition or template. With no conditions, Start acts immediately.':'Ready to start · '+outcome);
    el('builder-readiness').dataset.ready=String(!next&&!waiting&&conditionRows().length>0);
    el('builder-fix').hidden=!next;
    el('builder-fix').onclick=()=>{const step=next&&['Conditions','Linked setups'].includes(next.name)?'conditions':'entry';openSetupBuilder(step);if(next?.name==='Quotes')el('builder-readiness').textContent='Next: Return to the chart and reconnect MT5 for a fresh quote.';else if(next&&['Invalidation','Entry quality'].includes(next.name)){el('setup-builder').classList.add('builder-advanced');el('builder-mode').textContent='Simple view';el('builder-mode').setAttribute('aria-pressed','true');} };

    const list=el('setup-readiness-checks'),key=JSON.stringify(checks);
    if(list.dataset.key!==key){list.dataset.key=key;list.replaceChildren(...checks.map(item=>{const row=text('li',`${item.state==='blocked'?'Fix':item.state==='pending'?'At execution':item.state==='waiting'?'While monitoring':'OK'} · ${item.name}: ${item.message}`);row.dataset.state=item.state;return row;}));}
    el('condition-start').disabled=!!blocked.length;
  }


  function readAutoPlan(){
    const value={enabled:el('auto-plan-enabled').checked};
    for(const name of ['entry','timeframe','sensitivity','buffer','rr','risk','expiry']){
      const raw=el('auto-plan-'+name).value;value[name]=['entry','timeframe'].includes(name)?raw:raw.trim()===''?NaN:Number(raw);
    }return value;
  }
  function setAutoPlan(value={}){
    const settings={enabled:false,entry:'MARKET',timeframe:'M5',sensitivity:2,buffer:10,rr:2,risk:2,expiry:30,...value};
    el('auto-plan-enabled').checked=settings.enabled===true;
    for(const name of ['entry','timeframe','sensitivity','buffer','rr','risk','expiry'])el('auto-plan-'+name).value=settings[name];
    renderAutoPlanControls();
  }
  function autoPlanErrors(plan){
    if(!plan.enabled)return [];const errors=[];
    if(!['MARKET','RETEST'].includes(plan.entry)||!C.frames.includes(plan.timeframe))errors.push('Choose an entry method and swing timeframe.');
    if(!Number.isInteger(plan.sensitivity)||plan.sensitivity<1||plan.sensitivity>10)errors.push('Stop swing sensitivity must be 1–10 candles each side.');
    if(!Number.isInteger(plan.buffer)||plan.buffer<0||plan.buffer>1000000)errors.push('SL buffer must be 0–1,000,000 broker ticks.');
    if(!Number.isFinite(plan.rr)||plan.rr<.1||plan.rr>100)errors.push('Target distance must be 0.1–100 R.');
    if(!Number.isFinite(plan.risk)||plan.risk<.01||plan.risk>2)errors.push('Equity risk must be 0.01–2% per order.');
    if(plan.entry==='RETEST'&&(!Number.isInteger(plan.expiry)||plan.expiry<1||plan.expiry>1440))errors.push('Retest expiry must be 1–1,440 whole minutes.');
    return errors;
  }
  function renderAutoPlanControls(){
    const plan=readAutoPlan();
    for(const name of ['entry','timeframe','sensitivity','buffer','rr','risk','expiry'])el('auto-plan-'+name).disabled=!plan.enabled||(name==='expiry'&&plan.entry!=='RETEST');
    el('condition-sizing').disabled=plan.enabled;if(plan.enabled)el('condition-sizing').value='MANUAL';
    el('condition-sizing').querySelector('[value=MANUAL]').textContent=plan.enabled?'Automatic plan controls lots':'Ticket lots';
    el('auto-plan-status').textContent=plan.enabled?autoPlanErrors(plan).join(' ')||'Enabled for condition entries. Use Prepare order for review to inspect calculated prices and risk.':'Off — condition entries use the Order ticket.';
  }
  function autoPlanSummary(calc){return `Automatic plan · equity budget ${calc.budget.toFixed(2)} ${calc.currency} · modeled loss ${calc.modeled_loss.toFixed(2)} · modeled reward ${calc.modeled_reward.toFixed(2)} · ${calc.rr}R price distance. Modeled entry ${calc.modeled_entry}. ${calc.expires_at?'Broker expiry '+new Date(calc.expires_at*1000).toISOString():''} Costs and actual slippage are excluded.`;}
  for(const name of ['enabled','entry','timeframe','sensitivity','buffer','rr','risk','expiry']){
    const input=el('auto-plan-'+name),edit=()=>{renderAutoPlanControls();invalidate();saveConditions();syncDraftLines();};
    input.addEventListener(input.type==='number'?'input':'change',edit);
  }
  renderAutoPlanControls();


  function readEntryQuality(){const value={enabled:el('quality-enabled').checked};for(const name of ['max_distance','min_rr','target','reference_step']){const input=el('quality-'+name),raw=name==='reference_step'?(input.value||input.dataset.pending||'1'):input.value;value[name]=raw.trim()===''?NaN:Number(raw);}return value;}
  function setEntryQuality(value={}){const settings={enabled:false,max_distance:0,min_rr:2,target:0,reference_step:1,...value};el('quality-enabled').checked=settings.enabled===true;for(const name of ['max_distance','min_rr','target'])el('quality-'+name).value=settings[name];el('quality-reference_step').dataset.pending=String(settings.reference_step);renderEntryQualityControls();}
  function entryQualityErrors(value,rows=conditionRows()){
    if(!value?.enabled)return [];const errors=[];
    if(!['max_distance','min_rr','target'].every(name=>Number.isFinite(value[name])&&value[name]>=0)||value.min_rr>100)errors.push('Entry quality needs nonnegative values and minimum RR no greater than 100.');
    if(!value.max_distance&&!value.min_rr)errors.push('Set maximum distance or minimum RR above zero.');
    if(value.max_distance>0&&(!Number.isInteger(value.reference_step)||value.reference_step<1||value.reference_step>rows.length))errors.push('Choose an existing reference condition for the distance check.');return errors;
  }
  function qualityDescription(value){if(!value?.enabled)return 'Off';return [value.max_distance>0?`Entry within ${value.max_distance} price units of condition ${value.reference_step}`:'',value.min_rr>0?`minimum RR 1:${value.min_rr}${value.target>0?' to the nearer of TP and '+comparisonPrice(value.target):' to order TP'}`:''].filter(Boolean).join('; ');}
  function renderEntryQualityControls(){
    const select=el('quality-reference_step'),chosen=select.dataset.pending||select.value||'1',rows=conditionRows(),options=JSON.stringify(rows.map(r=>[r.rule,r.level,r.low,r.high]));
    if(select.dataset.options!==options){select.replaceChildren(...rows.map((r,i)=>new Option(`${i+1}: ${C.rules[r.rule]||r.rule}`,String(i+1))));select.dataset.options=options;}
    select.value=chosen;const value=readEntryQuality();for(const name of ['max_distance','min_rr','target'])el('quality-'+name).disabled=!value.enabled;select.disabled=!value.enabled||!(value.max_distance>0);el('quality-target').disabled=!value.enabled||!(value.min_rr>0);
    el('quality-status').textContent=value.enabled?entryQualityErrors(value,rows).join(' ')||qualityDescription(value)+'. Frozen at Start.':'Off — existing entry behavior is unchanged.';
  }
  for(const name of ['enabled','max_distance','min_rr','target','reference_step'])el('quality-'+name).addEventListener(['enabled','reference_step'].includes(name)?'change':'input',()=>{if(name==='reference_step')el('quality-reference_step').dataset.pending=el('quality-reference_step').value;renderEntryQualityControls();invalidate();saveConditions();});
  renderEntryQualityControls();

  function readMonitorSettings(){return {name:el('monitor-name').value.trim(),group:el('monitor-group').value.trim(),group_policy:el('monitor-policy').value};}
  function setMonitorSettings(value={}){el('monitor-name').value=value.name||'';el('monitor-group').value=value.group||'';el('monitor-policy').value=value.group_policy==='FIRST_ENTRY'?'FIRST_ENTRY':'ALL';}
  function fillMonitorEstimate(details,run){
    const body=details.querySelector('.terminal-monitor-estimate-body'),cached=monitorEstimates.get(run.id),estimate=cached?.value;body.replaceChildren();
    if(estimate){
      const status={would_pass:'Would pass local checks',would_skip:'Would skip at this quote',unavailable:'Not enough information',alert:'Alerts only'}[estimate.status]||'Unavailable';
      const badge=text('strong',status,'terminal-estimate-outcome');badge.dataset.outcome=estimate.status;body.append(badge);
      const price=value=>Number.isFinite(value)?value.toFixed(estimate.digits??5):'—',money=value=>Number.isFinite(value)?value.toFixed(2)+' '+(estimate.currency||''):'—';
      if(Number.isFinite(estimate.entry))body.append(text('p',`${estimate.side} ${estimate.order_kind} · entry ${price(estimate.entry)} · SL ${price(estimate.sl)} · TP ${price(estimate.tp)}`));
      if(Number.isFinite(estimate.volume))body.append(text('p',`${estimate.volume} lots · modeled risk ${money(estimate.risk)}${Number.isFinite(estimate.risk_percent)?' ('+estimate.risk_percent.toFixed(2)+'% equity)':''}`));
      if(Number.isFinite(estimate.rr))body.append(text('p',`Available RR 1:${estimate.rr.toFixed(2)}${estimate.min_rr>0?' · minimum 1:'+estimate.min_rr:''}`));
      if(estimate.quality_target>0)body.append(text('p',`Available RR uses the nearer of TP and ${price(estimate.quality_target)}.`));
      if(Number.isFinite(estimate.distance))body.append(text('p',`Distance ${price(estimate.distance)} · maximum ${estimate.max_distance} price units`));
      body.append(text('p',estimate.reason||''));const age=text('small','','terminal-estimate-age');age.dataset.received=cached.received;age.dataset.at=estimate.at;body.append(age);
    }else body.append(text('p',monitorEstimateBusy===run.id?'Calculating from frozen settings…':'Expand to calculate from the current broker quote.'));
    body.append(text('p','Estimate only—conditions have not passed. Recalculated at execution; final broker checks still apply.','terminal-muted'));
    const refresh=text('button',monitorEstimateBusy===run.id?'Calculating…':'Refresh estimate');refresh.type='button';refresh.disabled=!!monitorEstimateBusy||run.scope!==scope;refresh.onclick=()=>loadMonitorEstimate(run.id);body.append(refresh);
    updateMonitorEstimateAges();
  }
  function updateMonitorEstimateAges(){for(const node of el('monitor-list').querySelectorAll('.terminal-estimate-age')){const age=Math.max(0,Math.floor(Math.max(Date.now()-Number(node.dataset.received),Date.now()-Number(node.dataset.at))/1000)),value=`As of ${new Date(Number(node.dataset.at)).toLocaleTimeString([], {hour12:false})} local${age>15?' · Old estimate—refresh before relying on it':''}`;if(node.textContent!==value)node.textContent=value;node.closest('details').dataset.stale=String(age>15);}}
  async function loadMonitorEstimate(id){
    if(monitorEstimateBusy)return;const run=serverMonitors.find(run=>run.id===id);if(!run||run.scope!==scope||run.phase!=='running')return;
    monitorEstimateBusy=id;for(const detail of el('monitor-list').querySelectorAll('[data-estimate-id]')){const item=serverMonitors.find(run=>run.id===detail.dataset.estimateId);if(item)fillMonitorEstimate(detail,item);}
    try{const result=await call('terminal/conditions/estimate',{id});if(!result.estimate)throw Error('Server did not return an estimate. Restart TradeTrace to load the updated server.');monitorEstimates.set(id,{value:result.estimate,received:Date.now()});}
    catch(error){monitorEstimates.set(id,{value:{status:'unavailable',at:Date.now(),reason:error.message},received:Date.now()});}
    finally{monitorEstimateBusy='';for(const detail of el('monitor-list').querySelectorAll('[data-estimate-id]')){const item=serverMonitors.find(run=>run.id===detail.dataset.estimateId);if(item)fillMonitorEstimate(detail,item);}}
  }
  function recoveryDescription(run){
    const info=run.interruption;if(!info)return '';const stamp=value=>Number.isFinite(value)?new Date(value*1000).toLocaleString()+' local':'unavailable';
    const seconds=Math.max(0,Math.round(info.gap_seconds)),gap=seconds>=3600?`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${seconds%60}s`:seconds>=60?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${seconds}s`;
    return `${info.recovery_message} Last fresh quote: ${stamp(info.last_quote_time)}. Gap at detection: ${gap}.${info.ready?' Fresh quote now: '+stamp(info.current_quote_time)+'.':''} Every step starts over only after your explicit Start.`;
  }
  async function reviewInterruptedSetup(id){
    if(conditionBusy||submitting||reviewing||closing)return;
    try{const payload=await call('terminal/conditions/recovery',{id});receiveServerConditions(payload);const run=serverMonitors.find(run=>run.id===id);
      if(!run?.interruption?.ready||run.phase!=='stopped')return;
      await openMonitoredSetup(id);if(selectedMonitorId===id){openSetupBuilder('review');syncConditionStartLabel();renderBuilderSummary();}
    }catch(error){conditionMessage('Review unavailable: '+error.message);}
  }
  function syncConditionStartLabel(){el('condition-start').textContent=el('condition-action').value==='AUTO'?'Arm automatic entry':el('condition-action').value==='REVIEW'?'Start conditions for review':'Start conditions';}
  const monitorOutcomes=new Map();
  let outcomeRevision=0;
  let monitorFilter='all',monitorOpener=null;
  const monitorDetailsOpen=new Set();
  try{const saved=JSON.parse(localStorage.getItem('tradetrace.monitorView')||'{}');if(['all','active','attention','history'].includes(saved.filter))monitorFilter=saved.filter;for(const id of (Array.isArray(saved.expanded)?saved.expanded:[]).slice(0,100))if(typeof id==='string')monitorDetailsOpen.add(id);}catch(_){}
  function saveMonitorView(){try{localStorage.setItem('tradetrace.monitorView',JSON.stringify({filter:monitorFilter,expanded:[...monitorDetailsOpen].slice(-100)}));}catch(_){}}
  for(const item of el('monitor-filters').querySelectorAll('button'))item.setAttribute('aria-pressed',String(item.dataset.monitorFilter===monitorFilter));
  el('monitor-toolbar').onclick=()=>showMonitorWorkspace();
  for(const button of el('monitor-filters').querySelectorAll('button'))button.onclick=()=>{monitorFilter=button.dataset.monitorFilter;for(const item of el('monitor-filters').querySelectorAll('button'))item.setAttribute('aria-pressed',String(item===button));saveMonitorView();renderMonitorList();};
  function monitorDisplayName(run){
    const side=run.settings.ticket.side,legacy=`${run.symbol} ${side} #`,name=run.name||'';
    if(name&&!((name.startsWith(legacy)&&/^\d+$/.test(name.slice(legacy.length)))||name===run.symbol+' saved setup'))return name;
    const row=run.rows[0],rule=row?(C.rules[row.rule]||row.rule).replace('Bullish ','').replace('Bearish ','').replace('MS','market shift').replace('BOS','structure break'):'conditions';
    return `${run.symbol} · ${side==='BUY'?'Buy':'Sell'} after ${row?.mode==='CANDLE'?row.timeframe+' ':''}${rule}${run.rows.length>1?' + '+(run.rows.length-1)+' more':''}`;
  }
  function showMonitorWorkspace(){
    if(el('monitor-workspace').hidden)monitorOpener=document.activeElement;
    const panel=el('monitor-workspace');panel.hidden=false;panel.classList.add('is-expanded');el('monitors-panel').open=true;
    el('monitor-workspace-close').focus({preventScroll:true});
  }
  el('monitor-workspace-open').onclick=()=>showMonitorWorkspace();
  function hideMonitorWorkspace(){el('monitor-workspace').hidden=true;el('monitor-workspace').classList.remove('is-expanded');if(monitorOpener?.isConnected)monitorOpener.focus({preventScroll:true});}
  el('monitor-workspace-close').onclick=hideMonitorWorkspace;
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!el('setup-builder').open&&!el('monitor-workspace').hidden)hideMonitorWorkspace();});
  function renderMonitorList(){
    const active=serverMonitors.filter(r=>['running','review','finishing'].includes(r.phase)),saved=serverMonitors.filter(r=>r.phase==='saved');el('monitor-count').textContent=`${active.length} active${saved.length?' · '+saved.length+' saved':''}`;
    const attentionCount=serverMonitors.filter(r=>r.phase==='review'||r.phase==='saved'||(r.phase==='stopped'&&r.interruption?.enabled)).length;
    el('monitor-toolbar').replaceChildren(document.createTextNode(`Monitoring · ${active.length}`));
    if(attentionCount)el('monitor-toolbar').append(text('span',`${attentionCount} need attention`,'terminal-monitor-attention-badge'));
    el('monitor-toolbar').title=attentionCount?`${attentionCount} setups need review or restart`:'Open monitoring workspace';
    el('monitor-overview').textContent=el('monitor-count').textContent+' · all symbols';
    el('monitor-stop-all').disabled=!active.length&&!saved.length;el('monitor-add').disabled=conditionBusy||submitting||reviewing||closing;
    const key=JSON.stringify(serverMonitors.map(r=>[r.id,r.phase,r.message,r.applied?.index,r.revision,r.review?.preview,r.interruption?.checked_at,r.interruption?.enabled]).concat([selectedMonitorId,scope,conditionBusy,submitting,reviewing,closing,monitorFilter,outcomeRevision]));
    if(el('monitor-list').dataset.key===key)return;el('monitor-list').dataset.key=key;
    const previousHistory=el('monitor-list').querySelector('.terminal-monitor-history'),historyOpen=previousHistory?.open===true;
    const liveCards=[],attentionCards=[],historyCards=[];
    const cards=serverMonitors.slice().reverse().sort((a,b)=>a.symbol.localeCompare(b.symbol)).map(run=>{
      const card=text('article','','terminal-monitor-card');card.dataset.monitorId=run.id;card.dataset.selected=String(run.id===selectedMonitorId);
      card.dataset.phase=run.phase;card.dataset.symbol=run.symbol;
      const live=['running','review','finishing'].includes(run.phase),attention=run.phase==='saved'||(run.interruption?.enabled&&run.phase==='stopped');
      (live?liveCards:attention?attentionCards:historyCards).push(card);
      const heading=text('div','','terminal-monitor-heading'),status=run.phase==='running'?'Monitoring':run.phase==='review'?'Review needed':run.phase==='finishing'?'Submitting':run.phase==='saved'?'Saved · not armed':attention?'Interrupted':run.phase;
      heading.append(text('strong',`${run.symbol} · ${run.settings.ticket.side}`),text('span',status,'terminal-monitor-badge'));card.append(heading);
      card.append(text('span',monitorDisplayName(run)+(run.id===selectedMonitorId?' · Selected':''),'terminal-monitor-name'));
      const row=run.rows[run.applied.index];
      if(row)card.append(text('strong',`Step ${run.applied.index+1} of ${run.rows.length} · ${row.mode==='CANDLE'?row.timeframe+' · ':''}${C.rules[row.rule]||row.rule}`,'terminal-monitor-rule'));
      const facts=text('div','','terminal-monitor-facts');
      facts.append(text('span',run.action==='AUTO'?'Automatic entry':run.action==='REVIEW'?'Review before entry':'Alert only'),text('span',run.settings.autoPlan?.enabled?'Risk '+run.settings.autoPlan.risk+'%':run.settings.sizing==='AUTO'?'Risk 2%':'Lots '+run.settings.ticket.volume));card.append(facts);
      if(run.invalidation?.enabled)card.append(text('span',(run.phase==='saved'?'Previous cancellation: Bid ':'Cancel if Bid ')+(run.invalidation.direction==='BELOW'?'≤ ':'≥ ')+run.invalidation.level,'terminal-monitor-cancel'));
      if(run.group)card.append(text('span',`${run.group} · ${run.group_policy==='FIRST_ENTRY'?'First entry stops others':'All may enter'}`,'terminal-monitor-meta'));
      card.append(text('p',run.phase==='running'?C.waitingDescription(run.rows[run.applied.index],run.structureState,{digits:run.symbol===el('symbol').value?market?.digits:undefined}):run.message,'terminal-monitor-waiting-text'));const actions=document.createElement('div'),open=text('button',run.phase==='review'?'Open review':'Open setup'),stop=text('button',run.phase==='saved'?'Dismiss saved':'Stop');open.type=stop.type='button';
      open.disabled=run.scope!==scope||conditionBusy||submitting||reviewing||closing;open.onclick=()=>openMonitoredSetup(run.id);
      stop.disabled=!['running','review','finishing','saved'].includes(run.phase);stop.onclick=async()=>{try{receiveServerConditions(await call('terminal/conditions/stop',{id:run.id}));}catch(error){conditionMessage('Stop not confirmed: '+error.message);}};
      if(run.phase==='saved'){const resume=text('button','Review saved setup');resume.type='button';resume.disabled=run.scope!==scope||conditionBusy||submitting||reviewing||closing;resume.onclick=async()=>{await openMonitoredSetup(run.id);if(selectedMonitorId===run.id){openSetupBuilder('review');syncConditionStartLabel();renderBuilderSummary();}};card.append(resume);}
      if(run.interruption?.enabled&&run.phase==='stopped'){
        const recovery=text('div','','terminal-monitor-recovery');recovery.append(text('strong',run.interruption.ready?'Connection restored—review and restart':'Monitoring interrupted'),text('p',recoveryDescription(run)));
        const check=text('button','Check connection'),restart=text('button','Review & restart');check.type=restart.type='button';
        check.disabled=run.scope!==scope;restart.disabled=!run.interruption.ready||run.scope!==scope||conditionBusy||submitting||reviewing||closing;
        check.onclick=async()=>{check.disabled=true;try{receiveServerConditions(await call('terminal/conditions/recovery',{id:run.id}));}catch(error){conditionMessage('Recovery check failed: '+error.message);}finally{check.disabled=false;}};
        restart.onclick=()=>reviewInterruptedSetup(run.id);recovery.append(check,restart);card.append(recovery);
      }
      actions.className='terminal-monitor-row-actions';
      const view=text('button','View on chart');view.type='button';view.disabled=open.disabled;view.onclick=async()=>{await openMonitoredSetup(run.id,false);if(selectedMonitorId===run.id){hideMonitorWorkspace();}};
      open.title='Edit draft. Running settings change only after explicit Start.';
      const duplicate=text('button','Duplicate draft');duplicate.type='button';duplicate.disabled=open.disabled;duplicate.onclick=()=>duplicateMonitoredSetup(run.id);
      actions.append(open,stop,view,duplicate);card.append(actions);
      if(!['running','review','finishing','saved'].includes(run.phase)){
        const area=text('div','','terminal-monitor-outcome'),cached=monitorOutcomes.get(run.id),value=cached?.value;
        const labels={pending:'Waiting to fill',open:'Position open',closed:'Trade closed',cancelled:'Cancelled',expired:'Expired',rejected:'Rejected',unknown:'Outcome unconfirmed',shared:'Shared position',no_order:'No order submitted'};
        const initial=run.result?( [10008,10009,10010].includes(run.result.retcode)?'Submitted · check trade outcome':'Broker rejected request'):'No confirmed trade result';
        area.append(text('strong',value?labels[value.state]||value.state:initial));
        if(value){const amount=value.state==='closed'?value.net:value.state==='open'?value.floating:null;area.append(text('p',value.message+(Number.isFinite(amount)?` ${amount>=0?'+':''}${amount.toFixed(2)} ${value.currency}${value.state==='open'?' floating':''}${Number.isFinite(value.r_multiple)?' · '+(value.r_multiple>=0?'+':'')+value.r_multiple.toFixed(2)+'R':''}`:'')));area.append(text('small',`Checked ${new Date(value.checked_at*1000).toLocaleTimeString()} · refresh for current status`));}
        if(cached?.error)area.append(text('p','Check unavailable: '+cached.error));
        const check=text('button',cached?.busy?'Checking MT5…':value?'Refresh trade outcome':'Check trade outcome');check.type='button';check.disabled=!!cached?.busy||run.scope!==scope;
        check.onclick=async()=>{monitorOutcomes.set(run.id,{...cached,busy:true});outcomeRevision++;renderMonitorList();try{const result=await call('terminal/conditions/outcome',{id:run.id});monitorOutcomes.set(run.id,{value:result.outcome});}catch(error){monitorOutcomes.set(run.id,{value:cached?.value,error:error.message});}finally{outcomeRevision++;renderMonitorList();}};
        area.append(check);card.append(area);
      }

      if(run.phase==='running'){
        const details=document.createElement('details');details.className='terminal-monitor-estimate';details.dataset.estimateId=run.id;details.open=monitorEstimateOpen.has(run.id);
        details.append(text('summary','If triggered now'),text('div','','terminal-monitor-estimate-body'));
        details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open){monitorEstimateOpen.add(run.id);if(!monitorEstimates.has(run.id))loadMonitorEstimate(run.id);}else monitorEstimateOpen.delete(run.id);});
        card.append(details);fillMonitorEstimate(details,run);
      }
      const detail=document.createElement('details');detail.className='terminal-monitor-row-details';detail.open=monitorDetailsOpen.has(run.id);detail.append(text('summary','Details · cancellation & estimate'));
      for(const node of [...card.children])if(node.matches('.terminal-monitor-cancel,.terminal-monitor-meta,.terminal-monitor-recovery,.terminal-monitor-estimate'))detail.append(node);
      detail.addEventListener('toggle',()=>{if(!detail.isConnected)return;if(detail.open)monitorDetailsOpen.add(run.id);else monitorDetailsOpen.delete(run.id);saveMonitorView();});card.append(detail);
      return card;
    });
    const symbolGroups=items=>{
      const groups=new Map();
      for(const card of items){const symbol=card.dataset.symbol;if(!groups.has(symbol))groups.set(symbol,[]);groups.get(symbol).push(card);}
      return [...groups].map(([symbol,rows])=>{const group=text('section','','terminal-monitor-symbol-group');group.dataset.monitorSymbol=symbol;group.setAttribute('aria-label',symbol+' setups');group.append(text('h5',`${symbol} · ${rows.length} setup${rows.length===1?'':'s'}`),...rows);return group;});
    };
    const sections=[];
    if(liveCards.length&&['all','active'].includes(monitorFilter))sections.push(text('h4',`Monitoring now · ${liveCards.length}`),...symbolGroups(liveCards));
    if(attentionCards.length&&['all','attention'].includes(monitorFilter))sections.push(text('h4',`Needs attention · ${attentionCards.length}`),...symbolGroups(attentionCards));
    if(historyCards.length&&['all','history'].includes(monitorFilter)){const history=document.createElement('details');history.className='terminal-monitor-history';history.open=historyOpen||monitorFilter==='history';history.append(text('summary',`History · ${historyCards.length} stopped / completed`),...symbolGroups(historyCards));sections.push(history);}
    if(!sections.length&&cards.length)sections.push(text('p','No setups in this view.','terminal-muted'));
    if(!cards.length)sections.push(text('p','No server setups yet. Configure a draft and click Start.','terminal-muted'));
    else if(!liveCards.length&&['all','active'].includes(monitorFilter))sections.unshift(text('p','Nothing is actively monitoring.','terminal-monitor-empty'));
    el('monitor-list').replaceChildren(...sections);updateMonitorEstimateAges();
  }
  async function openMonitoredSetup(id,showBuilder=true){
    let run=serverMonitors.find(r=>r.id===id);if(!run||run.scope!==scope||conditionBusy||submitting||reviewing||closing)return;
    hideMonitorWorkspace();conditionBusy=true;updateTicket();
    try{
      if(el('symbol').value!==run.symbol){el('symbol').value=run.symbol;selectionChanged();const until=Date.now()+10000;while(!market&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,100));if(!market)throw Error('Chart is still loading. Try opening the setup again.');}
      if(run.scope!==scope||el('symbol').value!==run.symbol)throw Error('Account or symbol changed while opening the setup. Try again.');
      run=serverMonitors.find(r=>r.id===id);if(!run)throw Error('Setup no longer exists.');
      invalidate();selectedMonitorId=id;serverMonitor=null;serverStateKey='';serverDetachedId='';serverReviewShown='';conditionFinished='';conditionApplied=null;
      const settings=run.settings,ticket=settings.ticket;conditionHistorySuspended=true;el('condition-list').replaceChildren();
      for(const row of run.rows)conditionRow(row);
      setAutoPlan(settings.autoPlan);setEntryQuality(settings.entryQuality);setInvalidation(settings.invalidation);setMonitorSettings({name:run.name,group:run.group,group_policy:run.group_policy});
      for(const name of ['sizing','timeout','gap','action'])el('condition-'+name).value=settings[name];syncConditionStartLabel();
      for(const name of ['side','order-kind','order-price','volume','sl','tp'])el(name).value=ticket[name]??'';
      conditionHistorySuspended=false;resetConditionUndo();saveConditions();updateOrderHint();syncDraftLines();selectSetupTab('conditions');
      receiveServerConditions({run,runs:serverMonitors});
      if(showBuilder&&!el('quick-editor').open)openSetupBuilder(run.phase==='review'?'review':'conditions');
      return true;
    }catch(error){conditionHistorySuspended=false;conditionMessage(error.message);}
    finally{conditionBusy=false;updateTicket();}
  }
  async function duplicateMonitoredSetup(id){
    const original=serverMonitors.find(run=>run.id===id);if(!original||conditionBusy||submitting||reviewing||closing)return;
    if(!await openMonitoredSetup(id,false)||selectedMonitorId!==id)return;
    invalidate();selectedMonitorId='';serverMonitor=null;serverStateKey='';serverDetachedId='';serverReviewShown='';conditionFinished='';conditionApplied=null;
    setMonitorSettings({name:monitorDisplayName(original)+' (copy)',group:'',group_policy:'ALL'});
    el('condition-action').value='ALERT';syncConditionStartLabel();saveConditions();renderMonitorList();
    conditionMessage('Duplicated as an alerts-only draft. Original monitoring continues. Review settings and explicitly Start to arm this copy.');
    openSetupBuilder('conditions');
  }
  el('monitor-add').onclick=()=>{
    if(conditionBusy||submitting||reviewing||closing)return;
    hideMonitorWorkspace();
    invalidate();selectedMonitorId='';serverMonitor=null;serverStateKey='';serverDetachedId='';serverReviewShown='';clearSetupDraft();renderMonitorList();
    conditionMessage('Independent draft. Existing monitors continue. Configure this setup, then Start.');
    if(!el('quick-editor').open)openSetupBuilder('conditions');
  };
  el('monitor-stop-all').onclick=async()=>{try{receiveServerConditions(await call('terminal/conditions/stop',{all:true,reason:'Stopped: Stop all requested. Broker orders remain unchanged.'}));}catch(error){conditionMessage('Stop all not confirmed: '+error.message);}};
  for(const name of ['name','group','policy'])el('monitor-'+name).addEventListener(name==='policy'?'change':'input',()=>{saveConditions();});

  function readInvalidation(){
    const value={enabled:el('invalidation-enabled').checked,visible:el('invalidation-visible').checked};
    for(const name of ['source','direction','level','timeframe','sensitivity','buffer']){const raw=el('invalidation-'+name).value;value[name]=['level','sensitivity','buffer'].includes(name)?raw.trim()===''?NaN:Number(raw):raw;}
    return value;
  }
  function setInvalidation(value={}){
    const guard={enabled:false,source:'SWING',direction:'BELOW',level:0,timeframe:'M5',sensitivity:2,buffer:10,visible:true,...value};
    for(const name of ['enabled','visible'])el('invalidation-'+name).checked=guard[name]===true;
    for(const name of ['source','direction','level','timeframe','sensitivity','buffer'])el('invalidation-'+name).value=guard[name];
    renderInvalidationControls();renderEntryQualityControls();
  }
  function invalidationErrors(guard){
    if(!guard.enabled)return [];const errors=[];
    if(guard.source==='LEVEL'){if(!Number.isFinite(guard.level)||guard.level<=0)errors.push('Enter a positive manual cancellation price.');if(!['BELOW','ABOVE'].includes(guard.direction))errors.push('Choose the cancellation direction.');}
    else if(guard.source==='SWING'){if(!C.frames.includes(guard.timeframe)||!Number.isInteger(guard.sensitivity)||guard.sensitivity<1||guard.sensitivity>10)errors.push('Choose a swing timeframe and 1–10 candles each side.');if(!Number.isInteger(guard.buffer)||guard.buffer<0||guard.buffer>1000000)errors.push('Invalidation buffer must be 0–1,000,000 broker ticks.');}
    else errors.push('Choose manual price or confirmed swing invalidation.');
    return errors;
  }
  function invalidationDescription(guard){
    if(!guard?.enabled)return 'Off';
    return guard.source==='LEVEL'?`Bid is ${guard.direction==='BELOW'?'at/below':'at/above'} ${comparisonPrice(guard.level)}`:`Bid breaches the starting ${guard.timeframe} confirmed swing (${guard.sensitivity} candles each side, ${guard.buffer} ticks outward), below a BUY swing low or above a SELL swing high`;
  }
  function invalidationPreview(){
    const guard=readInvalidation();if(!guard.enabled||invalidationErrors(guard).length)return guard;
    const result={...guard,direction:guard.source==='SWING'?(el('side').value==='BUY'?'BELOW':'ABOVE'):guard.direction};
    if(guard.source==='SWING'){
      const history=structureHistories.get(structureKey(guard.timeframe));result.level=null;
      if(!history)return result;
      if(history.error)return {...result,error:history.error};
      if(!history.analyses.has(guard.sensitivity)){const model=new C.Structure(guard.sensitivity);for(const bar of history.candles)model.push(bar);history.analyses.set(guard.sensitivity,model);}
      const model=history.analyses.get(guard.sensitivity),swing=(result.direction==='BELOW'?model.lows:model.highs).at(-1);
      if(!swing||swing.broken)return {...result,error:'A usable confirmed invalidation swing is unavailable. Choose another timeframe or a manual level.'};
      const tick=market?.tick_size;if(!(tick>0))return {...result,error:'Broker tick size unavailable for invalidation.'};
      const raw=swing.price+(result.direction==='BELOW'?-1:1)*guard.buffer*tick;
      result.level=Number(((result.direction==='BELOW'?Math.floor(raw/tick+1e-8):Math.ceil(raw/tick-1e-8))*tick).toFixed(10));
    }
    if(!(result.level>0))result.error='Cancellation price must be positive.';
    else if(market&&(result.direction==='BELOW'?market.bid<=result.level:market.bid>=result.level))result.error='Setup is already invalid at the current Bid. Adjust the cancellation level.';
    return result;
  }
  function renderInvalidationControls(){
    const guard=readInvalidation(),swing=guard.source==='SWING';
    for(const name of ['source','direction','level','timeframe','sensitivity','buffer']){const input=el('invalidation-'+name);input.disabled=!guard.enabled||(swing?['direction','level'].includes(name):['timeframe','sensitivity','buffer'].includes(name));if(name!=='source')input.parentElement.hidden=swing?['direction','level'].includes(name):['timeframe','sensitivity','buffer'].includes(name);}
    const current=serverMonitor?.scope===scope&&serverMonitor.symbol===el('symbol').value?serverMonitor.invalidation:null;
    const applied=current?.enabled&&['running','review'].includes(serverMonitor.phase)?` Applied guard: Bid ${current.direction==='BELOW'?'≤':'≥'} ${comparisonPrice(current.level)}, frozen at Start.`:'';
    const message=(guard.enabled?invalidationErrors(guard).join(' ')||'Draft guard enabled. Swing levels are frozen when you Start; this does not move the order SL.':'Draft guard is off.')+applied;
    if(el('invalidation-status').textContent!==message)el('invalidation-status').textContent=message;
  }
  for(const name of ['enabled','source','direction','level','timeframe','sensitivity','buffer','visible']){
    const input=el('invalidation-'+name);input.addEventListener(input.type==='number'?'input':'change',()=>{renderInvalidationControls();invalidate();saveConditions();loadStructureDrafts();});
  }
  renderInvalidationControls();

  const builderMoves=[],builderPanels={};let builderStep='conditions',builderFocus=null;
  const quickEditor=el('quick-editor');try{quickEditor.open=localStorage.getItem('tradetrace.quickEditorOpen')==='true';}catch(_){}
  quickEditor.addEventListener('toggle',()=>{if(quickEditor.open&&!el('setup-builder').open&&builderMoves.length)restoreQuickEditor();try{localStorage.setItem('tradetrace.quickEditorOpen',String(quickEditor.open));}catch(_){}sizePanels();});
  function builderMove(node,parent){if(!node)return;const marker=document.createComment('setup-builder-return');node.before(marker);builderMoves.push({node,marker});parent.append(node);}
  function openSetupBuilder(step='conditions'){
    const dialog=el('setup-builder');if(dialog.open){setBuilderStep(step);return;}
    builderFocus=document.activeElement;
    if(builderMoves.length){
      el('conditions-panel').hidden=el('setup-order-panel').hidden=false;el('builder-templates').open=conditionRows().length===0;el('builder-manual-review').open=!el('submit').hidden||!!editingOrder||!!editingPosition;
      dialog.classList.remove('builder-advanced');el('builder-mode').textContent='Show advanced';el('builder-mode').setAttribute('aria-pressed','false');
      setBuilderStep(step,true);dialog.showModal();return;
    }
    const form=el('ticket');el('builder-form-host').append(form);
    for(const name of ['conditions','entry','review']){const panel=document.createElement('section');panel.id='terminal-builder-panel-'+name;panel.setAttribute('aria-labelledby','terminal-builder-step-'+name);panel.setAttribute('role','region');builderPanels[name]=panel;form.append(panel);}
    builderMove(el('conditions-panel'),builderPanels.conditions);builderMove(el('setup-order-panel'),builderPanels.entry);
    const templates=document.createElement('details');templates.id='terminal-builder-templates';templates.className='builder-temporary';templates.innerHTML='<summary>Choose a starter or saved template</summary>';templates.open=conditionRows().length===0;el('conditions-panel').prepend(templates);builderMove(el('condition-starters'),templates);builderMove(el('condition-templates'),templates);el('conditions-panel').querySelector(':scope>p.terminal-muted')?.classList.add('builder-advanced');
    builderMove(form.querySelector('.terminal-setup-risk'),builderPanels.entry);
    builderMove(el('condition-action').parentElement,builderPanels.entry);
    builderMove(el('auto-plan-enabled').parentElement,builderPanels.entry);builderMove(el('auto-plan'),builderPanels.entry);
    const planFields=document.createElement('div');planFields.className='terminal-builder-plan-fields builder-temporary';el('auto-plan').insertBefore(planFields,el('auto-plan').querySelector('label'));for(const label of [...el('auto-plan').querySelectorAll(':scope>label')])builderMove(label,planFields);
    for(const name of ['invalidation-enabled','quality-enabled']){const label=el(name).parentElement;label.classList.add('builder-advanced');builderMove(label,builderPanels.entry);}
    for(const name of ['invalidation-settings','quality-settings']){el(name).classList.add('builder-advanced');builderMove(el(name),builderPanels.entry);}
    const timing=el('condition-timeout').closest('details');timing.classList.add('builder-advanced');builderMove(timing,builderPanels.entry);
    el('monitor-group-settings').classList.add('builder-advanced');
    for(const name of ['condition-preview','setup-readiness'])builderMove(el(name),builderPanels.review);
    el('condition-preview').open=el('setup-readiness').open=true;
    for(const name of ['condition-comparison','condition-event-log','setup-last-result']){el(name).classList.add('builder-advanced');builderMove(el(name),builderPanels.review);}
    builderMove(form.querySelector('.terminal-setup-account'),builderPanels.review);
    const manual=document.createElement('details');manual.id='terminal-builder-manual-review';manual.className='terminal-builder-manual-review';manual.innerHTML='<summary>Manual ticket review / prepared order</summary>';builderPanels.review.append(manual);
    for(const name of ['preview','order-summary','submit'])builderMove(el(name),manual);
    manual.open=!el('submit').hidden||!!editingOrder||!!editingPosition;
    builderMove(form.querySelector('.terminal-setup-run-actions'),builderPanels.review);
    for(const label of el('setup-order-panel').children)if(!label.classList.contains('terminal-side-cards')&&label.tagName!=='SELECT'&&label.id!=='terminal-ticket-editing'&&label.id!=='terminal-ticket-edit-cancel')label.classList.add('builder-manual-fields');
    el('conditions-panel').hidden=el('setup-order-panel').hidden=false;
    dialog.classList.remove('builder-advanced');el('builder-mode').textContent='Show advanced';el('builder-mode').setAttribute('aria-pressed','false');
    setBuilderStep(step,true);dialog.showModal();
  }
  function restoreQuickEditor(){
    if(!builderMoves.length)return;
    const tab=el('setup-tab-order').getAttribute('aria-selected')==='true'?'order':'conditions';
    for(const {node,marker} of builderMoves.reverse()){marker.replaceWith(node);}builderMoves.length=0;
    el('ticket').querySelectorAll('.builder-temporary').forEach(node=>node.remove());
    for(const panel of Object.values(builderPanels))panel.remove();el('quick-editor-host').append(el('ticket'));
    selectSetupTab(tab);
  }
  function closeSetupBuilder(chart=false){
    const dialog=el('setup-builder');if(!dialog.open)return;
    dialog.close();selectSetupTab(builderStep==='conditions'?'conditions':'order');
    // Keep the prepared layout when the classic editor is collapsed. Reopening
    // then only switches the visible step instead of moving dozens of controls.
    if(quickEditor.open)restoreQuickEditor();renderBuilderSummary();
    if(chart){if(el('monitor-workspace').classList.contains('is-expanded')){hideMonitorWorkspace();}el('chart').scrollIntoView({block:'center'});el('chart').focus({preventScroll:true});}else if(builderFocus?.isConnected)builderFocus.focus({preventScroll:true});
  }
  function setBuilderStep(step,preparing=false){
    if(!el('setup-builder').open&&!preparing)return;builderStep=step;
    for(const name of ['conditions','entry','review']){builderPanels[name].hidden=name!==step;const button=el('builder-step-'+name);if(name===step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
    el('builder-form-host').scrollTop=0;el('builder-back').disabled=step==='conditions';el('builder-next').hidden=step==='review';
    el('builder-next').textContent=step==='conditions'?'Next: Entry & risk →':'Next: Review →';
    el('builder-step-hint').textContent=step==='conditions'?'Choose a template or build your conditions.':step==='entry'?'Choose side, execution mode and risk.':'Review all settings. Only Start arms this setup.';
    renderBuilderSummary(preparing);
  }
  function renderBuilderSummary(preparing=false){
    const recovery=el('condition-recovery'),interrupted=serverMonitor?.id!==serverDetachedId&&serverMonitor?.phase==='stopped'&&serverMonitor?.interruption?.enabled&&serverMonitor.scope===scope&&serverMonitor.symbol===el('symbol').value;
    const saved=serverMonitor?.id!==serverDetachedId&&serverMonitor?.phase==='saved'&&serverMonitor.scope===scope&&serverMonitor.symbol===el('symbol').value;
    let savedText='';if(saved){const previous=serverMonitor.invalidation,proposed=invalidationPreview();savedText='Saved after server restart. Automatic entry is disarmed. Review, then explicitly Start; all steps begin again.';if(serverMonitor.saved?.uncertain)savedText+=' Previous submission outcome may be uncertain—check MT5 positions and pending orders before re-arming.';if(previous?.enabled)savedText+=' Previous frozen cancellation: '+comparisonPrice(previous.level)+'.';if(proposed.enabled)savedText+=' Proposed draft cancellation: '+(proposed.error|| (proposed.level?comparisonPrice(proposed.level):'waiting for current broker swing history'))+'. Recalculated at Start.';}
    const recoveryText=saved?savedText:interrupted?recoveryDescription(serverMonitor):'';if(recovery.textContent!==recoveryText)recovery.textContent=recoveryText;recovery.hidden=!interrupted&&!saved;
    const sidebar=el('builder-draft-summary');if(!sidebar)return;
    const rows=conditionRows(),plan=readAutoPlan(),side=el('side').value,name=readMonitorSettings().name||'Unnamed draft';
    const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
    setText(sidebar,`${name} · ${rows.length} condition${rows.length===1?'':'s'} · ${side} · ${plan.enabled?plan.risk+'% risk':'ticket lots'}`);
    const dialog=el('setup-builder');if(!dialog.open&&!preparing)return;
    dialog.classList.toggle('builder-use-auto',plan.enabled);if(plan.enabled&&!dialog.classList.contains('builder-advanced')&&!el('auto-plan').open)el('auto-plan').open=true;
    setText(el('builder-context'),`${el('symbol').value||'Select a market'} · ${market?(market.demo?'Demo':'LIVE')+' account '+market.account:'Connect MT5'} · ${name}`);
    setText(el('builder-story'),el('condition-preview-text').textContent||'Add conditions or load a starter template. An empty setup acts immediately when explicitly started.');
    const facts=[['Execution',{ALERT:'Alerts only',REVIEW:'Prepare order for review',AUTO:'One automatic entry attempt'}[el('condition-action').value]],['Entry',plan.enabled?(plan.entry==='RETEST'?'Limit retest · expires in '+plan.expiry+' minutes':'Market after confirmation'):side+' '+(el('order-kind').value==='MARKET'?'market':'pending at '+el('order-price').value)],['Risk & target',plan.enabled?`${plan.risk}% equity · ${plan.rr}R target · ${plan.timeframe} swing stop (${plan.sensitivity} candles, ${plan.buffer} ticks)`:`${el('volume').value||'—'} lots · SL ${el('sl').value||'not set'} · TP ${el('tp').value||'not set'}`],['Cancellation',invalidationDescription(readInvalidation())],['Entry quality',qualityDescription(readEntryQuality())],['Linked setups',readMonitorSettings().group?readMonitorSettings().group+' · '+(readMonitorSettings().group_policy==='FIRST_ENTRY'?'first entry stops others':'all may enter'):'Independent'],['Timing',`Timeout ${el('condition-timeout').value||0} min · quote-gap reset ${el('condition-gap').value||0} sec`]];
    const factsNode=el('builder-facts'),factsKey=JSON.stringify(facts);if(factsNode.dataset.key!==factsKey){factsNode.dataset.key=factsKey;factsNode.replaceChildren(...facts.flatMap(([label,value])=>[text('dt',label),text('dd',value)]));}
  }
  el('builder-use-chart').onclick=()=>{
    const frame=el('timeframe').value,symbol=el('symbol').value;
    if(!C.frames.includes(frame)){el('builder-readiness').textContent=`Choose a supported chart timeframe first: ${C.frames.join(', ')}.`;return;}
    if(conditionBusy||submitting||reviewing||closing)return;
    for(const row of el('condition-list').querySelectorAll('.terminal-condition-row')){const input=row.querySelector('[data-field=timeframe]');if(input){input.value=frame;input.dispatchEvent(new Event('change',{bubbles:true}));}}
    for(const id of ['condition-starter-frame','auto-plan-timeframe','invalidation-timeframe']){const input=el(id);if(input){input.value=frame;input.dispatchEvent(new Event('change',{bubbles:true}));}}
    saveConditions();renderBuilderSummary();renderSetupReadiness();
    el('builder-use-chart').textContent=`Applied ${symbol} · ${frame}`;
  };
  el('builder-open').onclick=()=>openSetupBuilder('conditions');
  for(const name of ['conditions','entry','review'])el('builder-step-'+name).onclick=()=>setBuilderStep(name);
  el('builder-close').onclick=()=>closeSetupBuilder();el('builder-chart').onclick=()=>closeSetupBuilder(true);
  el('builder-back').onclick=()=>setBuilderStep(builderStep==='review'?'entry':'conditions');el('builder-next').onclick=()=>setBuilderStep(builderStep==='conditions'?'entry':'review');
  const advanced=()=>{const enabled=el('setup-builder').classList.toggle('builder-advanced');el('builder-mode').textContent=enabled?'Simple view':'Show advanced';el('builder-mode').setAttribute('aria-pressed',String(enabled));renderBuilderSummary();};
  el('builder-mode').onclick=advanced;el('builder-advanced-shortcut').onclick=()=>{if(!el('setup-builder').classList.contains('builder-advanced'))advanced();setBuilderStep('entry');};
  el('setup-builder').addEventListener('cancel',event=>{event.preventDefault();closeSetupBuilder();});
  el('ticket').addEventListener('keydown',event=>{if(el('setup-builder').open&&event.key==='Enter'&&event.target.tagName==='INPUT')event.preventDefault();});
  new MutationObserver(()=>{if(el('pane').hidden&&el('setup-builder').open)closeSetupBuilder();}).observe(el('pane'),{attributes:true,attributeFilter:['hidden']});
  renderBuilderSummary();

  selectSetupTab('order');

  buildChart();setTool('cursor');
  new MutationObserver(()=>{if(!el('pane').hidden){if(!running)connectWorkspace(true);else refresh();}}).observe(el('pane'),{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){pollServerConditions();refresh();}});
  setInterval(()=>{if(!document.hidden)pollServerConditions();},2000);
  setInterval(()=>{if(!document.hidden&&!el('pane').hidden)renderConditionWaiting();updateMonitorEstimateAges();},1000);
  pollServerConditions();
  window.addEventListener('DOMContentLoaded',()=>connectWorkspace(true));
  setInterval(()=>{if(!running&&!connecting&&!autoReconnectBlocked&&!document.hidden&&!el('pane').hidden&&Date.now()>=nextAutoConnect)connectWorkspace(true);else refresh();},2000);
})();
