// Arcane Guilds — game data (original design).
//
// Cards are generated from cost "templates" written relative to the card's
// own element (offset 0 = own element, +1..+4 = the next elements in the
// cycle fire → water → earth → wind → light). Every template is applied to all
// five elements, so the set is perfectly symmetric: no element is stronger
// than another by construction. Tune balance by editing the templates.

const ELEMENTS = ['fire', 'water', 'earth', 'wind', 'light'];
const STAR = 'star'; // joker

const ELEMENT_INFO = {
  fire:  { th: 'ไฟ',  icon: '🔥', color: '#e4572e' },
  water: { th: 'น้ำ', icon: '💧', color: '#2e86de' },
  earth: { th: 'ดิน', icon: '⛰️', color: '#8a6a3b' },
  wind:  { th: 'ลม',  icon: '🌪️', color: '#3bb273' },
  light: { th: 'แสง', icon: '✨', color: '#e9c46a' },
  star:  { th: 'ดวงดาว', icon: '⭐', color: '#9b5de5' },
};

// [costByOffset, points]   costByOffset: { offset: amount }
const TEMPLATES = {
  1: [
    [{ 1: 1, 2: 1, 3: 1 }, 0],          // 3
    [{ 1: 1, 2: 1, 3: 1, 4: 1 }, 0],    // 4
    [{ 2: 2, 3: 1 }, 0],                // 3
    [{ 4: 3 }, 0],                      // 3
    [{ 1: 2, 4: 2 }, 0],                // 4
    [{ 0: 1, 2: 1, 3: 2 }, 0],          // 4
    [{ 1: 1, 2: 2, 4: 2 }, 0],          // 5
    [{ 3: 4 }, 1],                      // 4
  ],
  2: [
    [{ 1: 2, 2: 2, 4: 2 }, 1],          // 6
    [{ 0: 2, 3: 2, 4: 3 }, 1],          // 7
    [{ 1: 4, 2: 2 }, 2],                // 6
    [{ 4: 5 }, 2],                      // 5
    [{ 2: 3, 3: 4 }, 2],                // 7
    [{ 1: 6 }, 3],                      // 6
  ],
  3: [
    [{ 1: 3, 2: 3, 3: 3, 4: 4 }, 3],    // 13
    [{ 2: 7 }, 4],                      // 7
    [{ 0: 3, 1: 3, 2: 6 }, 4],          // 12
    [{ 0: 3, 2: 7 }, 5],                // 10
  ],
};

// Names, in template order, per element and level.
const NAMES = {
  fire: {
    1: ['ประกายไฟ', 'ลูกไฟจิ๋ว', 'คบเพลิงนำทาง', 'เปลวเทียนเวท', 'ถ่านอุ่นมือ', 'ม่านควัน', 'จุดไฟพิธี', 'หมัดเพลิง'],
    2: ['ซาลาแมนเดอร์', 'ไม้เท้าเพลิง', 'ฟีนิกซ์น้อย', 'ดาบลาวา', 'หมาป่าถ่านแดง', 'เตาหลอมวิญญาณ'],
    3: ['หอคอยสุริยัน', 'ภูเขาไฟนิรันดร์', 'ห้องสมุดเพลิงกาฬ', 'บัลลังก์ฟีนิกซ์'],
  },
  water: {
    1: ['หยดน้ำค้าง', 'ฟองเวท', 'ม่านหมอก', 'น้ำพุจิ๋ว', 'คลื่นซัด', 'กระจกน้ำ', 'สายฝนรักษา', 'แส้น้ำ'],
    2: ['ภูตปลาคาร์ฟ', 'ตรีศูลคลื่น', 'เต่าวารี', 'โล่น้ำแข็ง', 'งูทะเลคราม', 'คนโทชีวา'],
    3: ['หอคอยวังวน', 'นครใต้สมุทร', 'ธารน้ำแข็งพันปี', 'ศาลเจ้าเงือก'],
  },
  earth: {
    1: ['หินเวท', 'รากไม้พัน', 'โล่ดิน', 'เมล็ดเร่งโต', 'ทรายดูด', 'ผลึกถ้ำ', 'กำแพงโคลน', 'เสาหินตั้ง'],
    2: ['โกเลมหิน', 'ค้อนแผ่นดินไหว', 'หมีผา', 'ต้นไม้พูดได้', 'ตุ่นขุดแร่', 'ขวานภูผา'],
    3: ['หอคอยรากยักษ์', 'เหมืองผลึกลึก', 'ป้อมบรรพต', 'ต้นไม้โลก'],
  },
  wind: {
    1: ['สายลมกระซิบ', 'ใบไม้บิน', 'ขนนกเวท', 'ลมหมุนจิ๋ว', 'กระดิ่งลม', 'ฝีเท้าลม', 'ว่าวผู้ส่งสาร', 'ลมหายใจเย็น'],
    2: ['เหยี่ยวพายุ', 'ธนูลมกรด', 'กริฟฟินหนุ่ม', 'ผ้าคลุมเหาะ', 'ภูตเมฆ', 'ใบมีดพายุ'],
    3: ['หอคอยฟ้าผ่า', 'เกาะลอยฟ้า', 'วิหารพายุ', 'ดวงตาพายุ'],
  },
  light: {
    1: ['แสงหิ่งห้อย', 'เทียนนำทาง', 'ระฆังแสง', 'กระจกสะท้อน', 'แสงรุ่ง', 'ลูกแก้วส่องทาง', 'รัศมีรักษา', 'ม่านออโรรา'],
    2: ['ยูนิคอร์น', 'คทาอรุณ', 'นกฮูกขาว', 'โล่ศักดิ์สิทธิ์', 'กวางเงิน', 'โคมนิรันดร์'],
    3: ['หอคอยรุ่งอรุณ', 'มหาวิหารแก้ว', 'สวนแห่งแสง', 'ประตูสวรรค์'],
  },
};

const rot = (e, offset) => ELEMENTS[(ELEMENTS.indexOf(e) + offset) % ELEMENTS.length];

function buildCards() {
  const cards = [];
  for (const level of [1, 2, 3]) {
    for (const el of ELEMENTS) {
      TEMPLATES[level].forEach(([rel, points], i) => {
        const cost = {};
        for (const [off, n] of Object.entries(rel)) cost[rot(el, Number(off))] = n;
        cards.push({
          id: `${el.slice(0, 2)}${level}${i + 1}`,   // e.g. fi13 = fire, level 1, template 3 (wa=water, wi=wind)
          level, bonus: el, points, cost,
          name: NAMES[el][level][i],
        });
      });
    }
  }
  return cards;
}

// Guardian spirits ("nobles"): 3 prestige each.
//  - 5 x "triad"   : 3/3/3 in elements (i, i+1, i+3)
//  - 5 x "quartet" : 2/2/2/2 in every element except i
const GUARDIAN_NAMES = {
  triad:   ['นาคาผู้เฝ้าธาร', 'จิ้งจอกเก้าหาง', 'ภูตพฤกษาชรา', 'อินทรีทองคำ', 'กิเลนแสง'],
  quartet: ['เทวีแห่งฤดูกาล', 'ผู้เฒ่าแห่งขุนเขา', 'วิญญาณสายรุ้ง', 'ผู้พิทักษ์ประตูมิติ', 'ราชินีหิ่งห้อย'],
};
function buildGuardians() {
  const out = [];
  ELEMENTS.forEach((el, i) => {
    out.push({ id: `g3${i + 1}`, name: GUARDIAN_NAMES.triad[i], points: 3,
      req: { [el]: 3, [rot(el, 1)]: 3, [rot(el, 3)]: 3 } });
  });
  ELEMENTS.forEach((el, i) => {
    const req = {};
    for (const e of ELEMENTS) if (e !== el) req[e] = 2;
    out.push({ id: `g2${i + 1}`, name: GUARDIAN_NAMES.quartet[i], points: 3, req });
  });
  return out;
}

// Dragons: one per game, 3/3 in two elements (i, i+2), 4 prestige, can be stolen
// (equal strength also steals). The amount comes from CONFIG.dragonReq.
const DRAGON_NAMES = ['มังกรเพลิงผา', 'มังกรวายุวารี', 'มังกรศิลาแสง', 'มังกรพายุเพลิง', 'มังกรจันทราวารี'];
function buildDragons() {
  return ELEMENTS.map((el, i) => ({
    id: `d${i + 1}`, name: DRAGON_NAMES[i], points: 4,
    req: { [el]: 3, [rot(el, 2)]: 3 },
  }));
}

// Prophecies (secret objectives). `check(p, ctx)` gets the player's final
// state; scored at game end only.
function buildProphecies() {
  const byElement = ELEMENTS.map((el) => ({
    id: `p-${el}`, name: `บุตรแห่ง${ELEMENT_INFO[el].th}`, points: 3,
    text: `จบเกมโดยมีโบนัส${ELEMENT_INFO[el].th} ${ELEMENT_INFO[el].icon} ≥ 4`,
    kind: 'elementBonus', element: el, min: 4,
  }));
  return [
    ...byElement,
    { id: 'p-balance', name: 'ผู้สมดุล', points: 2, text: 'จบเกมโดยมีโบนัสทุกธาตุ ≥ 2', kind: 'allBonus', min: 2 },
    { id: 'p-spirits', name: 'ผู้สื่อวิญญาณ', points: 3, text: 'มีภูตพิทักษ์ ≥ 2 ตน', kind: 'guardians', min: 2 },
    { id: 'p-dragon', name: 'นายมังกร', points: 2, text: 'ครองมังกรอยู่ตอนจบเกม', kind: 'dragon' },
    { id: 'p-sealer', name: 'ผู้วางผนึก', points: 3, text: 'เก็บค่าสาปจากผนึกได้ ≥ 3 ครั้ง', kind: 'curses', min: 3 },
    { id: 'p-trainee', name: 'ผู้ฝึกตน', points: 2, text: 'มีการ์ด Lv1 ≥ 12 ใบ', kind: 'levelCount', level: 1, min: 12 },
    { id: 'p-legend', name: 'ผู้สร้างตำนาน', points: 2, text: 'มีการ์ด Lv3 ≥ 1 ใบ', kind: 'levelCount', level: 3, min: 1 },
  ];
}

// Tunable rule numbers (⚙️ in the design doc).
const CONFIG = {
  winPoints: 15,
  tokenLimit: 10,
  reserveLimit: 3,
  takeTwoMin: 4,
  starTokens: 5,
  tokensPerElement: { 2: 4, 3: 5, 4: 7 },
  // seal action: place 1 own element crystal on a market card AND take up to
  // `takeWith` different crystals; owner buying it uses the seal as `ownerWildCount` wilds
  seal: { maxPerPlayer: 2, curse: 1, ownerWild: true, ownerWildCount: 2, takeWith: 2 },
  dragonPoints: 4,
  dragonReq: 3,          // bonuses needed in each of the dragon's 2 elements
  dragonStealOnTie: true, // equal strength also steals (on your own turn)
  prophecy: {},          // per-prophecy overrides, e.g. { 'p-fire': { min: 4, points: 3 } }
  lastSeatBonusToken: false,
  startTokens: null,      // explicit override, e.g. [0, 1, 1, 2] = crystals per turn-order position
  // turn-order compensation by player count (from balance simulation)
  startTokensByPlayers: { 2: [0, 0], 3: [0, 1, 1], 4: [0, 1, 1, 1] },
};

module.exports = {
  ELEMENTS, STAR, ELEMENT_INFO, TEMPLATES, CONFIG,
  CARDS: buildCards(),
  GUARDIANS: buildGuardians(),
  DRAGONS: buildDragons(),
  PROPHECIES: buildProphecies(),
};
