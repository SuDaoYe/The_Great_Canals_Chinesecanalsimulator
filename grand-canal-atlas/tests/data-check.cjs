const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
assert.ok(fs.existsSync(path.join(root, 'data/atlas.json')), '资料库应包含可核查的工程数据');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/atlas.json'), 'utf8'));
const ids = new Set(data.sources.map(s => s.id));
const eras = new Map(data.eras.map(e=>[e.id,e]));
assert.equal(ids.size, data.sources.length, '来源标识不能重复');
assert.equal(new Set(data.canals.map(c => c.id)).size, data.canals.length);
for (const canal of data.canals) {
  assert.ok(canal.coords.length >= 2, canal.id + ' 必须有真实经纬度');
  for (const [lon, lat] of canal.coords) assert.ok(lon >= 73 && lon <= 135 && lat >= 18 && lat <= 54, canal.id);
  assert.ok(canal.start <= canal.end, canal.id);
  const era=eras.get(canal.era);
  assert.ok(era && canal.start>=era.start && canal.start<=era.end, canal.id+' 营建年代必须属于所标历史阶段');
  assert.ok(canal.sources.length > 0, canal.id + ' 不能缺少来源');
  for (const id of canal.sources) assert.ok(ids.has(id), id + ' 来源未登记');
  for (const metric of canal.metrics) {
    assert.ok(ids.has(metric.source), canal.id + ' 指标必须有来源');
    assert.ok(metric.scope && metric.caveat, canal.id + ' 指标必须说明口径与限制');
    assert.notEqual(metric.unit, '人民币', '古代工程不得伪造现代成本');
  }
}
const tonghui = data.canals.find(c => c.id === 'tonghui');
assert.ok(tonghui.metrics.some(m => m.value === 2850000 && m.unit === '工'), '通惠河须区分285万工与人数');
assert.ok(!tonghui.metrics.some(m => m.unit === '人' && m.value > 1000000), '不能把累计工数当作民工人数');
const q = data.canals.find(c => c.id === 'huitong');
assert.ok(q.metrics.some(m => m.value === 2510748 && m.unit === '工'));
assert.ok(data.eras.some(e => e.id === 'south-song'), '应区分北宋与南宋水系');
console.log(`PASS: ${data.canals.length} 工程、${data.sources.length} 来源、${data.canals.reduce((n,c)=>n+c.metrics.length,0)} 指标；引用与坐标完整，人数/工数未混用。`);
