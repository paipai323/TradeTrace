const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
const scope = {};
vm.runInNewContext(source.slice(source.indexOf('function buildReplayCandles(')), scope);
const build = (points, through, period=60000) => JSON.parse(JSON.stringify(scope.buildReplayCandles(points, through, period)));
const ticks = [[1000, 1.1, 1.1001], [30000, 1.2, 1.2001], [59000, 1.05, 1.0501], [61000, 1.15, 1.1501]];
assert.deepEqual(build(ticks, -1), []);
assert.deepEqual(build(ticks, 0), [[0, 1.1, 1.1, 1.1, 1.1]]);
assert.deepEqual(build(ticks, 1), [[0, 1.1, 1.2, 1.1, 1.2]]);
assert.deepEqual(build(ticks, 2), [[0, 1.1, 1.2, 1.05, 1.05]]);
assert.deepEqual(build(ticks, 3), [[0, 1.1, 1.2, 1.05, 1.05], [60000, 1.15, 1.15, 1.15, 1.15]]);
assert.deepEqual(build(ticks, 3, 300000), [[0, 1.1, 1.2, 1.05, 1.15]]);
// Rewinding rebuilds only the revealed portion; a later low must disappear.
assert.equal(build(ticks, 1)[0][3], 1.1);
console.log('Replay candle aggregation checks passed');
