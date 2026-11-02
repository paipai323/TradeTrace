const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process'),playwright=require('playwright');
const root=path.resolve(__dirname,'..'),port=18888,url=`http://127.0.0.1:${port}`;
const server=spawn(process.env.TRADETRACE_TEST_PYTHON||path.join(root,'.venv/Scripts/python.exe'),['tests/monitor_browser_server.py','--port',String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
(async()=>{
 await new Promise((resolve,reject)=>{server.stdout.on('data',s=>{if(s.toString().includes('http://'))resolve();});server.stderr.on('data',s=>process.stderr.write(s));server.on('error',reject);setTimeout(()=>reject(Error('Server startup timeout')),15000).unref();});
 const executablePath=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 browser=await playwright.chromium.launch({headless:true,executablePath,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1536,height:1100}}),errors=[];
 let page=await context.newPage(),manualPreviewRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/terminal/preview')manualPreviewRequests++;});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#nav-terminal').click();
 await page.waitForFunction(()=>document.querySelector('#terminal-chart-title').textContent.includes('EURUSD'));
 const token=await page.locator('meta[name=replay-token]').getAttribute('content');
 const post=async(route,body={})=>{const response=await context.request.post(url+'/api/'+route,{headers:{'X-Replay-Token':token},data:body});assert.equal(response.status(),200,await response.text());return response.json();};
 const waitState=async(predicate)=>{const until=Date.now()+12000;while(Date.now()<until){const value=await post('test/feed');if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Monitor state timeout: '+JSON.stringify(await post('test/feed')));};


 await page.locator('#terminal-builder-open').click();for(let i=0;i<12;i++)await page.locator('#terminal-condition-add').click();await page.locator('#terminal-builder-close').click();
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const samples=[];for(let i=0;i<4;i++)samples.push(await page.evaluate(async()=>{const t=performance.now();document.getElementById('terminal-builder-open').click();const script=performance.now()-t;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const paint=performance.now()-t;document.getElementById('terminal-builder-close').click();await new Promise(resolve=>requestAnimationFrame(resolve));return {script,paint};}));
 await page.locator('#terminal-builder-open').click();const stable=await page.evaluate(async()=>{const node=document.getElementById('terminal-builder-facts');let changes=0;const observer=new MutationObserver(records=>changes+=records.length);observer.observe(node,{childList:true,subtree:true,characterData:true});await new Promise(resolve=>setTimeout(resolve,2500));observer.disconnect();return changes;});assert.equal(stable,0,'unchanged quote/status polls must not rebuild the summary');
 console.log(JSON.stringify({samples,unchangedSummaryMutations:stable}));assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill();});
