// ==UserScript==
// @name         净化阿北 · 投诉助手
// @namespace    https://github.com/kylinwu
// @version      2.6.4
// @description  豆瓣小组帖子一键批量投诉 v2.6.4 — 与「净化阿北」网站联动，从网站跳转过来自动导入链接与投诉理由并开始批量投诉
// @author       kylinwu💚爱妻
// @match        https://www.douban.com/group/topic/*
// @match        https://www.douban.com/group/*/topic/*
// @match        https://www.douban.com/doubanapp/dispatch*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /*
   * v2.4.0 —— 完整闭环交互引擎
   *
   * 【每轮完整闭环】（这是核心！不是在一个弹窗里连点多个选项）
   *   轮次N:
   *     ① 点"投诉"按钮          → span.report
   *     ② 等弹窗弹出            → .drc-modal-container.visible
   *     ③ 在弹窗中点一级选项    → .report-reason-item > .report-reason-item-hd
   *     ④ 等二级列表展开        → .report-reason-item.active > .report-reason-item-bd 可见
   *     ⑤ 点二级选项            → .report-reason-item-subs-item
   *     ⑥ 点"提交"              → footer button
   *     ⑦ 弹窗自动消失
   *   （轮次间等2s，然后回到①）
   *
   * 【真实DOM结构 — 来自开发者工具截图】
   *   投诉按钮: div#link-report_group > span.report("投诉")
   *   弹窗容器: div.drc-modal-container.visible > div.drc-modal.s
   *   一级列表: .report-layout-main.web > .report-reason-list > .report-reason-item
   *            └─ .report-reason-item-hd > span(文字)
   *   二级列表: .active .report-reason-item-bd > ul > li > .report-reason-item-subs-item
   *   提交按钮: .report-layout-footer.web > button("提交")
   *   关闭按钮: .drc-modal-close
   */

  var VERSION = '2.6.4';
  var AUTHOR = 'kylinwu💚爱妻';
  var stopFlag = false;

  // 延时配置（ms）—— 给足时间让豆瓣React渲染和动画完成
  var DELAY = {
    afterClickReport: 1200,    // 点投诉后等弹窗
    afterPickL1:      800,     // 点L1后等展开动画
    l1ExpandPoll:     250,     // 展开检测间隔
    l1ExpandMaxWait:  5000,    // 展开最大等待（加大！）
    afterPickL2:      500,     // 点L2后
    afterSubmit:      800,     // 提交后等弹窗关闭
    betweenRounds:    2500,    // 轮次间间隔
    dialogWait:       15000,   // 弹窗超时
  };

  // ===================== 投诉选项数据 =====================
  var OFFICIAL_REASONS = [
    { label: '引战',              sub: [] },
    { label: '广告',              sub: [] },
    { label: '影响评分公正性',    sub: [] },
    { label: '算法推荐类违规信息', sub: [] },
    { label: '水军养号',          sub: [] },
    { label: '网络暴力 / 网络戾气',
      sub: ['歧视偏见','泄露隐私','谩骂攻击','煽动性言论','开盒行为','我被网暴','其他网暴信息'] },
    { label: '政治相关',
      sub: ['政治制度','历史虚无','民族仇恨','分裂言论','煽动言论','其他政治有害信息'] },
    { label: '色情低俗',
      sub: ['低俗内容','色情作品','色情导流','色情交易','其他色情低俗信息'] },
    { label: '不实信息',
      sub: ['疫情类不实信息','科普类不实信息','社会谣言','时政谣言','虚假新闻','其他不实信息'] },
    { label: '辱骂攻击',         sub: ['侮辱谩骂','人身攻击'] },
    { label: '饭圈乱象',
      sub: ['涉未成年人','鼓动粉丝攀比','网络水军','干扰舆论','造谣爆料','挂人引战','内容来源不明'] },
    { label: '违法违规',
      sub: ['涉嫌欺诈','涉枪涉爆','毒品危险品','邪教相关','非法交易','恐怖血腥','赌博内容',
            '教唆犯罪','其他违法违规信息','封建迷信','非法外链'] },
    { label: '涉未成年人',
      sub: ['诱导不良行为','欺凌霸凌','儿童邪典','儿童色情','泄露隐私','其他涉未成年人有害信息'] },
    { label: '自媒体乱象',       sub: ['冒充机构媒体及特定职业','其他仿冒信息'] },
    { label: '涉重大赛事',
      sub: ['违规营销','造谣传谣','未经授权','假冒仿冒','其他不良信息'] },
    { label: 'AI 乱象',          sub: ['AI 造假','其他 AI 违规信息'] },
    { label: '侵犯我的权益',     sub: [] },
    { label: '其他',             sub: [] },
  ];

  var BUILTIN_PRESETS = [
    { name: '标准4连击（推荐）', rounds: [
      { r:'辱骂攻击', s:'侮辱谩骂' }, { r:'饭圈乱象', s:'挂人引战' },
      { r:'网络暴力 / 网络戾气', s:'谩骂攻击' }, { r:'涉未成年人', s:'诱导不良行为' },
    ]},
    { name: '色情+暴力4连击', rounds: [
      { r:'色情低俗', s:'低俗内容' }, { r:'网络暴力 / 网络戾气', s:'歧视偏见' },
      { r:'辱骂攻击', s:'人身攻击' }, { r:'饭圈乱象', s:'造谣爆料' },
    ]},
    { name: '引战专用3连击', rounds: [
      { r:'引战', s:'' }, { r:'饭圈乱象', s:'干扰舆论' }, { r:'辱骂攻击', s:'侮辱谩骂' },
    ]},
  ];

  // ===================== 样式 =====================
  GM_addStyle(`
    #kylin-panel{position:fixed;top:50px;right:8px;width:220px;background:#f0f7f0;
      border:2px solid #5a9a5a;border-radius:10px;box-shadow:0 3px 14px rgba(60,120,60,.2);
      z-index:99999;font-family:-apple-system,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;
      font-size:10.5px;color:#2a4a2a;user-select:none}
    #kylin-panel *{box-sizing:border-box}
    .kp-hd{background:#3a7a3a;color:#fff;padding:5px 8px;border-radius:8px 8px 0 0;
      display:flex;align-items:center;justify-content:space-between;cursor:move}
    .kp-hd .kp-title{font-size:11.5px;font-weight:bold;letter-spacing:.5px}
    .kp-hd .kp-meta{font-size:9px;opacity:.7}
    .kp-hd .kp-mini{background:rgba(255,255,255,.25);border:none;color:#fff;width:18px;height:18px;
      border-radius:50%;cursor:pointer;font-size:13px;line-height:18px;text-align:center;padding:0}
    .kp-bd{padding:6px 8px}
    .kp-sec{font-size:10px;font-weight:bold;color:#3a7a3a;margin:5px 0 3px;display:flex;align-items:center;gap:2px}
    .kp-sec::before{content:'';display:inline-block;width:2.5px;height:9px;background:#5aaa5a;border-radius:2px}
    .kp-badge{display:inline-block;padding:0 4px;border-radius:5px;font-size:9px;background:#c8e6c8;color:#2a5a2a;margin-left:2px}
    .kp-type-row{display:flex;gap:4px;margin-bottom:5px}
    .kp-type-btn{flex:1;padding:4px 0;border:1.5px solid #a5d6a7;background:#f8fff8;color:#2a4a2a;
      border-radius:4px;cursor:pointer;font-size:10px;text-align:center;transition:all .15s}
    .kp-type-btn.active{background:#4caf50;color:#fff;border-color:#388e3c}
    .kp-type-btn:hover:not(.active){background:#e8f5e9}
    .kp-select-wrap{display:flex;flex-direction:column;gap:3px;margin-bottom:4px}
    .kp-select-wrap select{width:100%;padding:4px 6px;border:1.5px solid #a5d6a7;border-radius:4px;
      background:#f8fff8;color:#2a4a2a;font-size:10px;outline:none;cursor:pointer;appearance:auto}
    .kp-select-wrap select:focus{border-color:#4caf50;box-shadow:0 0 0 2px rgba(76,175,80,.15)}
    .kp-round-list{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;padding:4px 6px;
      margin-bottom:5px;max-height:80px;overflow-y:auto}
    .kp-round-item{display:flex;align-items:center;justify-content:space-between;padding:2px 4px;
      background:#f1f8e9;border:1px solid #c5e1a5;border-radius:3px;margin-bottom:2px;font-size:9.5px;line-height:1.4}
    .kp-round-item:last-child{margin-bottom:0}
    .kp-round-item .kp-rm-btn{background:none;border:none;color:#c62828;cursor:pointer;font-size:12px;
      line-height:1;padding:0 1px}.kp-round-item .kp-rm-btn:hover{color:#b71c1c}
    .kp-round-empty{text-align:center;color:#81c784;font-size:9.5px;padding:6px 0}
    .kp-add-btn{width:100%;padding:4px 0;background:#66bb6a;color:#fff;border:none;border-radius:4px;
      font-size:10.5px;font-weight:bold;cursor:pointer;transition:all .15s;margin-bottom:2px}
    .kp-add-btn:hover{background:#43a047}
    .kp-go-btn{width:100%;padding:6px 0;background:#388e3c;color:#fff;border:none;border-radius:5px;
      font-size:11px;font-weight:bold;cursor:pointer;letter-spacing:.5px;transition:all .15s;margin-top:2px}
    .kp-go-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 2px 6px rgba(56,142,60,.3)}
    .kp-go-btn:disabled{opacity:.5;cursor:not-allowed}
    .kp-stop-btn{width:100%;padding:4px 0;background:#ef5350;color:#fff;border:none;border-radius:5px;
      font-size:10.5px;cursor:pointer;margin-top:2px;display:none}.kp-stop-btn:hover{background:#c62828}
    .kp-status{background:#e8f5e9;border:1px solid #a5d6a7;border-radius:4px;padding:3px 6px;
      font-size:9.5px;color:#2e7d32;margin-top:4px;min-height:18px;line-height:1.3}
    .kp-status.err{background:#ffebee;border-color:#ef9a9a;color:#c62828}
    .kp-status.ok{background:#e8f5e9;border-color:#81c784;color:#2e7d32}
    .kp-pg{height:3px;background:#c8e6c9;border-radius:2px;margin-top:3px;overflow:hidden}
    .kp-pg-bar{height:100%;background:#4caf50;border-radius:2px;transition:width .3s;width:0%}
    .kp-ft{text-align:center;font-size:8.5px;color:#81c784;padding:2px 0 5px}
    .kp-hr{border:none;border-top:1px dashed #c8e6c9;margin:5px 0}
    .kp-admin-chk{display:flex;align-items:center;gap:4px;background:#e8f5e9;padding:4px 6px;
      border:1px solid #a5d6a7;border-radius:4px;margin-bottom:5px;font-size:9.5px;cursor:pointer}
    .kp-admin-chk input[type=checkbox]{accent-color:#4caf50;width:12px;height:12px;cursor:pointer}
    #kylin-trig{position:fixed;top:50px;right:4px;width:32px;height:32px;
      background:#388e3c;color:#fff;border:none;border-radius:50%;font-size:14px;cursor:pointer;z-index:99998;
      box-shadow:0 2px 8px rgba(56,142,60,.4);display:none;line-height:32px;text-align:center}
    #kylin-trig:hover{transform:scale(1.1)}
    .kps{display:inline-block;width:9px;height:9px;border:2px solid #c8e6c9;border-top-color:#4caf50;
      border-radius:50%;animation:kspin .8s linear infinite;vertical-align:middle;margin-right:2px}
    @keyframes kspin{to{transform:rotate(360deg)}}
    /* ===== 设置弹窗 ===== */
    #ks-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);
      z-index:200000;display:flex;align-items:center;justify-content:center}
    #ks-dlg{width:380px;max-height:70vh;background:#f0f7f0;border:2px solid #5a9a5a;
      border-radius:12px;box-shadow:0 6px 30px rgba(60,120,60,.3);display:flex;flex-direction:column;overflow:hidden}
    .ks-hd{background:#3a7a3a;color:#fff;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;
      border-radius:10px 10px 0 0}
    .ks-hd .ks-title{font-size:14px;font-weight:bold}
    .ks-bd{padding:12px 14px;overflow-y:auto;flex:1}
    .ks-ft{padding:8px 14px;border-top:1px dashed #c8e6c9;display:flex;gap:6px;justify-content:flex-end}
    .ks-preset-card{background:#fff;border:1.5px solid #a5d6a7;border-radius:7px;padding:8px 10px;margin-bottom:6px}
    .ks-preset-card .ks-phd{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
    .ks-preset-card .ks-pname{font-weight:bold;color:#2a5a2a;font-size:12px}
    .ks-preset-card .ks-plist{font-size:11px;color:#558b55;line-height:1.5}
    .ks-btn{padding:4px 10px;border:1.5px solid #a5d6a7;background:#f8fff8;color:#2a4a2a;
      border-radius:5px;cursor:pointer;font-size:11.5px;transition:all .15s}
    .ks-btn:hover{background:#e8f5e9}
    .ks-btn.primary{background:#4caf50;color:#fff;border-color:#388e3c}.ks-btn.primary:hover{background:#43a047}
    .ks-btn.danger{background:#ef5350;color:#fff;border-color:#c62828}.ks-btn.danger:hover{background:#c62828}
    .ks-input{flex:1;padding:5px 8px;border:1.5px solid #a5d6a7;border-radius:5px;
      background:#fff;color:#2a4a2a;font-size:11.5px;outline:none}
    .ks-input:focus{border-color:#4caf50;box-shadow:0 0 0 2px rgba(76,175,80,.15)}
    .ks-new-row{display:flex;gap:5px;margin-bottom:8px;align-items:center}
    .ks-label{font-size:11px;color:#2a4a2a;white-space:nowrap;font-weight:bold}
    .ks-tip{font-size:10.5px;color:#81c784;margin-bottom:6px}
    /* ===== 批量链接（高亮） ===== */
    .kp-batch-tgl{display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10.5px;
      color:#1b5e20;background:linear-gradient(135deg,#c8e6c9,#a5d6a7);
      margin-bottom:4px;padding:5px 7px;border:1.5px solid #4caf50;border-radius:5px;
      transition:all .15s;font-weight:bold}
    .kp-batch-tgl:hover{background:linear-gradient(135deg,#a5d6a7,#81c784);
      box-shadow:0 1px 4px rgba(76,175,80,.25)}
    .kp-batch-tgl .kp-batch-arrow{color:#2e7d32;font-size:11px;transition:transform .2s;display:inline-block}
    .kp-batch-area{display:none;margin-bottom:5px}
    .kp-batch-area.show{display:block}
    .kp-batch-ta{width:100%;height:65px;padding:5px 7px;border:1.5px solid #4caf50;border-radius:4px;
      background:#faffff;color:#2a4a2a;font-size:10px;resize:vertical;outline:none;font-family:monospace}
    .kp-batch-ta:focus{border-color:#388e3c;box-shadow:0 0 0 2px rgba(56,142,60,.15)}
    .kp-batch-ta::placeholder{color:#81c784}
    .kp-batch-info{font-size:9.5px;color:#2e7d32;margin-top:2px;font-weight:bold}
  `);

  // ===================== 工具函数 =====================
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function log(msg, type) {
    var el = document.getElementById('kp-st');
    if (!el) return;
    el.className = 'kp-status ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
    el.innerHTML = msg;
  }

  function setProgress(pct) {
    var el = document.getElementById('kp-pgb');
    if (el) el.style.width = pct + '%';
  }

  /**
   * 【v2.4 核心】模拟真人点击 —— 完整的鼠标事件序列
   *
   * 豆瓣前端大概率使用 React/Vue，它们的合成事件系统需要完整的原生事件序列：
   *   mousedown → mouseup → click
   * 单独调用 .click() 或 dispatchEvent(click) 往往无法触发。
   */
  function simulateRealClick(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    // 如果元素不可见或尺寸为0，尝试用父元素
    var target = el;
    if (rect.width === 0 || rect.height === 0) {
      target = el.parentElement || el;
      rect = target.getBoundingClientRect();
    }
    var cx = Math.round(rect.left + rect.width / 2);
    var cy = Math.round(rect.top + rect.height / 2);

    // 注意：油猴沙箱的 window 不是真正 Window，必须用 unsafeWindow 或省略 view
    var realWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
    var opts = { view: realWin, bubbles: true, cancelable: true, clientX: cx, clientY: cy,
                 button: 0, buttons: 1 };

    try {
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
    } catch(e) {
      // fallback: 不传 view，让浏览器自动填充
      console.warn('[豆瓣投诉] MouseEvent fallback:', e.message);
      var simpleOpts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
      target.dispatchEvent(new MouseEvent('mousedown', simpleOpts));
      target.dispatchEvent(new MouseEvent('mouseup', simpleOpts));
      target.dispatchEvent(new MouseEvent('click', simpleOpts));
    }

    console.log('[豆瓣投诉] 🔘 simulateRealClick:', target.tagName, target.className,
      '@(' + cx + ',' + cy + ') size=' + Math.round(rect.width) + 'x' + Math.round(rect.height));
    return true;
  }

  /**
   * 定位投诉按钮: div#link-report_group > span.report("投诉")
   */
  function getReportBtn() {
    var spans = document.querySelectorAll('span.report');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent.trim() === '投诉') {
        console.log('[豆瓣投诉✓] 找到投诉按钮: span.report');
        return spans[i];
      }
    }
    var group = document.querySelector('#link-report_group');
    if (group) {
      var inner = group.querySelector('.report, [class*="report"]');
      if (inner) return inner;
      return group;
    }
    console.warn('[豆瓣投诉✗] 未找到任何投诉按钮');
    return null;
  }

  // ===================== 核心交互引擎 v2.4 =====================

  /**
   * Step ②: 等待弹窗出现
   */
  async function waitForDialog(timeout) {
    timeout = timeout || DELAY.dialogWait;
    var start = Date.now();
    while (Date.now() - start < timeout) {
      var c = document.querySelector('.drc-modal-container.visible');
      if (c) {
        var d = c.querySelector('.drc-modal.s');
        if (d && d.offsetHeight > 0) {
          console.log('[豆瓣投诉✓] 弹窗已弹出');
          return c;
        }
      }
      var alt = document.querySelector('[class*="drc-modal"][class*="visible"]');
      if (alt && alt.offsetHeight > 0) return alt;
      await sleep(300);
    }
    return null;
  }

  /**
   * Step ③: 选择一级分类
   *
   * 关键改进：使用 simulateRealClick() 触发完整鼠标事件序列
   */
  /* v2.6.2: 弹窗一级区域查找（多级兜底，兼容豆瓣改版） */
  function getMainArea(dlgContainer) {
    var sels = ['.report-layout-main.web', '.report-layout-main', '[class*="report-layout-main"]'];
    for (var i = 0; i < sels.length; i++) {
      var el = dlgContainer.querySelector(sels[i]);
      if (el) return el;
    }
    // 兜底A：弹窗容器里直接找一级选项，用其父级当 mainArea
    var item = dlgContainer.querySelector('.report-reason-item');
    if (item && item.parentElement) return item.parentElement;
    // 兜底B：全文档找（个别弹窗不在 dlgContainer 内）
    for (var j = 0; j < sels.length; j++) {
      var el2 = document.querySelector(sels[j]);
      if (el2 && el2.offsetHeight > 0) return el2;
    }
    var item2 = document.querySelector('.report-reason-item');
    if (item2 && item2.offsetHeight > 0 && item2.parentElement) return item2.parentElement;
    return null;
  }

  async function pickL1(dlgContainer, categoryName) {
    log('<span class="kps"></span> ➂ 选L1：「' + categoryName + '」');

    var mainArea = getMainArea(dlgContainer);
    if (!mainArea) {
      log('✗ 找不到投诉弹窗一级区域', 'err');
      console.error('[豆瓣投诉✗] 无mainArea, dlg HTML:',
        dlgContainer.innerHTML ? dlgContainer.innerHTML.substring(0, 800) : 'null');
      return false;
    }

    var items = mainArea.querySelectorAll('.report-reason-item');
    console.log('[豆瓣投诉] 一级选项数量:', items.length);

    var found = null;
    for (var i = 0; i < items.length; i++) {
      var hd = items[i].querySelector('.report-reason-item-hd');
      if (!hd) continue;

      // 取hd内所有非图标span的文字
      var spans = hd.querySelectorAll('span');
      var txt = '';
      for (var j = 0; j < spans.length; j++) {
        if (spans[j].classList.contains('report-reason-item-right-icon')) continue;
        if (spans[j].classList.contains('report-reason-item-icon')) continue;
        txt += spans[j].textContent.trim();
      }

      console.log('[豆瓣投诉] L1[' + i + ']="' + txt + '"');

      // 匹配策略：包含匹配 || 反向包含 || 去空格全等
      if (txt.indexOf(categoryName) >= 0 ||
          categoryName.indexOf(txt) >= 0 ||
          txt.replace(/[\s/]/g, '') === categoryName.replace(/[\s/]/g, '')) {
        found = items[i];
        console.log('[豆瓣投诉✓] L1匹配成功: "' + txt + '" ↔ "' + categoryName + '"');
        break;
      }
    }

    // 兜底：全文搜索
    if (!found) {
      for (var k = 0; k < items.length; k++) {
        if (items[k].textContent.indexOf(categoryName) >= 0) {
          found = items[k];
          console.log('[豆瓣投诉✓] L1全文兜底匹配');
          break;
        }
      }
    }

    if (!found) {
      log('✗ L1未找到「' + categoryName + '」', 'err');
      var labels = [];
      for (var m = 0; m < items.length; m++) labels.push(items[m].textContent.trim().substring(0, 25));
      console.warn('[豆瓣投诉] 可选L1:', labels.join(' | '));
      return false;
    }

    // 【核心】点击 .report-reason-item-hd（头部区域），而不是整个item
    var clickTarget = found.querySelector('.report-reason-item-hd') || found;
    console.log('[豆瓣投诉] 点击目标:', clickTarget.className);
    simulateRealClick(clickTarget);

    // 保存引用供后续pickL2使用
    window.__kp_lastL1Item = found;

    return true;
  }

  /**
   * Step ④+⑤: 等一级展开 → 选择二级子项（v2.4.1 增强版）
   *
   * 二级选项的真实DOM结构（开发者工具确认）：
   *   .report-reason-item-bd
   *     ul.report-reason-item-subs-list
   *       li
   *         .report-reason-item-subs-item  ← 文字在这里
   */
  async function pickL2(dlgContainer, subName) {
    log('<span class="kps"></span> ➃ 等待L1展开…');

    var mainArea = getMainArea(dlgContainer);

    // ---- 轮询等待二级区域出现 ----
    var bd = null;
    var waited = 0;
    while (waited < DELAY.l1ExpandMaxWait) {
      // 优先用刚才点的那个L1项
      var lastL1 = window.__kp_lastL1Item;
      if (lastL1) {
        bd = lastL1.querySelector(':scope > .report-reason-item-bd')
           || lastL1.querySelector('.report-reason-item-bd');
        if (bd && bd.offsetHeight > 0) {
          console.log('[豆瓣投诉✓] 通过__kp_lastL1Item找到BD');
          break;
        }
      }

      // 备用1: .active项
      var activeEl = mainArea ? mainArea.querySelector('.report-reason-item.active') : null;
      if (activeEl) {
        bd = activeEl.querySelector('.report-reason-item-bd');
        if (bd && bd.offsetHeight > 0) {
          console.log('[豆瓣投诉✓] 通过.active找到BD');
          break;
        }
      }

      // 备用2: 任何可见的bd
      var anyBd = mainArea ? mainArea.querySelector('.report-reason-item-bd') : null;
      if (anyBd && anyBd.offsetHeight > 0) {
        bd = anyBd;
        console.log('[豆瓣投诉✓] 通过任意可见BD');
        break;
      }

      if (waited % 1000 < 250) {
        console.log('[豆瓣投诉] L1展开等待中... ' + (waited / 1000).toFixed(1) + 's',
          'active=', !!activeEl, 'bdVisible=', !!(anyBd && anyBd.offsetHeight > 0));
      }

      await sleep(DELAY.l1ExpandPoll);
      waited += DELAY.l1ExpandPoll;
    }

    if (!bd || bd.offsetHeight <= 0) {
      log('⚠️ L1未展开（无二级区），跳过L2选择直接提交', 'err');
      console.warn('[豆瓣投诉✗] BD未出现，已等待' + (waited / 1000) + 's');
      return false;
    }

    log('<span class="kps"></span> ➄ 选L2：「' + subName + '」');

    // 额外等待确保二级列表完全渲染
    await sleep(500);

    // ---- 查找二级选项（多种策略）----
    // 策略A: .report-reason-item-subs-item（已知精确选择器）
    var subs = bd.querySelectorAll('.report-reason-item-subs-item');
    console.log('[豆瓣投诉] L2策略A(.subs-item)候选:', subs.length);

    // 策略B: 如果A没结果，扩大范围
    if (!subs || subs.length === 0) {
      subs = bd.querySelectorAll('li, [class*="subs"], [class*="sub-item"], div');
      console.log('[豆瓣投诉] L2策略B(li/div)候选:', subs.length);
    }

    var targetSub = null;
    var allTexts = [];
    for (var n = 0; n < subs.length; n++) {
      var st = subs[n].textContent.trim();
      allTexts.push(st.substring(0, 20));
      // 精确匹配或包含匹配
      if (st === subName || st.indexOf(subName) >= 0 || subName.indexOf(st) >= 0) {
        targetSub = subs[n];
        console.log('[豆瓣投诉✓] L2匹配: "' + st + '" class=' + subs[n].className);
        break;
      }
    }

    if (!targetSub) {
      log('✗ L2未找到「' + subName + '」', 'err');
      console.warn('[豆瓣投诉] 可选L2列表:', allTexts.join(' | '));
      return false;
    }

    // ---- 点击L2：多层级尝试 ----
    // 尝试顺序：自身 → parentElement(li) → 第一个可点击的子元素
    var clickCandidates = [
      targetSub,
      targetSub.parentElement,  // 可能是 li 标签，事件绑定在li上
      targetSub.querySelector('span'),
      targetSub.closest('li')
    ];

    var clicked = false;
    for (var ci = 0; ci < clickCandidates.length; ci++) {
      var candidate = clickCandidates[ci];
      if (!candidate) continue;

      console.log('[豆瓣投诉] L2尝试点击[' + ci + ']:' +
        candidate.tagName + '.' + candidate.className);

      simulateRealClick(candidate);
      await sleep(300); // 等待看是否有选中效果

      // 检查是否被选中了——通过检查是否有 .selected / .active / checked 等
      // 或者检查父级ul中是否有被标记的项
      var selectedSub = bd.querySelector('.selected, .active, [class*="checked"], [class*="chosen"]');
      if (selectedSub) {
        console.log('[豆瓣投诉✓] L2点击成功！检测到选中状态:', selectedSub.textContent.trim());
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      // 即使没检测到选中状态，也算尝试过了
      console.log('[豆瓣投诉] L2点击已执行（无法验证是否选中）');
    }

    await sleep(DELAY.afterPickL2);
    return true;
  }

  /**
   * Step ⑥: 点击提交按钮
   */
  async function clickSubmitBtn(dlgContainer) {
    log('<span class="kps"></span> ➅ 提交…');

    var footer = dlgContainer.querySelector('.report-layout-footer.web')
               || dlgContainer.querySelector('.report-layout-footer');

    if (footer) {
      var btn = footer.querySelector('button');
      if (btn) {
        console.log('[豆瓣投诉✓] 提交按钮: "' + btn.textContent.trim() + '"');
        simulateRealClick(btn);
        await sleep(DELAY.afterSubmit);
        return true;
      }
    }

    // 兜底搜索
    var allBtns = dlgContainer.querySelectorAll('button');
    for (var i = 0; i < allBtns.length; i++) {
      var t = allBtns[i].textContent.trim();
      if (t === '提交' || t.indexOf('提交') >= 0) {
        console.log('[豆瓣投诉✓] 提交(兜底):', t);
        simulateRealClick(allBtns[i]);
        await sleep(DELAY.afterSubmit);
        return true;
      }
    }

    log('⚠️ 未找到提交按钮', 'err');
    return false;
  }

  /**
   * 强制关闭弹窗（保险措施）
   */
  async function forceClose(container) {
    await sleep(400);
    if (!container) return;

    var closeBtn = container.querySelector('.drc-modal-close');
    if (closeBtn && closeBtn.offsetParent !== null) {
      simulateRealClick(closeBtn);
      await sleep(400);
      return;
    }

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', keyCode: 27, bubbles: true, cancelable: true
    }));
    await sleep(300);

    if (container.classList.contains('visible')) {
      container.classList.remove('visible');
    }
  }

  /* ===================== v2.6.3 辅助：删除页检测 / 回报 / 提交验证 ===================== */

  /** 检测当前页是否为"帖子已被删除/不存在" */
  function isDeletedPage() {
    var t = '';
    try { t = (document.body && document.body.innerText) || ''; } catch (e) { t = ''; }
    t = t.slice(0, 3000);
    return /该内容已被删除|此内容已被删除|已被管理员删除|内容已被删除|帖子已被删除|该话题已被删除|主题不存在|内容不存在|页面不存在|你访问的页面飘走了/.test(t);
  }

  /** 回报黑水塘：这条链接已被删除（带导入时的 token/postId/linkId） */
  function reportDeadToBlackPool() {
    var ctx;
    try { ctx = JSON.parse(GM_getValue('kp_report_ctx', '{}')); } catch (e) { ctx = {}; }
    if (!ctx.token || !ctx.postId || !ctx.api) { console.log('[豆瓣投诉] 无回报上下文，跳过回报'); return; }
    var idx = parseInt(GM_getValue('kp_batch_index', 0));
    var linkId = (ctx.linkIds || [])[idx] || '';
    if (!linkId) { console.log('[豆瓣投诉] 无 linkId，跳过回报'); return; }
    try {
      fetch(ctx.api + '/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': ctx.token },
        body: JSON.stringify({ action: 'reportDead', id: ctx.postId, linkId: linkId }),
      }).then(function (res) { return res.json(); }).then(function (d) {
        console.log('[豆瓣投诉] 已回报黑水塘（此条已被删除）:', d && d.error ? d.error : 'ok');
      }).catch(function (e) { console.warn('[豆瓣投诉] 回报失败:', e); });
    } catch (e) { console.warn('[豆瓣投诉] 回报异常:', e); }
  }

  /**
   * 提交后验证：等弹窗关闭 / 识别豆瓣提示。
   * 之前无验证，弹窗报错也当成功，用户收不到豆邮以为投诉失败——现在如实报告。
   */
  async function verifySubmitted() {
    var start = Date.now();
    while (Date.now() - start < 6000) {
      var c = document.querySelector('.drc-modal-container.visible');
      var vis = c && c.offsetHeight > 0;
      if (!vis) { console.log('[豆瓣投诉✓] 弹窗已关闭（提交生效）'); return true; }
      // 扫提示条文字（范围限提示类元素，避免误判正文）
      var tips = document.querySelectorAll('[class*="drc-toast"],[class*="toast"],[class*="drc-msg"],[class*="drc-message"],[class*="notifier"]');
      var txt = '';
      for (var i = 0; i < tips.length; i++) txt += tips[i].textContent || '';
      if (/已投诉|重复投诉|已经投诉/.test(txt)) {
        log('ℹ️ 豆瓣提示已投诉过（重复投诉不再受理、不再发豆邮）');
        console.log('[豆瓣投诉] 重复投诉提示:', txt.trim().slice(0, 60));
        return true;
      }
      if (/投诉成功|提交成功|已提交/.test(txt)) { console.log('[豆瓣投诉✓] 成功提示:', txt.trim().slice(0, 40)); return true; }
      await sleep(400);
    }
    log('⚠️ 弹窗未关闭——提交可能未生效（检查是否漏选理由/二级项，或豆瓣报了错）', 'err');
    return false;
  }

  // ===================== 单轮完整闭环 =====================

  /**
   * 【核心函数】执行一轮完整的投诉闭环
   *
   *  ① 点投诉按钮  →  ② 等弹窗  →  ③ 选L1
   *  →  ④ 等L1展开  →  ⑤ 选L2  →  ⑥ 提交  →  ⑦ 弹窗关闭
   */
  async function doOneRound(reportSpan, roundInfo) {

    // ===== ① 点击投诉按钮 =====
    log('<span class="kps"></span> ➊ 📍 点「投诉」…');
    simulateRealClick(reportSpan);
    await sleep(DELAY.afterClickReport);

    // ===== ② 等弹窗弹出 =====
    log('<span class="kps"></span> ⏳ 等弹窗…');
    var dlg = await waitForDialog();
    if (!dlg) {
      log('✗ 弹窗未弹出！（超时' + (DELAY.dialogWait/1000) + 's）', 'err');
      return false;
    }
    console.log('[豆瓣投诉✓] ========== 第' + (roundInfo._idx+1) + '轮弹窗就绪 ==========');

    try {
      // ---- 管理员路径 ----
      if (roundInfo.isAdmin) {
        log('📋 管理员路径');
        await pickL1(dlg, '发布与本组主题无关的内容');
        await clickSubmitBtn(dlg);
        return await verifySubmitted();
      }

      // ---- ③ 选一级分类 ----
      var okL1 = await pickL1(dlg, roundInfo.r);
      if (!okL1) {
        await forceClose(dlg);
        return false;
      }

      // 等 L1 展开
      await sleep(DELAY.afterPickL1);

      // ---- ④+⑤ 选二级子项（如有）----
      if (roundInfo.s) {
        var okL2 = await pickL2(dlg, roundInfo.s);
        if (okL2) {
          await sleep(DELAY.afterPickL2);
        } else {
          log('⚠️ L2失败，继续尝试提交', 'err');
        }
      }

      // ---- ⑥ 提交 + 验证（v2.6.3：弹窗关闭/豆瓣提示才算成功，不再盲报） ----
      await clickSubmitBtn(dlg);
      var verified = await verifySubmitted();

      console.log('[豆瓣投诉✓] ========== 第' + (roundInfo._idx+1) + '轮' + (verified ? '完成' : '疑似未生效') + ' ==========');
      return verified;

    } catch(e) {
      console.error('[豆瓣投诉✗] 异常:', e.stack || e.message);
      log('✗ 异常: ' + e.message, 'err');
      await forceClose(dlg);
      return false;
    }
  }

  // ===================== 预设管理 =====================
  function getAllPresets() {
    try { return BUILTIN_PRESETS.concat(JSON.parse(GM_getValue('kylin_custom_presets', '[]'))); }
    catch(e) { return BUILTIN_PRESETS.slice(); }
  }
  function saveCustomPresets(list) { GM_setValue('kylin_custom_presets', JSON.stringify(list)); }

  function openSettings() {
    if (document.getElementById('ks-overlay')) return;
    var customList;
    try { customList = JSON.parse(GM_getValue('kylin_custom_presets', '[]')); } catch(e) { customList = []; }

    var ov = document.createElement('div');
    ov.id = 'ks-overlay';
    ov.innerHTML =
      '<div id="ks-dlg"><div class="ks-hd"><span class="ks-title">快捷预设管理</span>' +
        '<button class="ks-btn danger" id="ks-close">&times;</button></div>' +
        '<div class="ks-bd">' +
          '<div class="ks-tip">先在主面板选好轮次队列，然后保存为新预设方案。</div>' +
          '<div style="background:#fff;border:1.5px solid #a5d6a7;border-radius:8px;padding:10px 12px;margin-bottom:10px">' +
            '<div style="font-size:12px;font-weight:bold;color:#3a7a3a;margin-bottom:6px">新增预设</div>' +
            '<div class="ks-new-row"><span class="ks-label">名称：</span>' +
              '<input class="ks-input" id="ks-new-name" placeholder="例：我的5连击"></div>' +
            '<button class="ks-btn primary" id="ks-save-q">从当前队列保存</button></div>' +
          '<div style="font-size:12px;font-weight:bold;color:#3a7a3a;margin:10px 0 6px">内置预设（只读）</div>' +
          '<div id="ks-builtin">' + renderCards(BUILTIN_PRESETS, true) + '</div>' +
          '<div style="font-size:12px;font-weight:bold;color:#3a7a3a;margin:10px 0 6px">我的预设</div>' +
          '<div id="ks-custom">' + (customList.length ? renderCards(customList, false) :
            '<div style="color:#81c784;font-size:12px;padding:10px;text-align:center">暂无</div>') + '</div></div>' +
        '<div class="ks-ft"><button class="ks-btn primary" id="ks-done">完成</button></div></div>';

    document.body.appendChild(ov);
    ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
    document.getElementById('ks-close').onclick = function() { ov.remove(); };
    document.getElementById('ks-done').onclick = function() { ov.remove(); };
    document.getElementById('ks-save-q').onclick = function() {
      var name = document.getElementById('ks-new-name').value.trim();
      if (!name) { alert('输入名称'); return; }
      if (!queue.length) { alert('队列为空'); return; }
      customList.push({ name: name, rounds: queue.map(function(q) { return {r:q.r,s:q.s}; }) });
      saveCustomPresets(customList);
      document.getElementById('ks-custom').innerHTML = renderCards(customList, false);
      document.getElementById('ks-new-name').value = '';
      log('已保存预设「' + name + '」', 'ok');
    };
    document.getElementById('ks-custom').addEventListener('click', function(e) {
      if (e.target.classList.contains('ks-del')) {
        var idx = parseInt(e.target.dataset.idx);
        if (!isNaN(idx) && confirm('删除？')) {
          customList.splice(idx, 1);
          saveCustomPresets(customList);
          e.target.closest('.ks-preset-card').remove();
          if (!customList.length) document.getElementById('ks-custom').innerHTML =
            '<div style="color:#81c784;font-size:12px;padding:10px;text-align:center">暂无</div>';
        }
      }
    });
  }

  function renderCards(list, readonly) {
    var h = '';
    for (var i = 0; i < list.length; i++) {
      h += '<div class="ks-preset-card"><div class="ks-phd">';
      h += '<span class="ks-pname">' + escHtml(list[i].name) + '</span>';
      if (!readonly) h += '<button class="ks-btn danger ks-del" data-idx="'+i+'">删除</button>';
      h += '</div><div class="ks-plist">';
      h += list[i].rounds.map(function(r){return r.r+(r.s?'→'+r.s:'');}).join(' | ');
      h += '</div></div>';
    }
    return h;
  }
  function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ===================== 主面板构建 =====================
  function buildPanel(batchMode) {
    var panel = document.createElement('div'); panel.id = 'kylin-panel';
    var pres = getAllPresets();

    var batchHtml = '';
    if (batchMode) {
      // 批量模式：显示精简状态面板
      batchHtml =
        '<div class="kp-sec">📋 批量执行中</div>' +
        '<div class="kp-batch-info" id="kp-batch-status" style="font-size:11px;margin-bottom:6px">' +
          '加载任务…</div>' +
        '<div class="kp-pg" style="margin-bottom:4px"><div class="kp-pg-bar" id="kp-pgb"></div></div>';
    } else {
      // 正常模式
      batchHtml =
        // 快捷方案栏
        '<div style="display:flex;gap:5px;align-items:center;margin-bottom:6px">' +
          '<select id="kp-presets" style="flex:1;padding:5px 6px;border:1.5px solid #a5d6a7;' +
            'border-radius:5px;background:#f8fff8;color:#2a4a2a;font-size:11px;appearance:auto">' +
            '<option value="">快捷方案▼</option>' +
            pres.map(function(p){return '<option>'+escHtml(p.name)+'</option>';}).join('')+'</select></div>' +
        // 选择投诉理由
        '<div class="kp-sec">投诉理由 <span class="kp-badge">可多轮</span></div>' +
        '<div class="kp-select-wrap">' +
          '<select id="kp-s1"><option>-- 一级分类 --</option>' +
            OFFICIAL_REASONS.map(function(r){return '<option>'+escHtml(r.label)+'</option>';}).join('')+'</select>' +
          '<select id="kp-s2" disabled><option>-- 二级子项 --</option></select>' +
          '<button class="kp-add-btn" id="kp-add">＋添加本轮</button></div>' +
        // 队列列表
        '<div class="kp-sec">队列 <span class="kp-badge" id="kp-count">0轮</span></div>' +
        '<div class="kp-round-list" id="kp-list"><div class="kp-round-empty">未添加</div></div>' +
        // 批量链接（可折叠，高亮）
        '<div class="kp-batch-tgl" id="kp-batch-tgl">' +
          '<span class="kp-batch-arrow" id="kp-batch-arrow">▶</span> 📋 批量链接 — 粘贴多个帖子URL自动逐个执行</div>' +
        '<div class="kp-batch-area" id="kp-batch-area">' +
          '<textarea class="kp-batch-ta" id="kp-batch-ta" ' +
            'placeholder="每行一个链接，支持任意格式:&#10;https://www.douban.com/group/topic/123/&#10;https://www.douban.com/doubanapp/dispatch?uri=...&#10;http://mf.ens5.cn/UW86gf9U&#10;492400126（纯数字ID也行）"></textarea>' +
          '<div class="kp-batch-info" id="kp-batch-info">已识别 <b>0</b> 条链接</div>' +
        '</div>' +
        // 操作按钮
        '<button class="kp-go-btn" id="kp-go">▶ 一键投诉（本页）</button>' +
        '<button class="kp-go-btn" id="kp-go-batch" style="background:#2e7d32;margin-top:3px;display:none">▶▶ 批量投诉（全部链接）</button>';
    }

    panel.innerHTML =
      '<div class="kp-hd" id="kp-drag"><div><div class="kp-title">' +
        (batchMode ? '📋 批量投诉' : '一键投诉工具') + '</div>' +
        '<div class="kp-meta">v'+VERSION+' · '+AUTHOR+'</div></div>' +
        (batchMode ? '' : '<button class="kp-mini" title="最小化">–</button>') +
        '</div>' +
      '<div class="kp-bd" id="kp-body">' +
        // 非批量才显示页面类型
        (batchMode ? '' :
        '<div class="kp-sec">页面类型</div><div class="kp-type-row">' +
          '<button class="kp-type-btn active" id="kp-t-in">组内</button>' +
          '<button class="kp-type-btn" id="kp-t-out">组外</button></div>' +
        '<label class="kp-admin-chk"><input type="checkbox" id="kp-adm-cb">' +
          '<span>提交管理员（仅组内）</span></label>' +
        '<div class="kp-hr"></div>') +
        batchHtml +
        '<button class="kp-stop-btn" id="kp-stop">■ 停止</button>' +
        '<div class="kp-status" id="kp-st">' + (batchMode ? '准备执行…' : '就绪') + '</div>' +
        (batchMode ? '' : '<div class="kp-pg"><div class="kp-pg-bar" id="kp-pgb"></div></div>') +
        '<div style="font-size:10px;color:#7a8b7a;margin:4px 2px 0;line-height:1.5">📮 没收到豆邮不代表失败：豆瓣不保证每次投诉都发信，重复投诉尤其可能没有。成功与否以本面板日志和页面提示为准。</div>' +
        '<div class="kp-ft">合理使用 · 请勿滥用</div></div>';

    document.body.appendChild(panel);

    var trig = document.createElement('button');
    trig.id = 'kylin-trig'; trig.title = '打开面板'; trig.textContent = '🚩';
    document.body.appendChild(trig);

    if (batchMode) {
      trig.style.display = 'none';
      panel.style.display = '';
    }

    bindEvents(panel, trig, batchMode);
  }

  function bindEvents(panel, trig, batchMode) {
    // 停止按钮（所有模式都有）
    var stopBtn = document.getElementById('kp-stop');
    if (stopBtn) stopBtn.onclick = function() { stopFlag = true; log('已请求停止'); };

    if (!batchMode) {
      // ===== 事件委托：队列 × 删除按钮（仅正常模式） =====
      var kpList = document.getElementById('kp-list');
      if (kpList) kpList.addEventListener('click', function(e) {
      if (e.target.classList.contains('kp-rm-btn')) {
        var idx = parseInt(e.target.dataset.idx);
        if (idx === -1) {
          var cb = document.getElementById('kp-adm-cb'); cb.checked = false; renderQ();
        } else if (!isNaN(idx)) {
          removeRound(idx);
        }
      }
    }); // end kp-list event delegation

    // ===== 正常模式专属事件绑定 =====
    document.querySelector('#kp-drag .kp-mini').onclick = function() {
        document.getElementById('kp-body').style.display = 'none'; panel.style.display = 'none'; trig.style.display = '';
      };
      trig.onclick = function() {
        panel.style.display = ''; document.getElementById('kp-body').style.display = ''; trig.style.display = 'none';
      };
      drag(panel, document.getElementById('kp-drag'));

      document.getElementById('kp-t-in').onclick = function() {
        this.classList.add('active'); document.getElementById('kp-t-out').classList.remove('active');
        document.getElementById('kp-adm-cb').parentElement.style.display = '';
      };
      document.getElementById('kp-t-out').onclick = function() {
        this.classList.add('active'); document.getElementById('kp-t-in').classList.remove('active');
        document.getElementById('kp-adm-cb').parentElement.style.display = 'none';
      };

      document.getElementById('kp-s1').onchange = function() {
        var v = this.value, s2 = document.getElementById('kp-s2');
        if (!v) { s2.disabled = true; s2.innerHTML = '<option>-- 先选一级 --</option>'; return; }
        var item = null;
        for (var i = 0; i < OFFICIAL_REASONS.length; i++) {
          if (OFFICIAL_REASONS[i].label === v) { item = OFFICIAL_REASONS[i]; break; }
        }
        if (item && item.sub.length) {
          s2.disabled = false;
          s2.innerHTML = '<option>-- 选子项 --</option>' +
            item.sub.map(function(s){return '<option>'+escHtml(s)+'</option>';}).join('');
        } else {
          s2.disabled = true; s2.innerHTML = '<option>无子项</option>';
        }
      };

      document.getElementById('kp-add').onclick = addRound;

      document.getElementById('kp-presets').onchange = function() {
        var n = this.value; if (!n) return;
        var all = getAllPresets(), p = null;
        for (var i = 0; i < all.length; i++) { if (all[i].name === n) p = all[i]; }
        if (!p) return; clearQueue();
        for (var j = 0; j < p.rounds.length; j++) pushRound(p.rounds[j].r, p.rounds[j].s);
        this.value = '';
      };

      // 批量链接折叠
      document.getElementById('kp-batch-tgl').onclick = function() {
        var area = document.getElementById('kp-batch-area');
        var arrow = document.getElementById('kp-batch-arrow');
        var goBatch = document.getElementById('kp-go-batch');
        area.classList.toggle('show');
        if (arrow) {
          arrow.textContent = area.classList.contains('show') ? '▼' : '▶';
          arrow.style.transform = area.classList.contains('show') ? 'rotate(0)' : '';
        }
        // 显示/隐藏批量按钮
        if (goBatch) goBatch.style.display = area.classList.contains('show') ? '' : 'none';
      };

      // 批量链接输入检测
      var batchTa = document.getElementById('kp-batch-ta');
      if (batchTa) {
        batchTa.oninput = function() {
          var parsed = parseLinks(this.value);
          var info = document.getElementById('kp-batch-info');
          var goBatch = document.getElementById('kp-go-batch');
          if (info) info.innerHTML = '已识别 <b>' + parsed.length + '</b> 条链接';
          if (goBatch) goBatch.style.display = parsed.length > 0 ? '' : 'none';
        };
      }

      // 批量执行按钮
      var batchBtn = document.getElementById('kp-go-batch');
      if (batchBtn) batchBtn.onclick = startBatch;

      document.getElementById('kp-go').onclick = goRun;
    } // end if(!batchMode)
  }

  // ===================== 队列 =====================
  var queue = [];

  function addRound() {
    var r = document.getElementById('kp-s1').value;
    var s2 = document.getElementById('kp-s2'), s = s2.disabled ? '' : s2.value;
    if (!r) { log('先选一级分类', 'err'); return; }
    if (!s2.disabled && !s) { log('选二级子项', 'err'); return; }
    for (var i = 0; i < queue.length; i++)
      if (queue[i].r === r && queue[i].s === s) { log('重复了', 'err'); return; }
    pushRound(r, s);
    log('已添加「' + r + (s ? '→'+s : '') + '」');
  }

  function pushRound(r, s) { queue.push({ r:r, s:s }); renderQ(); }
  function removeRound(i) { queue.splice(i, 1); renderQ(); }
  function clearQueue() { queue = []; renderQ(); }

  function renderQ() {
    var el = document.getElementById('kp-list');
    var doAdmin = document.getElementById('kp-adm-cb').checked;
    var total = (doAdmin?1:0) + queue.length;
    document.getElementById('kp-count').textContent = total+'轮';

    if (!total) { el.innerHTML = '<div class="kp-round-empty">未添加</div>'; return; }
    var h = '';
    if (doAdmin) h += '<div class="kp-round-item" data-idx="-1"><span>管理员「无关内容」</span>' +
      '<button class="kp-rm-btn" data-idx="-1">×</button></div>';
    for (var i = 0; i < queue.length; i++)
      h += '<div class="kp-round-item" data-idx="'+i+'"><span>'+(i+1)+'. '+queue[i].r+(queue[i].s?'→'+queue[i].s:'')+'</span>' +
        '<button class="kp-rm-btn" data-idx="'+i+'">×</button></div>';
    el.innerHTML = h;
  }
  // ===================== 执行入口 =====================
  async function goRun() {
    stopFlag = false;
    var goBtn = document.getElementById('kp-go'), stopBtn = document.getElementById('kp-stop');
    goBtn.disabled = true; stopBtn.style.display = '';

    var isInside = document.getElementById('kp-t-in').classList.contains('active');
    var doAdmin = isInside && document.getElementById('kp-adm-cb').checked;

    var rounds = [];
    if (doAdmin) rounds.push({ r:'', s:'', isAdmin:true });
    for (var i = 0; i < queue.length; i++)
      rounds.push({ r:queue[i].r, s:queue[i].s, isAdmin:false, _idx:i });

    if (!rounds.length) {
      log('至少加一个轮次', 'err'); goBtn.disabled=false; stopBtn.style.display='none'; return;
    }

    var btn = getReportBtn();
    if (!btn) {
      log('未找到投诉按钮！', 'err'); goBtn.disabled=false; stopBtn.style.display='none'; return;
    }

    log('🚀 开始执行，共' + rounds.length + '轮独立闭环…\n每轮：开窗→选L1→展开L2→选L2→提交→关窗');
    setProgress(0);

    var ok = 0;
    for (var i = 0; i < rounds.length; i++) {
      if (stopFlag) { log('已停止 (' + ok+'/'+rounds.length + ')'); break; }
      var rd = rounds[i];
      var lbl = rd.isAdmin ? '管理员' : rd.r + (rd.s ? '→'+rd.s : '');
      log('━━━ 第' + (i+1) + '/' + rounds.length + '轮：' + lbl + ' ━━━');

      try {
        var success = await doOneRound(btn, rd);
        if (success) ok++;
        setProgress(Math.round(((i+1)/rounds.length)*100));

        // 轮次间等待——弹窗需要完全消失后才能重新打开
        if (i < rounds.length - 1 && !stopFlag) {
          log('<span class="kps"></span> ⏳ 等待' + (DELAY.betweenRounds/1000) + 's后进入下轮…');
          await sleep(DELAY.betweenRounds);
        }
      } catch(e) {
        console.error('[豆瓣投诉✗] 第'+(i+1)+'轮异常:', e);
        log('第'+(i+1)+'轮异常: '+e.message, 'err');
        await sleep(1000);
      }
    }

    setProgress(100);
    log('✅ 完成！成功 ' + ok + '/' + rounds.length + ' 轮', ok > 0 ? 'ok' : '');
    goBtn.disabled = false; stopBtn.style.display = 'none';
  }

  // 拖拽
  function drag(el, handle) {
    var d = false, ox = 0, oy = 0;
    handle.onmousedown = function(e) {
      d = true; ox = e.clientX - el.getBoundingClientRect().left;
      oy = e.clientY - el.getBoundingClientRect().top; e.preventDefault();
    };
    document.onmousemove = function(e) {
      if (!d) return;
      el.style.left = (e.clientX - ox) + 'px'; el.style.top = (e.clientY - oy) + 'px'; el.style.right = 'auto';
    };
    document.onmouseup = function() { d = false; };
  }

  // ===================== 批量链接执行 =====================

  /**
   * 解析链接文本，提取帖子URL
   * 策略：能标准化的就标准化，不能标准化的原样保留（短链等会自动重定向到豆瓣）
   *   1. 直接链接: https://www.douban.com/group/topic/123/ → 标准化
   *   2. dispatch短链: https://www.douban.com/doubanapp/dispatch?uri=... → 标准化
   *   3. 纯数字ID: 123456789 → 转标准豆瓣URL
   *   4. 其他所有非空行 → 原样保留（http://mf.ens5.cn/xxx 等外部短链）
   */
  function parseLinks(text) {
    var lines = text.split(/[\n\r]+/);
    var links = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      // 格式1: 豆瓣直接链接 → 标准化
      var m1 = line.match(/https?:\/\/www\.douban\.com\/group\/(?:[^/]*\/)?topic\/(\d+)/);
      if (m1) { links.push('https://www.douban.com/group/topic/' + m1[1] + '/'); continue; }

      // 格式2: dispatch短链 → 提取ID标准化
      if (line.indexOf('doubanapp/dispatch') >= 0) {
        var uriMatch = line.match(/[?&]uri=([^&\s]+)/);
        if (uriMatch) {
          var decoded = decodeURIComponent(uriMatch[1]);
          var topicMatch = decoded.match(/\/group\/topic\/(\d+)/);
          if (topicMatch) { links.push('https://www.douban.com/group/topic/' + topicMatch[1] + '/'); continue; }
        }
      }

      // 格式3: 纯数字ID（≥6位）→ 转标准豆瓣URL
      var m3 = line.match(/^(\d{6,})$/);
      if (m3) { links.push('https://www.douban.com/group/topic/' + m3[1] + '/'); continue; }

      // 格式4: 其他所有非空行 → 原样保留（外部短链等，浏览器会自动重定向到豆瓣）
      links.push(line);
    }
    return links;
  }

  /**
   * 构建当前投诉轮次列表（从面板状态）
   */
  function buildRounds() {
    var isInside = document.getElementById('kp-t-in').classList.contains('active');
    var doAdmin = isInside && document.getElementById('kp-adm-cb').checked;
    var rounds = [];
    if (doAdmin) rounds.push({ r:'', s:'', isAdmin:true });
    for (var i = 0; i < queue.length; i++)
      rounds.push({ r:queue[i].r, s:queue[i].s, isAdmin:false, _idx:i });
    return { rounds: rounds, isInside: isInside, doAdmin: doAdmin };
  }

  /**
   * 单页执行投诉（供批量模式调用，返回成功/失败）
   */
  async function executeSinglePage(rounds) {
    if (!rounds || !rounds.length) return 0;
    stopFlag = false;
    window.__kp_exec_busy = true;   // v2.6.2 执行中：拦截误关；结束后（含异常）立即复位
    try {
      return await __execSinglePageInner(rounds);
    } finally {
      window.__kp_exec_busy = false;
    }
  }

  async function __execSinglePageInner(rounds) {

    var btn = getReportBtn();
    if (!btn) {
      log('未找到投诉按钮', 'err');
      return 0;
    }

    log('🚀 执行 ' + rounds.length + ' 轮…');
    setProgress(0);
    var ok = 0;

    for (var i = 0; i < rounds.length; i++) {
      if (stopFlag) break;
      var rd = rounds[i];
      rd._idx = i;
      try {
        var success = await doOneRound(btn, rd);
        if (success) ok++;
        setProgress(Math.round(((i + 1) / rounds.length) * 100));
        if (i < rounds.length - 1 && !stopFlag)
          await sleep(DELAY.betweenRounds);
      } catch (e) {
        console.error('[豆瓣投诉✗] 轮次异常:', e);
        await sleep(1000);
      }
    }

    setProgress(100);
    return ok;
  }

  /**
   * 开始批量执行（用户点击按钮触发）
   */
  function startBatch() {
    var text = document.getElementById('kp-batch-ta').value;
    var links = parseLinks(text);
    if (!links.length) { log('请粘贴有效链接', 'err'); return; }

    var info = buildRounds();
    if (!info.rounds.length) { log('请先添加投诉轮次', 'err'); return; }

    // 保存批量状态
    GM_setValue('kp_batch_links', JSON.stringify(links));
    GM_setValue('kp_batch_queue', JSON.stringify(info.rounds));
    GM_setValue('kp_batch_is_inside', info.isInside);
    GM_setValue('kp_batch_index', 0);
    GM_setValue('kp_batch_active', true);

    log('📋 批量开始：共 ' + links.length + ' 个链接，跳转到第1个…');

    // 跳转到第一个链接
    setTimeout(function() {
      location.href = links[0];
    }, 800);
  }

  /**
   * 批量模式：当前页面执行完成后跳转到下一个
   */
  function moveToNextBatchLink() {
    var links = JSON.parse(GM_getValue('kp_batch_links', '[]'));
    var idx = parseInt(GM_getValue('kp_batch_index', 0));
    var nextIdx = idx + 1;

    if (nextIdx >= links.length) {
      // 全部完成
      GM_setValue('kp_batch_active', false);
      GM_setValue('kp_batch_links', '[]');
      GM_setValue('kp_batch_queue', '[]');
      console.log('[豆瓣投诉✓] ====== 批量完成！共处理 ' + links.length + ' 个链接 ======');
      log('✅ 批量完成！共处理 ' + links.length + ' 个帖子', 'ok');
      setProgress(100);
      // 恢复面板
      var panel = document.getElementById('kylin-panel');
      if (panel) {
        panel.querySelector('.kp-title').textContent = '一键投诉工具';
        panel.querySelector('.kp-bd').innerHTML =
          '<div style="text-align:center;padding:20px 0">' +
          '<div style="font-size:24px;margin-bottom:8px">✅</div>' +
          '<div style="font-size:13px;color:#2e7d32;font-weight:bold">批量执行完毕</div>' +
          '<div style="font-size:11px;color:#558b55;margin:4px 0">完成 ' + links.length + ' 个帖子</div>' +
          '<div style="font-size:10.5px;color:#7a8b7a;margin:6px 8px 0;text-align:left;line-height:1.6">📮 豆邮说明：豆瓣不保证每次投诉都发送「投诉受理通知」，重复投诉尤其可能没有——没收到豆邮≠失败，以面板日志的每轮真实结果为准。</div>' +
          '<button onclick="location.reload()" ' +
            'style="margin-top:12px;padding:5px 16px;background:#4caf50;color:#fff;border:none;' +
            'border-radius:5px;cursor:pointer;font-size:12px">返回正常模式</button></div>';
      }
      return;
    }

    // 保存下一个索引并跳转
    GM_setValue('kp_batch_index', nextIdx);
    console.log('[豆瓣投诉] 跳转到第' + (nextIdx + 1) + '个链接: ' + links[nextIdx]);
    setTimeout(function() {
      location.href = links[nextIdx];
    }, 1200);
  }

  /**
   * 批量模式：页面加载后自动执行
   */
  async function runBatchAuto() {
    var links = JSON.parse(GM_getValue('kp_batch_links', '[]'));
    var idx = parseInt(GM_getValue('kp_batch_index', 0));
    var queue = JSON.parse(GM_getValue('kp_batch_queue', '[]'));

    if (!links.length || !queue.length) {
      console.warn('[豆瓣投诉] 批量数据异常，重置');
      GM_setValue('kp_batch_active', false);
      return;
    }

    // 显示批量状态
    var statusEl = document.getElementById('kp-batch-status');
    if (statusEl) statusEl.innerHTML =
      '第 <b>' + (idx + 1) + '</b> / <b>' + links.length + '</b> 个<br>' +
      '<span style="font-size:9.5px;color:#81c784">' + links[idx] + '</span>';

    log('📋 批量 [' + (idx + 1) + '/' + links.length + '] 开始执行…');

    // 等待页面加载
    await sleep(2500);

    // v2.6.3：帖子已被删除 → 不再卡住，回报黑水塘并自动跳下一条
    if (isDeletedPage()) {
      log('⏭️ 此帖已被删除，自动跳过并回报黑水塘');
      console.log('[豆瓣投诉] 第' + (idx + 1) + '条已被删除，跳过');
      reportDeadToBlackPool();
      moveToNextBatchLink();
      return;
    }

    // 执行投诉
    var ok = await executeSinglePage(queue);
    console.log('[豆瓣投诉] 批量第' + (idx + 1) + '帖完成: ' + ok + '/' + queue.length + ' 轮');

    // 跳转到下一个
    moveToNextBatchLink();
  }

  // ===================== v2.6.0 新增：黑水塘网站联动 =====================
  /*
   * 网站「一键投诉」会把链接和投诉理由编码到 URL 的 #kpbatch= 参数里，
   * 再跳转到第一个链接。脚本在这里自动导入并直接进入批量模式，
   * 无需再手动粘贴链接、手动配置轮次。
   */
  function importFromBlackPool() {
    try {
      var h = location.hash || '';
      var m = h.match(/kpbatch=([A-Za-z0-9\-_]+)/);
      if (!m) return false;

      var b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var bin = atob(b64);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      if (!data || !data.links || !data.links.length) return false;

      var rounds = (data.rounds && data.rounds.length)
        ? data.rounds
        : [{ r: '辱骂攻击', s: '侮辱谩骂' }];

      GM_setValue('kp_batch_links', JSON.stringify(data.links));
      GM_setValue('kp_batch_queue', JSON.stringify(rounds));
      GM_setValue('kp_batch_is_inside', data.isInside !== false);
      GM_setValue('kp_batch_index', 0);
      GM_setValue('kp_batch_active', true);
      // v2.6.3 回报上下文：发现已删除的帖子可回报给黑水塘
      GM_setValue('kp_report_ctx', JSON.stringify({ postId: data.postId || '', linkIds: data.linkIds || [], token: data.token || '', api: data.api || '' }));

      console.log('[豆瓣投诉] 🌊 已从黑水塘导入 ' + data.links.length +
                  ' 个链接 / ' + rounds.length + ' 轮投诉，开始批量');

      // 清掉 hash，避免刷新重复导入
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      return true;
    } catch (e) {
      console.warn('[豆瓣投诉] 黑水塘导入失败:', e);
      return false;
    }
  }

  // ===================== 初始化 =====================
  function init() {
    // v2.6.2 防误关（修正）：只在「正在执行投诉」的瞬间拦截关闭。
    // 之前用 GM 的 kp_batch_active 判断，批量模式跳转链接本身也会触发拦截，
    // 导致每个链接跳转都弹「离开此网站?」，批量被卡死。
    // 现在改用页面内存标志 __kp_exec_busy：只有 executeSinglePage 真正跑投诉时为 true；
    // 脚本自己 location.href 跳转前已复位，不会弹框。
    window.addEventListener('beforeunload', function(e) {
      if (window.__kp_exec_busy === true) {
        var msg = '⚠ 正在执行投诉，现在关闭会中断本轮。确定要离开吗？';
        e.preventDefault();
        e.returnValue = msg;
        return msg;
      }
    });

    // 优先从黑水塘网站导入（会打开批量模式）
    var imported = importFromBlackPool();
    var batchActive = GM_getValue('kp_batch_active', false) || imported;

    // 安全检查：如果批量模式已激活但数据不完整，自动重置
    if (batchActive) {
      var links = [];
      try { links = JSON.parse(GM_getValue('kp_batch_links', '[]')); } catch(e) { links = []; }
      if (!links.length) {
        console.log('[豆瓣投诉] 检测到残留批量状态，自动重置');
        GM_setValue('kp_batch_active', false);
        GM_setValue('kp_batch_links', '[]');
        GM_setValue('kp_batch_queue', '[]');
        batchActive = false;
      }
    }

    var ready = function() {
      if (batchActive) {
        // 批量模式：显示精简面板
        buildPanel(true);
        console.log('[豆瓣投诉] v' + VERSION + ' 批量模式启动');
        setTimeout(function() { runBatchAuto(); }, 500);
      } else {
        buildPanel(false);
        console.log('[豆瓣投诉] v' + VERSION + ' 已加载 · 作者: ' + AUTHOR);
      }
      // 始终注册菜单
      try { GM_registerMenuCommand('快捷预设管理', openSettings); } catch(e) {}
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      setTimeout(ready, batchActive ? 800 : 1500);
    }
  }
  init();

})();
