function check(stage, state) {
  if (state === 'failed') {
    const ordered = ['terminal', 'connector', 'account', 'history', 'ticks'];
    const stop = ordered.indexOf(stage);
    for (const earlier of ordered.slice(0, Math.max(0, stop))) {
      if ($('check-' + earlier).dataset.state === 'checking') check(earlier, 'passed');
    }
  }
  const item = $('check-' + stage);
  if (!item) return;
  item.dataset.state = state;
  item.textContent = stage[0].toUpperCase() + stage.slice(1) + ' · ' + state;
}
function resetChecks() {
  for (const stage of ['terminal', 'connector', 'account', 'history', 'ticks']) check(stage, 'waiting');
}
$('verify').onclick = () => task(async () => {
  status('Comparing this position with a fresh read of MT5 executions…');
  const result = await api('verify', {id: data.trade.id});
  $('verify-note').textContent = (result.matches ? 'Import matches the fresh MT5 records. ' : 'Values changed: ' + result.differences.join(', ') + '. Reload trade history. ') + result.note;
  if (result.position) {
    $('verify-note').textContent += ` Recorded close: ${result.position.reason}. Net including linked charges: ${fmt(result.position.net)} ${currency}.`;
  }
  const table = document.createElement('table');
  const header = table.createTHead().insertRow();
  for (const label of ['Ticket', 'Time (UTC)', 'Execution', 'Price', 'Lots', 'Profit', 'Commission', 'Swap', 'Fee']) {
    const cell = document.createElement('th'); cell.textContent = label; header.append(cell);
  }
  const body = table.createTBody();
  for (const deal of result.deals) {
    const row = body.insertRow();
    for (const value of [deal.ticket, stamp(deal.time), deal.entry === 0 ? 'Entry' : 'Exit', fmt(deal.price), fmt(deal.volume), fmt(deal.profit), fmt(deal.commission), fmt(deal.swap), fmt(deal.fee)]) row.insertCell().textContent = value;
  }
  $('verify-records').replaceChildren(table);
  status(result.matches ? 'Import consistency check passed. Compare the displayed executions with MT5 History.' : 'Trade records changed. Reload history before continuing.');
});



let directConnected = false;
let keySaved = false;
function keyState(saved) {
  keySaved = saved;
  $('key-state').textContent = saved ? 'API key saved with Windows encryption.' : 'The API key is saved with Windows encryption after a successful connection.';
  $('native-key').placeholder = saved ? 'Saved key will be used · enter a new key to replace it' : 'Paste your MT5 API key once';
  $('forget-key').disabled = !saved || busy;
}
$('forget-key').onclick=()=>task(async()=>{
  const result=await api('forget-key',{});
  directConnected=false;$('native-key').value='';keyState(false);
  $('levels-status').textContent=result.message;status(result.message);
});
let levelsPolling = false;
function applyLevels(result) {
  $('levels-status').textContent = result.message;
  $('levels-status').className = result.state === 'active' ? 'gain' : 'neutral';
  if (data && data.trade.id !== 'SAMPLE') {
    const levels = result.levels.find(item => item.id === data.trade.id);
    if (levels) {
      for (const key of ['sl', 'tp']) {
        if (!(key in levels)) continue;
        data.trade[key] = levels[key];
        data.trade[key + '_source'] = levels[key] ? 'direct MT5 position history' : 'not set at close (direct MT5)';
      }
      render();
    }
  }
}
async function pollLevels() {
  if (!connected || !directConnected || busy || levelsPolling) return;
  const current = generation;
  levelsPolling = true;
  try {
    const result = await api('sync-levels', {});
    if (current !== generation || !connected) return;
    if (result.state === 'setup') directConnected = false;
    applyLevels(result);
  } catch (error) {
    $('levels-status').textContent = error.message;
  } finally { levelsPolling = false; }
}
setInterval(pollLevels, 5000);

function showAccount(account) {
  currency=account.currency;connected=true;
  $('account').textContent=`${account.server} · Account ${account.account} · ${account.currency}`;
  for(const stage of ['terminal','connector','account'])check(stage,'passed');
}
async function connectSession() {
  resetChecks();check('terminal','checking');
  status('Finding MT5, connecting history and loading your trades…');
  connected=false;directConnected=false;data=null;generation++;render();$('trades').replaceChildren();
  let result;
  try {
    result=await api('connect-all',{path:$('path').value||$('terminals').value,url:$('native-url').value.trim(),key:$('native-key').value});
  } catch(error) {
    $('connection-settings').open=true;
    if(error.stage==='terminal') {
      try {
        const found=await api('terminals',{});
        $('terminals').replaceChildren(new Option('Choose the signed-in terminal',''));
        for(const path of found.terminals)$('terminals').append(new Option(path,path));
      } catch(_) { /* Original connection error remains the useful message. */ }
    }
    throw error;
  }
  showAccount(result);
  if ('key_saved' in result.native) keyState(result.native.key_saved);
  directConnected=['active','connected'].includes(result.native.state);
  applyLevels(result.native);
  if(directConnected){$('native-key').value='';$('connection-settings').open=false;}
  else $('connection-settings').open=true;
  await loadHistory();
  if(directConnected) {applyLevels(await api('sync-levels',{}));status('Connected. Choose a trade to replay.');}
  else status('Trades loaded. '+result.native.message);
}
async function restoreSession() {
  await task(async()=>{
    const session=await api('session',{});
    keyState(Boolean(session.key_saved));
    if(session.native_url)$('native-url').value=session.native_url;
    if(session.key_error){$('connection-settings').open=true;status(session.key_error);}
    if(!session.connected)return;
    showAccount(session);directConnected=session.direct;
    await loadHistory();
    if(directConnected)applyLevels(await api('sync-levels',{}));
    status(directConnected?'Connection restored. Choose a trade to replay.':'Trades loaded. Add your API key in Connection settings for complete SL/TP.');
  });
}
restoreSession();
