const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18891,url=`http://127.0.0.1:${port}`;
const storeDir=fs.mkdtempSync(path.join(root,'work/persisted-browser-')),store=path.join(storeDir,'setups.json');let server,browser;
function launch(){server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['tests/monitor_browser_server.py','--port',String(port)],{cwd:root,windowsHide:true,env:{...process.env,TRADETRACE_TEST_MONITOR_STORE:store},stdio:['pipe','pipe','pipe']});return server;}
async function ready(){await new Promise((resolve,reject)=>{server.stdout.on('data',data=>{if(data.toString().includes('http://'))resolve();});server.stderr.on('data',data=>process.stderr.write(data));server.on('error',reject);setTimeout(()=>reject(Error('Startup timeout')),15000).unref();});}
async function shutdown(){const current=server;await new Promise((resolve,reject)=>{current.once('exit',resolve);current.stdin.write('stop\n');setTimeout(()=>reject(Error('Shutdown timeout')),10000).unref();});}
launch();
(async()=>{
 await ready();
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1536,height:1100}}),errors=[];
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.context().addInitScript(()=>localStorage.setItem('tradetrace.quickEditorOpen','true'));await page.goto(url);await page.locator('#nav-terminal').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 let token=await page.locator('meta[name=replay-token]').getAttribute('content');
 const post=async(route,body={})=>{const response=await context.request.post(url+'/api/'+route,{headers:{'X-Replay-Token':token},data:body});assert.equal(response.status(),200,await response.text());return response.json();};
 const waitState=async(predicate)=>{const until=Date.now()+12000;while(Date.now()<until){const value=await post('test/feed');if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Monitor state timeout: '+JSON.stringify(await post('test/feed')));};
 const setup=async(level,action,name,swing=false)=>{
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-monitor-add').click();await page.waitForFunction(()=>!document.querySelector('#terminal-setup-new').disabled);await page.locator('#terminal-setup-tab-order').click();await page.locator('#terminal-sl').fill('1.09');await page.locator('#terminal-tp').fill('1.12');
  await page.locator('#terminal-setup-tab-conditions').click();await page.locator('#terminal-condition-add').click();await page.locator('.terminal-condition-row [data-field=level]').fill(String(level));
  await page.locator('#terminal-monitor-name').fill(name);if(swing){await page.locator('#terminal-invalidation-enabled').check();await page.locator('#terminal-invalidation-settings').evaluate(e=>e.open=true);await page.locator('#terminal-invalidation-sensitivity').fill('1');}
  await page.locator('#terminal-condition-action').selectOption(action);await page.locator('#terminal-condition-start').click();
  return (await waitState(s=>s.state.run?.name===name&&['running','review'].includes(s.state.run.phase))).state.run.id;
 };

 const bars=values=>values.map((price,i)=>[Date.now()-(8-i)*300000,price,price+.0002,price-.0002,price,100]);
 await post('test/feed',{bars:bars([1.09,1.098,1.092,1.101,1.094,1.100,1.096,1.102])});
 const first=await setup(1.2,'AUTO','Saved automatic buy',true),second=await setup(1.102,'REVIEW','Saved prepared review');
 let state=(await waitState(s=>s.state.runs.find(run=>run.id===second).phase==='review')).state,previous=state.runs.find(run=>run.id===first).invalidation.level,oldToken=state.runs.find(run=>run.id===second).review.preview;
 assert.equal((await post('test/feed')).sent,0);assert.ok(fs.existsSync(store));assert.equal(fs.readFileSync(store,'utf8').includes(oldToken),false,'review tokens are never persisted');
 await shutdown();launch();await ready();await page.reload();token=await page.locator('meta[name=replay-token]').getAttribute('content');await page.locator('#nav-terminal').click();
 state=(await waitState(s=>s.state.runs.length===2)).state;assert.ok(state.runs.every(run=>run.phase==='saved'&&run.applied.index===0&&run.review===null));assert.equal((await post('test/feed')).sent,0);
 await page.waitForFunction(()=>document.querySelector('#terminal-monitor-count').textContent.includes('2 saved'));
 const rejected=await context.request.post(url+'/api/terminal/submit',{headers:{'X-Replay-Token':token},data:{preview:oldToken}});assert.notEqual(rejected.status(),200,'old review cannot send after restart');
 await post('test/feed',{bars:bars([1.09,1.098,1.092,1.101,1.095,1.100,1.096,1.102])});await page.reload();token=await page.locator('meta[name=replay-token]').getAttribute('content');await page.locator('#nav-terminal').click();
 await page.locator(`[data-monitor-id="${first}"]`).getByRole('button',{name:'Review saved setup',exact:true}).click();await page.locator('#terminal-setup-builder').waitFor();
 assert.equal(await page.locator('#terminal-builder-step-review').getAttribute('aria-current'),'step');assert.equal(await page.locator('#terminal-condition-start').textContent(),'Arm automatic entry');
 await page.waitForFunction(value=>document.querySelector('#terminal-condition-recovery').textContent.includes(String(value))&&document.querySelector('#terminal-condition-recovery').textContent.includes('1.0947'),previous);
 assert.match(await page.locator('#terminal-condition-recovery').textContent(),/Previous frozen cancellation.*Proposed draft cancellation/);assert.equal((await post('test/feed')).sent,0);
 await page.locator('#terminal-setup-builder').screenshot({path:path.join(root,'work/saved-setup-review.png')});
 await page.locator('#terminal-condition-start').click();state=(await waitState(s=>s.state.run.id!==first&&s.state.run.phase==='running')).state;const renewed=state.run.id;assert.equal(state.run.applied.index,0);assert.notEqual(state.run.invalidation.level,previous);assert.equal((await post('test/feed')).sent,0);
 await page.locator('#terminal-builder-close').click();await page.locator(`[data-monitor-id="${second}"]`).getByRole('button',{name:'Dismiss saved',exact:true}).click();
 await shutdown();launch();await ready();await page.reload();token=await page.locator('meta[name=replay-token]').getAttribute('content');await page.locator('#nav-terminal').click();
 state=(await waitState(s=>s.state.runs.length===1)).state;assert.equal(state.runs[0].id,renewed);assert.equal(state.runs[0].phase,'saved');assert.equal((await post('test/feed')).sent,0);
 assert.deepEqual(errors,[]);console.log('Persistent monitor browser tests passed: real server restarts, multiple saved setups, no automatic entry or old tokens, cancellation comparison, explicit restart and dismissal; fake broker only');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill();});
