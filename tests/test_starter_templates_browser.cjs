/* Isolated, headless UI regression test. Every broker endpoint is intercepted. */
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const playwright=require('playwright');
const demo=process.env.TRADETRACE_TEST_LIVE!=='1';
const root=path.resolve(__dirname,'..'),port=18882,url=`http://127.0.0.1:${port}`;
const server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['server.py','--port',String(port),'--no-browser'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
const candles=Array.from({length:300},(_,i)=>[Date.UTC(2026,9,20)/1+300000*i,1.1+i*.00001,1.1003+i*.00001,1.0997+i*.00001,1.1001+i*.00001,100+i]);
const hourlyCandles=candles.map((bar,i)=>[Math.floor(candles.at(-1)[0]/3600000)*3600000-(299-i)*3600000,...bar.slice(1)]);
let browser;
let tradingAllowed=true,quoteAge=0;
let estimateMultiplier=1;
let equityOffset=0;
let mockBid=1.103;
let marketDelay=0;
const conditionBodies=[],automaticBodies=[];
const journalEntries=[],previewSetups=new Map();
const journalAccount=JSON.stringify(['123','Test-Demo']);
(async()=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test server timeout')),15000);server.stdout.on('data',chunk=>{if(chunk.toString().includes('http://')){clearTimeout(timer);resolve();}});server.on('error',reject);server.stderr.on('data',chunk=>process.stderr.write(chunk));});
  const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
  browser=await playwright.chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1536,height:1100}}),errors=[];let draftEstimateDelay=0,draftEstimateCalls=0,positionAmendments=0,positionLevels={sl:1.09,tp:1.12},proposedLevels=null,previews=0,submissions=0,planRequests=0,planDelay=0,positionClosed=false,pendingExists=false,pendingSnapshot=null,pendingModification=null,mockConnected=false,connectionCalls=0,lastConnectionPath=null;
  page.on('pageerror',error=>errors.push(error.message));
  const mockApi=async(endpoint,body)=>{
    if(endpoint==='/api/terminal/market'&&marketDelay)await new Promise(resolve=>setTimeout(resolve,marketDelay));
    if(endpoint==='/api/terminal/preview'&&body.condition_entry)conditionBodies.push(body);
    let value={};
    if(endpoint==='/api/session')value={connected:mockConnected,key_saved:false,account:'123',server:'Test-Demo',currency:'USD',direct:false};
    else if(endpoint==='/api/journal/overview')value={accounts:journalEntries.length?[{id:journalAccount,login:'123',server:'Test-Demo',currency:'USD'}]:[],account:journalEntries.length?journalAccount:null,trades:[],condition_entries:journalEntries};
    else if(endpoint==='/api/connect'||endpoint==='/api/connect-all'){mockConnected=true;connectionCalls++;lastConnectionPath=body.path;value={account:'123',server:'Test-Demo',currency:'USD',path:'C:/Test/terminal64.exe',native:{state:'setup',message:'Test history connector optional',levels:[],key_saved:false}};}
    else if(endpoint==='/api/history')value={trades:[],skipped:0};
    else if(endpoint==='/api/terminal/symbols')value={symbols:['EURUSD','GBPUSD','XAUUSD'],visible:['EURUSD','GBPUSD'],account:'123',server:'Test-Demo',currency:'USD',demo};
    else if(endpoint==='/api/terminal/market')value={bars:body.timeframe==='H1'?hourlyCandles:candles,bid:mockBid,ask:mockBid+.0001,quote_time:Date.now()/1000-quoteAge,trading_allowed:tradingAllowed,digits:5,tick_size:.00001,volume_min:.01,volume_max:10,volume_step:.01,balance:10000,equity:10020+equityOffset,margin_free:9990,currency:'USD',account:'123',server:'Test-Demo',demo,orders:pendingExists?[pendingSnapshot]:[],positions:positionClosed?[]:[{ticket:'42',symbol:'EURUSD',type:0,volume:.01,price_open:1.101,price_current:1.103,...positionLevels,profit:20}]};
    else if(endpoint==='/api/terminal/closed')value={account:'123',server:'Test-Demo',currency:'USD',positions:[{id:'41',symbol:'EURUSD',side:'BUY',volume:.01,entry:1.1,exit:1.102,end:Date.now(),net:1.8}],note:'Last 30 days · test net P/L'};
    else if(endpoint==='/api/terminal/quotes')value={account:'123',server:'Test-Demo',quotes:Object.fromEntries(body.symbols.map(s=>[s,{bid:mockBid,ask:mockBid+.0001,time:Date.now()/1000}]))};
    else if(endpoint==='/api/terminal/estimate'){draftEstimateCalls++;if(draftEstimateDelay)await new Promise(resolve=>setTimeout(resolve,draftEstimateDelay));const sign=body.side==='BUY'?1:-1,profit=price=>price?sign*(Number(price)-Number(body.entry))*Number(body.volume)*100000*estimateMultiplier:null;value={account:'123',server:'Test-Demo',currency:'USD',sl:profit(Number(body.sl)),tp:profit(Number(body.tp))};}
    else if(endpoint==='/api/terminal/plan'){planRequests++;if(planDelay)await new Promise(resolve=>setTimeout(resolve,planDelay));value={account:'123',server:'Test-Demo',currency:'USD',risk:12.5,reward:25,mark_to_market:3,quote_time:Date.now()/1000-quoteAge,trading_allowed:tradingAllowed,note:'Mock gross estimate; no trade placed'};}
    else if(endpoint==='/api/terminal/position-preview'){assert.equal(body.position,'42');proposedLevels={sl:Number(body.sl),tp:Number(body.tp)};value={preview:'mock-position-token',expires_in:60,account:'123',server:'Test-Demo',request:{action:6,position:42,symbol:'EURUSD',...proposedLevels}};}
    else if(endpoint==='/api/terminal/modify-preview'){pendingModification={price:Number(body.price),sl:Number(body.sl),tp:Number(body.tp)};value={preview:'mock-modify-token',expires_in:60,account:'123',server:'Test-Demo',request:{order:88,symbol:'EURUSD',...pendingModification}};}
    else if(endpoint==='/api/terminal/cancel-preview')value={preview:'mock-cancel-token',expires_in:60,account:'123',server:'Test-Demo',request:{order:88,symbol:'EURUSD',action:8}};
    else if(endpoint==='/api/terminal/close-preview')value={preview:'mock-close-token',expires_in:60,account:'123',server:'Test-Demo',request:{position:42,symbol:'EURUSD',volume:.01,price:1.103,type:1}};
    else if(endpoint==='/api/terminal/condition-plan'){
      automaticBodies.push(structuredClone(body));await new Promise(resolve=>setTimeout(resolve,200));
      const pending=body.auto_plan.entry==='RETEST',entry=pending?body.retest_level:1.1031,sl=Number((body.stop_swing.price-body.auto_plan.buffer*.00001).toFixed(5)),tp=Number((entry+body.auto_plan.rr*(entry-sl)).toFixed(5));
      const calculation={entry,modeled_entry:entry,sl,tp,volume:.05,risk_percent:body.auto_plan.risk,budget:100,modeled_loss:90,modeled_reward:180,rr:body.auto_plan.rr,currency:'USD',stop_swing:body.stop_swing,buffer_ticks:body.auto_plan.buffer,expires_at:pending?Math.floor(Date.now()/1000)+body.auto_plan.expiry*60:null};
      value={preview:pending?'mock-pending-token':'test-token',order_kind:pending?'LIMIT':'MARKET',expires_in:60,account:'123',server:'Test-Demo',demo,calculation,request:{symbol:body.symbol,type:pending?2:0,price:entry,sl,tp,volume:.05}};
      previewSetups.set(value.preview,{...body,condition_setup:{...body.condition_setup,automatic_plan:calculation},sl,tp});
      if(pending)pendingSnapshot={ticket:'88',symbol:body.symbol,type:2,volume:.05,price:entry,sl,tp};
    }
    else if(endpoint==='/api/terminal/preview'){previews++;await new Promise(resolve=>setTimeout(resolve,250));const pending=body.order_kind&&body.order_kind!=='MARKET',kind=body.order_kind==='PENDING'?(body.side==='BUY'?(Number(body.price)<1.1031?'LIMIT':'STOP'):(Number(body.price)>1.103?'LIMIT':'STOP')):body.order_kind;if(pending)pendingSnapshot={ticket:'88',symbol:body.symbol,type:body.side==='BUY'?(kind==='LIMIT'?2:4):(kind==='LIMIT'?3:5),volume:Number(body.volume),price:Number(body.price),sl:Number(body.sl),tp:Number(body.tp)};value={preview:pending?'mock-pending-token':'test-token',order_kind:kind,expires_in:60,account:'123',server:'Test-Demo',request:{symbol:body.symbol,volume:Number(body.volume),price:pending?Number(body.price):1.1031,sl:Number(body.sl)||0,tp:Number(body.tp)||0}};}
    else if(endpoint==='/api/terminal/submit'){if(body.preview==='mock-position-token'){positionAmendments++;positionLevels={...proposedLevels};value={retcode:10009,comment:'Mocked protection amendment',operation:'position-sltp',order:'0',deal:'0',volume:0,price:0,message:'Test only'};}else {submissions++;}if(body.preview==='mock-position-token'){}else if(body.preview==='mock-modify-token'){pendingSnapshot={...pendingSnapshot,...pendingModification};value={retcode:10009,comment:'Mocked amendment',order:'88',deal:'0',volume:0,price:0,operation:'modify',message:'Test only'};}else if(body.preview==='mock-cancel-token'){pendingExists=false;value={retcode:10009,comment:'Mocked cancellation',order:'88',deal:'0',volume:0,price:0,operation:'cancel',message:'Test only'};}else if(body.preview==='mock-pending-token'){pendingExists=true;value={retcode:10008,comment:'Mocked pending accepted',order:'88',deal:'0',volume:0,price:0,operation:'pending',message:'Test only'};}else if(body.preview==='mock-close-token'){positionClosed=true;value={retcode:10009,comment:'Mocked closure',order:'101',deal:'102',volume:.01,price:1.103,operation:'close',remaining_volume:0,message:'Test only'};}else value={retcode:10009,comment:'Mocked execution',order:'99',deal:'100',volume:.01,price:1.1031,message:'Test only'};}
    else throw Error('Not available in isolated browser test: '+endpoint);
    if(endpoint==='/api/terminal/preview'){if(body.condition_entry)previewSetups.set(value.preview,structuredClone(body));else previewSetups.delete(value.preview);}
    if(endpoint==='/api/terminal/submit'&&previewSetups.has(body.preview)){
      const saved=previewSetups.get(body.preview);previewSetups.delete(body.preview);
      journalEntries.unshift({id:'entry-'+journalEntries.length,created:new Date().toISOString(),position:null,demo,setup:saved.condition_setup,request:{symbol:saved.symbol,sl:saved.sl,tp:saved.tp},result:{...value,operation:value.operation||'open'}});value.journal_recorded=true;
    }
    return value;
  };
  const serverMonitor=require('./mock_condition_monitor.cjs').createMonitor(mockApi);
  await page.route('**/api/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname,body=route.request().postDataJSON()||{};
    try{const value=endpoint.startsWith('/api/terminal/conditions/')?await serverMonitor.handle(endpoint,body):await mockApi(endpoint,body);if(endpoint==='/api/terminal/submit')serverMonitor.submitted(body,value);await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});}catch(error){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
  });
  await page.context().addInitScript(()=>localStorage.setItem('tradetrace.quickEditorOpen','true'));await page.goto(url);await page.locator('#nav-terminal').click();
  await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
  await page.locator('#terminal-setup-tab-conditions').click();
  assert.equal(await page.locator('#terminal-condition-starters').isVisible(),true);
  assert.equal(await page.locator('#terminal-condition-starter option').count(),8);
  for(const key of ['MS_UP','MS_DOWN','BOS_UP','BOS_DOWN','BOS_UP_RETEST','BOS_DOWN_RETEST','MS_UP_RETEST','MS_DOWN_RETEST']){
    await page.locator('#terminal-condition-starter').selectOption(key);
    await page.locator('#terminal-condition-starter-frame').selectOption('M15');await page.locator('#terminal-condition-starter-risk').fill('0.75');
    await page.locator('#terminal-condition-starter-load').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);
    assert.equal(await page.locator('.terminal-condition-row').count(),1);
    assert.equal(await page.locator('.terminal-condition-row [data-field=rule]').inputValue(),key.replace('_RETEST',''));
    assert.equal(await page.locator('.terminal-condition-row [data-field=timeframe]').inputValue(),'M15');
    assert.equal(await page.locator('.terminal-condition-row [data-field=sensitivity]').inputValue(),'2');
    assert.equal(await page.locator('#terminal-side').inputValue(),key.includes('_UP')?'BUY':'SELL');
    assert.equal(await page.locator('#terminal-auto-plan-enabled').isChecked(),true);
    assert.equal(await page.locator('#terminal-auto-plan-stop_basis').inputValue(),'SIGNAL');
    assert.equal(await page.locator('#terminal-auto-plan-hold_breakout').isChecked(),!key.endsWith('_RETEST'));
    assert.equal(await page.locator('#terminal-invalidation-enabled').isChecked(),true);
    assert.equal(await page.locator('#terminal-invalidation-source').inputValue(),'SWING');
    assert.equal(await page.locator('#terminal-invalidation-timeframe').inputValue(),'M15');
    assert.equal(await page.locator('#terminal-invalidation-sensitivity').inputValue(),'2');
    assert.equal(await page.locator('#terminal-invalidation-buffer').inputValue(),'10');
    assert.equal(await page.locator('#terminal-auto-plan-entry').inputValue(),key.endsWith('_RETEST')?'RETEST':'MARKET');
    assert.equal(await page.locator('#terminal-auto-plan-risk').inputValue(),'0.75');
    assert.equal(await page.locator('#terminal-auto-plan-rr').inputValue(),'2');
    assert.equal(await page.locator('#terminal-condition-action').inputValue(),'ALERT');
    assert.equal(await page.locator('#terminal-setup-phase').textContent(),'Draft');assert.equal(await page.locator('#terminal-condition-stop').isDisabled(),true);
    assert.equal(submissions,0);assert.equal(previews,0);assert.equal(automaticBodies.length,0);
  }
  assert.equal(await page.locator('#terminal-condition-template-select option').count(),1,'built-ins do not change saved library');
  await page.locator('#terminal-condition-starter-risk').fill('3');assert.equal(await page.locator('#terminal-condition-starter-load').isDisabled(),true);
  await page.locator('#terminal-condition-starter-risk').fill('0.5');
  await page.locator('#terminal-invalidation-enabled').uncheck(); // This lifecycle fixture has no confirmed swings.
  await page.locator('#terminal-condition-start').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.waitForFunction(()=>document.querySelector('#terminal-condition-stop').disabled===false);
  await page.locator('#terminal-condition-starter').selectOption('MS_UP');await page.locator('#terminal-condition-starter-load').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);
  assert.equal(await page.locator('#terminal-condition-stop').isDisabled(),true,'loading a starter stops the prior monitor');
  await page.locator('#terminal-condition-templates summary').click();await page.locator('#terminal-condition-template-name').fill('My starter copy');await page.locator('#terminal-condition-template-save').click();
  assert.match(await page.locator('#terminal-condition-template-status').textContent(),/Saved/);
  await page.locator('#terminal-setup-new').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-condition-template-load').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);
  assert.equal(await page.locator('#terminal-invalidation-enabled').isChecked(),true);
  assert.equal(await page.locator('#terminal-auto-plan-risk').inputValue(),'0.5');assert.equal(await page.locator('#terminal-side').inputValue(),'BUY');
  await page.locator('#terminal-condition-starters').scrollIntoViewIfNeeded();await page.locator('#terminal-ticket').screenshot({path:path.join(root,'work/starter-templates.png')});
  await page.reload();await page.locator('#nav-terminal').click();await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));await page.locator('#terminal-setup-tab-conditions').click();
  assert.equal(await page.locator('#terminal-condition-starter option').count(),8);assert.equal(await page.locator('#terminal-condition-action').inputValue(),'ALERT');
  assert.equal(submissions,0);assert.deepEqual(errors,[]);console.log('Starter template browser tests passed (mock broker; no real trades)');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
