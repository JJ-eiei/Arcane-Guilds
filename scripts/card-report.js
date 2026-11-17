// Validates game data and writes docs/cards.md (review tables).
// Usage: node scripts/card-report.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { ELEMENTS, ELEMENT_INFO, TEMPLATES, CARDS, GUARDIANS, DRAGONS, PROPHECIES, CONFIG } = require('../server/games/arcane/data');

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const icon = (e) => ELEMENT_INFO[e].icon;
const costStr = (c) => ELEMENTS.filter((e) => c[e]).map((e) => `${icon(e)}${c[e]}`).join(' ');

// ---------- validation ----------
assert.equal(CARDS.length, 90);
for (const [lv, n] of [[1, 40], [2, 30], [3, 20]]) assert.equal(CARDS.filter((c) => c.level === lv).length, n, `level ${lv}`);
assert.equal(new Set(CARDS.map((c) => c.id)).size, 90, 'unique ids');
assert.equal(new Set(CARDS.map((c) => c.name)).size, 90, 'unique names');
for (const c of CARDS) {
  assert.ok(c.name, `name for ${c.id}`);
  for (const [e, n] of Object.entries(c.cost)) {
    assert.ok(ELEMENTS.includes(e) && n > 0, `${c.id} cost`);
    assert.ok(n <= CONFIG.tokensPerElement[4] , `${c.id}: needs ${n} ${e} but only 7 exist`);
  }
}
assert.equal(GUARDIANS.length, 10);
assert.equal(DRAGONS.length, 5);
assert.equal(new Set(PROPHECIES.map((p) => p.id)).size, PROPHECIES.length);

// per-element symmetry
const stats = {};
for (const e of ELEMENTS) stats[e] = { cards: 0, points: 0, demand: 0 };
for (const c of CARDS) {
  stats[c.bonus].cards++; stats[c.bonus].points += c.points;
  for (const [e, n] of Object.entries(c.cost)) stats[e].demand += n;
}
const s0 = JSON.stringify(stats.fire);
for (const e of ELEMENTS) {
  assert.equal(stats[e].cards, stats.fire.cards);
  assert.equal(stats[e].points, stats.fire.points);
  assert.equal(stats[e].demand, stats.fire.demand);
}
const guardDemand = Object.fromEntries(ELEMENTS.map((e) => [e, GUARDIANS.reduce((a, g) => a + (g.req[e] || 0), 0)]));
const dragonDemand = Object.fromEntries(ELEMENTS.map((e) => [e, DRAGONS.reduce((a, g) => a + (g.req[e] || 0), 0)]));
assert.equal(new Set(Object.values(guardDemand)).size, 1, 'guardians symmetric');
assert.equal(new Set(Object.values(dragonDemand)).size, 1, 'dragons symmetric');

// ---------- level summary ----------
const levelRows = [1, 2, 3].map((lv) => {
  const cs = CARDS.filter((c) => c.level === lv);
  const costs = cs.map((c) => sum(c.cost));
  const pts = cs.map((c) => c.points);
  const dist = {};
  for (const p of pts) dist[p] = (dist[p] || 0) + 1;
  return `| Lv${lv} | ${cs.length} | ${Math.min(...costs)}–${Math.max(...costs)} (เฉลี่ย ${(costs.reduce((a, b) => a + b) / cs.length).toFixed(1)}) | ${Object.entries(dist).map(([p, n]) => `${p} แต้ม × ${n}`).join(', ')} |`;
});

// ---------- markdown ----------
let md = `# Arcane Guilds — ข้อมูลการ์ด (ร่างที่ 1)

> สร้างจาก \`server/games/arcane/data.js\` ด้วย \`node scripts/card-report.js\` — อย่าแก้ไฟล์นี้ด้วยมือ

## ภาพรวม
| เลเวล | จำนวน | ราคารวม (ผลึก) | เกียรติยศ |
|---|---|---|---|
${levelRows.join('\n')}

**สมดุลระหว่างธาตุ:** ทุกธาตุมีการ์ด ${stats.fire.cards} ใบ, เกียรติยศรวม ${stats.fire.points}, และถูกใช้เป็นราคารวม ${stats.fire.demand} เม็ดเท่ากันทุกธาตุ (ใช้แม่แบบเดียวกันหมุนไปทั้ง 5 ธาตุ)

## แม่แบบราคา (ใช้กับทุกธาตุ)
ตำแหน่งธาตุนับจากธาตุของการ์ดเอง ตามวงล้อ 🔥 → 💧 → ⛰️ → 🌪️ → ✨ → 🔥
ตัวอย่าง: การ์ด 🔥 แม่แบบ "+1×2, +4×2" ราคา 💧2 ✨2 (ตัวเองคือ +0)

| เลเวล | แม่แบบ | ราคารวม | เกียรติยศ |
|---|---|---|---|
${[1, 2, 3].flatMap((lv) => TEMPLATES[lv].map(([rel, p], i) => `| Lv${lv}-${i + 1} | ${Object.entries(rel).map(([o, n]) => `+${o}×${n}`).join(', ')} | ${sum(rel)} | ${p || '–'} |`)).join('\n')}

`;

for (const lv of [1, 2, 3]) {
  md += `\n## เลเวล ${lv}\n| รหัส | ชื่อ | ธาตุ | ราคา | รวม | เกียรติยศ |\n|---|---|---|---|---|---|\n`;
  for (const c of CARDS.filter((x) => x.level === lv)) {
    md += `| ${c.id} | ${c.name} | ${icon(c.bonus)} | ${costStr(c.cost)} | ${sum(c.cost)} | ${c.points || '–'} |\n`;
  }
}

md += `\n## ภูตพิทักษ์ (ตนละ 3 เกียรติยศ)\n| รหัส | ชื่อ | เงื่อนไขโบนัส |\n|---|---|---|\n`;
for (const g of GUARDIANS) md += `| ${g.id} | ${g.name} | ${costStr(g.req)} |\n`;

md += `\n## มังกร (สุ่ม 1 ตัวต่อเกม · ${CONFIG.dragonPoints} เกียรติยศ · แย่งได้)\n| รหัส | ชื่อ | เงื่อนไขโบนัส |\n|---|---|---|\n`;
for (const d of DRAGONS) md += `| ${d.id} | ${d.name} | ${costStr(d.req)} |\n`;

md += `\n## คำทำนาย (จั่ว 2 เก็บ 1 · ลับ)\n| รหัส | ชื่อ | เงื่อนไข | เกียรติยศ |\n|---|---|---|---|\n`;
for (const p of PROPHECIES) md += `| ${p.id} | ${p.name} | ${p.text} | +${p.points} |\n`;

md += `\n## ค่าตั้งต้น ⚙️\n\`\`\`json\n${JSON.stringify(CONFIG, null, 2)}\n\`\`\`\n`;

const out = path.join(__dirname, '..', 'docs', 'cards.md');
fs.writeFileSync(out, md);
console.log('OK —', CARDS.length, 'cards,', GUARDIANS.length, 'guardians,', DRAGONS.length, 'dragons,', PROPHECIES.length, 'prophecies');
console.log('per element:', s0, '| guardian demand/element:', guardDemand.fire, '| dragon demand/element:', dragonDemand.fire);
console.log(levelRows.join('\n'));
console.log('wrote', out);
