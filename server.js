/* 扑克风云会 沙盘电子版 —— 纯 Node 后端（无第三方依赖）
 * 一台电脑启动，局域网内各小组用浏览器访问。
 * 数据持久化到 data.json。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');

/* ---------- 命令行参数（转发 host/port） ---------- */
function argVal(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find(a => a.startsWith('--' + name + '='));
  if (eq) return eq.split('=')[1];
  return def;
}
const PORT = parseInt(process.env.PORT || argVal('port', '7100'), 10);
const HOST = process.env.HOST || argVal('host', '0.0.0.0');

/* ---------- 账目类型定义 ---------- */
const TYPES = {
  sale:            { name: '销售收入',     sign: 1,  team: true,  cat: 'in'  },
  other_in:        { name: '其他收入',     sign: 1,  team: true,  cat: 'in'  },
  lend_back:       { name: '借款返还',     sign: 1,  team: true,  cat: 'in'  },
  loan_in:         { name: '贷款取得',     sign: 1,  team: true,  cat: 'loan'},
  liquidate_cards: { name: '卡牌折算',     sign: 1,  team: false, cat: 'in'  },
  buy_basic:       { name: '采购初级材料', sign: -1, team: true,  cat: 'out' },
  buy_adv:         { name: '采购高级材料', sign: -1, team: true,  cat: 'out' },
  skill:           { name: '技能成本',     sign: -1, team: false, cat: 'out' },
  service_out:     { name: '服务费支出',   sign: -1, team: true,  cat: 'out' },
  lend_out:        { name: '放贷支出',     sign: -1, team: true,  cat: 'out' },
  repay:           { name: '还贷',         sign: -1, team: true,  cat: 'out' },
  labor:           { name: '人力成本',     sign: -1, team: false, cat: 'cost'},
  warehouse:       { name: '仓储成本',     sign: -1, team: false, cat: 'cost'},
  tax:             { name: '税费',         sign: -1, team: false, cat: 'cost'},
  interest:        { name: '利息',         sign: -1, team: false, cat: 'cost'},
  penalty:         { name: '罚款',         sign: -1, team: false, cat: 'cost'},
  adjust:          { name: '账目调整',     sign: 0,  team: false, cat: 'adj' },
  refine:          { name: '深度加工',     sign: -1, team: true,  cat: 'out' }
};

/* 规则参数默认值见 defaultConfig()（管理端可配置） */

/* ---------- 六项技能（规则见课件第30页） ---------- */
const SKILLS = {
  '深度加工': { desc: '任意1张牌+10金币，可从任意市场抽1张牌', desc2: '升级后：仅需+5金币', refineCost: [10, 5] },
  '市场调研': { desc: '每轮可多看需求卡/规律提示（信息类，不影响账目）', desc2: '升级后：每轮可看更多信息' },
  '品牌溢价': { desc: '销售时额外获得10%金币', desc2: '升级后：额外获得20%金币', saleBonus: [0.10, 0.20] },
  '自建仓库': { desc: '仓储费每张3金币/轮', desc2: '升级后：每张2金币/轮', warehousePer: [3, 2] },
  '批量折扣': { desc: '单一市场一次购买≥10张享8折', desc2: '升级后：≥5张8折，≥10张7折' },
  '独特卖点': { desc: '销售时（隐藏牌除外）可用JQK代替任意一张牌，每次最多1张', desc2: '升级后：每次最多2张' }
};
const SKILL_ALIAS = { '自有仓库': '自建仓库', '精加工': '深度加工' };
function canonSkill(name) {
  name = String(name || '').trim();
  return SKILLS[name] ? name : (SKILL_ALIAS[name] && SKILLS[SKILL_ALIAS[name]] ? SKILL_ALIAS[name] : null);
}
function teamSkill(team, name) {
  return (team.skills || []).find(s => s.name === name) || null;
}
function skillLevel(team, name) { const s = teamSkill(team, name); return s ? s.level : 0; }

/* ---------- 状态 ---------- */
function defaultConfig() {
  // 规则参数（管理端可改；默认按《规则说明书2.0》口径）
  return {
    baseCash: 500,        // 初始资金
    baseCards: 32,        // 起手卡牌数
    priceBasic: 10,       // 初级材料单价
    priceAdv: 30,         // 高级材料单价
    cardValue: 10,        // 清算时每张卡牌折算金币
    laborPer: 5,          // 人力成本 金币/人/轮
    warehousePer: 5,      // 仓储成本 金币/张/轮
    taxRate: 10,          // 税费 = 本轮收入的 %
    interestRate: 5,      // 利息 = 贷款余额的 %/轮
    loanMax: 500          // 贷款上限
  };
}
function defaultState() {
  return {
    created: false,
    adminCode: process.env.ADMIN_CODE || '8888',   // 线上部署务必用环境变量 ADMIN_CODE 改默认口令
    round: 1,               // 1-4 经营轮次
    phase: 'setup',         // setup | running | settled | finished
    showRanking: false,     // 是否公布排名
    timerEnd: null,         // 本轮计时截止时间戳
    timerMinutes: 30,
    config: defaultConfig(),
    teams: []               // {id,name,code,members,skills,entries:[]}
  };
}
const cfg = () => Object.assign(defaultConfig(), state.config || {});
let state = defaultState();
let idSeq = 1;

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const s = JSON.parse(raw);
    if (s && typeof s === 'object') { state = Object.assign(defaultState(), s); }
    idSeq = state.idSeq || 1000;
    // 旧数据迁移：skill/skill2 字符串 -> skills 数组
    for (const t of state.teams) {
      if (!Array.isArray(t.skills)) {
        t.skills = [];
        for (const nm of [t.skill, t.skill2]) {
          const c = canonSkill(nm);
          if (c) t.skills.push({ name: c, level: 1 });
        }
      }
      delete t.skill; delete t.skill2;
    }
  } catch (e) { /* 首次运行 */ }
}
function save() {
  state.idSeq = idSeq;
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
}
load();

/* ---------- 计算 ---------- */
function compute(team) {
  const cf = cfg();
  let cash = cf.baseCash, cards = cf.baseCards, loan = 0;
  for (const e of team.entries) {
    cash += e.amount || 0;
    cards += e.cards || 0;
    loan += e.loan || 0;
  }
  return { cash, cards, loan };
}
function roundIncome(team, round) {
  let s = 0;
  for (const e of team.entries) {
    if (e.round === round && e.amount > 0 && ['sale', 'other_in', 'lend_back'].includes(e.type)) s += e.amount;
  }
  return s;
}
function netWorth(team) {
  const c = compute(team);
  if (state.phase === 'finished') return c.cash; // 清算后现金即净利
  return c.cash + c.cards * cfg().cardValue - c.loan; // 实时身家预估
}
function teamView(team, withCode) {
  const c = compute(team);
  return {
    id: team.id, name: team.name, members: team.members,
    skills: (team.skills || []).map(s => ({
      name: s.name, level: s.level,
      desc: s.level >= 2 ? SKILLS[s.name].desc2 : SKILLS[s.name].desc
    })),
    cash: c.cash, cards: c.cards, loan: c.loan,
    net: netWorth(team),
    entries: team.entries,
    code: withCode ? team.code : undefined
  };
}

/* ---------- 结算动作 ---------- */
function settleRound() {
  const r = state.round;
  const cf = cfg();
  for (const t of state.teams) {
    const c = compute(t);
    const push = (type, amount, note) => {
      if (amount <= 0) return;
      t.entries.push({ id: idSeq++, round: r, type, label: TYPES[type].name, amount: -amount, cards: 0, loan: 0, note: note || '', ts: Date.now() });
    };
    push('labor', t.members * cf.laborPer, `${t.members}人 × ${cf.laborPer}`);
    // 自建仓库技能：仓储费率 3（初级）/ 2（升级）金币每张
    const whLv = skillLevel(t, '自建仓库');
    const whPer = whLv ? SKILLS['自建仓库'].warehousePer[whLv - 1] : cf.warehousePer;
    push('warehouse', Math.max(0, c.cards) * whPer, `${c.cards}张 × ${whPer}${whLv ? '（自建仓库）' : ''}`);
    const inc = roundIncome(t, r);
    push('tax', Math.round(inc * cf.taxRate / 100), `本轮收入${inc} × ${cf.taxRate}%`);
    if (c.loan > 0) push('interest', Math.round(c.loan * cf.interestRate / 100), `贷款余额${c.loan} × ${cf.interestRate}%`);
  }
  state.phase = 'settled';
  state.timerEnd = null;
}
function nextRound() {
  if (state.round < 4) { state.round += 1; state.phase = 'running'; }
}
function finalize() {
  for (const t of state.teams) {
    const c = compute(t);
    if (c.cards > 0) {
      const cv = cfg().cardValue;
      t.entries.push({ id: idSeq++, round: state.round, type: 'liquidate_cards', label: '卡牌折算', amount: c.cards * cv, cards: -c.cards, loan: 0, note: `${c.cards}张 × ${cv}`, ts: Date.now() });
    }
    const c2 = compute(t);
    if (c2.loan > 0) {
      t.entries.push({ id: idSeq++, round: state.round, type: 'repay', label: '清算还贷', amount: -c2.loan, cards: 0, loan: -c2.loan, note: '清算时偿还全部贷款', ts: Date.now() });
    }
  }
  state.phase = 'finished';
  state.showRanking = true;
  state.timerEnd = null;
}

/* ---------- HTTP 工具 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
function getTeam(id) { return state.teams.find(t => t.id === id); }
function checkAdmin(p) { return p && p.adminCode === state.adminCode; }
function checkTeam(p) { const t = getTeam(p.teamId); return t && t.code === p.code ? t : null; }

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (p.startsWith('/api/')) {
    const body = req.method === 'POST' ? await readBody(req) : {};
    try {
      /* 全局状态（登录页也要拿队伍列表） */
      if (p === '/api/state') {
        return send(res, 200, {
          created: state.created, round: state.round, phase: state.phase,
          showRanking: state.showRanking, timerEnd: state.timerEnd, timerMinutes: state.timerMinutes,
          now: Date.now(), config: cfg(),
          teams: state.teams.map(t => teamView(t, false))
        });
      }
      /* 登录 */
      if (p === '/api/login') {
        if (body.role === 'admin') {
          // 未创建对局时也允许进入管理端（管理端首页即创建对局）
          if (body.code !== state.adminCode) return send(res, 403, { error: '管理口令错误' });
          return send(res, 200, { ok: true });
        }
        const t = getTeam(body.teamId);
        if (!t || t.code !== body.code) return send(res, 403, { error: '小队口令错误' });
        return send(res, 200, { ok: true, team: teamView(t, false) });
      }
      /* 创建对局（无需口令，仅允许在未创建或带正确管理口令时） */
      if (p === '/api/setup') {
        if (state.created && !checkAdmin(body)) return send(res, 403, { error: '需要管理口令才能重开对局' });
        const names = (body.names || []).map(s => String(s).trim()).filter(Boolean).slice(0, 10);
        if (names.length < 2) return send(res, 400, { error: '至少需要 2 支队伍' });
        const keepConfig = cfg();
        const keepAdmin = state.adminCode;
        state = defaultState();
        state.config = keepConfig;       // 重开对局保留规则参数
        state.created = true;
        state.adminCode = String(body.adminCode || keepAdmin || '8888').trim() || '8888';
        state.phase = 'running';
        state.teams = names.map((n, i) => ({
          id: idSeq++, name: n, code: String(1000 + Math.floor(Math.random() * 9000)),
          members: Math.max(1, parseInt((body.members || [])[i], 10) || 6),
          skills: [], entries: []
        }));
        save();
        return send(res, 200, { ok: true, adminCode: state.adminCode, teams: state.teams.map(t => ({ id: t.id, name: t.name, code: t.code })) });
      }
      /* 小组记账 */
      if (p === '/api/entry') {
        const t = checkTeam(body);
        if (!t) return send(res, 403, { error: '未登录或口令错误' });
        if (!state.created || state.phase === 'finished') return send(res, 400, { error: '对局已结束，无法记账' });
        const e = buildTeamEntry(t, body);
        if (e.error) return send(res, 400, { error: e.error });
        t.entries.push(e.entry);
        save();
        return send(res, 200, { ok: true, team: teamView(t, false) });
      }
      /* ---- 以下为管理端 ---- */
      if (p === '/api/admin/entry') {
        if (!checkAdmin(body)) return send(res, 403, { error: '管理口令错误' });
        const t = getTeam(body.teamId);
        if (!t) return send(res, 404, { error: '小队不存在' });
        if (body.type === 'skill') {
          const sk = canonSkill(body.skillName);
          if (!sk) return send(res, 400, { error: '未知技能名称' });
          if (!Array.isArray(t.skills)) t.skills = [];
          const owned = t.skills.find(s => s.name === sk);
          if (body.skillAction === 'upgrade') {
            if (!owned) return send(res, 400, { error: `该组尚未持有「${sk}」，无法升级` });
            if (owned.level >= 2) return send(res, 400, { error: `「${sk}」已是升级版` });
          } else {
            if (owned) return send(res, 400, { error: `该组已持有「${sk}」` });
            if (t.skills.length >= 2) return send(res, 400, { error: '每组最多持有 2 项技能' });
          }
        }
        const e = buildAdminEntry(t, body);
        if (e.error) return send(res, 400, { error: e.error });
        t.entries.push(e.entry);
        if (body.type === 'skill') {
          const sk = canonSkill(body.skillName);
          const owned = t.skills.find(s => s.name === sk);
          if (body.skillAction === 'upgrade') owned.level = 2;
          else t.skills.push({ name: sk, level: 1 });
        }
        save();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/deleteEntry') {
        if (!checkAdmin(body)) return send(res, 403, { error: '管理口令错误' });
        const t = getTeam(body.teamId);
        if (!t) return send(res, 404, { error: '小队不存在' });
        const before = t.entries.length;
        t.entries = t.entries.filter(e => e.id !== body.entryId);
        if (t.entries.length === before) return send(res, 404, { error: '条目不存在' });
        save();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/control') {
        if (!checkAdmin(body)) return send(res, 403, { error: '管理口令错误' });
        const a = body.action;
        if (a === 'settle') {
          if (state.phase !== 'running') return send(res, 400, { error: '当前不在经营中' });
          settleRound();
        } else if (a === 'next') {
          if (state.phase !== 'settled') return send(res, 400, { error: '请先结算本轮' });
          if (state.round >= 4) return send(res, 400, { error: '已是第四轮，请执行清算' });
          nextRound();
        } else if (a === 'finalize') {
          if (state.phase === 'finished') return send(res, 400, { error: '已清算' });
          finalize();
        } else if (a === 'timer') {
          const m = Math.max(1, parseInt(body.minutes, 10) || state.timerMinutes || 30);
          state.timerMinutes = m;
          state.timerEnd = Date.now() + m * 60000;
        } else if (a === 'timerStop') {
          state.timerEnd = null;
        } else if (a === 'showRanking') {
          state.showRanking = !!body.value;
        } else if (a === 'setMembers') {
          const t = getTeam(body.teamId);
          if (t) t.members = Math.max(1, parseInt(body.members, 10) || t.members);
        } else if (a === 'setConfig') {
          const cur = cfg();
          const KEYS = ['baseCash','baseCards','priceBasic','priceAdv','cardValue','laborPer','warehousePer','taxRate','interestRate','loanMax'];
          for (const k of KEYS) {
            const v = Number((body.config || {})[k]);
            if (Number.isFinite(v) && v >= 0) cur[k] = v;
          }
          state.config = cur;
        } else if (a === 'backToRunning') {
          if (state.phase === 'settled') state.phase = 'running';
        } else {
          return send(res, 400, { error: '未知操作' });
        }
        save();
        return send(res, 200, { ok: true });
      }
      /* 管理端获取含口令的完整信息 */
      if (p === '/api/admin/state') {
        if (!checkAdmin(body)) return send(res, 403, { error: '管理口令错误' });
        return send(res, 200, {
          created: state.created, round: state.round, phase: state.phase,
          showRanking: state.showRanking, timerEnd: state.timerEnd, timerMinutes: state.timerMinutes,
          config: cfg(),
          teams: state.teams.map(t => teamView(t, true))
        });
      }
      /* 导出CSV结算表 */
      if (p === '/api/export') {
        if (u.searchParams.get('adminCode') !== state.adminCode) return send(res, 403, { error: '管理口令错误' });
        const csv = buildCSV();
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="poker-settlement.csv"' });
        return res.end('\ufeff' + csv);
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      return send(res, 500, { error: String(err && err.message || err) });
    }
  }

  /* 静态文件 */
  let f = p === '/' ? '/index.html' : p;
  const fp = path.normalize(path.join(PUB, f));
  if (!fp.startsWith(PUB)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(fp, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(fp)] || 'application/octet-stream');
  });
});

/* ---------- 记账构造 ---------- */
function buildTeamEntry(t, b) {
  const type = b.type;
  const def = TYPES[type];
  if (!def || !def.team) return { error: '该账目类型不允许小组操作' };
  const c = compute(t);
  const r = state.round;
  const note = String(b.note || '').slice(0, 100);
  const mk = (amount, cards, loan, label) => ({
    entry: { id: idSeq++, round: r, type, label: label || def.name, amount, cards, loan, note, ts: Date.now() }
  });
  const pos = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };

  if (type === 'sale') {
    const amt = pos(b.amount), used = pos(b.cards);
    if (!amt) return { error: '请填写销售金额' };
    if (used > c.cards) return { error: `卡牌不足：当前仅有 ${c.cards} 张` };
    // 品牌溢价技能：销售额外 +10%（初级）/ +20%（升级）
    const bpLv = skillLevel(t, '品牌溢价');
    let finalAmt = amt, extraNote = '';
    if (bpLv) {
      const rate = SKILLS['品牌溢价'].saleBonus[bpLv - 1];
      const bonus = Math.round(amt * rate);
      finalAmt = amt + bonus;
      extraNote = `含品牌溢价+${bonus}`;
    }
    const note2 = [extraNote, note].filter(Boolean).join('；');
    return { entry: { id: idSeq++, round: r, type, label: `销售收入${b.order ? '（' + String(b.order).slice(0, 20) + '）' : ''}`, amount: finalAmt, cards: -used, loan: 0, note: note2, ts: Date.now() } };
  }
  if (type === 'buy_basic' || type === 'buy_adv') {
    const n = pos(b.count);
    if (!n) return { error: '请填写采购张数' };
    const price = type === 'buy_basic' ? cfg().priceBasic : cfg().priceAdv;
    let cost = n * price, disNote = '';
    // 批量折扣技能：初级 ≥10张8折；升级 ≥5张8折、≥10张7折
    const bdLv = skillLevel(t, '批量折扣');
    if (bdLv === 1 && n >= 10) { cost = Math.round(cost * 0.8); disNote = '批量折扣8折'; }
    if (bdLv >= 2) {
      if (n >= 10) { cost = Math.round(n * price * 0.7); disNote = '批量折扣7折'; }
      else if (n >= 5) { cost = Math.round(n * price * 0.8); disNote = '批量折扣8折'; }
    }
    if (cost > c.cash) return { error: `现金不足：需 ${cost}，当前 ${c.cash}（可申请贷款）` };
    return { entry: { id: idSeq++, round: r, type, label: def.name, amount: -cost, cards: n, loan: 0, note: [disNote, note].filter(Boolean).join('；'), ts: Date.now() } };
  }
  if (type === 'refine') {
    // 深度加工技能：任意1张牌 + 金币 → 从任意市场抽1张牌（手牌数不变）
    const lv = skillLevel(t, '深度加工');
    if (!lv) return { error: '本组未持有「深度加工」技能' };
    const cost = SKILLS['深度加工'].refineCost[lv - 1];
    if (c.cards < 1) return { error: '至少需要 1 张手牌用于加工' };
    if (cost > c.cash) return { error: `现金不足：需 ${cost}，当前 ${c.cash}` };
    return { entry: { id: idSeq++, round: r, type, label: '深度加工', amount: -cost, cards: 0, loan: 0, note: `1张牌+${cost}金币抽1张牌`, ts: Date.now() } };
  }
  if (type === 'loan_in') {
    const amt = pos(b.amount);
    if (!amt) return { error: '请填写贷款金额' };
    if (c.loan + amt > cfg().loanMax) return { error: `贷款总额不能超过 ${cfg().loanMax}（当前余额 ${c.loan}）` };
    return mk(amt, 0, amt);
  }
  if (type === 'repay') {
    const amt = pos(b.amount);
    if (!amt) return { error: '请填写还贷金额' };
    if (amt > c.loan) return { error: `还贷金额不能超过贷款余额 ${c.loan}` };
    if (amt > c.cash) return { error: '现金不足' };
    return mk(-amt, 0, -amt);
  }
  if (type === 'other_in' || type === 'lend_back') {
    const amt = pos(b.amount);
    if (!amt) return { error: '请填写金额' };
    return mk(amt, 0, 0);
  }
  if (type === 'service_out' || type === 'lend_out') {
    const amt = pos(b.amount);
    if (!amt) return { error: '请填写金额' };
    if (amt > c.cash) return { error: '现金不足' };
    return mk(-amt, 0, 0);
  }
  return { error: '未知账目类型' };
}

function buildAdminEntry(t, b) {
  const type = b.type;
  const def = TYPES[type];
  if (!def || def.team) return { error: '该类型请由小组端自行记账' };
  const r = state.round;
  const note = String(b.note || '').slice(0, 100);
  if (type === 'adjust') {
    const amt = Math.round(Number(b.amount));
    if (!Number.isFinite(amt) || amt === 0) return { error: '请填写调整金额（可为负）' };
    const cards = Math.round(Number(b.cards) || 0);
    return { entry: { id: idSeq++, round: r, type, label: String(b.label || '账目调整').slice(0, 20), amount: amt, cards, loan: 0, note, ts: Date.now() } };
  }
  const amt = Math.round(Number(b.amount));
  if (!Number.isFinite(amt) || amt <= 0) return { error: '请填写正数金额' };
  const label = type === 'skill' && b.skillName ? `技能成本（${String(b.skillName).slice(0, 12)}${b.skillAction === 'upgrade' ? '·升级' : ''}）` : def.name;
  return { entry: { id: idSeq++, round: r, type, label, amount: -amt, cards: 0, loan: 0, note, ts: Date.now() } };
}

/* ---------- CSV 导出 ---------- */
function buildCSV() {
  const rows = [];
  const R = [1, 2, 3, 4];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  for (const t of state.teams) {
    rows.push([`小队：${t.name}`].map(esc).join(','));
    rows.push(['记录项', '第一轮', '第二轮', '第三轮', '第四轮', '合计'].map(esc).join(','));
    const sum = (pred) => R.map(r => t.entries.filter(e => e.round === r && pred(e)).reduce((s, e) => s + e.amount, 0));
    const line = (name, arr) => rows.push([name, ...arr, arr.reduce((a, b) => a + b, 0)].map(esc).join(','));
    line('销售收入', sum(e => e.type === 'sale'));
    line('其他收入', sum(e => ['other_in', 'lend_back'].includes(e.type)));
    line('贷款取得', sum(e => e.type === 'loan_in'));
    line('技能成本', sum(e => e.type === 'skill'));
    line('采购初级材料', sum(e => e.type === 'buy_basic'));
    line('采购高级材料', sum(e => e.type === 'buy_adv'));
    line('深度加工', sum(e => e.type === 'refine'));
    line('人力成本', sum(e => e.type === 'labor'));
    line('仓储成本', sum(e => e.type === 'warehouse'));
    line('税费', sum(e => e.type === 'tax'));
    line('利息', sum(e => e.type === 'interest'));
    line('服务费/放贷/还贷', sum(e => ['service_out', 'lend_out', 'repay'].includes(e.type)));
    line('罚款/调整', sum(e => ['penalty', 'adjust'].includes(e.type)));
    const c = compute(t);
    rows.push(['期末现金', c.cash, '剩余卡牌', c.cards, '贷款余额', c.loan].map(esc).join(','));
    rows.push(['净利润（身家）', netWorth(t)].map(esc).join(','));
    rows.push('');
  }
  return rows.join('\r\n');
}

server.listen(PORT, HOST, () => {
  const nets = require('os').networkInterfaces();
  let lan = '';
  for (const k of Object.keys(nets)) for (const n of nets[k] || []) {
    if (n.family === 'IPv4' && !n.internal) { lan = n.address; break; }
  }
  console.log(`扑克风云会 沙盘电子版已启动`);
  console.log(`本机访问:  http://localhost:${PORT}/`);
  if (lan) console.log(`局域网访问（各小组手机/电脑）:  http://${lan}:${PORT}/`);
});
