const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18886,url=`http://127.0.0.1:${port}`;
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
 const setup=async(level,action,distance,minimum,target=0)=>{
  await page.locator('#terminal-setup-new').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();await page.locator('.terminal-condition-row [data-field=level]').fill(String(level));
  await page.locator('#terminal-quality-enabled').check();await page.locator('#terminal-quality-settings').evaluate(e=>e.open=true);
  await page.locator('#terminal-quality-max_distance').fill(String(distance));await page.locator('#terminal-quality-min_rr').fill(String(minimum));if(minimum>0)await page.locator('#terminal-quality-target').fill(String(target));
  await page.locator('#terminal-condition-action').selectOption(action);await page.locator('#terminal-condition-start').click();
  return (await waitState(s=>s.state.run?.phase==='running')).state.run.id;
 };

 await setup(1.104,'AUTO',.0005,0);await post('test/feed',{bid:1.105});
 let state=await waitState(s=>s.state.run.phase==='skipped');assert.equal(state.sent,0);assert.match(state.state.run.message,/distance/);
 await page.waitForFunction(()=>document.querySelector('#terminal-setup-phase').textContent==='Skipped');
 await page.locator('#terminal-quality-settings').scrollIntoViewIfNeeded();await page.locator('#terminal-ticket').screenshot({path:path.join(root,'work/entry-quality.png')});
 await page.locator('#terminal-condition-templates').evaluate(e=>e.open=true);await page.locator('#terminal-condition-template-name').fill('Quality filter');await page.locator('#terminal-condition-template-save').click();
 assert.match(await page.locator('#terminal-condition-template-status').textContent(),/Saved/);
 await page.locator('#terminal-setup-new').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);assert.equal(await page.locator('#terminal-quality-enabled').isChecked(),false);
 await page.locator('#terminal-condition-template-load').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);
 assert.equal(await page.locator('#terminal-quality-enabled').isChecked(),true);assert.equal(await page.locator('#terminal-quality-max_distance').inputValue(),'0.0005');
 await post('test/feed',{bid:1.103});await setup(1.104,'AUTO',0,2);await post('test/feed',{bid:1.105});state=await waitState(s=>s.state.run.phase==='skipped');assert.equal(state.sent,0);assert.match(state.state.run.message,/available RR/);
 await post('test/feed',{bid:1.103});await setup(1.104,'REVIEW',0,.5);await post('test/feed',{bid:1.105});await waitState(s=>s.state.run.phase==='review');await page.locator('#terminal-submit').waitFor();
 await post('test/feed',{bid:1.115});await page.locator('#terminal-submit').click();state=await waitState(s=>s.state.run.phase==='skipped');assert.equal(state.sent,0,'failed RR at confirmation never sends');
 await post('test/feed',{bid:1.103});await setup(1.104,'AUTO',0,.5,1.106);await post('test/feed',{bid:1.105});state=await waitState(s=>s.state.run.phase==='skipped');assert.equal(state.sent,0,'nearer target constrains available reward');
 await post('test/feed',{bid:1.103});await setup(1.104,'AUTO',.002,.5);await post('test/feed',{bid:1.105});await waitState(s=>s.sent===1&&s.state.run.phase==='finished');
 assert.deepEqual(errors,[]);console.log('Entry quality browser tests passed: distance, minimum RR, nearer target, frozen review recheck, saved templates, skip reasons and passing entry; fake broker only');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
