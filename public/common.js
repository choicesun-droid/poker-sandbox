/* 公共 JS */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
async function api(path, body) {
  const r = await fetch(path, body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('请求失败 ' + r.status));
  return j;
}
function fmt(n) { return (n < 0 ? '-' : '') + Math.abs(Math.round(n)).toLocaleString(); }
function phaseName(s) {
  if (!s.created) return '未开始';
  if (s.phase === 'finished') return '已清算';
  if (s.phase === 'settled') return `第${s.round}轮 · 已结算`;
  return `第${s.round}轮 · 经营中`;
}
function fmtTime(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000);
  return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
/* 倒计时渲染：返回是否超时 */
function renderTimer(el, s) {
  if (!s.timerEnd) { el.textContent = '--:--'; el.classList.remove('over'); return false; }
  const use = s.timerEnd - Date.now() - (window._skew || 0);
  el.textContent = fmtTime(use);
  el.classList.toggle('over', use < 0);
  return use < 0;
}
/* 保存服务器时钟偏移 */
function trackSkew(s) { window._skew = Date.now() - s.now; }
function showErr(el, msg) { el.textContent = msg || ''; el.style.display = msg ? 'block' : 'none'; }
