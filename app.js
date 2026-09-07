/* 净化阿北 · 前端主逻辑 */
'use strict';

const $ = (s) => document.querySelector(s);
const app = $('#app');

/* API 基址：默认同源 /api；CloudBase 部署时由 index.html 注入 CB_API_BASE（跨域完整地址） */
const API = window.CB_API_BASE || (location.origin + '/api');

const GROUPS = [
  { key: 'yuanqi', name: '源气满满', url: 'https://www.douban.com/group/757413/' },
  { key: 'pisa', name: '披萨品鉴指南', url: 'https://www.douban.com/group/757391/' },
];

const state = {
  token: localStorage.getItem('bp_token') || '',
  me: null,
  section: 'pool',
  filter: 'all',
  poolTab: 'zzy',
  posts: [],
  findings: [],
  messages: [],
  users: [],
  apps: [],
  regs: [],
  audit: [],
  initialized: false,
  seenFindings: new Set(JSON.parse(localStorage.getItem('bp_seen_f') || '[]')),
  seenRegs: new Set(JSON.parse(localStorage.getItem('bp_seen_r') || '[]')),
  pendingLinks: [],
};

/* ---------------- 通用 ---------------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function tip(msg, type) {
  const box = $('#toast-center');
  const el = document.createElement('div');
  el.className = 'tip ' + (type || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let okFlag = false;
    try { okFlag = document.execCommand('copy'); } catch (err) { okFlag = false; }
    ta.remove();
    return okFlag;
  }
}

async function api(path, payload) {
  const res = await fetch(API + '/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-token': state.token },
    body: JSON.stringify(payload || {}),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { data = { error: '服务器返回异常' }; }
  if (data.error) {
    if (res.status === 401) { state.token = ''; state.me = null; localStorage.removeItem('bp_token'); render(); }
    const err = new Error(data.error);
    err.code = data.code || '';
    err.links = data.links || [];
    throw err;
  }
  return data;
}

function guard(fn) {
  return async (e) => {
    try { await fn(e); } catch (err) { tip(err.message || '操作失败', 'err'); }
  };
}

/* ---------------- 时间 / 状态 ---------------- */
function remainMs(p) { return p.expireAt - Date.now(); }

function fmtRemain(ms) {
  if (ms <= 0) return '已过期';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d >= 1) return '剩 ' + d + ' 天 ' + (h % 24) + ' 小时';
  if (h >= 1) return '剩 ' + h + ' 小时';
  return '剩 ' + Math.max(1, Math.floor(ms / 60000)) + ' 分钟';
}

/** 某条链接是否已被「当前用户」标记完成（完成态是每人的私人状态） */
function isDone(l) {
  return l.doneBy && typeof l.doneBy === 'object' && !!l.doneBy[state.me.nick];
}

/** 倒计时阈值：剩余不足 24 小时 */
function postState(p) {
  if (p.links.length && p.links.every(isDone)) return 'done';
  const ms = remainMs(p);
  if (ms <= 0) return 'expired';
  if (ms <= 24 * 3600 * 1000) return 'urgent';
  return 'fresh';
}

const STATE_TEXT = { fresh: '最新', urgent: '倒计时', expired: '已过期', done: '已完成' };

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function roleBadge(role) {
  const name = { admin: '管理员', mod: '捞黑员', member: '执法者' }[role] || role;
  return '<span class="badge ' + role + '">' + name + '</span>';
}

/* ---------------- 投诉理由（与脚本预设一致） ---------------- */
const PRESETS = [
  { name: '标准4连击（推荐）', rounds: [
    { r: '辱骂攻击', s: '侮辱谩骂' }, { r: '饭圈乱象', s: '挂人引战' },
    { r: '网络暴力 / 网络戾气', s: '谩骂攻击' }, { r: '涉未成年人', s: '诱导不良行为' }] },
  { name: '色情+暴力4连击', rounds: [
    { r: '色情低俗', s: '低俗内容' }, { r: '网络暴力 / 网络戾气', s: '歧视偏见' },
    { r: '辱骂攻击', s: '人身攻击' }, { r: '饭圈乱象', s: '造谣爆料' }] },
  { name: '引战专用3连击', rounds: [
    { r: '引战', s: '' }, { r: '饭圈乱象', s: '干扰舆论' }, { r: '辱骂攻击', s: '侮辱谩骂' }] },
];

const CUSTOM_REASONS = [
  { r: '辱骂攻击', s: '侮辱谩骂' }, { r: '辱骂攻击', s: '人身攻击' },
  { r: '饭圈乱象', s: '挂人引战' }, { r: '饭圈乱象', s: '干扰舆论' },
  { r: '饭圈乱象', s: '造谣爆料' }, { r: '网络暴力 / 网络戾气', s: '谩骂攻击' },
  { r: '网络暴力 / 网络戾气', s: '泄露隐私' }, { r: '不实信息', s: '其他不实信息' },
  { r: '涉未成年人', s: '诱导不良行为' }, { r: '色情低俗', s: '低俗内容' },
  { r: '引战', s: '' }, { r: '侵犯我的权益', s: '' },
];

function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---------------- 启动 / 数据 ---------------- */
async function boot() {
  try {
    const st = await api('auth', { action: 'status' });
    state.initialized = st.initialized;
  } catch (e) { state.initialized = false; }
  if (state.token) {
    try {
      const r = await api('auth', { action: 'me' });
      if (r.user) state.me = r.user; else state.token = '';
    } catch (e) { state.token = ''; }
  }
  render();
  if (state.me) { await refreshAll(); startPollingOnce(); }
}

async function refreshAll() {
  const isStaff = state.me && state.me.role !== 'member';
  const jobs = [
    api('posts', { action: 'list' }).catch(() => ({ posts: [] })),
    api('findings', { action: 'list' }).catch(() => ({ findings: [] })),
    api('messages', { action: 'list' }).catch(() => ({ messages: [] })),
  ];
  if (isStaff) jobs.push(api('admin', { action: 'listUsers' }).catch(() => ({ users: [] })));
  if (isStaff) jobs.push(api('admin', { action: 'listRegistrations' }).catch(() => ({ registrations: [] })));
  if (state.me && (state.me.role === 'admin' || state.me.role === 'deputy')) jobs.push(api('admin', { action: 'listApps' }).catch(() => ({ applications: [] })));

  const res = await Promise.all(jobs);
  state.posts = res[0].posts || [];
  state.stats = res[0].stats || { total: 0, undone: 0, done: 0, mineTotal: 0, mineToday: 0 };
  checkNewFindings(res[1].findings || []);
  state.findings = res[1].findings || [];
  state.messages = res[2].messages || [];
  if (isStaff) { state.users = res[3].users || []; checkNewRegs(res[4].registrations || []); state.regs = res[4].registrations || []; }
  if (state.me && state.me.role === 'admin') state.apps = (res[res.length - 1].applications) || [];
  if (state.me && (state.me.role === 'admin' || state.me.role === 'deputy')) {
    loadReport().then(safeRender).catch(() => {});
  }
  safeRender();
}

/** 加载报表：日汇总 + 当前选中月份的月汇报 */
async function loadReport() {
  const daily = await api('report', { action: 'daily' });
  state.report = state.report || {};
  state.report.byDay = daily.byDay || [];
  state.report.months = daily.months || [];
  if (!state.report.selMonth || state.report.months.indexOf(state.report.selMonth) < 0) {
    state.report.selMonth = state.report.months[0] || '';
  }
  if (state.report.selMonth) {
    const m = await api('report', { action: 'month', month: state.report.selMonth });
    state.report.uploads = m.uploads;
    state.report.participants = m.participants;
    state.report.list = m.list || [];
    state.report.byDayMonth = m.byDay || [];
  }
  // 操作审计（谁删了公告/链接）
  api('admin', { action: 'audit' }).then((a) => { state.audit = a.items || []; safeRender(); }).catch(() => {});
}

/** 用户正在输入框打字时不重绘，避免内容被清掉；重绘后保持滚动位置 */
function safeRender() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function checkNewFindings(list) {
  if (!state.me || state.me.role === 'member') return;
  const fresh = list.filter((f) => f.status === 'pending' && f.by !== state.me.nick && !state.seenFindings.has(f.id));
  if (!fresh.length) return;
  fresh.forEach((f) => { state.seenFindings.add(f.id); showFindingToast(f); });
  localStorage.setItem('bp_seen_f', JSON.stringify([...state.seenFindings].slice(-200)));
}

function checkNewRegs(list) {
  if (!state.me || state.me.role === 'member') return;
  const fresh = list.filter((r) => !state.seenRegs.has('reg:' + r.nick));
  if (!fresh.length) return;
  fresh.forEach((r) => { state.seenRegs.add('reg:' + r.nick); showRegToast(r); });
  localStorage.setItem('bp_seen_r', JSON.stringify([...state.seenRegs].slice(-200)));
}

function showFindingToast(f) {
  const box = $('#toast-box');
  const el = document.createElement('div');
  el.className = 'toast warn';
  el.innerHTML =
    '<div class="t">🌊 发现尚未捕捞的黑水</div>' +
    '<div class="d">' + esc(f.by) + '：' + esc(f.url) + (f.note ? '<br>' + esc(f.note) : '') + '</div>' +
    '<div class="row">' +
    '<button class="btn sm" data-act="f-open" data-id="' + f.id + '">查看链接</button>' +
    '<button class="btn sm" data-act="f-accept" data-id="' + f.id + '">发布到黑水塘</button>' +
    '<button class="btn sm ghost" data-act="f-ignore" data-id="' + f.id + '">忽略</button>' +
    '</div>';
  box.appendChild(el);
  setTimeout(() => el.remove(), 60000);
}

/** 是否有审批权（入队申请 / 捞黑员申请）：最高管理员与次管理员 */
function canApprove() {
  return state.me && (state.me.role === 'admin' || state.me.role === 'deputy');
}

function showRegToast(r) {
  const box = $('#toast-box');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML =
    '<div class="t">📮 新的入队申请</div>' +
    '<div class="d">' + esc(r.nick) + ' 申请成为执法者</div>' +
    '<div class="row">' +
    (canApprove()
      ? '<button class="btn sm" data-act="reg-approve" data-nick="' + esc(r.nick) + '">通过</button>' +
        '<button class="btn sm ghost" data-act="reg-reject" data-nick="' + esc(r.nick) + '">拒绝</button>'
      : '<button class="btn sm ghost" data-act="goto-admin">去管理后台</button>') +
    '</div>';
  box.appendChild(el);
  setTimeout(() => el.remove(), 60000);
}

let pollingStarted = false;
function startPollingOnce() {
  if (pollingStarted) return;
  pollingStarted = true;
  setInterval(() => { if (state.me) refreshAll(); }, 40000);
}

/* ---------------- 主渲染：左侧导航 + 单页三模块 ---------------- */
function render() {
  if (!state.me) { renderAuth(); return; }
  const staff = state.me.role !== 'member';
  app.innerHTML =
    '<div class="shell">' +
      '<aside class="sidebar">' +
        '<div class="brand">净化阿北<span>反黑协作站</span></div>' +
        navBtn('pool', '🌊', '黑水塘') +
        navBtn('find', '🔍', '发现黑水') +
        navBtn('msg', '💬', '留言板') +
        (staff ? navBtn('admin', '⚙️', '管理后台') : '') +
        '<div class="foot">' +
          (!staff ? '<button class="navbtn sm" data-act="apply-mod"><span class="ic">🙋</span>申请成为捞黑员</button>' : '') +
          '<div class="me">' + esc(state.me.nick) + '<br>' + esc(state.me.roleName) + '</div>' +
          '<button class="navbtn sm" data-act="chg-pass"><span class="ic">🔑</span>修改密码</button>' +
          '<button class="navbtn" data-act="logout"><span class="ic">🚪</span>退出</button>' +
        '</div>' +
      '</aside>' +
      '<div class="content"><div class="inner">' +
        '<section id="sec-pool">' + viewPool() + '</section>' +
        '<section id="sec-find">' + viewFind() + '</section>' +
        '<section id="sec-msg">' + viewMsg() + '</section>' +
        (staff ? '<section id="sec-admin">' + viewAdmin() + '</section>' : '') +
      '</div></div>' +
    '</div>';
  loadPendingImages();
  highlightNav();
}

function navBtn(id, icon, label) {
  return '<button class="navbtn' + (state.section === id ? ' active' : '') + '" data-act="nav" data-sec="' + id + '">' +
    '<span class="ic">' + icon + '</span>' + label + '</button>';
}

let navObserver = null;
function highlightNav() {
  const secs = ['pool', 'find', 'msg', 'admin'];
  if (navObserver) navObserver.disconnect();
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        state.section = en.target.id.replace('sec-', '');
        document.querySelectorAll('.navbtn[data-sec]').forEach((b) => {
          b.classList.toggle('active', b.dataset.sec === state.section);
        });
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  secs.forEach((s) => {
    const el = document.getElementById('sec-' + s);
    if (el) obs.observe(el);
  });
  navObserver = obs;
}

/* ---------------- 黑水塘 ---------------- */
function viewPool() {
  const staff = state.me.role !== 'member';
  // 板块：黑水塘（张真源相关）/ 浑水摸鱼（非张真源但恶劣影响）
  const boardPosts = state.posts.filter((p) => (p.board || 'zzy') === state.poolTab);
  const zzyCount = state.posts.filter((p) => (p.board || 'zzy') === 'zzy').length;
  const fishCount = state.posts.length - zzyCount;
  const bucket = { all: [], fresh: [], urgent: [], expired: [], done: [] };
  const counts = { all: boardPosts.length, fresh: 0, urgent: 0, expired: 0, done: 0 };
  boardPosts.forEach((p) => { const s = postState(p); bucket[s].push(p); counts[s]++; });
  bucket.all = boardPosts.slice().sort((a, b) => {
    const sa = postState(a) === 'done' ? 1 : 0, sb = postState(b) === 'done' ? 1 : 0;
    return sa - sb || b.createdAt - a.createdAt;
  });
  const list = bucket[state.filter] || [];

  let html = '<div class="sec-title"><span class="ic">🌊</span>黑水塘' +
    '<small>公告牌 · 点击左侧图标可快速跳转</small></div>';

  html += '<div class="filters">' +
    '<button class="chip' + (state.poolTab === 'zzy' ? ' active' : '') + '" data-act="pool-tab" data-b="zzy">🎣 黑水塘<span class="n">' + zzyCount + '</span></button>' +
    '<button class="chip' + (state.poolTab === 'fish' ? ' active' : '') + '" data-act="pool-tab" data-b="fish">🐟 浑水摸鱼<span class="n">' + fishCount + '</span></button>' +
    '</div>';

  html += statsCard();
  html += scriptHelp();

  if (staff) {
    html += '<div class="card">' +
      '<h3>📢 发布捕捞公告</h3>' +
      '<label>发布板块</label><select id="p-board" style="width:100%">' +
        '<option value="zzy">黑水塘（张真源相关黑帖）</option>' +
        '<option value="fish">浑水摸鱼（非张真源相关 · 恶劣影响）</option>' +
      '</select>' +
      '<label>公告标题</label><input type="text" id="p-title" placeholder="例如：9月第一波黑帖">' +
      '<label>链接（可一次粘贴多条，自动按 10 个一组拆分）</label>' +
      '<textarea id="p-links" placeholder="每行一个链接，支持豆瓣完整网址 / 9位帖子ID / dispatch短链"></textarea>' +
      '<label>备注（可选）</label><input type="text" id="p-note" placeholder="例如：重点投诉挂人引战">' +
      '<div class="row" style="margin-top:10px"><button class="btn" id="b-pub">发布到公告牌</button></div>' +
    '</div>';
  }

  const names = { all: '全部', fresh: '最新', urgent: '倒计时', expired: '已过期', done: '已完成' };
  html += '<div class="filters">' + ['all', 'fresh', 'urgent', 'expired', 'done'].map((k) =>
    '<button class="chip' + (state.filter === k ? ' active' : '') + '" data-act="filter" data-f="' + k + '">' +
    names[k] + '<span class="n">' + counts[k] + '</span></button>').join('') + '</div>';

  html += list.length ? list.map(postCard).join('') : '<div class="card empty">这里还很干净 🐟</div>';
  return html;
}

function postCard(p) {
  const st = postState(p);
  const total = p.links.length;
  const done = p.links.filter(isDone).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const staff = state.me.role !== 'member';
  const canDel = state.me.role === 'admin' || state.me.role === 'deputy'; // 整删仅最高/次级
  const isFish = (p.board || 'zzy') === 'fish';

  return '<div class="card post ' + (st === 'done' ? 'done' : '') + '">' +
    '<div class="head"><div class="title">' + (isFish ? '<span class="fish-tag">🐟 浑水摸鱼</span> ' : '') + esc(p.title) + '</div>' +
      '<span class="state ' + st + '">' + STATE_TEXT[st] + '</span></div>' +
    '<div class="meta">发布者 ' + esc(p.by) + ' · ' + fmtTime(p.createdAt) +
      ' · <b>' + fmtRemain(remainMs(p)) + '</b> · 我完成 ' + done + '/' + total + '</div>' +
    (p.note ? '<div class="meta">📝 ' + esc(p.note) + '</div>' : '') +
    '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
    '<ul class="links">' + p.links.map((l) => {
      const metaLine = l.meta ? [l.meta.author, l.meta.ip, l.meta.postTime, l.meta.group].filter(Boolean).join(' · ') : '';
      return '<li class="' + (isDone(l) ? 'ok' : '') + '">' +
        '<input type="checkbox" ' + (isDone(l) ? 'checked' : '') + ' data-act="toggle" data-id="' + p.id + '" data-lid="' + l.id + '">' +
        '<span style="min-width:0;flex:1">' +
          (l.title ? '<div class="ltitle">' + esc(l.title) + '</div>' : '') +
          '<span class="url" title="' + esc(l.url) + '">' + esc(l.url) + '</span>' +
          (metaLine ? '<div class="lmeta">' + esc(metaLine) + '</div>' : '') +
        '</span>' +
        (staff ? '<button class="btn sm danger" data-act="del-link" data-id="' + p.id + '" data-lid="' + l.id + '" title="删除这条链接（进操作记录）">✕</button>' : '') +
        '<button class="btn sm ghost" data-act="copy-one" data-url="' + esc(l.url) + '">复制</button>' +
        '<button class="btn sm ghost" data-act="open-one" data-url="' + esc(l.url) + '">打开</button>' +
      '</li>';
    }).join('') + '</ul>' +
    '<div class="row" style="margin-top:10px">' +
      '<button class="btn sm" data-act="copy-all" data-id="' + p.id + '">📋 复制本组链接</button>' +
      '<button class="btn sm" data-act="report" data-id="' + p.id + '">🚨 一键投诉（跳转脚本）</button>' +
      (staff ? '<button class="btn sm ghost" data-act="add-link" data-id="' + p.id + '">+ 补链接</button>' : '') +
      (canDel ? '<button class="btn sm danger" data-act="del-post" data-id="' + p.id + '">删除公告</button>' : '') +
    '</div></div>';
}

/* 数字模块：全局战绩，点击跳到黑水塘 */
function statsCard() {
  const s = state.stats || { total: 0, undone: 0, mineTotal: 0, mineToday: 0 };
  const cell = (label, val, cls) =>
    '<div class="stat' + (cls ? ' ' + cls : '') + '" data-act="goto-pool">' +
      '<b>' + label + '</b><span>' + val + '</span></div>';
  return '<div class="stats">' +
    cell('全部黑帖', s.total) +
    cell('我处理', s.mineTotal) +
    cell('今日处理', s.mineToday) +
    cell('未处理', s.undone, 'warn') +
  '</div>';
}

/* 脚本安装引导：默认折叠，点开展开；提供直接安装/复制全文/下载三种方式 */
function scriptHelp() {
  const installUrl = API + '/script.user.js';
  return '<details class="card script-help">' +
    '<summary>🛠 第一次使用？点此展开 · 安装投诉脚本（老成员可折叠）</summary>' +
    '<p class="hint">这个投诉脚本的链接一般人看不到，需先在浏览器装好「油猴 Tampermonkey」插件，再安装本站的专属脚本；之后点任意公告里的「🚨 一键投诉」才会自动批量投诉。</p>' +
    '<ol class="steps">' +
      '<li>电脑/手机浏览器安装 <b>Tampermonkey（油猴）</b> 插件</li>' +
      '<li>点下面「直接安装」，油猴会弹出安装框；如果没弹（或打开了代码页），改用「复制脚本全文」→ 油猴面板 → 添加新脚本 → 全选粘贴 → 保存</li>' +
      '<li>回到黑水塘，点公告「🚨 一键投诉」→ 选理由 → 自动跳转并批量投诉</li>' +
    '</ol>' +
    '<div class="row">' +
      '<a class="btn" href="' + installUrl + '" target="_blank" rel="noopener">⬇ 直接安装脚本 v2.6.0</a>' +
      '<button class="btn ghost" data-act="copy-script-full">复制脚本全文</button>' +
      '<button class="btn ghost" data-act="download-script">下载到本地</button>' +
    '</div>' +
  '</details>';
}

/* ---------------- 发现黑水 ---------------- */
function viewFind() {
  const staff = state.me.role !== 'member';
  let html = '<div class="sec-title"><span class="ic">🔍</span>发现黑水' +
    '<small>公告牌上没有的黑帖，贴到这里</small></div>' +
    '<div class="card">' +
      '<h3>提交尚未捕捞的黑水</h3>' +
      '<p class="hint">提交后所有管理员右下角会立刻收到提醒。</p>' +
      '<label>黑帖链接</label><input type="text" id="f-url" placeholder="https://www.douban.com/group/topic/xxxxx/">' +
      '<label>说明（可选）</label><input type="text" id="f-note" placeholder="例如：造谣爆料，已在传播">' +
      '<div class="row" style="margin-top:10px"><button class="btn" id="b-find">提交发现</button></div>' +
    '</div>';

  if (staff) {
    const pend = state.findings.filter((f) => f.status === 'pending');
    html += '<div class="card"><h3>⏳ 待处理（' + pend.length + '）</h3>' +
      (pend.length ? pend.map(findingRow).join('') : '<div class="empty">暂无待处理</div>') + '</div>';
  }
  const mine = state.findings.filter((f) => f.by === state.me.nick);
  html += '<div class="card"><h3>📁 我提交的</h3>' +
    (mine.length ? mine.map(findingRow).join('') : '<div class="empty">你还没有提交过</div>') + '</div>';
  return html;
}

function findingRow(f) {
  const staff = state.me.role !== 'member';
  const tag = { pending: '待处理', accepted: '已发布', ignored: '已忽略' }[f.status] || f.status;
  return '<div class="finding ' + f.status + '">' +
    '<div class="u"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.url) + '</a>' +
      (f.note ? '<div class="muted">' + esc(f.note) + '</div>' : '') +
      '<div class="muted">' + esc(f.by) + ' · ' + fmtTime(f.ts) + ' · ' + tag +
      (f.handledBy ? '（' + esc(f.handledBy) + '）' : '') + '</div></div>' +
    (staff && f.status === 'pending'
      ? '<div class="row" style="flex-direction:column;gap:6px">' +
        '<button class="btn sm" data-act="f-accept" data-id="' + f.id + '">发布到黑水塘</button>' +
        '<button class="btn sm ghost" data-act="f-open" data-id="' + f.id + '">查看</button>' +
        '<button class="btn sm ghost" data-act="f-ignore" data-id="' + f.id + '">忽略</button>' +
        '</div>' : '') +
  '</div>';
}

/* ---------------- 留言板（楼中楼） ---------------- */
function viewMsg() {
  const roots = state.messages.filter((m) => !m.parentId).sort((a, b) => b.ts - a.ts);
  const kids = (id) => state.messages.filter((m) => m.parentId === id).sort((a, b) => a.ts - b.ts);

  let html = '<div class="sec-title"><span class="ic">💬</span>留言板' +
    '<small>提建议、报情况，管理员会在这里答复</small></div>' +
    '<div class="card">' +
      '<textarea id="m-text" placeholder="说点什么…"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn" id="b-msg">发布留言</button></div>' +
    '</div><div class="card">';
  if (!roots.length) html += '<div class="empty">还没有留言，来抢第一楼 🌱</div>';
  html += roots.map((m) => msgBlock(m, kids)).join('');
  return html + '</div>';
}

function msgBlock(m, kids) {
  const canDel = state.me.role !== 'member' || m.nick === state.me.nick;
  const sub = kids(m.id).map((r) => {
    const canDelR = state.me.role !== 'member' || r.nick === state.me.nick;
    return '<div class="msg">' +
      '<div class="who">' + esc(r.nick) + roleBadge(r.role) + '<span class="muted"> ' + fmtTime(r.ts) + '</span></div>' +
      '<div class="txt">' + esc(r.text) + '</div>' +
      (canDelR ? '<button class="btn sm danger" data-act="del-msg" data-id="' + r.id + '">删除</button>' : '') +
      '</div>';
  }).join('');

  return '<div class="msg">' +
    '<div class="who">' + esc(m.nick) + roleBadge(m.role) + '<span class="muted"> ' + fmtTime(m.ts) + '</span></div>' +
    '<div class="txt">' + esc(m.text) + '</div>' +
    '<div class="row">' +
      '<button class="btn sm ghost" data-act="reply" data-id="' + m.id + '">回复</button>' +
      (canDel ? '<button class="btn sm danger" data-act="del-msg" data-id="' + m.id + '">删除</button>' : '') +
    '</div>' +
    '<div class="reply-form" id="rf-' + m.id + '" hidden>' +
      '<textarea id="rt-' + m.id + '" placeholder="回复 ' + esc(m.nick) + '…"></textarea>' +
      '<div class="row" style="margin-top:6px">' +
        '<button class="btn sm" data-act="send-reply" data-id="' + m.id + '">发送回复</button>' +
        '<button class="btn sm ghost" data-act="cancel-reply" data-id="' + m.id + '">取消</button>' +
      '</div></div>' +
    (sub ? '<div class="replies">' + sub + '</div>' : '') +
  '</div>';
}

/* ---------------- 管理后台 ---------------- */
function viewAdmin() {
  const isAdmin = state.me.role === 'admin';
  const approver = canApprove();
  const staff = state.me.role !== 'member'; // 报表可见范围：最高管理员/次管理员/捞黑员
  let html = '<div class="sec-title"><span class="ic">⚙️</span>管理后台<small>成员、注册申请、捞黑员申请</small></div>';

  const pendRegs = state.regs || [];
  html += '<div class="card"><h3>📮 入队申请（' + pendRegs.length + '）</h3>' +
    (pendRegs.length ? pendRegs.map((r) =>
      '<div class="finding pending"><div class="u"><b>' + esc(r.nick) + '</b>' +
      '<div class="muted">' + fmtTime(r.createdAt) + '</div>' +
      '<div class="pending-pics">' +
        GROUPS.map((g) => '<img data-img="' + esc((r.images || {})[g.key] || '') + '" alt="' + g.name + '" title="' + g.name + '在组截图">').join('') +
      '</div></div>' +
      '<div class="row" style="flex-direction:column;gap:6px">' +
      (approver
        ? '<button class="btn sm" data-act="reg-approve" data-nick="' + esc(r.nick) + '">通过</button>' +
          '<button class="btn sm ghost" data-act="reg-reject" data-nick="' + esc(r.nick) + '">拒绝</button>'
        : '<span class="muted">需管理员审批</span>') +
      '</div></div>').join('') : '<div class="empty">暂无待审核的入队申请</div>') + '</div>';

  const deputyCount = (state.users || []).filter((u) => u.role === 'deputy').length;
  html += '<div class="card"><h3>👥 成员管理</h3>' +
    '<div class="row"><input type="text" id="u-nick" placeholder="新执法者昵称"><input type="text" id="u-pass" placeholder="初始密码">' +
    '<button class="btn" id="b-adduser">新增执法者</button></div>' +
    '<p class="hint">捞黑员可增加 / 剔除执法者；次管理员与捞黑员的任免只有最高管理员能操作。次管理员可审批入队与捞黑员申请（最多 2 人' + (isAdmin ? '，当前 ' + deputyCount + ' 人' : '') + '）。</p>' +
    '<div style="margin-top:10px">' + (state.users || []).map((u) =>
      '<div class="finding"><div class="u"><b>' + esc(u.nick) + '</b>' + roleBadge(u.role) +
      '<div class="muted">加入于 ' + fmtTime(u.createdAt) + '</div></div>' +
      (u.role === 'admin' ? '' :
        '<div class="row" style="flex-direction:column;gap:6px">' +
        (isAdmin && u.role === 'member' ? '<button class="btn sm" data-act="promote" data-nick="' + esc(u.nick) + '">提升为捞黑员</button>' : '') +
        (isAdmin && u.role !== 'deputy' ? '<button class="btn sm ghost" data-act="set-deputy" data-nick="' + esc(u.nick) + '">设为次管理员</button>' : '') +
        (isAdmin && u.role === 'mod' ? '<button class="btn sm ghost" data-act="demote" data-nick="' + esc(u.nick) + '">降级为执法者</button>' : '') +
        (isAdmin && u.role === 'deputy' ? '<button class="btn sm ghost" data-act="demote" data-nick="' + esc(u.nick) + '">卸任次管理员（降为执法者）</button>' : '') +
        '<button class="btn sm danger" data-act="remove-user" data-nick="' + esc(u.nick) + '">剔除</button>' +
        '</div>') +
      '</div>').join('') + '</div></div>';

  if (approver) {
    const pend = (state.apps || []).filter((a) => a.status === 'pending');
    html += '<div class="card"><h3>🌟 捞黑员申请（' + pend.length + '）</h3>' +
      (pend.length ? pend.map((a) =>
        '<div class="finding pending"><div class="u"><b>' + esc(a.nick) + '</b>' +
        '<div class="muted">' + (a.reason ? esc(a.reason) : '（未填写理由）') + ' · ' + fmtTime(a.ts) + '</div></div>' +
        '<div class="row" style="flex-direction:column;gap:6px">' +
        '<button class="btn sm" data-act="approve" data-id="' + a.id + '">通过</button>' +
        '<button class="btn sm ghost" data-act="reject" data-id="' + a.id + '">拒绝</button>' +
        '</div></div>').join('') : '<div class="empty">暂无待审批申请</div>') + '</div>';
  }

  // 📊 日汇总（仅今日速览）+ 月汇报（最高管理员 / 次管理员 / 捞黑员）
  if (staff) {
    const rep = state.report || {};
    const mlist = rep.list || [];
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const td = (rep.byDay || []).find((d) => d.date === today) || { uploads: 0, people: 0 };
    const months = rep.months || [today.slice(0, 7)];
    const cur = rep.selMonth || months[0];
    html += '<div class="card"><h3>🗓 月汇报</h3>' +
      '<div class="stats" style="margin-bottom:10px">' +
        '<div class="stat"><b>今日上传</b><span>' + td.uploads + '</span></div>' +
        '<div class="stat"><b>今日参与</b><span>' + td.people + '</span></div>' +
        '<div class="stat"><b>本月上传黑帖</b><span>' + (rep.uploads != null ? rep.uploads : '—') + '</span></div>' +
        '<div class="stat"><b>本月参与人数</b><span>' + (rep.participants != null ? rep.participants : '—') + '</span></div>' +
      '</div>' +
      '<div class="row"><select id="rep-month" style="flex:1">' +
        months.map((m) => '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + m + '</option>').join('') +
      '</select>' +
      '<button class="btn" data-act="rep-load">查看</button>' +
      '<button class="btn ghost" data-act="rep-export">⬇ 下载 Excel（CSV）</button></div>' +
      (mlist.length ? '<table class="rep-table" style="margin-top:10px"><tr><th>#</th><th>板块</th><th>标题/链接</th><th>发帖人</th><th>IP</th><th>发帖时间</th><th>小组</th><th>上传人</th></tr>' +
        mlist.map((l) =>
          '<tr><td>' + l.seq + '</td><td>' + (l.board === 'fish' ? '🐟 浑水摸鱼' : '🎣 黑水塘') + '</td>' +
          '<td style="max-width:220px;word-break:break-all">' + (l.title ? esc(l.title) + '<br>' : '') +
            '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.url) + '</a></td>' +
          '<td>' + esc(l.author || '—') + '</td><td>' + esc(l.ip || '—') + '</td>' +
          '<td>' + esc(l.postTime || '—') + '</td><td>' + esc(l.group || '—') + '</td>' +
          '<td>' + esc(l.by || '—') + '</td></tr>').join('') + '</table>'
        : '<p class="hint">该月暂无上传记录。</p>') +
      '<p class="hint">CSV 用 Excel / WPS 直接打开，含：序列号、帖子链接、标题、发帖人、发帖IP、发帖时间、所属豆瓣小组、上传人、上传时间。黑帖的作者/IP/时间/小组来自豆瓣页面抓取，抓不到的显示 —，可点下方按钮补抓。</p>' +
      '<div class="row"><button class="btn ghost" data-act="rep-refresh-info">🔄 补抓缺失的黑帖信息</button></div>' +
      '</div>';

    // 🧾 操作记录（谁删了公告 / 链接）
    const audit = state.audit || [];
    html += '<div class="card"><h3>🧾 操作记录</h3>' +
      (audit.length ? '<table class="rep-table"><tr><th>时间</th><th>操作人</th><th>操作</th><th>内容</th></tr>' +
        audit.slice(0, 50).map((a) =>
          '<tr><td style="white-space:nowrap">' + fmtTime(a.at) + '</td>' +
          '<td>' + esc(a.by) + '<span class="muted">（' + esc(({ admin: '最高管理员', deputy: '次管理员', mod: '捞黑员', member: '执法者' })[a.role] || a.role) + '）</span></td>' +
          '<td style="white-space:nowrap">' + esc(a.action) + '</td>' +
          '<td style="word-break:break-all">' + esc(a.detail) + '</td></tr>').join('') + '</table>'
        : '<div class="empty">暂无删除操作记录</div>') +
      '</div>';
  }

  return html;
}

/** 异步加载入队申请的截图 */
async function loadPendingImages() {
  const imgs = [...document.querySelectorAll('img[data-img]')];
  await Promise.all(imgs.map(async (img) => {
    const key = img.dataset.img;
    if (!key) { img.remove(); return; }
    try {
      const r = await fetch(API + '/upload?key=' + encodeURIComponent(key), { headers: { 'x-token': state.token } });
      const d = await r.json();
      if (d.data) img.src = d.data;
    } catch (e) { /* 忽略 */ }
  }));
}

/* ---------------- 登录 / 注册 ---------------- */
let authMode = 'login';
const regForm = { groups: { yuanqi: '', pisa: '' }, imgs: { yuanqi: '', pisa: '' } };

function renderAuth() {
  authMode = state.initialized ? authMode : 'init';
  app.innerHTML =
    '<div class="auth-wrap">' +
      '<div class="auth-title"><div class="logo">净化阿北</div>' +
        '<div class="sub">豆瓣反黑协作站 · 一起守护张真源的生存空间</div></div>' +
      '<div class="card" id="auth-card"></div>' +
    '</div>';
  paintAuth();
}

function paintAuth(msgHtml) {
  const card = $('#auth-card');
  const isReg = authMode === 'register';
  const isInit = authMode === 'init';
  let html = '';

  if (!isInit) {
    html += '<div class="switch">' +
      '<button class="' + (isReg ? '' : 'on') + '" data-act="mode" data-m="login">登录</button>' +
      '<button class="' + (isReg ? 'on' : '') + '" data-act="mode" data-m="register">申请入队</button>' +
      '</div>';
  } else {
    html += '<h3>🛡 创建最高管理员</h3><p class="hint">首次使用：设置最高管理员账号，只有它可以提升捞黑员、审批入队。</p>';
  }

  html += '<label>豆瓣昵称（必须与豆瓣一致，便于核实身份）</label><input type="text" id="i-nick" placeholder="填写你在豆瓣的昵称">' +
    '<label>密码</label><input type="password" id="i-pass" placeholder="至少 4 位">' +
    (isReg ? '<label>确认密码</label><input type="password" id="i-pass2" placeholder="再输入一次">' : '');

  if (isReg) {
    html += '<div style="margin-top:12px">' + GROUPS.map((g) =>
      '<div class="q-row"><div class="q">是否已加入 <b>' + g.name + '</b> 组？' +
        '<div><a href="' + g.url + '" target="_blank" rel="noopener">' + g.url + '</a></div></div>' +
        '<div class="opt">' +
          '<label class="' + (regForm.groups[g.key] === 'yes' ? 'on' : '') + '" data-act="pick" data-g="' + g.key + '" data-v="yes">是</label>' +
          '<label class="' + (regForm.groups[g.key] === 'no' ? 'on' : '') + '" data-act="pick" data-g="' + g.key + '" data-v="no">否</label>' +
        '</div></div>').join('') + '</div>';

    const both = regForm.groups.yuanqi === 'yes' && regForm.groups.pisa === 'yes';
    html += '<p class="hint up-tip">⚠ 在组截图须同时露出【组名】与【你的豆瓣用户名】（豆瓣「我的」主页可见昵称处）。只截头像或帖子的不予通过。</p>';
    if (both) {
      html += GROUPS.map((g) =>
        '<div class="upload-box"><div class="cap">上传你在 <b>' + g.name + '</b> 组的在组截图</div>' +
        '<input type="file" accept="image/*" data-upload="' + g.key + '">' +
        '<div id="pv-' + g.key + '">' + (regForm.imgs[g.key] ? '<img src="' + regForm.imgs[g.key].data + '">' : '') + '</div>' +
        '</div>').join('');
      html += '<label class="attest"><input type="checkbox" id="i-attest"> 我确认以上两张截图都同时显示了「组名」与「我的豆瓣用户名」，否则自愿审核不通过</label>';
    }
  }

  html += '<div class="row" style="margin-top:14px">' +
    '<button class="btn" id="b-main">' + (isInit ? '创建并进入' : (isReg ? '提交入队申请' : '登录')) + '</button>' +
    '</div>' +
    (msgHtml || '');
  card.innerHTML = html;

  card.querySelectorAll('input[type=file][data-upload]').forEach((inp) => {
    inp.onchange = guard(async () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const data = await compressImage(file);
      regForm.imgs[inp.dataset.upload] = { data };
      const pv = $('#pv-' + inp.dataset.upload);
      if (pv) pv.innerHTML = '<img src="' + data + '">';
    });
  });

  $('#b-main').onclick = guard(async () => {
    const nick = $('#i-nick').value.trim();
    const pass = $('#i-pass').value;
    if (nick.length < 2) throw new Error('昵称至少 2 个字符');
    if (pass.length < 4) throw new Error('密码至少 4 位');

    if (isInit) {
      const r = await api('auth', { action: 'init', nick, pass });
      return saveLogin(r);
    }
    if (!isReg) {
      const r = await api('auth', { action: 'login', nick, pass });
      return saveLogin(r);
    }
    await submitRegister(nick, pass);
  });
}

async function submitRegister(nick, pass) {
  if (pass !== $('#i-pass2').value) throw new Error('两次密码不一致');

  // 本地先校验入组资格
  const missing = GROUPS.filter((g) => regForm.groups[g.key] !== 'yes');
  if (missing.length) {
    const msg = missing.length === GROUPS.length
      ? '抱歉，你尚未有注册资格，请先去' + GROUPS[0].name + '组入组，再一起战斗吧。'
      : '抱歉，你怎么还没有 ' + missing[0].name + ' 组，先去入组再一起战斗吧。';
    const links = missing.map((g) => '<div style="margin-top:6px">👉 <a href="' + g.url + '" target="_blank" rel="noopener">' + g.name + '：' + g.url + '</a></div>').join('');
    paintAuth('<div class="reject">' + esc(msg) + links + '</div>');
    return;
  }
  if (!regForm.imgs.yuanqi || !regForm.imgs.pisa) throw new Error('请上传两个组的在组截图');
  const attest = $('#i-attest');
  if (!attest || !attest.checked) throw new Error('请勾选「截图已同时显示组名与用户名」确认项');

  const btn = $('#b-main');
  btn.disabled = true;
  btn.textContent = '上传截图中…';
  const images = {};
  for (const g of GROUPS) {
    const r = await api('upload', { data: regForm.imgs[g.key].data });
    images[g.key] = r.key;
  }
  btn.textContent = '提交中…';
  const res = await api('auth', {
    action: 'register', nick, pass,
    groups: regForm.groups,
    images,
    imgAttest: true,
  });
  paintAuth('<div class="ok-note">✅ 申请已提交，等待管理员审核。<br>昵称：<b>' + esc(nick) + '</b><br>审核通过后即可用这个密码登录。</div>');
}

function compressImage(file, maxW) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, (maxW || 720) / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
      img.src = fr.result;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function saveLogin(r) {
  state.token = r.token;
  state.me = r.user;
  localStorage.setItem('bp_token', r.token);
  render();
  await refreshAll();
  startPollingOnce();
}

/* ---------------- 一键投诉弹窗 ---------------- */
function openReportModal(post) {
  const todo = post.links.filter((l) => !isDone(l));
  state.pendingLinks = todo.length ? todo.map((l) => l.url) : post.links.map((l) => l.url);
  const checked = new Set(JSON.parse(localStorage.getItem('bp_rounds') || 'null') || [0, 1, 2, 3]);
  $('#modal').innerHTML =
    '<div class="modal">' +
      '<h3>🚨 一键投诉</h3>' +
      '<p class="hint">共 ' + state.pendingLinks.length + ' 个待投诉链接。选好理由后跳转第一条链接，脚本自动接管批量投诉；链接同时复制到剪贴板。</p>' +
      '<div class="preset">' + PRESETS.map((p, i) =>
        '<button class="chip" data-act="preset" data-i="' + i + '">' + esc(p.name) + '</button>').join('') + '</div>' +
      '<div id="reason-box">' + CUSTOM_REASONS.map((r, i) =>
        '<label class="reason-item"><input type="checkbox" value="' + i + '"' + (checked.has(i) ? ' checked' : '') + '>' +
        esc(r.r + (r.s ? ' / ' + r.s : '')) + '</label>').join('') + '</div>' +
      '<div class="row" style="margin-top:14px">' +
        '<button class="btn" data-act="do-report">复制链接并开始投诉</button>' +
        '<button class="btn ghost" data-act="close-modal">取消</button>' +
      '</div></div>';
  $('#mask').hidden = false;
}

async function doReport() {
  const boxes = [...document.querySelectorAll('#reason-box input:checked')];
  const rounds = boxes.map((b) => CUSTOM_REASONS[Number(b.value)]);
  if (!rounds.length) throw new Error('至少选择一个投诉理由');
  localStorage.setItem('bp_rounds', JSON.stringify(boxes.map((b) => Number(b.value))));
  const links = state.pendingLinks;
  if (!links.length) throw new Error('没有待投诉的链接');

  const url = links[0] + '#kpbatch=' + b64url(JSON.stringify({ links, rounds, isInside: true }));
  $('#mask').hidden = true;
  const win = window.open(url, '_blank');
  let copied = false;
  try { copied = await copyText(links.join('\n')); } catch (e) { copied = false; }
  if (!win) { tip('弹窗被拦截，请手动打开：' + links[0], 'err'); return; }
  tip(copied ? '已复制 ' + links.length + ' 条链接，脚本将自动接管批量投诉'
             : '已跳转，链接复制失败可回来点「复制本组链接」', 'ok');
}

/* ---------------- 事件 ---------------- */
document.addEventListener('click', guard(async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'mode') { authMode = el.dataset.m; paintAuth(); return; }
  if (act === 'pick') {
    regForm.groups[el.dataset.g] = el.dataset.v;
    paintAuth();
    return;
  }
  if (act === 'nav') {
    const target = document.getElementById('sec-' + el.dataset.sec);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (act === 'goto-admin') {
    const t = document.getElementById('sec-admin');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (act === 'goto-pool') {
    const t = document.getElementById('sec-pool');
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (act === 'copy-script-full') {
    const res = await fetch(API + '/script');
    if (!res.ok) throw new Error('脚本获取失败（' + res.status + '），请刷新重试');
    const text = await res.text();
    await copyText(text);
    tip('脚本全文已复制：打开油猴面板 → 添加新脚本 → 全选粘贴 → Ctrl+S 保存', 'ok');
    return;
  }
  if (act === 'download-script') {
    const res = await fetch(API + '/script');
    if (!res.ok) throw new Error('脚本下载失败（' + res.status + '）');
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'blackpool-report.user.js';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    tip('已下载，可把文件拖进油猴面板安装', 'ok');
    return;
  }
  if (act === 'logout') {
    await api('auth', { action: 'logout' });
    state.token = ''; state.me = null;
    localStorage.removeItem('bp_token');
    render();
    return;
  }
  if (act === 'filter') { state.filter = el.dataset.f; render(); return; }
  if (act === 'pool-tab') { state.poolTab = el.dataset.b; render(); return; }

  if (act === 'toggle') {
    await api('posts', { action: 'toggleLink', id: el.dataset.id, linkId: el.dataset.lid });
    await refreshAll();
    return;
  }
  if (act === 'del-link') {
    if (!confirm('确定删除这条链接？操作会记入管理后台的操作记录。')) return;
    await api('posts', { action: 'removeLink', id: el.dataset.id, linkId: el.dataset.lid });
    await refreshAll();
    tip('已删除该链接', 'ok');
    return;
  }
  if (act === 'copy-one') { await copyText(el.dataset.url); tip('已复制', 'ok'); return; }
  if (act === 'open-one') { window.open(el.dataset.url, '_blank'); return; }
  if (act === 'copy-all') {
    const p = state.posts.find((x) => x.id === el.dataset.id);
    const links = p.links.filter((l) => !isDone(l)).map((l) => l.url);
    await copyText(links.length ? links.join('\n') : p.links.map((l) => l.url).join('\n'));
    tip('已复制 ' + (links.length || p.links.length) + ' 条链接', 'ok');
    return;
  }
  if (act === 'report') { openReportModal(state.posts.find((x) => x.id === el.dataset.id)); return; }
  if (act === 'del-post') {
    if (!confirm('确定删除这条公告？')) return;
    await api('posts', { action: 'delete', id: el.dataset.id });
    await refreshAll(); tip('已删除', 'ok');
    return;
  }
  if (act === 'add-link') {
    const more = prompt('粘贴要补充的链接（每行一个）：');
    if (!more) return;
    const r = await api('posts', { action: 'addLinks', id: el.dataset.id, links: more });
    await refreshAll();
    let msg = '已补充 ' + (r.added || 0) + ' 条';
    const skipList = r.skippedList || [];
    if (skipList.length) {
      msg += '，剔除 ' + skipList.length + ' 条重复';
      showSkippedModal(skipList);
    }
    tip(msg, r.added ? 'ok' : 'warn');
    return;
  }

  if (act === 'rep-load') {
    const sel = document.getElementById('rep-month');
    state.report.selMonth = sel ? sel.value : state.report.selMonth;
    await loadReport();
    safeRender(); tip('已加载 ' + state.report.selMonth + ' 月报', 'ok');
    return;
  }
  if (act === 'rep-export') {
    tip('正在生成 CSV…', 'ok');
    const res = await fetch(API + '/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-token': state.token },
      body: JSON.stringify({ action: 'export', month: state.report.selMonth }),
    });
    if (!res.ok) throw new Error('导出失败');
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '黑水塘月报-' + state.report.selMonth + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    tip('已下载', 'ok');
    return;
  }
  if (act === 'rep-refresh-info') {
    tip('开始补抓缺失信息（每批最多10条）…', 'ok');
    let total = 0;
    for (const p of state.posts) {
      try {
        const r = await api('posts', { action: 'refreshInfo', id: p.id });
        total += r.updated || 0;
      } catch (e) { /* 单组失败不影响其他 */ }
    }
    await refreshAll();
    tip('补抓完成，更新 ' + total + ' 条', 'ok');
    return;
  }

  if (act === 'f-accept') {
    const f = state.findings.find((x) => x.id === el.dataset.id);
    const title = prompt('发布到黑水塘的公告标题：', '黑水捕捞 · ' + (f ? f.by : ''));
    if (title === null) return;
    await api('findings', { action: 'accept', id: el.dataset.id, title });
    const t = el.closest('.toast'); if (t) t.remove();
    await refreshAll(); tip('已发布到公告牌', 'ok');
    return;
  }
  if (act === 'f-ignore') {
    await api('findings', { action: 'ignore', id: el.dataset.id });
    const t = el.closest('.toast'); if (t) t.remove();
    await refreshAll();
    return;
  }
  if (act === 'f-open') {
    const f = state.findings.find((x) => x.id === el.dataset.id);
    if (f) window.open(f.url, '_blank');
    return;
  }

  if (act === 'reg-approve') {
    await api('admin', { action: 'decideRegistration', nick: el.dataset.nick, approve: true });
    const t = el.closest('.toast'); if (t) t.remove();
    await refreshAll(); tip(el.dataset.nick + ' 已通过，可以登录了', 'ok');
    return;
  }
  if (act === 'reg-reject') {
    if (!confirm('拒绝并删除 ' + el.dataset.nick + ' 的入队申请？')) return;
    await api('admin', { action: 'decideRegistration', nick: el.dataset.nick, approve: false });
    const t = el.closest('.toast'); if (t) t.remove();
    await refreshAll(); tip('已拒绝', 'ok');
    return;
  }

  if (act === 'reply') {
    const box = document.getElementById('rf-' + el.dataset.id);
    if (box) box.hidden = !box.hidden;
    return;
  }
  if (act === 'cancel-reply') {
    const box = document.getElementById('rf-' + el.dataset.id);
    if (box) box.hidden = true;
    return;
  }
  if (act === 'send-reply') {
    const text = (document.getElementById('rt-' + el.dataset.id) || {}).value || '';
    if (!text.trim()) return;
    await api('messages', { action: 'create', text: text.trim(), parentId: el.dataset.id });
    await refreshAll(); tip('回复成功', 'ok');
    return;
  }
  if (act === 'del-msg') {
    if (!confirm('删除这条留言？')) return;
    await api('messages', { action: 'delete', id: el.dataset.id });
    await refreshAll();
    return;
  }

  if (act === 'promote') {
    await api('admin', { action: 'setRole', nick: el.dataset.nick, role: 'mod' });
    await refreshAll(); tip('已提升为捞黑员', 'ok');
    return;
  }
  if (act === 'demote') {
    await api('admin', { action: 'setRole', nick: el.dataset.nick, role: 'member' });
    await refreshAll(); tip('已降级为执法者', 'ok');
    return;
  }
  if (act === 'set-deputy') {
    if (!confirm('确定任命 ' + el.dataset.nick + ' 为次管理员？次管理员可审批入队与捞黑员申请（最多 2 人）。')) return;
    await api('admin', { action: 'setRole', nick: el.dataset.nick, role: 'deputy' });
    await refreshAll(); tip(el.dataset.nick + ' 已任命为次管理员', 'ok');
    return;
  }
  if (act === 'remove-user') {
    if (!confirm('确定剔除 ' + el.dataset.nick + '？')) return;
    await api('admin', { action: 'removeUser', nick: el.dataset.nick });
    await refreshAll(); tip('已剔除', 'ok');
    return;
  }
  if (act === 'approve') {
    await api('admin', { action: 'decideApp', id: el.dataset.id, approve: true });
    await refreshAll(); tip('已通过，对方成为捞黑员', 'ok');
    return;
  }
  if (act === 'reject') {
    await api('admin', { action: 'decideApp', id: el.dataset.id, approve: false });
    await refreshAll();
    return;
  }

  if (act === 'preset') {
    const p = PRESETS[Number(el.dataset.i)];
    const idx = p.rounds.map((r) => CUSTOM_REASONS.findIndex((c) => c.r === r.r && c.s === r.s));
    document.querySelectorAll('#reason-box input').forEach((b) => { b.checked = idx.indexOf(Number(b.value)) > -1; });
    return;
  }
  if (act === 'do-report') { await doReport(); return; }
  if (act === 'apply-mod') {
    const reason = prompt('申请成为捞黑员，填写理由（可选）：', '');
    if (reason === null) return;
    await api('auth', { action: 'apply', reason });
    tip('申请已提交，等待管理员审批', 'ok');
    return;
  }
  if (act === 'chg-pass') { openPassModal(); return; }
  if (act === 'close-modal') { $('#mask').hidden = true; return; }
}));

/* 重复链接：发布前确认弹窗（列出每条重复及其所在公告），返回 'skip' / 'force' / null */
function dupesModal(dupes, fresh) {
  return new Promise((resolve) => {
    const rows = dupes.map((d) =>
      '<div class="dupe-row"><code>' + esc(d.url) + '</code>' +
      '<span class="dupe-where">⚠ 已在：' + esc(d.postTitle || '未知公告') +
      '（' + esc(d.by || '?') + ' 发布 · ' + (d.type === 'same' ? '同一帖子' : '同标题') + '）</span></div>'
    ).join('');
    $('#modal').innerHTML =
      '<div class="modal">' +
        '<h3>⚠ 有 ' + dupes.length + ' 条链接已在黑水塘</h3>' +
        rows +
        '<p class="hint">不重复的 ' + (fresh || 0) + ' 条不受影响。重复的帖子重复投诉没有意义，建议跳过。</p>' +
        '<div class="row">' +
          '<button class="btn" id="d-skip">跳过重复，发布其余</button>' +
          '<button class="btn ghost" id="d-force">全部照发</button>' +
          '<button class="btn ghost" id="d-cancel">取消</button>' +
        '</div></div>';
    $('#mask').hidden = false;
    const done = (v) => { $('#mask').hidden = true; resolve(v); };
    document.getElementById('d-skip').onclick = () => done('skip');
    document.getElementById('d-force').onclick = () => done('force');
    document.getElementById('d-cancel').onclick = () => done(null);
  });
}

/* 重复链接：发布/补充后告知明细（哪几条被剔除、已在哪里） */
function showSkippedModal(skipList) {
  const rows = skipList.map((d) =>
    '<div class="dupe-row"><code>' + esc(d.url) + '</code>' +
    '<span class="dupe-where">已在：' + esc(d.postTitle || '未知公告') + '（' + esc(d.by || '?') + ' 发布）</span></div>'
  ).join('');
  $('#modal').innerHTML =
    '<div class="modal">' +
      '<h3>♻ 已剔除 ' + skipList.length + ' 条重复链接</h3>' +
      '<p class="hint">以下链接已在黑水池里，未重复上：</p>' +
      rows +
      '<div class="row"><button class="btn" id="d-ok">知道了</button></div></div>';
  $('#mask').hidden = false;
  document.getElementById('d-ok').onclick = () => { $('#mask').hidden = true; };
}

/* 修改密码弹窗 */
function openPassModal() {  $('#modal').innerHTML =
    '<div class="modal">' +
      '<h3>🔑 修改密码</h3>' +
      '<p class="hint">账号：' + esc(state.me.nick) + '（' + esc(state.me.roleName) + '），修改后本次登录保持有效，下次登录请用新密码。</p>' +
      '<label>旧密码</label><input type="password" id="pw-old" autocomplete="current-password">' +
      '<label>新密码（至少 4 位）</label><input type="password" id="pw-new" autocomplete="new-password">' +
      '<label>确认新密码</label><input type="password" id="pw-new2" autocomplete="new-password">' +
      '<div class="row" style="margin-top:14px">' +
        '<button class="btn" data-act="do-chg-pass">确认修改</button>' +
        '<button class="btn ghost" data-act="close-modal">取消</button>' +
      '</div></div>';
  $('#mask').hidden = false;
  setTimeout(() => { const o = $('#pw-old'); if (o) o.focus(); }, 50);
}

/* 页面内直接绑定的按钮 */
document.addEventListener('click', guard(async (e) => {
  const id = e.target.id;
  if (id === 'b-pub') {
    const links = $('#p-links').value.trim();
    if (!links) throw new Error('请粘贴至少一个链接');
    const payload = {
      action: 'create', title: $('#p-title').value.trim(),
      links, note: $('#p-note').value.trim(),
      board: ($('#p-board') || {}).value || 'zzy',
    };
    let r = await api('posts', payload);
    if (r.needConfirm) {
      const choice = await dupesModal(r.dupes || [], r.fresh);
      if (!choice) return;
      payload.force = true;
      payload.skipDupes = choice === 'skip';
      r = await api('posts', payload);
    }
    await refreshAll();
    const created = (r.created && r.created.length) || 0;
    const filled = (r.filled && r.filled.length) || 0;
    const skipList = r.skippedList || [];
    let msg = '已聚合发布：新建 ' + created + ' 批、补入 ' + filled + ' 批';
    if (skipList.length) {
      msg += '，剔除 ' + skipList.length + ' 条重复';
      showSkippedModal(skipList);
    }
    tip(msg, 'ok');
  }
  if (id === 'b-find') {
    const url = $('#f-url').value.trim();
    if (!url) throw new Error('请填写链接');
    const note = $('#f-note').value.trim();
    const res = await api('findings', { action: 'create', url, note });
    if (res.needConfirm) {
      const ex = res.exists || {};
      const msg = '⚠ 这条黑帖疑似已在黑水塘：\n标题：' + (ex.title || '（抓取失败）') +
        '\n所属公告：' + (ex.postTitle || '（未知）') + '\n发布者：' + (ex.by || '') +
        (ex.done ? '\n（该帖已在公告牌被标记完成）' : '') + '\n\n仍要提交发现吗？';
      if (!confirm(msg)) return;
      await api('findings', { action: 'create', url, note, force: true });
    }
    $('#f-url').value = ''; $('#f-note').value = '';
    await refreshAll();
    tip('已提交，管理员会收到提醒', 'ok');
  }
  if (id === 'b-msg') {
    const text = $('#m-text').value.trim();
    if (!text) throw new Error('留言不能为空');
    await api('messages', { action: 'create', text, parentId: '' });
    $('#m-text').value = '';
    await refreshAll();
    tip('留言已发布', 'ok');
  }
  if (id === 'b-adduser') {
    const nick = $('#u-nick').value.trim();
    const pass = $('#u-pass').value.trim();
    if (!nick || !pass) throw new Error('请填写昵称和密码');
    await api('admin', { action: 'createUser', nick, pass });
    $('#u-nick').value = ''; $('#u-pass').value = '';
    await refreshAll();
    tip('已新增执法者 ' + nick, 'ok');
  }
}));

/* 修改密码提交 */document.addEventListener('click', guard(async (e) => {
  if (e.target.dataset.act !== 'do-chg-pass') return;
  const oldPass = $('#pw-old').value;
  const newPass = $('#pw-new').value;
  if (!oldPass || !newPass) throw new Error('请填写旧密码和新密码');
  if (newPass !== $('#pw-new2').value) throw new Error('两次新密码不一致');
  if (newPass.length < 4) throw new Error('新密码至少 4 位');
  await api('auth', { action: 'changePass', oldPass, newPass });
  $('#mask').hidden = true;
  tip('密码已修改，下次登录请使用新密码', 'ok');
}));

$('#mask').addEventListener('click', (e) => { if (e.target.id === 'mask') $('#mask').hidden = true; });

boot();
