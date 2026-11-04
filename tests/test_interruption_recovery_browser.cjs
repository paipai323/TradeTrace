const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18890,url=`http://127.0.0.1:${port}`;
const server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['tests/monitor_browser_server.py','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.on('data',s=>{if(s.toString().includes('http://'))resolve();});server.stderr.on('data',s=>process.stderr.write(s));server.on('error',reject);setTimeout(()=>reject(Error('Server startup timeout')),15000).unref();});
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1536,height:1100}}),errors=[];
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.context().addInitScript(()=>localStorage.setItem('tradetrace.quickEditorOpen','true'));await page.goto(url);await page.locator('#nav-terminal').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 const token=await page.locator('meta[name=replay-token]').getAttribute('content');
 const post=async(route,body={})=>{const response=await context.request.post(url+'/api/'+route,{headers:{'X-Replay-Token':token},data:body});assert.equal(response.status(),200,await response.text());return response.json();};
 const waitState=async(predicate)=>{const until=Date.now()+12000;while(Date.now()<until){const value=await post('test/feed');if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Monitor state timeout: '+JSON.stringify(await post('test/feed')));};
 const setup=async(level,action)=>{
  await page.locator('#terminal-setup-new').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();await page.locator('.terminal-condition-row [data-field=level]').fill(String(level));
  await page.locator('#terminal-condition-action').selectOption(action);await page.locator('#terminal-condition-start').click();
  return (await waitState(s=>s.state.run?.phase==='running')).state.run.id;
 };

 const first=await setup(1.104,'AUTO');await post('test/feed',{quote_age:60,poll_gap:45});
 let state=await waitState(s=>s.state.run.phase==='stopped'&&s.state.run.interruption);assert.equal(state.sent,0);assert.equal(state.state.run.interruption.kind,'poll_gap');
 let card=page.locator(`[data-monitor-id="${first}"]`);await card.locator('.terminal-monitor-recovery').waitFor();assert.match(await card.textContent(),/Last fresh quote.*Gap at detection/);
 assert.equal(await card.getByRole('button',{name:'Review & restart',exact:true}).isDisabled(),true);
 await page.reload();await page.locator('#nav-terminal').click();card=page.locator(`[data-monitor-id="${first}"]`);await card.locator('.terminal-monitor-recovery').waitFor();
 await post('test/feed',{quote_age:0});await card.getByRole('button',{name:'Check connection',exact:true}).click();
 await card.getByRole('button',{name:'Review & restart',exact:true}).waitFor();await page.waitForFunction(id=>!document.querySelector(`[data-monitor-id="${id}"] .terminal-monitor-recovery button:last-child`).disabled,first);
 assert.match(await card.textContent(),/Connection restored/);await page.waitForTimeout(2200);state=await post('test/feed');assert.equal(state.sent,0);assert.equal(state.state.run.phase,'stopped','fresh quotes never resume trading');
 await card.getByRole('button',{name:'Review & restart',exact:true}).click();await page.locator('#terminal-setup-builder').waitFor();
 assert.equal(await page.locator('#terminal-builder-step-review').getAttribute('aria-current'),'step');assert.equal(await page.locator('#terminal-condition-start').textContent(),'Arm automatic entry');
 assert.equal(await page.locator('.terminal-condition-row [data-field=level]').inputValue(),'1.104');assert.equal(await page.locator('#terminal-sl').inputValue(),'1.09');assert.equal(await page.locator('#terminal-tp').inputValue(),'1.12');
 assert.match(await page.locator('#terminal-condition-recovery').textContent(),/explicit Start/);assert.equal((await post('test/feed')).state.run.id,first,'reviewing does not restart');
 await page.locator('#terminal-setup-builder').screenshot({path:path.join(root,'work/interruption-review.png')});
 await page.locator('#terminal-condition-start').click();state=await waitState(s=>s.state.run.id!==first&&s.state.run.phase==='running');assert.equal(state.state.run.applied.index,0);assert.equal(state.state.run.interruption,null);assert.equal(state.sent,0);
 await page.locator('#terminal-builder-close').click();await post('test/feed',{bid:1.105});await waitState(s=>s.sent===1&&s.state.run.phase==='finished');
 assert.deepEqual(errors,[]);console.log('Interruption recovery browser tests passed: sleep gap, stale quotes, reload, restored connection, explicit review/restart and one fresh attempt; fake broker only');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
