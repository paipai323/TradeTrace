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
$('scan').onclick = () => task(async () => {
  check('terminal', 'checking');
  status('Finding MT5 terminals running under your Windows account…');
  const result = await api('terminals', {});
  $('terminals').replaceChildren();
  $('terminals').append(new Option(result.terminals.length ? 'Choose your running terminal' : 'No running MT5 found', ''));
  for (const path of result.terminals) $('terminals').append(new Option(path, path));
  if (result.terminals.length === 1) $('terminals').value = result.terminals[0];
  check('terminal', result.terminals.length ? 'passed' : 'failed');
  status(result.terminals.length ? 'Choose the terminal you signed into, then click Connect to MT5.' : 'Open MT5 from your Windows shortcut, sign in, then click Find running MT5 again. Run replay using Start.cmd in File Explorer.');
});
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
