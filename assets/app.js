/* ============================================================================
   Parent Advisor, AIM Edition: page behaviour.

   Plain script, no build step and no framework: the page is a Windows-95-era
   desktop imitation, and the DOM is the state. Structure, in order:

     config and prefs      SITE, API, DEFAULTS, savePrefs
     language              detectLang, buildLangSelect, setLang (wires i18n.js)
     chrome                clock, toast, sounds
     accessibility         inert shell while a modal is open, focus trap
     menus                 the menubar and its items
     windows               open/close/focus/drag/resize, taskbar
     sign on               screen-name picker, rename, prefs
     help                  how-to-win steps, safety, keys, about
     composer              formatting, colours, smileys, caret handling
     chat                  send, stream, render, citations
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var SITE = 'https://learnwithclay.ai';
  var CONSULT = 'https://calendly.com/clayton-learnwithclay';
  /* The advisor service, reached through its own Tailscale Funnel. It used to
     be proxied by a Vercel function on learnwithclay.ai; that account can be
     paused (it was on 2026-11-23: 402 DEPLOYMENT_DISABLED) and pausing it took
     the whole advisor down with it, because the page and the proxy shared the
     account. The funnel answers the same contract from the same server, one
     hop shorter. `/public/chat` is the token-free browser route: a browser
     cannot hold a bearer token, so it is guarded by an Origin allowlist and a
     per-visitor limit instead. */
  var API = 'https://jetson.tail155e26.ts.net/parent/public/chat';

  /* One stable id per browser, so the advisor's question budget follows the
     visitor rather than the network they happen to share with a whole school
     or household. 8-64 chars of [A-Za-z0-9._-]; anything else is ignored by
     the server and it falls back to counting the IP. */
  var SESSION_ID = (function () {
    var KEY = 'pa-session', s = '';
    try {
      s = localStorage.getItem(KEY) || '';
      if (!/^[A-Za-z0-9._-]{8,64}$/.test(s)) {
        s = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(KEY, s);
      }
    } catch (e) {
      s = s || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    return s;
  })();

  /* ---------------------------------------------------------------- prefs */
  var DEFAULTS = { sounds: true, cites: true, clock24: false, size: 'normal', sn: 'VisitingParent', lang: '' };
  var prefs = (function () {
    try {
      var raw = localStorage.getItem('pa-prefs');
      if (raw) {
        var p = JSON.parse(raw);
        for (var k in DEFAULTS) { if (p[k] === undefined) p[k] = DEFAULTS[k]; }
        return p;
      }
    } catch (e) {}
    return JSON.parse(JSON.stringify(DEFAULTS));
  })();
  function savePrefs() {
    try { localStorage.setItem('pa-prefs', JSON.stringify(prefs)); } catch (e) {}
  }

  /* ---------------------------------------------------------------- language
     The page ships in English; i18n.js holds the translation table and walks
     the DOM swapping text in place. The visitor's choice is persisted, seeds
     from the browser locale, and is also sent with every question so the
     advisor answers in the same language. */
  var i18n = window.PAi18n;

  function detectLang() {
    if (prefs.lang && i18n.metaFor(prefs.lang).code === prefs.lang) return prefs.lang;
    var want = '';
    try {
      want = String((navigator.languages && navigator.languages[0]) || navigator.language || 'en');
    } catch (e) { want = 'en'; }
    want = want.toLowerCase();
    if (want.indexOf('zh') === 0) return 'zh';
    var two = want.slice(0, 2);
    return i18n.metaFor(two).code === two ? two : 'en';
  }

  function buildLangSelect(sel) {
    if (!sel) return;
    sel.innerHTML = '';
    i18n.LANGS.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l.code;
      o.textContent = l.native;
      sel.appendChild(o);
    });
    sel.value = i18n.lang();
  }

  var langSelects = ['langPickSignon', 'langPickBuddy', 'prefLang'].map(function (id) {
    return document.getElementById(id);
  });

  function paintLangSelects() {
    langSelects.forEach(function (sel) {
      if (!sel) return;
      if (!sel.options.length) buildLangSelect(sel);
      if (sel.value !== i18n.lang()) sel.value = i18n.lang();
    });
  }

  function setLang(code, announce) {
    var m = i18n.metaFor(code);
    prefs.lang = m.code;
    savePrefs();
    paintLangSelects();
    // The language table is its own file now, fetched on first selection, so
    // anything built from the table waits for it to arrive.
    return i18n.set(m.code).then(function () {
      // canned preview answers are shipped per language, so re-render the ones
      // already on screen instead of trying to translate them in place
      $$('[data-canned]').forEach(function (el) {
        el.innerHTML = i18n.canned(el.getAttribute('data-canned'));
      });
      i18n.apply(document.body);
      paintGreeting(false);
      paintSound();
      if (announce) toast(i18n.tpl('languageChanged', { name: m.native }));
    });
  }


  var soundOn = prefs.sounds;

  var transcript = $('#chatTranscript');
  var input = $('#chatInput');
  var sendBtn = $('#sendBtn');
  var buddyInfo = $('#buddyinfo');
  var signon = $('#signon');
  var lastFocus = null;

  /* ---------------------------------------------------------------- toast */
  var toastEl = $('#toast'), toastTimer = null;
  function toast(msg) {
    toastEl.textContent = i18n.t(msg);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------------------------------------------------------------- clock */
  var clockEl = $('#clock');
  function tickClock() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    var mm = (m < 10 ? '0' : '') + m;
    if (prefs.clock24) {
      clockEl.textContent = (h < 10 ? '0' : '') + h + ':' + mm;
    } else {
      var ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      clockEl.textContent = h + ':' + mm + ' ' + ap;
    }
    clockEl.setAttribute('aria-label', d.toDateString() + ', ' + clockEl.textContent);
  }
  tickClock();
  setInterval(tickClock, 10000);
  clockEl.addEventListener('click', function () {
    prefs.clock24 = !prefs.clock24;
    savePrefs();
    tickClock();
    refreshChecks();
    var d = new Date();
    toast(d.toDateString() + ', ' + (prefs.clock24 ? '24 hour clock on' : '12 hour clock on'));
  });

  /* ---------------------------------------------------------------- sounds */
  var audio = null;
  function ac() {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
    }
    if (audio && audio.state === 'suspended') { try { audio.resume(); } catch (e) {} }
    return audio;
  }
  function tone(freq, t0, dur, vol) {
    var ctx = ac(); if (!ctx || !soundOn) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + dur);
  }
  function doorSound() { tone(392, 0, 0.09, 0.05); tone(523, 0.08, 0.09, 0.05); tone(659, 0.16, 0.14, 0.05); }
  function imSound() { tone(880, 0, 0.07, 0.05); tone(1175, 0.07, 0.12, 0.05); }
  function blip() { tone(660, 0, 0.05, 0.03); }

  var soundToggle = $('#soundToggle');
  function paintSound() {
    soundToggle.innerHTML = '<span aria-hidden="true">' + (prefs.sounds ? '\uD83D\uDD0A' : '\uD83D\uDD07') + '</span>' +
      ' <span>Sounds</span>';
    soundToggle.setAttribute('aria-pressed', prefs.sounds ? 'true' : 'false');
    i18n.apply(soundToggle);
  }
  soundToggle.addEventListener('click', function () {
    prefs.sounds = !prefs.sounds; soundOn = prefs.sounds; savePrefs(); paintSound();
    toast('Sounds ' + (prefs.sounds ? 'on' : 'off'));
    if (prefs.sounds) blip();
  });

  /* ---------------------------------------------------------------- prefs UI */
  function paintPrefs() {
    document.body.classList.toggle('large', prefs.size === 'large');
    transcript.classList.toggle('hide-cites', !prefs.cites);
    soundOn = prefs.sounds;
    paintSound();
  }

  /* ---------------------------------------------------------------- modal */
  var modal = $('#modal');
  /* The sign-on screen and #modal both claim aria-modal. Without inert on the
     app behind them, a keyboard or screen-reader user could operate the hidden
     app (and, on the sign-on screen, do it before signing on). */
  var SHELL_SELECTORS = ['#buddylist', '#howtowin', '#imwin', '#taskbar'];
  var signOnOpen = true, modalOpen = false;
  function refreshInert() {
    var on = signOnOpen || modalOpen;
    SHELL_SELECTORS.forEach(function (sel) {
      var el = $(sel);
      if (el) el.inert = on;
    });
  }
  /* Keep Tab inside an open dialog. Both dialogs are flat enough that a simple
     first/last wrap is enough. */
  function trapTab(container, e) {
    if (e.key !== 'Tab') return;
    var items = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]', container)
      .filter(function (el) { return el.getClientRects().length > 0; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function closeModal() {
    if (!modal.classList.contains('open')) return;
    modal.classList.remove('open');
    modal.innerHTML = '';
    modalOpen = false;
    refreshInert();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }
  function showModal(opts) {
    lastFocus = document.activeElement;
    modal.innerHTML =
      '<div class="dialog outset" role="document">' +
        '<div class="titlebar"><span class="tb-title" id="modalTitle"></span>' +
          '<span class="tb-btns"><button class="tb-btn" type="button" data-modal-close aria-label="Close dialog">&#10005;</button></span>' +
        '</div>' +
        '<div class="body"></div>' +
        '<div class="foot"></div>' +
      '</div>';
    $('#modalTitle', modal).textContent = opts.title || '';
    $('.body', modal).innerHTML = opts.body || '';
    var foot = $('.foot', modal);
    (opts.buttons || [{ label: 'OK', primary: true }]).forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn3d';
      btn.textContent = i18n.t(b.label);
      if (b.primary) btn.style.fontWeight = 'bold';
      btn.addEventListener('click', function () {
        var keep = b.onClick && b.onClick(modal) === false;
        if (!keep) closeModal();
      });
      foot.appendChild(btn);
    });
    modal.classList.add('open');
    modalOpen = true;
    refreshInert();
    if (opts.onOpen) opts.onOpen(modal);
    i18n.apply(modal);
    var first = $('.body button, .body input, .foot .btn3d', modal);
    if (first) first.focus();
  }
  modal.addEventListener('keydown', function (e) {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    trapTab(modal, e);
  });
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal();
    if (e.target.hasAttribute && e.target.hasAttribute('data-modal-close')) closeModal();
  });

  /* ---------------------------------------------------------------- menus */
  var MENUS = {
    buddylist: [
      { label: 'My AIM', items: [
        { t: 'Preferences...', a: 'prefs' },
        { t: 'Change Screen Name...', a: 'rename' },
        { t: 'Sounds On or Off', a: 'soundtoggle' },
        { sep: true },
        { t: 'Sign Off', a: 'signoff' }
      ] },
      { label: 'People', items: [
        { t: 'IM VaultAdvisor', a: 'im' },
        { t: 'Buddy Info', a: 'info' },
        { sep: true },
        { t: 'Request a Scoping Call', a: 'consult' },
        { t: 'Open the Live Assistant', a: 'live' }
      ] },
      { label: 'Help', items: [
        { t: 'How It Works', a: 'howto' },
        { t: 'Safety and Crisis Resources', a: 'safety' },
        { t: 'Keyboard Shortcuts', a: 'keys' },
        { sep: true },
        { t: 'About Parent Advisor', a: 'about' }
      ] }
    ],
    im: [
      { label: 'File', items: [
        { t: 'Save Conversation...', a: 'save' },
        { t: 'Print Conversation', a: 'print' },
        { sep: true },
        { t: 'Clear Conversation', a: 'clear' },
        { t: 'Close Window', a: 'closeim' }
      ] },
      { label: 'Edit', items: [
        { t: 'Copy Conversation', a: 'copyall' },
        { t: 'Copy Last Answer', a: 'copylast' },
        { sep: true },
        { t: 'Clear the Input Box', a: 'clearinput' }
      ] },
      { label: 'View', items: [
        { t: 'Normal Text Size', a: 'size-normal', check: function () { return prefs.size !== 'large'; } },
        { t: 'Large Text Size', a: 'size-large', check: function () { return prefs.size === 'large'; } },
        { sep: true },
        { t: 'Show Citations', a: 'cites', check: function () { return prefs.cites; } },
        { t: '24 Hour Clock', a: 'clock24', check: function () { return prefs.clock24; } },
        { sep: true },
        { t: 'Show Buddy List', a: 'showbuddies' }
      ] },
      { label: 'Insert', items: [
        { t: 'Bold', a: 'bold' },
        { t: 'Italic', a: 'italic' },
        { t: 'Underline', a: 'underline' },
        { t: 'Strikethrough', a: 'strike' },
        { sep: true },
        { t: 'Text Color...', a: 'textcolor' },
        { t: 'Smiley', a: 'smiley' },
        { t: 'Insert a Link', a: 'insertlink' },
        { t: "Insert Today's Date", a: 'insertdate' }
      ] },
      { label: 'People', items: [
        { t: 'IM VaultAdvisor', a: 'im' },
        { t: 'Request a Scoping Call', a: 'consult' },
        { t: 'Open the Live Assistant', a: 'live' },
        { sep: true },
        { t: 'Sign Off', a: 'signoff' }
      ] }
    ],
    howto: [
      { label: 'File', items: [
        { t: 'IM VaultAdvisor', a: 'im' },
        { t: 'Print These Steps', a: 'print' },
        { sep: true },
        { t: 'Close Window', a: 'closehowto' }
      ] },
      { label: 'Help', items: [
        { t: 'Safety and Crisis Resources', a: 'safety' },
        { t: 'Keyboard Shortcuts', a: 'keys' },
        { sep: true },
        { t: 'About Parent Advisor', a: 'about' }
      ] }
    ]
  };

  var openMenu = null, openMenuBtn = null;

  function closeMenu() {
    if (openMenu) { openMenu.classList.remove('open'); }
    if (openMenuBtn) { openMenuBtn.setAttribute('aria-expanded', 'false'); }
    openMenu = null; openMenuBtn = null;
  }

  function buildMenu(bar) {
    var key = bar.getAttribute('data-menu');
    var def = MENUS[key] || [];
    var btns = $$(':scope > button', bar);
    btns.forEach(function (btn, i) {
      var spec = def[i];
      if (!spec) return;
      var menu = document.createElement('div');
      menu.className = 'menu';
      menu.setAttribute('role', 'menu');
      spec.items.forEach(function (item) {
        if (item.sep) {
          var sep = document.createElement('div');
          sep.className = 'sep';
          menu.appendChild(sep);
          return;
        }
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        if (item.check) {
          b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', item.check() ? 'true' : 'false');
          b.innerHTML = '<span class="check">&#10003;</span><span></span><span></span>';
          b.children[1].textContent = item.t;
          b.setAttribute('data-check', item.a);
        } else {
          b.textContent = item.t;
        }
        b.setAttribute('data-act', item.a);
        b.addEventListener('click', function () {
          closeMenu();
          runAction(item.a);
        });
        menu.appendChild(b);
      });
      bar.appendChild(menu);
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = menu.classList.contains('open');
        closeMenu();
        closeStart(); closeSnPick();
        if (!isOpen) {
          menu.classList.add('open');
          btn.setAttribute('aria-expanded', 'true');
          openMenu = menu; openMenuBtn = btn;
          var firstItem = $('button', menu);
          if (firstItem) firstItem.focus();
        }
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); btn.click(); }
      });
      menu.addEventListener('click', function (e) { e.stopPropagation(); });
      menu.addEventListener('keydown', function (e) {
        var items = $$('button', menu);
        var idx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
        else if (e.key === 'Escape') { closeMenu(); if (btn) btn.focus(); }
        else if (e.key === 'Tab') { closeMenu(); }
      });
    });
  }
  $$('.menubar').forEach(buildMenu);

  function refreshChecks() {
    $$('.menu button[data-check]').forEach(function (b) {
      var a = b.getAttribute('data-check');
      var on = false;
      if (a === 'cites') on = prefs.cites;
      else if (a === 'clock24') on = prefs.clock24;
      else if (a === 'size-normal') on = prefs.size !== 'large';
      else if (a === 'size-large') on = prefs.size === 'large';
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------- actions */
  function runAction(a) {
    switch (a) {
      case 'prefs': openPrefs(); break;
      case 'rename': openRename(); break;
      case 'soundtoggle':
        prefs.sounds = !prefs.sounds; savePrefs(); paintPrefs();
        toast('Sounds ' + (prefs.sounds ? 'on' : 'off'));
        break;
      case 'signoff': logOff(); break;
      case 'im': openIM(); break;
      case 'consult': window.open(CONSULT, '_blank', 'noopener'); break;
      case 'live': window.open(SITE, '_blank', 'noopener'); break;
      case 'info': showInfo(); break;
      case 'howto': openHowTo(); break;
      case 'closehowto': setWin('howtowin', 'closed'); break;
      case 'safety': showSafety(); break;
      case 'keys': showKeys(); break;
      case 'about': showAbout(); break;
      case 'save': saveConversation(); break;
      case 'print': window.print(); break;
      case 'clear': clearConversation(); break;
      case 'closeim': setWin('imwin', 'closed'); break;
      case 'copyall': copyText(transcriptText(), 'Conversation copied'); break;
      case 'copylast': copyText(lastAnswerText(), 'Last answer copied'); break;
      case 'clearinput': input.innerHTML = ''; input.focus(); toast('Input cleared'); break;
      case 'size-normal': prefs.size = 'normal'; savePrefs(); paintPrefs(); refreshChecks(); toast('Normal text'); break;
      case 'size-large': prefs.size = 'large'; savePrefs(); paintPrefs(); refreshChecks(); toast('Large text'); break;
      case 'cites':
        prefs.cites = !prefs.cites; savePrefs(); paintPrefs(); refreshChecks();
        toast('Citations ' + (prefs.cites ? 'shown' : 'hidden'));
        break;
      case 'clock24':
        prefs.clock24 = !prefs.clock24; savePrefs(); tickClock(); refreshChecks();
        toast(prefs.clock24 ? '24 hour clock' : '12 hour clock');
        break;
      case 'showbuddies': openWin('buddylist'); break;
      case 'bold': applyFormat('bold'); break;
      case 'italic': applyFormat('italic'); break;
      case 'underline': applyFormat('underline'); break;
      case 'strike': applyFormat('strike'); break;
      case 'textcolor': openPicker('color'); break;
      case 'smiley': openPicker('smiley'); break;
      case 'insertlink': insertLink(); break;
      case 'insertdate': insertTextAtCaret(new Date().toLocaleDateString()); break;
      default: break;
    }
  }

  /* ---------------------------------------------------------------- windows */
  var winState = {};
  function winEl(id) { return document.getElementById(id); }
  function taskBtn(id) { return $('.task-item[data-win="' + id + '"]'); }

  function setWin(id, state) {
    var el = winEl(id); if (!el) return;
    var btn = taskBtn(id);
    if (state === 'closed') {
      el.classList.add('is-hidden');
      if (btn) btn.classList.add('is-hidden');
      el.classList.remove('is-max', 'is-blur', 'is-sized');
      el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = '';
      winState[id] = 'closed';
      updateTaskbar();
      return;
    }
    if (btn) btn.classList.remove('is-hidden');
    if (state === 'min') {
      el.classList.add('is-hidden');
      winState[id] = 'min';
      updateTaskbar();
      return;
    }
    el.classList.remove('is-hidden');
    if (state === 'max') {
      if (window.innerWidth > 820) {
        el.dataset.restore = JSON.stringify({
          left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height
        });
        el.classList.add('is-max');
        el.classList.remove('is-sized');
        el.style.left = '6px';
        el.style.top = '6px';
        el.style.width = Math.max(280, window.innerWidth - 14) + 'px';
        el.style.height = Math.max(240, window.innerHeight - 44) + 'px';
      }
      winState[id] = 'max';
    } else {
      if (el.classList.contains('is-max') && el.dataset.restore) {
        var r = {};
        try { r = JSON.parse(el.dataset.restore); } catch (e) {}
        el.classList.remove('is-max');
        el.style.left = r.left || ''; el.style.top = r.top || '';
        el.style.width = r.width || ''; el.style.height = r.height || '';
        if (r.width || r.height) el.classList.add('is-sized');
      }
      winState[id] = 'open';
    }
    focusWin(id);
    updateTaskbar();
  }

  var topZ = 10;
  function focusWin(id) {
    $$('.window').forEach(function (w) { w.classList.add('is-blur'); });
    var el = winEl(id); if (!el) return;
    el.classList.remove('is-blur');
    el.style.zIndex = ++topZ;
    updateTaskbar();
  }

  function updateTaskbar() {
    $$('.task-item').forEach(function (b) {
      var id = b.getAttribute('data-win');
      var el = winEl(id);
      if (!el) return;
      var visible = !el.classList.contains('is-hidden');
      b.classList.toggle('active', visible && !el.classList.contains('is-blur'));
      b.setAttribute('aria-pressed', visible ? 'true' : 'false');
    });
  }

  function openWin(id) {
    var el = winEl(id);
    if (!el) return;
    if (winState[id] === 'closed' || el.classList.contains('is-hidden')) setWin(id, 'open');
    else focusWin(id);
  }
  function openIM() {
    openWin('imwin');
    try { input.focus(); } catch (e) {}
  }

  $$('.window').forEach(function (w) {
    winState[w.id] = 'open';
    w.addEventListener('mousedown', function () { focusWin(w.id); });
    w.addEventListener('focusin', function () { focusWin(w.id); });
  });
  updateTaskbar();

  $$('.tb-btn[data-win-act]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var id = b.getAttribute('data-win');
      var act = b.getAttribute('data-win-act');
      if (act === 'min') { setWin(id, 'min'); }
      else if (act === 'max') { setWin(id, winState[id] === 'max' ? 'open' : 'max'); }
      else if (act === 'close') { setWin(id, 'closed'); }
    });
  });

  $$('.task-item').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-win');
      var el = winEl(id);
      if (!el) return;
      if (winState[id] === 'min' || winState[id] === 'closed' || el.classList.contains('is-hidden')) setWin(id, 'open');
      else if (!el.classList.contains('is-blur')) setWin(id, 'min');
      else focusWin(id);
    });
  });

  /* drag */
  function makeDraggable(win) {
    var bar = win.querySelector('.titlebar');
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.tb-btn')) return;
      if (window.innerWidth <= 820) return;
      if (win.classList.contains('is-max')) return;
      var rect = win.getBoundingClientRect();
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      ox = rect.left; oy = rect.top;
      win.style.left = ox + 'px';
      win.style.top = oy + 'px';
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      document.body.style.userSelect = 'none';
    });
    bar.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var nx = Math.max(0, Math.min(window.innerWidth - 60, ox + (e.clientX - sx)));
      var ny = Math.max(0, Math.min(window.innerHeight - 70, oy + (e.clientY - sy)));
      win.style.left = nx + 'px';
      win.style.top = ny + 'px';
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }
  $$('.window').forEach(makeDraggable);

  /* resize from the right edge, bottom edge, and bottom right corner */
  function makeResizable(win) {
    $$('.rz', win).forEach(function (handle) {
      handle.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.innerWidth <= 820) return;
        if (win.classList.contains('is-max')) return;
        var dir = handle.getAttribute('data-dir') || 'se';
        var rect = win.getBoundingClientRect();
        var w0 = rect.width, h0 = rect.height;
        var limitW = window.innerWidth - rect.left - 6;
        var limitH = window.innerHeight - rect.top - 36;
        win.classList.add('is-sized');
        win.style.left = rect.left + 'px';
        win.style.top = rect.top + 'px';
        win.style.width = w0 + 'px';
        win.style.height = h0 + 'px';
        focusWin(win.id);
        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
        document.body.style.userSelect = 'none';
        function move(ev) {
          if (dir.indexOf('e') > -1) {
            var w = Math.max(230, Math.min(limitW, w0 + (ev.clientX - e.clientX)));
            win.style.width = w + 'px';
          }
          if (dir.indexOf('s') > -1) {
            var h = Math.max(170, Math.min(limitH, h0 + (ev.clientY - e.clientY)));
            win.style.height = h + 'px';
          }
        }
        function end() {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', end);
          handle.removeEventListener('pointercancel', end);
          document.body.style.userSelect = '';
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
      });
    });
    var bar = win.querySelector('.titlebar');
    bar.addEventListener('dblclick', function (e) {
      if (e.target.closest('.tb-btn')) return;
      setWin(win.id, winState[win.id] === 'max' ? 'open' : 'max');
    });
  }
  $$('.window').forEach(makeResizable);

  window.addEventListener('resize', function () {
    $$('.window.is-max').forEach(function (el) {
      el.style.width = Math.max(280, window.innerWidth - 14) + 'px';
      el.style.height = Math.max(240, window.innerHeight - 44) + 'px';
    });
  });

  /* ---------------------------------------------------------------- start menu */
  var startMenu = $('#startmenu'), startBtn = $('#startBtn');
  var START_ITEMS = [
    { t: 'Buddy List', a: 'showbuddies', ic: '\uD83D\uDC65' },
    { t: 'Instant Message', a: 'im', ic: '\uD83D\uDCAC' },
    { t: 'Preferences...', a: 'prefs', ic: '\u2699' },
    { sep: true },
    { t: 'How It Works', a: 'howto', ic: '\u2139' },
    { t: 'Safety and Crisis Resources', a: 'safety', ic: '\u26A0' },
    { t: 'Keyboard Shortcuts', a: 'keys', ic: '\u2328' },
    { sep: true },
    { t: 'Request a Scoping Call', a: 'consult', ic: '\uD83D\uDCDE' },
    { t: 'Live Assistant', a: 'live', ic: '\uD83C\uDF10' },
    { t: 'About', a: 'about', ic: '\u2139' },
    { sep: true },
    { t: 'Sign Off', a: 'signoff', ic: '\u23FB' }
  ];
  START_ITEMS.forEach(function (it) {
    if (it.sep) {
      var s = document.createElement('div');
      s.className = 'sep';
      startMenu.appendChild(s);
      return;
    }
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = '<span class="ic" aria-hidden="true"></span><span></span>';
    b.children[0].textContent = it.ic;
    b.children[1].textContent = it.t;
    b.addEventListener('click', function () {
      closeStart();
      runAction(it.a);
    });
    startMenu.appendChild(b);
  });
  function closeStart() {
    startMenu.classList.remove('open');
    startBtn.setAttribute('aria-expanded', 'false');
  }
  startBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var isOpen = startMenu.classList.contains('open');
    closeMenu(); closeSnPick(); closeStart();
    if (!isOpen) {
      startMenu.classList.add('open');
      startBtn.setAttribute('aria-expanded', 'true');
      var first = $('button', startMenu);
      if (first) first.focus();
    }
  });
  startMenu.addEventListener('click', function (e) { e.stopPropagation(); });
  startMenu.addEventListener('keydown', function (e) {
    var items = $$('button', startMenu);
    var idx = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeStart(); startBtn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
  });

  document.addEventListener('click', function () {
    closeMenu(); closeStart(); closeSnPick(); closePickers();
  });

  /* ---------------------------------------------------------------- screen name */
  var snPick = $('#snPick'), snDropdown = null;
  function closeSnPick() {
    if (snDropdown) { snDropdown.remove(); snDropdown = null; }
    if (snPick) snPick.setAttribute('aria-expanded', 'false');
  }
  function setScreenName(raw) {
    var sn = String(raw || '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16) || 'VisitingParent';
    prefs.sn = sn; savePrefs();
    $('#snLabel').textContent = sn;
    $('#snInput').value = sn;
    return sn;
  }
  function welcome() {
    var sn = $('#snLabel').textContent || 'VisitingParent';
    // built in English on purpose: the i18n pass translates the whole panel and
    // keeps the English source, so a later language switch can redo it
    buddyInfo.innerHTML = '<div class="bi-head">' + escapeHtml('Welcome, ' + sn) + '</div>' +
      '<span>A knowledge base your experts control, and the assistant that answers out of it.</span> ' +
      '<span>Open</span> <b>How It Works</b> <span>for the four steps.</span> ' +
      '<span>IM</span> <b>VaultAdvisor</b> <span>to ask a question.</span>';
    i18n.apply(buddyInfo);
  }
  function openSnPick() {
    var isOpen = !!snDropdown;
    closeMenu(); closeStart(); closeSnPick();
    if (isOpen) return;
    snDropdown = document.createElement('div');
    snDropdown.className = 'dropdown open';
    snDropdown.style.position = 'fixed';
    var rect = snPick.getBoundingClientRect();
    snDropdown.style.top = (rect.bottom + 2) + 'px';
    snDropdown.style.left = Math.max(4, rect.right - 170) + 'px';
    [{ t: 'VisitingParent', v: 'VisitingParent' },
     { t: 'Parent', v: 'Parent' },
     { t: 'Family', v: 'Family' },
     { t: 'Change Screen Name...', v: '__ask' }].forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.t;
      b.addEventListener('click', function () {
        closeSnPick();
        if (o.v === '__ask') openRename();
        else { setScreenName(o.v); welcome(); toast('Screen name is now ' + o.v); }
      });
      snDropdown.appendChild(b);
    });
    document.body.appendChild(snDropdown);
    snPick.setAttribute('aria-expanded', 'true');
    var first = $('button', snDropdown);
    if (first) first.focus();
  }
  snPick.addEventListener('click', function (e) { e.stopPropagation(); openSnPick(); });
  document.addEventListener('click', function (e) {
    if (snDropdown && !snDropdown.contains(e.target) && e.target !== snPick) closeSnPick();
  });

  function openRename() {
    showModal({
      title: 'Change Screen Name',
      body: '<p>Pick the name that appears on your messages. Letters, numbers, and spaces only, up to 16 characters.</p>' +
            '<input type="text" id="renameInput" maxlength="16" value="' + escapeHtml($('#snLabel').textContent) + '" aria-label="New screen name">',
      buttons: [
        { label: 'Cancel' },
        { label: 'OK', primary: true, onClick: function (m) {
            var v = setScreenName($('#renameInput', m).value);
            welcome();
            toast('Screen name is now ' + v);
          } }
      ],
      onOpen: function (m) {
        var el = $('#renameInput', m);
        el.focus(); el.select();
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            var v = setScreenName(el.value); welcome(); toast('Screen name is now ' + v); closeModal();
          }
        });
      }
    });
  }

  /* ---------------------------------------------------------------- preferences */
  function openPrefs() {
    showModal({
      title: 'Preferences',
      body:
        '<div class="pref-row"><label for="prefLang" style="min-width:86px;font-weight:bold;">Language</label>' +
        '<select class="langsel" id="prefLang" aria-label="Language"></select></div>' +
        '<div class="pref-row"><input type="checkbox" id="prefSounds"' + (prefs.sounds ? ' checked' : '') + '><label for="prefSounds">Sounds</label></div>' +
        '<div class="pref-row"><input type="checkbox" id="prefCites"' + (prefs.cites ? ' checked' : '') + '><label for="prefCites">Show citation lines under answers</label></div>' +
        '<div class="pref-row"><input type="checkbox" id="prefClock"' + (prefs.clock24 ? ' checked' : '') + '><label for="prefClock">24 hour clock in the taskbar</label></div>' +
        '<div class="pref-row"><input type="checkbox" id="prefBig"' + (prefs.size === 'large' ? ' checked' : '') + '><label for="prefBig">Large text in the conversation</label></div>' +
        '<div class="pref-row"><label for="prefSN" style="min-width:86px;font-weight:bold;">ScreenName</label>' +
        '<input type="text" id="prefSN" maxlength="16" value="' + escapeHtml($('#snLabel').textContent) + '"></div>',
      buttons: [
        { label: 'Cancel' },
        { label: 'Apply', primary: true, onClick: function (m) {
            prefs.sounds = $('#prefSounds', m).checked;
            prefs.cites = $('#prefCites', m).checked;
            prefs.clock24 = $('#prefClock', m).checked;
            prefs.size = $('#prefBig', m).checked ? 'large' : 'normal';
            savePrefs(); paintPrefs(); tickClock(); refreshChecks();
            setScreenName($('#prefSN', m).value);
            welcome();
            if ($('#prefLang', m)) setLang($('#prefLang', m).value, false);
            toast('Preferences applied');
          } }
      ],
      onOpen: function (m) {
        var sel = $('#prefLang', m);
        buildLangSelect(sel);
        if (sel) sel.addEventListener('change', function () { setLang(sel.value, false); });
      }
    });
  }

  /* ---------------------------------------------------------------- dialogs */
  function showInfo() {
    openWin('buddylist');
    buddyInfo.innerHTML = '<div class="bi-head">About Parent Advisor</div>' +
      'A knowledge base your experts control, and the assistant that answers out of it. ' +
      'Preview derived from the vault (1,300+ notes).<br><br>' +
      '<button class="linkish" type="button" data-act="about">More about this preview</button>';
    i18n.apply(buddyInfo);
  }
  /* how it works window */
  var STEPS = [
    { name: 'Curate', sum: 'Read First',
      body: 'People who know the field write it. Nothing goes in until it is read. Written and checked by hand.' },
    { name: 'Connect', sum: 'Questions are connected to the Vault',
      body: 'One question reaches the whole vault. Notes are written the way families type. The vault stays on your machines.' },
    { name: 'Retrieve', sum: 'Grounded Sources Retrieved',
      body: 'A question pulls out the right passages. The model sees nothing else. A silent vault gets an honest answer.' },
    { name: 'Answer', sum: 'Cited and Verified Response',
      body: 'Replies cite the notes behind them. Clinical questions go to a person. Safety paths fire before the model. A human is always the expert.' }
  ];
  var hwDetail = $('#hwDetail');
  var currentStep = 0;

  function selectStep(i, focusRow) {
    var idx = Math.max(0, Math.min(STEPS.length - 1, i));
    currentStep = idx;
    $$('.hw-step').forEach(function (b, n) {
      b.setAttribute('aria-selected', n === idx ? 'true' : 'false');
      b.setAttribute('tabindex', n === idx ? '0' : '-1');
    });
    var s = STEPS[idx];
    hwDetail.innerHTML = '<div class="bi-head">STEP ' + (idx + 1) + ': ' + s.name + '</div>' + s.body;
    i18n.apply(hwDetail);
    if (focusRow) {
      var row = $('.hw-step[data-step="' + idx + '"]');
      if (row) row.focus();
    }
  }

  $$('.hw-step').forEach(function (b) {
    b.addEventListener('click', function () {
      selectStep(parseInt(b.getAttribute('data-step'), 10), false);
      blip();
    });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); selectStep(currentStep + 1, true); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); selectStep(currentStep - 1, true); }
      else if (e.key === 'Home') { e.preventDefault(); selectStep(0, true); }
      else if (e.key === 'End') { e.preventDefault(); selectStep(STEPS.length - 1, true); }
    });
  });

  function openHowTo(step) {
    openWin('howtowin');
    if (typeof step === 'number') selectStep(step, false);
  }
  $('#hwIM').addEventListener('click', openIM);
  $('#hwClose').addEventListener('click', function () { setWin('howtowin', 'closed'); });
  function showSafety() {
    showModal({
      title: 'Safety and Crisis Resources',
      body:
        '<p><b>If you or your child is in danger right now, reach out first:</b></p>' +
        '<ul>' +
        '<li><a href="https://988lifeline.org/deaf-hard-of-hearing-hearing-loss/" target="_blank" rel="noopener">988 Suicide and Crisis Lifeline</a>: <a href="tel:988">call or text 988</a> (US). <a href="https://988lifeline.org/deaf-hard-of-hearing-hearing-loss/" target="_blank" rel="noopener">ASL video line available</a>.</li>' +
        '<li>Crisis Text Line: text HOME to 741741.</li>' +
        '<li>Child abuse or an unsafe child: <a href="tel:18004224453">1-800-422-4453</a> (Childhelp), or 911.</li>' +
        '</ul>' +
        '<p>In the live system, safety paths fire before the model runs, and clinical questions route to a person.</p>',
      buttons: [{ label: 'Close', primary: true }]
    });
  }
  function showKeys() {
    showModal({
      title: 'Keyboard Shortcuts',
      body:
        '<ul>' +
        '<li><b>Enter</b> sends a message. <b>Shift Enter</b> starts a new line.</li>' +
        '<li><b>Ctrl or Cmd B, I, U</b> bold, italic, underline while typing.</li>' +
        '<li>Smileys typed as text, like :) or &lt;3, turn into emoji.</li>' +
        '<li><b>Alt 1</b> opens the Buddy List.</li>' +
        '<li><b>Alt 2</b> opens the Instant Message window.</li>' +
        '<li><b>Alt 3</b> opens How It Works.</li>' +
        '<li><b>Alt P</b> opens Preferences.</li>' +
        '<li><b>Esc</b> closes a menu or dialog.</li>' +
        '<li><b>Tab</b> moves through every control on the page.</li>' +
        '</ul>',
      buttons: [{ label: 'Close', primary: true }]
    });
  }
  function showAbout() {
    showModal({
      title: 'About Parent Advisor',
      body:
        '<p>A knowledge base your experts control, and the assistant that answers out of it. ' +
        'This preview is derived from the vault (1,300+ notes) and answers from four grounded paths ' +
        'when the live API cannot be reached.</p>' +
        '<p>Built by Clayton Lawson. <a href="' + SITE + '" target="_blank" rel="noopener">learnwithclay.ai</a></p>',
      buttons: [
        { label: 'Request a Scoping Call', onClick: function () { window.open(CONSULT, '_blank', 'noopener'); } },
        { label: 'Close', primary: true }
      ]
    });
  }
  buddyInfo.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (b) runAction(b.getAttribute('data-act'));
  });

  /* ---------------------------------------------------------------- buddy list */
  var stepInfo = {
    curate:   { head: 'STEP 1: Curate',   body: 'People who know the field write it. Nothing goes in until it is read. Written and checked by hand.', sub: 'read first' },
    connect:  { head: 'STEP 2: Connect',  body: 'One question reaches the whole vault. Notes are written the way families type. The vault stays on your machines.', sub: 'one question, whole vault' },
    retrieve: { head: 'STEP 3: Retrieve', body: 'A question pulls out the right passages. The model sees nothing else. A silent vault gets an honest answer.', sub: 'right passages only' },
    answer:   { head: 'STEP 4: Answer',   body: 'Replies cite the notes behind them. Clinical questions go to a person. Safety paths fire before the model. A human is always the expert.', sub: 'cited, human expert' }
  };

  $$('.buddy').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-buddy');
      if (stepInfo[key]) {
        var s = stepInfo[key];
        buddyInfo.innerHTML = '<div class="bi-head">' + s.head + '</div>' + s.body +
          '<div style="margin-top:5px;color:#666;font-style:italic;">' + s.sub + '</div>';
        blip();
      } else if (key === 'howto') {
        buddyInfo.innerHTML = '<div class="bi-head">HowItWorks</div>Four steps, from the first note to the cited answer.';
        openHowTo();
        blip();
      } else if (key === 'advisor') {
        buddyInfo.innerHTML = '<div class="bi-head">VaultAdvisor</div>Online and answering from the vault. Ask me anything about raising a Deaf or hard of hearing child. I cite where answers come from.';
        openIM();
        blip();
      } else if (key === 'call') {
        buddyInfo.innerHTML = '<div class="bi-head">ScopingCall</div>Talk to a person about the live system. ' +
          '<a href="' + CONSULT + '" target="_blank" rel="noopener">Request a scoping call</a>';
        window.open(CONSULT, '_blank', 'noopener');
      } else if (key === 'live') {
        buddyInfo.innerHTML = '<div class="bi-head">LiveAssistant</div>The full assistant, wired to the real vault. ' +
          '<a href="' + SITE + '" target="_blank" rel="noopener">See the live assistant</a>';
        window.open(SITE, '_blank', 'noopener');
      }
      i18n.apply(buddyInfo);
    });
  });

  $$('.group-head').forEach(function (head) {
    head.addEventListener('click', function () {
      var group = head.getAttribute('data-group');
      var expanded = head.getAttribute('aria-expanded') !== 'false';
      head.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      $('.arrow', head).innerHTML = expanded ? '&#9654;' : '&#9660;';
      $$('.buddy[data-group="' + group + '"]').forEach(function (b) {
        b.classList.toggle('is-hidden', expanded);
      });
      blip();
    });
  });

  $('#imBtn').addEventListener('click', openIM);
  $('#infoBtn').addEventListener('click', showInfo);
  $('#setupBtn').addEventListener('click', openPrefs);

  /* ---------------------------------------------------------------- formatting
     The composer is a rich text box (contenteditable). Bold, italic, underline,
     strikethrough, and text color apply live through execCommand; what you see
     while typing is what lands in the transcript. On send, the composer HTML is
     sanitized down to a whitelist of inline formatting tags for the transcript,
     while the plain text (no markup) is what goes to the advisor API. */
  var FORMAT_CMDS = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough' };

  function applyFormat(kind) {
    var cmd = FORMAT_CMDS[kind];
    if (!cmd) return;
    input.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, null);
    paintFormatStates();
  }
  function paintFormatStates() {
    $$('[data-format]').forEach(function (b) {
      var on = false;
      try { on = document.queryCommandState(FORMAT_CMDS[b.getAttribute('data-format')]); } catch (e) {}
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  $$('[data-format]').forEach(function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep composer selection
    b.addEventListener('click', function () { applyFormat(b.getAttribute('data-format')); });
  });
  ['keyup', 'mouseup', 'focus'].forEach(function (ev) {
    input.addEventListener(ev, paintFormatStates);
  });

  var TEXT_COLORS = ['#000000', '#cc0000', '#0000cc', '#007700', '#880088', '#008080', '#ff6600', '#808080',
                     '#ffffff', '#ffb6c1', '#99ccff', '#99ff99', '#dda0dd', '#40e0d0', '#ffd700', '#c0c0c0'];
  var SMILEYS = [
    [':)', '\uD83D\uDE42'], [':(', '\uD83D\uDE41'], [';)', '\uD83D\uDE09'], [':D', '\uD83D\uDE04'],
    [':-O', '\uD83D\uDE2E'], ['O:-)', '\uD83D\uDE07'], [":'(", '\uD83D\uDE22'], [':-P', '\uD83D\uDE1B'],
    [':-*', '\uD83D\uDE18'], ['B-)', '\uD83D\uDE0E'], ['<3', '\u2764\uFE0F'], ['>:o', '\uD83D\uDE20']
  ];

  function insertTextAtCaret(text) {
    input.focus();
    var ok = false;
    try { ok = document.execCommand && document.execCommand('insertText', false, text); } catch (e) {}
    if (!ok) input.appendChild(document.createTextNode(text));
  }

  var colorBtn = $('#colorBtn'), smileyBtn = $('#smileyBtn');
  var pickerEl = null;
  function closePickers() {
    if (pickerEl) { pickerEl.remove(); pickerEl = null; }
    colorBtn.setAttribute('aria-expanded', 'false');
    smileyBtn.setAttribute('aria-expanded', 'false');
  }
  function openPicker(kind) {
    var isOpen = pickerEl && pickerEl.getAttribute('data-kind') === kind;
    closeMenu(); closeStart(); closeSnPick(); closePickers();
    if (isOpen) return;
    var btn = (kind === 'color') ? colorBtn : smileyBtn;
    pickerEl = document.createElement('div');
    pickerEl.className = 'dropdown open picker';
    pickerEl.setAttribute('data-kind', kind);
    pickerEl.setAttribute('role', 'menu');
    pickerEl.style.position = 'fixed';
    var r = btn.getBoundingClientRect();
    pickerEl.style.left = Math.max(4, Math.min(r.left - 4, window.innerWidth - 180)) + 'px';
    pickerEl.style.top = Math.max(4, r.top - (kind === 'color' ? 124 : 66)) + 'px';
    if (kind === 'color') {
      TEXT_COLORS.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = c;
        b.setAttribute('aria-label', 'Text color ' + c);
        b.title = c;
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          colorBtn.style.borderBottomColor = c;
          input.focus();
          document.execCommand('styleWithCSS', false, true);
          document.execCommand('foreColor', false, c);
          closePickers();
        });
        pickerEl.appendChild(b);
      });
    } else {
      SMILEYS.forEach(function (s) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'smile';
        b.textContent = s[1];
        b.title = s[0];
        b.setAttribute('aria-label', 'Smiley ' + s[0]);
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          insertTextAtCaret(s[1]);
          closePickers();
        });
        pickerEl.appendChild(b);
      });
    }
    document.body.appendChild(pickerEl);
    pickerEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    btn.setAttribute('aria-expanded', 'true');
  }
  colorBtn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep composer selection
  smileyBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  colorBtn.addEventListener('click', function (e) { e.stopPropagation(); openPicker('color'); });
  smileyBtn.addEventListener('click', function (e) { e.stopPropagation(); openPicker('smiley'); });

  /* composer key handling: Enter sends, Shift+Enter is a line break,
     paste is forced to plain text so outside markup never reaches the transcript */
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) document.execCommand('insertLineBreak');
      else sendFromComposer();
    }
  });
  input.addEventListener('paste', function (e) {
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, t);
  });
  /* Paste is forced to plain text above, but drop was not: dragging HTML into a
     contenteditable inserts real markup, and the composer itself is a live sink
     (an <img onerror> fires the moment it lands, before any send-time
     sanitizing). Same treatment as paste: text only. */
  input.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (!dt) return;
    e.preventDefault();
    var t = dt.getData('text/plain');
    if (t) document.execCommand('insertText', false, t);
  });
  input.addEventListener('input', function () {
    if (!input.textContent.replace(/\u00a0/g, '').trim()) input.innerHTML = '';
  });

  /* whitelist sanitizer: only inline formatting survives into the transcript */
  function sanitizeRich(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var KEEP = { b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, strike: 1, br: 1, span: 1, font: 1 };
    /* visit() inspects ONE element. The old walker only looked at the children
       of the node it was given, so an element moved up during unwrapping was
       never itself examined: a nested <img onerror> survived into the
       transcript. Every moved child now goes back through visit(). */
    function visit(n) {
      if (!n || n.nodeType !== 1) return;
      var tag = n.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object') {
        n.remove();
        return;
      }
      var parent = n.parentNode;
      if (!parent) return;
      if (tag === 'div' || tag === 'p') {
        parent.insertBefore(document.createElement('br'), n);
        var movedBlock = Array.prototype.slice.call(n.childNodes);
        movedBlock.forEach(function (c) { parent.insertBefore(c, n); });
        n.remove();
        movedBlock.forEach(function (c) { if (c.nodeType === 1) visit(c); });
        return;
      }
      if (!KEEP[tag]) { // unwrap unknown tags, keep their text
        var movedInline = Array.prototype.slice.call(n.childNodes);
        movedInline.forEach(function (c) { parent.insertBefore(c, n); });
        n.remove();
        movedInline.forEach(function (c) { if (c.nodeType === 1) visit(c); });
        return;
      }
      var color = '';
      if (tag === 'span' && n.style && n.style.color) color = n.style.color;
      if (tag === 'font') color = n.getAttribute('color') || '';
      Array.prototype.slice.call(n.attributes).forEach(function (a) { n.removeAttribute(a.name); });
      if (color) {
        if (tag === 'font') n.setAttribute('color', color);
        else n.style.color = color;
      }
      Array.prototype.slice.call(n.childNodes).forEach(function (c) { if (c.nodeType === 1) visit(c); });
    }
    Array.prototype.slice.call(tmp.childNodes).forEach(function (c) { if (c.nodeType === 1) visit(c); });
    return tmp.innerHTML.replace(/^(<br\s*\/?>\s*)+/i, '').replace(/(<br\s*\/?>\s*)+$/i, '');
  }

  function composerText() {
    var clone = input.cloneNode(true);
    $$('script, style', clone).forEach(function (n) { n.remove(); });
    var t = (typeof clone.innerText === 'string') ? clone.innerText : clone.textContent;
    return (t || '').replace(/\u00a0/g, ' ').trim();
  }

  function insertLink() {
    showModal({
      title: 'Insert a Link',
      body: '<p>Paste a web address. It will be added to your message.</p>' +
            '<input type="text" id="linkInput" placeholder="https://example.org" aria-label="Web address">',
      buttons: [
        { label: 'Cancel' },
        { label: 'Insert', primary: true, onClick: function (m) {
            var v = ($('#linkInput', m).value || '').trim();
            if (!v) { return false; }
            if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
            insertTextAtCaret(v);
          } }
      ],
      onOpen: function (m) { $('#linkInput', m).focus(); }
    });
  }

  /* ---------------------------------------------------------------- warn meter */
  var warnLevel = 0;
  var warnBtn = $('#warnBtn');
  function paintWarn() {
    $('.warnmeter i').style.width = warnLevel + '%';
    $('.warnmeter').setAttribute('aria-valuenow', String(warnLevel));
    $('#warnPct').textContent = warnLevel + '%';
    warnBtn.disabled = warnLevel >= 100;
    warnBtn.setAttribute('aria-disabled', warnBtn.disabled ? 'true' : 'false');
  }
  warnBtn.addEventListener('click', function () {
    if (warnLevel >= 100) return;
    showModal({
      title: 'Send a Warning',
      body: '<p>Warn the other person that this conversation is getting heated. Warnings are logged in the conversation.</p>' +
            '<p>Warning level: <b>' + warnLevel + '%</b> used.</p>',
      buttons: [
        { label: 'Cancel' },
        { label: 'Send Warning', primary: true, onClick: function () {
            warnLevel = Math.min(100, warnLevel + 20);
            paintWarn();
            addMessage(escapeHtml(i18n.tpl('warningSent', { n: warnLevel })), 'sys');
            tone(220, 0, 0.3, 0.06);
          } }
      ]
    });
  });
  paintWarn();

  /* ---------------------------------------------------------------- sign on */
  var signOnBtn = $('#signOnBtn');
  function signOn() {
    setScreenName($('#snInput').value);
    welcome();
    signon.style.display = 'none';
    signOnOpen = false;
    refreshInert();
    doorSound();
    transcript.innerHTML = '';
    paintGreeting(true);
    setWin('buddylist', 'open');
    setWin('howtowin', 'open');
    setWin('imwin', 'open');
    input.focus();
  }
  signOnBtn.addEventListener('click', signOn);
  $('#snInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') signOn();
  });
  // The sign-on screen covers the viewport and declares aria-modal, so Tab has
  // to stay inside it. Previously Tab 5 walked into a window behind the overlay.
  signon.addEventListener('keydown', function (e) {
    if (signon.style.display === 'none') return;
    trapTab(signon, e);
  });

  /* The opening lines are chrome, not answers, so they follow the language
     switcher even mid-conversation. */
  function greetingBody(which) {
    if (which === 'crisis') {
      return i18n.t('If you are experiencing a crisis, please click here:') +
        ' <a href="https://988lifeline.org/deaf-hard-of-hearing-hearing-loss/" target="_blank" rel="noopener">988lifeline</a>';
    }
    return escapeHtml(i18n.t('Ask me anything about raising a Deaf or hard of hearing child. I answer from the vault, and I cite where answers come from.'));
  }
  function paintGreeting(add) {
    var lines = $$('#chatTranscript [data-greeting]');
    if (!add && !lines.length) return;
    if (lines.length) {
      lines.forEach(function (line) {
        var which = line.getAttribute('data-greeting');
        var ts = line.getAttribute('data-ts') || timeStamp();
        line.innerHTML = '<span class="who who-adv">VaultAdvisor ' + escapeHtml(ts) + ':</span> ' + greetingBody(which);
      });
      return;
    }
    ['ask', 'crisis'].forEach(function (which) {
      var line = addMessage(greetingBody(which), 'advisor');
      line.setAttribute('data-greeting', which);
      line.setAttribute('data-ts', timeStamp());
    });
  }

  function logOff() {
    closeModal();
    signon.style.display = 'flex';
    signOnOpen = true;
    refreshInert();
    ['buddylist', 'howtowin', 'imwin'].forEach(function (id) { setWin(id, 'closed'); });
    transcript.innerHTML = '';
    removeTyping(); inFlight = false; sendBtn.disabled = false;
    transcript.setAttribute('aria-busy', 'false');
    $('#snInput').value = prefs.sn || 'VisitingParent';
    $('#snInput').focus();
    tone(523, 0, 0.1, 0.04); tone(392, 0.1, 0.14, 0.04);
    toast('Signed off');
  }

  /* ---------------------------------------------------------------- answers */
  var CRISIS_PATTERNS = [
    /suicide/i, /suicidal/i, /kill myself/i, /killing myself/i, /end my life/i,
    /want to die/i, /wanna die/i, /hurt(ing)? myself/i, /self[- ]?harm/i,
    /overdose/i, /abus(e|ed|ive)/i, /hitting me/i, /beat(ing)? me/i,
    /don'?t want to (live|be here|exist)/i, /no reason to live/i,
    /emergency room|this is an emergency|urgent help/i,
    /crisis/i, /unsafe/i, /scared for my (child|kid|son|daughter)/i
  ];

  /* The page ships 18 languages, and this local router is the safety path that
     still works when the API is unreachable. English-only triggers sent a
     Spanish "quiero morir" to the generic preview answer, so the crisis terms
     are repeated per language. A false hit shows the resources, which is the
     safe direction to be wrong in; a miss is not. */
  var CRISIS_I18N = [
    // Spanish
    /suicid|quiero morir|me quiero morir|matarme|morirme|autolesi|me corto|abuso|me pega|me golpea|peligro|no quiero vivir/i,
    // French
    /suicid|me tuer|mourir|automutilation|abus|me frappe|danger|plus envie de vivre/i,
    // Portuguese
    /suic[ií]d|me matar|matar-me|morrer|automutila|abuso|me bate|perigo|n[ãa]o quero viver/i,
    // Haitian Creole
    /\bswisid|touye m|mouri|abi|bat mwen|danje/i,
    // Tagalog
    /pagpapakamatay|magpakamatay|patayin|mamatay|pang-aabuso|sinasaktan|panganib/i,
    // Vietnamese
    /tự tử|tự sát|giết|chết|lạm dụng|đánh đập|nguy hiểm/i,
    // Korean
    /자살|자해|죽고 싶|죽이|학대|때리|폭력/,
    // Japanese
    /自殺|自傷|死にたい|殺す|虐待|暴力/,
    // Chinese
    /自杀|自残|想死|杀死|虐待|暴力/,
    // Russian
    /суицид|самоубий|убить|умереть|насили|избива/i,
    // Arabic
    /انتحار|إيذاء النفس|أقتل نفسي|أريد أن أموت|إساءة|يضربني|خطر/,
    // Urdu
    /خودکشی|خود کو مار|زیادتی|تشدد/,
    // Hindi
    /आत्महत्या|खुद को मार|मरना चाहता|दुर्व्यवहार|हिंसा/,
    // Nepali
    /आत्महत्या|आफूलाई मार्न|मर्न चाहन्छु|दुर्व्यवहार/,
    // Bengali
    /আত্মহত্যা|নিজেকে মারতে|মরে যেতে|নির্যাতন/,
    // Amharic
    /ራስን መግደል|ራሴን መግደል|መሞት|መግደል|ጥቃት/,
    // Somali
    /\b(isdil|dil|dhimasho|xadgudub)\b/i
  ];

  var crisisAnswer =
    '<strong>If you or your child is in danger right now, please reach out first:</strong>' +
    '<ul>' +
    '<li><a href="https://988lifeline.org/deaf-hard-of-hearing-hearing-loss/" target="_blank" rel="noopener">988 Suicide and Crisis Lifeline</a>: call or text 988 (US). ASL video line available.</li>' +
    '<li>Deaf-specific crisis lines: Crisis Text Line (text HOME to 741741); Deaf Counseling Center and state Deaf crisis services offer video access.</li>' +
    '<li>If a child is being abused or is unsafe: Child Protective Services (CPS) at 1-800-4-A-CHILD (1-800-422-4453), or 911.</li>' +
    '</ul>' +
    'This preview keeps safety ahead of research language. A crisis question gets crisis resources first, always. ' +
    'In the live system, safety paths fire before the model, and clinical questions route to a person.' +
    '<span class="cite">Safety path: fires before retrieval. Human experts stay in the loop.</span>';

  var deprivationAnswer =
    'Language deprivation happens when a Deaf child does not get full access to a language during the early years, when the brain is built to acquire one. ' +
    'It is a lack of access, and the field describes it as deprivation, not a delay. Hearing status does not limit language capacity. Access does.' +
    '<ul>' +
    '<li>Full, early language access (most reliably ASL) gives a child the tools to be safe, to disclose, and to be believed.</li>' +
    '<li>Spoken language support and sign language are an AND, never an either/or.</li>' +
    '<li>Every deaf child needs a full, accessible first language now.</li>' +
    '</ul>' +
    'The vault holds the primary research and parent-plain summaries behind this. Every answer in the live system cites the notes it came from.' +
    '<span class="cite">Grounded in: vault notes on language deprivation, early access, and disclosure.</span>';

  var aslCiAnswer =
    'The evidence does not support the claim that a cochlear implant means waiting on sign language. ' +
    'The non-negotiable part: every deaf child needs a full, accessible first language now.' +
    '<ul>' +
    '<li>Many families use a bilingual-bimodal frame: ASL and spoken language together, with the implant as one tool among several.</li>' +
    '<li>Signing does not block spoken language development. A child with a strong first language has more to map sound onto, not less.</li>' +
    '<li>Watch the question behind the question: parents are usually asking whether their child will be left out. Full access at home is the protective factor.</li>' +
    '</ul>' +
    'Clinical decisions about implant candidacy belong with your care team. The vault keeps the research; people keep the judgment.' +
    '<span class="cite">Grounded in: vault notes on CI outcomes and bimodal bilingualism.</span>';

  var crpdAnswer =
    'Your child has rights with teeth, grounded in the UN Convention on the Rights of Persons with Disabilities (CRPD):' +
    '<ul>' +
    '<li>Article 24: an inclusive education system at all levels, with the language the learner uses, including sign language.</li>' +
    '<li>Articles 9, 21, and 30: accessibility, access to information and communication, and participation in cultural life. Bias shows up here as a rights issue, not a preference issue.</li>' +
    '<li>Deaf-led organizations to know: Gallaudet University, the Clerc Center, VL2 (Visual Language and Visual Learning), your state School for the Deaf, LEAD-K, ASDC, NAD, and WFD.</li>' +
    '</ul>' +
    'In the live system, an answer like this links straight to the notes and the sources behind them.' +
    '<span class="cite">Grounded in: vault notes on CRPD Articles 9, 21, 24, 30 and Deaf-led organizations.</span>';

  var fallbackAnswer =
    'In the live system, a question reaches the whole vault (1,300+ notes), the model sees only the passages that matter, and the answer cites the notes behind it.' +
    '<ul>' +
    '<li>This static preview carries four full answer paths: safety and crisis, language deprivation, sign language and cochlear implants, and CRPD rights.</li>' +
    '<li>Try one of the example questions below, or ask about early access, school rights, or safety.</li>' +
    '</ul>' +
    '<span class="cite">Preview note: answers here are hand written from the vault themes. The live assistant writes them from the notes themselves.</span>';

  window.PA_CANNED_EN = {
    crisisAnswer: crisisAnswer,
    deprivationAnswer: deprivationAnswer,
    aslCiAnswer: aslCiAnswer,
    crpdAnswer: crpdAnswer,
    fallbackAnswer: fallbackAnswer
  };

  /* The preview answers ship as whole translated blocks, so the route names a
     block and i18n supplies it in the visitor's language. */
  function routeKey(q) {
    for (var i = 0; i < CRISIS_PATTERNS.length; i++) {
      if (CRISIS_PATTERNS[i].test(q)) return 'crisisAnswer';
    }
    for (var j = 0; j < CRISIS_I18N.length; j++) {
      if (CRISIS_I18N[j].test(q)) return 'crisisAnswer';
    }
    if (/depriv/i.test(q) || /delay(ed)? (in )?(speech|language)/i.test(q) || /not (talk|speak)ing/i.test(q)) return 'deprivationAnswer';
    if (/\b(asl|sign(ing| language)?)\b/i.test(q) || /\bci\b/i.test(q) || /implant/i.test(q) || /cochlear/i.test(q)) return 'aslCiAnswer';
    if (/crpd/i.test(q) || /\b(rights?)\b.{0,40}\b(school|schooling|education|iep|504)\b/i.test(q) ||
        /\b(school|district|iep|504 plan)\b.{0,40}\brights?\b/i.test(q) ||
        /\b(iep|504 plan|due process|least restrictive)\b/i.test(q) || /\blead-?k\b/i.test(q)) return 'crpdAnswer';
    return 'fallbackAnswer';
  }

  function routeBlock(q) {
    var k = routeKey(q);
    return '<span data-canned="' + k + '">' + i18n.canned(k) + '</span>';
  }

  function timeStamp() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    var ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return '(' + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ' ' + ap + ')';
  }

  function mySN() {
    return $('#snLabel').textContent || 'VisitingParent';
  }

  /* ------------------------------------------------- smooth follow scroll */
  var followBottom = true;
  transcript.addEventListener('scroll', function () {
    followBottom = (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight) < 90;
  }, { passive: true });

  function followScroll(force) {
    if (!followBottom && !force) return;
    transcript.scrollTop = transcript.scrollHeight;
    followBottom = true;
  }

  /* ------------------------------------------------------------ typewriter */
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Drop dangling markdown markers while a slice is mid-word (e.g. a lone "**")
  // so the animated reveal never flashes stray asterisks.
  function partialClean(s) {
    return s.replace(/[*_`#]{1,3}$/, '').replace(/\[[^\]]*$/, '')
      .replace(/<\/?[a-zA-Z][^>]*$/, '');   // a half-typed tag never flashes
  }

  function typeOut(line, raw, tailHtml, onDone) {
    var body = line.querySelector('.type-body');
    var full = String(raw || '');
    if (!body) { if (onDone) onDone(); return; }
    if (reduceMotion || full.length < 40) {
      body.innerHTML = renderMarkdownLite(full) + (tailHtml || '');
      followScroll(true);
      if (onDone) onDone();
      return;
    }

    var i = 0, raf = 0, done = false;
    var TICK = 16;
    var totalMs = Math.min(2400, Math.max(650, full.length * 1.0));
    var perTick = Math.max(1, Math.ceil(full.length / (totalMs / TICK)));

    function cleanup() {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      transcript.removeEventListener('click', onSkip);
    }
    function settle() {
      if (done) return;
      done = true;
      cleanup();
      body.innerHTML = renderMarkdownLite(full) + (tailHtml || '');
      followScroll(true);
      if (onDone) onDone();
    }
    function onKey(e) { if (e.key === 'Escape') settle(); }
    function onSkip(e) {
      if (e.target && e.target.closest && e.target.closest('a')) return;
      settle();
    }

    document.addEventListener('keydown', onKey, true);
    transcript.addEventListener('click', onSkip);

    function step() {
      if (done) return;
      i = Math.min(full.length, i + perTick);
      body.innerHTML = renderMarkdownLite(partialClean(full.slice(0, i)));
      followScroll();
      if (i >= full.length) settle();
      else raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
  }

  function addMessage(html, who) {
    var line = document.createElement('div');
    line.className = 'mline';
    line.setAttribute('data-who', who);
    if (who === 'sys') {
      line.innerHTML = '<span class="sys">' + html + '</span>';
    } else {
      var name = who === 'parent' ? mySN() : 'VaultAdvisor';
      var cls = who === 'parent' ? 'who-you' : 'who-adv';
      line.innerHTML = '<span class="who ' + cls + '">' + escapeHtml(name) + ' ' + timeStamp() + ':</span> ' + html;
    }
    transcript.appendChild(line);
    transcript.scrollTop = transcript.scrollHeight;
    if (who === 'advisor') imSound();
    return line;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
  /* Text escaping is not attribute escaping: textContent -> innerHTML leaves
     double quotes alone, so a value interpolated into title="..." or href="..."
     could close the attribute and add its own. Anything that lands in an
     attribute goes through here instead. */
  function escapeAttr(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* classic AIM smileys: ASCII emoticons become real glyphs everywhere text is shown */
  var EMOTICONS = [
    [/(^|[\s(])O:-?\)(?=$|[\s).,;:!?])/gi, '$1\uD83D\uDE07'],
    [/(^|[\s(]):'-?\((?=$|[\s).,;:!?])/g, '$1\uD83D\uDE22'],
    [/(^|[\s(])&lt;3(?=$|[\s).,;:!?])/g, '$1\u2764\uFE0F'],
    [/(^|[\s(])B-\)(?=$|[\s).,;:!?])/gi, '$1\uD83D\uDE0E'],
    [/(^|[\s(]):-?\*(?=$|[\s).,;:!?])/g, '$1\uD83D\uDE18'],
    [/(^|[\s(]):-?[pP](?=$|[\s).,;:!?])/g, '$1\uD83D\uDE1B'],
    [/(^|[\s(]):-?[oO](?=$|[\s).,;:!?])/g, '$1\uD83D\uDE2E'],
    [/(^|[\s(]);-?\)(?=$|[\s).,;:!?])/g, '$1\uD83D\uDE09'],
    [/(^|[\s(]):-?D(?=$|[\s).,;:!?])/g, '$1\uD83D\uDE04'],
    [/(^|[\s(]):-?\((?=$|[\s).,;:!?])/g, '$1\uD83D\uDE41'],
    [/(^|[\s(]):-?\)(?=$|[\s).,;:!?])/g, '$1\uD83D\uDE42']
  ];
  function emotify(html) {
    for (var i = 0; i < EMOTICONS.length; i++) html = html.replace(EMOTICONS[i][0], EMOTICONS[i][1]);
    return html;
  }

  /* Markdown, done for a 560px AIM transcript.
     Models answer with tables and <https://…> autolinks; raw pipes and angle
     brackets read as broken code in a chat window. So: tables become stacked
     resource blocks (name is a link, contact line underneath), angle brackets
     are stripped, and every bare URL or email becomes a real link. */
  var _mdTokens = [];

  function mdEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* Only http(s), mailto and tel survive as link targets. A citation url comes
     from the API response, so a javascript: or data: value there would run as
     soon as a reader clicked it. Anything else renders as plain text. */
  function safeHref(url) {
    var u = String(url == null ? '' : url).trim();
    if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
    if (/^\/[^\/]/.test(u)) return u; // site-relative
    return '';
  }
  function mdLink(url, label) {
    var href = safeHref(url);
    if (!href) return label;
    return '<a href="' + mdEsc(href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  }
  function mdTok(html) { _mdTokens.push(html); return '\u0000' + (_mdTokens.length - 1) + '\u0000'; }

  // Inline pass: escape, linkify, then the AIM-ish inline set.
  function inlineMd(raw) {
    var s = String(raw == null ? '' : raw)
      .replace(/<\s*((?:https?:\/\/|mailto:)[^>\s]+)\s*>/g, '$1')   // <https://x> -> https://x
      .replace(/<\s*([^\s<>@]+@[^\s<>]+)\s*>/g, '$1')                // <a@b.org> -> a@b.org
      .replace(/<\s*>/g, '');                                        // stray empty <>
    _mdTokens = [];
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, function (m, txt, url) {
      return mdTok(mdLink(url, mdEsc(txt)));
    });
    s = mdEsc(s);

    // bare URLs, trailing punctuation kept outside the link
    s = s.replace(/(^|[\s(*])(https?:\/\/[^\s]+)/g, function (m, pre, url) {
      var tail = (url.match(/[.,;:!?)\]]+$/) || [''])[0];
      if (tail) url = url.slice(0, -tail.length);
      if (!url || url.length < 12) return m;
      return pre + mdTok(mdLink(url, url)) + tail;
    });
    // bare emails
    s = s.replace(/(^|[\s(*])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, function (m, pre, mail) {
      var tail = (mail.match(/[.,;:!?]+$/) || [''])[0];
      if (tail) mail = mail.slice(0, -tail.length);
      return pre + mdTok('<a href="mailto:' + mail + '">' + mail + '</a>') + tail;
    });

    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/__(.+?)__/g, '<u>$1</u>');
    s = s.replace(/(^|[\s(])_([^_\n]{1,200})_([\s).,;:!?]|$)/g, '$1<i>$2</i>$3');
    s = s.replace(/^#{1,6} (.+)$/gm, '<b>$1</b>');
    s = emotify(s);
    s = s.replace(/[ \t]*\u0001[ \t]*/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, function (m, n) { return _mdTokens[+n] || ''; });
  }

  /* Models sometimes hand back HTML fragments (<br>, <li>, <b>…). A chat
     transcript must never show a tag, so: line breaks become real lines, list
     items become bullets, anchors keep their URL, emphasis becomes markdown,
     and anything else tag-shaped is dropped before escaping. */
  function normalizeMd(text) {
    var s = String(text == null ? '' : text);
    s = s.replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#0?39;/gi, "'")
      .replace(/&amp;/gi, '&');
    // <br> is an inline break, not a row break: a control-char marker keeps a
    // table row in one piece, and inlineMd turns it into a real <br> later.
    s = s.replace(/<br\s*\/?>/gi, '\u0001');
    s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    s = s.replace(/<\/?(p|div|section|article|header|footer|ul|ol|table|thead|tbody|tr|blockquote)\b[^>]*>/gi, '\n');
    s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
    s = s.replace(/<\/?(strong|b)\b[^>]*>/gi, '**');
    s = s.replace(/<\/?(em|i)\b[^>]*>/gi, '_');
    s = s.replace(/<\/?u\b[^>]*>/gi, '__');
    s = s.replace(/<\/?(span|font|small|sub|sup|s|strike|del|ins|mark|center)\b[^>]*>/gi, '');
    s = s.replace(/<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi, '');   // any remaining tag
    return s;
  }

  var TBL_ROW = /^\s*\|.*\|\s*$/;
  var TBL_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/;

  function tblCells(line) {
    var s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (c) { return c.trim(); });
  }
  function firstUrl(s) {
    var m = String(s || '').match(/<?(https?:\/\/[^\s<>"')]+)>?/);
    return m ? m[1].replace(/[.,;:!?]+$/, '') : '';
  }

  // One table row -> one readable entry. The name keeps its red bold look but
  // carries the resource's own link; contact details drop to a small line.
  function resourceBlock(cells) {
    var name = (cells[0] || '').replace(/\*+/g, '').trim();
    var desc = (cells[1] || '').replace(/\*+/g, '').trim();
    var how = cells.slice(2).join(' \u00b7 ').trim();
    if (!name || !desc || /^\(?\s*see above\s*\)?\.?$/i.test(desc)) return '';
    var url = firstUrl(cells.join(' | '));
    var nameHtml = inlineMd(name);
    if (!/href=/.test(nameHtml)) {
      nameHtml = url ? mdLink(url, nameHtml)
        : '<b class="res-name">' + nameHtml + '</b>';
    }
    var html = '<div class="res">' + nameHtml;
    if (desc) html += '<span class="res-desc">' + inlineMd(desc) + '</span>';
    if (how) html += '<span class="res-how">' + inlineMd(how) + '</span>';
    return html + '</div>';
  }

  function renderMarkdownLite(text) {
    var lines = normalizeMd(text).split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (TBL_ROW.test(line) && i + 1 < lines.length && TBL_SEP.test(lines[i + 1])) {
        var rows = [], j = i + 2, blocks = '';
        while (j < lines.length && TBL_ROW.test(lines[j])) { rows.push(tblCells(lines[j])); j++; }
        rows.forEach(function (cells) {
          if (/^resource$/i.test((cells[0] || '').replace(/\*+/g, '').trim())) return; // header
          blocks += resourceBlock(cells);
        });
        if (blocks) { out.push('<div class="res-list">' + blocks + '</div>'); i = j - 1; continue; }
      }
      if (/^\s*$/.test(line)) { out.push(''); continue; }
      if (TBL_SEP.test(line)) continue;
      if (TBL_ROW.test(line) || /^\s*\|/.test(line)) {
        // mid-stream row: the separator row has not arrived yet, so never show pipes
        var mid = tblCells(line).filter(function (c) { return c; });
        if (mid.length) out.push(inlineMd(mid.join(' \u00b7 ')));
        continue;
      }
      if (/^\s*[-*] /.test(line)) { out.push('&bull; ' + inlineMd(line.replace(/^\s*[-*] /, ''))); continue; }
      out.push(inlineMd(line));
    }
    return out.join('<br>');
  }

  /* One question at a time. The Send button is disabled while a request is out,
     but Enter in the composer and the suggestion chips do not go through the
     button, so a second question used to start a second request: two answers
     interleaved, the typing row removed from under the first, and Send
     re-enabled while the first response was still coming. */
  var inFlight = false;

  function showTyping() {
    var line = document.createElement('div');
    line.className = 'mline is-typing';
    line.setAttribute('data-who', 'sys');
    line.innerHTML = '<span class="sys">' + escapeHtml(i18n.t('VaultAdvisor is searching the vault...')) + '</span>';
    transcript.appendChild(line);
    transcript.scrollTop = transcript.scrollHeight;
  }
  function removeTyping() {
    $$('.mline.is-typing', transcript).forEach(function (n) { n.remove(); });
  }

  function renderCitations(citations) {
    if (!citations || !citations.length) return '';
    var rows = '';
    citations.slice(0, 8).forEach(function (c) {
      var title = String(c.title || c.source || 'vault note');
      var link = safeHref(c.url || (c.doi ? ('https://doi.org/' + c.doi) : ''));
      // both of these land in attributes, so both use the attribute escaper
      var full = c.citation ? ' title="' + escapeAttr(String(c.citation).slice(0, 400)) + '"' : '';
      if (link) {
        rows += '<li' + full + '>' + escapeHtml(title) + ' <a class="doi-link" href="' + escapeAttr(link) +
          '" target="_blank" rel="noopener noreferrer">' + i18n.t('read the paper') + '</a></li>';
      } else {
        rows += '<li' + full + '>' + escapeHtml(title) + '</li>';
      }
    });
    var head = (citations.length === 1) ? i18n.tpl('citedFromOne') : i18n.tpl('citedFromMany', { n: citations.length });
    return '<div class="cites"><span class="cite-head">' + head + '</span><ul>' + rows + '</ul></div>';
  }

  /* The advisor retrieves in English, so the language request rides along as a
     short English tail: the question keeps its retrieval tokens and the model
     is told which language to answer in. */
  function apiQuestion(q) {
    var body = String(q).trim().slice(0, 460);
    if (i18n.lang() === 'en') return body;
    return body + '\n\n(Answer in ' + i18n.meta().en + '.)';
  }

  function ask(q, richHtml) {
    q = (q || '').trim();
    if (!q) { toast('Type a question first'); input.focus(); return; }
    if (inFlight) { input.focus(); return; }
    inFlight = true;
    addMessage(richHtml || renderMarkdownLite(q), 'parent');
    input.innerHTML = '';
    removeTyping();
    showTyping();
    sendBtn.disabled = true;
    // The transcript is a live region that the typewriter rewrites every
    // frame, which makes a screen reader queue an announcement per chunk.
    // aria-busy keeps it quiet until the answer has settled.
    transcript.setAttribute('aria-busy', 'true');

    var done = false;
    function finish(html) {
      if (done) return;
      done = true;
      inFlight = false;
      removeTyping();
      sendBtn.disabled = false;
      addMessage(html, 'advisor');
      transcript.setAttribute('aria-busy', 'false');
    }

    var timer = setTimeout(function () {
      finish(i18n.t('The live advisor is taking too long, so this is the preview answer.') + '<br><br>' + routeBlock(q));
    }, 25000);

    // Typewriter reveal of a real answer: builds the message shell, then streams
    // the text in so the reader watches it arrive and the transcript follows.
    function reveal(answerText, tailHtml) {
      if (done) return;
      done = true;
      inFlight = false;
      removeTyping();
      sendBtn.disabled = false;
      var line = addMessage('', 'advisor');
      var body = document.createElement('span');
      body.className = 'type-body';
      line.appendChild(body);
      typeOut(line, answerText, tailHtml, function () {
        transcript.setAttribute('aria-busy', 'false');
      });
    }

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: apiQuestion(q),
        sessionId: SESSION_ID,
        language: i18n.lang()
      })
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, data: data }; });
    }).then(function (out) {
      clearTimeout(timer);
      if (out.ok && out.data && out.data.answer) {
        var tail = '';
        if (out.data.citations && out.data.citations.length) {
          tail += renderCitations(out.data.citations);
        } else if (out.data.sources && out.data.sources.length) {
          tail += '<span class="cite">' + escapeHtml(i18n.tpl('answeredFrom', { n: out.data.sources.length })) + '</span>';
        }
        reveal(out.data.answer, tail);
      } else {
        var err = (out.data && out.data.error) ? escapeHtml(i18n.t(out.data.error)) : escapeHtml(i18n.t('The advisor could not be reached.'));
        finish(err + '<br><br>' + routeBlock(q));
      }
    }).catch(function () {
      clearTimeout(timer);
      finish(i18n.t('The live advisor could not be reached, so this is the preview answer.') + '<br><br>' + routeBlock(q));
    });
  }

  function sendFromComposer() {
    var q = composerText();
    if (!q) { toast('Type a question first'); input.focus(); return; }
    var html = emotify(sanitizeRich(input.innerHTML));
    if (!html.replace(/<br\s*\/?>/gi, '').trim()) html = '';
    ask(q, html || null);
  }
  sendBtn.addEventListener('click', sendFromComposer);
  $$('.chip').forEach(function (chip) {
    chip.__enQ = chip.textContent.trim();   // the vault is indexed in English
    chip.addEventListener('click', function () {
      ask(chip.__enQ || chip.textContent);
      openIM();
    });
  });

  /* ---------------------------------------------------------------- transcript tools */
  function transcriptText() {
    return $$('.mline', transcript).map(function (l) { return l.innerText.replace(/\s+\n/g, '\n'); }).join('\n\n');
  }
  function lastAnswerText() {
    var all = $$('.mline[data-who="advisor"]', transcript);
    return all.length ? all[all.length - 1].innerText : 'No answer yet.';
  }
  function copyText(text, msg) {
    if (!text) { toast('Nothing to copy yet'); return; }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg); } catch (e) { toast('Copy is blocked in this browser'); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(msg); }, fallback);
    } else { fallback(); }
  }
  function saveConversation() {
    var text = transcriptText();
    if (!text) { toast('Nothing to save yet'); return; }
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vaultadvisor-conversation.txt';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('Conversation saved');
  }
  function clearConversation() {
    showModal({
      title: 'Clear Conversation',
      body: '<p>Remove every message from this window? This cannot be undone.</p>',
      buttons: [
        { label: 'Cancel' },
        { label: 'Clear', primary: true, onClick: function () {
            transcript.innerHTML = '';
            addMessage(escapeHtml(i18n.t('Conversation cleared.')), 'sys');
            input.focus();
          } }
      ]
    });
  }

  /* ---------------------------------------------------------------- keyboard */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (modal.classList.contains('open')) { closeModal(); return; }
      closeMenu(); closeStart(); closeSnPick();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      var k = e.key.toLowerCase();
      if (k === '1') { e.preventDefault(); openWin('buddylist'); }
      else if (k === '2') { e.preventDefault(); openIM(); }
      else if (k === '3') { e.preventDefault(); openHowTo(); }
      else if (k === 'p') { e.preventDefault(); openPrefs(); }
    }
  });

  /* ---------------------------------------------------------------- boot */
  langSelects.forEach(function (sel) {
    if (!sel) return;
    buildLangSelect(sel);
    sel.addEventListener('change', function () { setLang(sel.value, true); });
  });
  setLang(detectLang(), false);
  paintPrefs();
  paintWarn();
  refreshChecks();
  setScreenName(prefs.sn || 'VisitingParent');
  selectStep(0, false);
  // Make the app inert while the sign-on dialog is up, and put focus inside it.
  refreshInert();
  $('#snInput').focus();
  if (window.innerWidth > 820) {
    var hw = $('#howtowin');
    var need = 850 + hw.offsetWidth + 8;
    if (need > window.innerWidth) {
      hw.style.left = Math.max(8, window.innerWidth - hw.offsetWidth - 8) + 'px';
    }
  }
})();
