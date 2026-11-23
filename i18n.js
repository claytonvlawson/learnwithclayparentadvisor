/* Parent Advisor i18n runtime.
   The English page is the source of truth: every translatable string is keyed
   by its exact English text, so the DOM can be walked and swapped in place
   without touching the markup or the app logic. Original English is cached on
   each node (.paEn) so switching languages, including back to English, is
   lossless.

   Public surface (window.PAi18n):
     LANGS                 [{code, en, native, dir}]
     lang()                current code
     set(code)             switch language, retranslate the whole document
     t(string)             translate a single string (returns input when unknown)
     tpl(key, vars)        translate a template and fill {name} / {n}
     canned(key)           translated HTML for a preview answer block
     apply(root)           translate one subtree (call after building a panel)
     meta()                the LANGS entry for the current language
*/
(function () {
  'use strict';

  var LANGS = [
    { code: 'en', en: 'English',              native: 'English',         dir: 'ltr' },
    { code: 'es', en: 'Spanish',              native: 'Español',         dir: 'ltr' },
    { code: 'zh', en: 'Chinese (Simplified)', native: '简体中文',         dir: 'ltr' },
    { code: 'ko', en: 'Korean',               native: '한국어',           dir: 'ltr' },
    { code: 'ja', en: 'Japanese',             native: '日本語',           dir: 'ltr' },
    { code: 'vi', en: 'Vietnamese',           native: 'Tiếng Việt',      dir: 'ltr' },
    { code: 'tl', en: 'Tagalog',              native: 'Tagalog',         dir: 'ltr' },
    { code: 'hi', en: 'Hindi',                native: 'हिन्दी',            dir: 'ltr' },
    { code: 'ne', en: 'Nepali',               native: 'नेपाली',           dir: 'ltr' },
    { code: 'bn', en: 'Bengali',              native: 'বাংলা',            dir: 'ltr' },
    { code: 'ar', en: 'Arabic',               native: 'العربية',         dir: 'rtl' },
    { code: 'ur', en: 'Urdu',                 native: 'اردو',            dir: 'rtl' },
    { code: 'am', en: 'Amharic',              native: 'አማርኛ',            dir: 'ltr' },
    { code: 'so', en: 'Somali',               native: 'Soomaali',        dir: 'ltr' },
    { code: 'ht', en: 'Haitian Creole',       native: 'Kreyòl ayisyen',  dir: 'ltr' },
    { code: 'fr', en: 'French',               native: 'Français',        dir: 'ltr' },
    { code: 'pt', en: 'Portuguese',           native: 'Português',       dir: 'ltr' },
    { code: 'ru', en: 'Russian',              native: 'Русский',         dir: 'ltr' }
  ];

  var I18N = {};

  var cur = 'en';

  /* Subtrees that must never be machine-translated: the conversation itself
     (answers already arrive in the chosen language, and the visitor's own
     words are theirs), the composer, scripts, and anything we render from the
     translation table already. */
  var SKIP = '#chatTranscript, #chatInput, script, style, textarea, .pa-noi18n';

  function dict() { return I18N[cur] || null; }
  function metaFor(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
    return LANGS[0];
  }
  function meta() { return metaFor(cur); }

  /* Parameterised strings the page builds at runtime. Kept as templates per
     language so word order survives translation. */
  var RULES = [
    { re: /^Welcome, (.+)$/, key: 'welcome', args: function (m) { return { name: m[1] }; } },
    { re: /^Screen name is now (.+)$/, key: 'screenNameNow', args: function (m) { return { name: m[1] }; } },
    { re: /^You sent a warning to VaultAdvisor\. Warning level is now (\d+)%\.$/,
      key: 'warningSent', args: function (m) { return { n: m[1] }; } },
    { re: /^Cited from the vault \((\d+) sources\):$/, key: 'citedFromMany',
      args: function (m) { return { n: m[1] }; } },
    { re: /^Answered from (\d+) vault passages\.$/, key: 'answeredFrom',
      args: function (m) { return { n: m[1] }; } },
    { re: /^Talk To Me \((\d+\/\d+)\)$/, key: 'talkToMe', args: function (m) { return { n: m[1] }; } }
  ];

  function fill(tpl, vars) {
    return String(tpl).replace(/\{(\w+)\}/g, function (all, k) {
      return (vars && vars[k] !== undefined) ? String(vars[k]) : all;
    });
  }

  function tpl(key, vars) {
    var d = dict();
    var raw = (d && d.templates && d.templates[key]) || EN_TEMPLATES[key];
    return raw ? fill(raw, vars) : '';
  }

  var EN_TEMPLATES = {
    welcome: 'Welcome, {name}',
    screenNameNow: 'Screen name is now {name}',
    warningSent: 'You sent a warning to VaultAdvisor. Warning level is now {n}%.',
    citedFromOne: 'Cited from the vault:',
    citedFromMany: 'Cited from the vault ({n} sources):',
    answeredFrom: 'Answered from {n} vault passages.',
    talkToMe: 'Talk To Me ({n})',
    languageChanged: 'Language changed to {name}'
  };

  /* English text that maps to a template rather than a plain word. */
  function lookup(s) {
    if (cur === 'en') return null;
    var d = dict();
    if (d && d.ui && Object.prototype.hasOwnProperty.call(d.ui, s)) return d.ui[s];
    for (var i = 0; i < RULES.length; i++) {
      var m = s.match(RULES[i].re);
      if (m) return tpl(RULES[i].key, RULES[i].args(m));
    }
    return null;
  }

  function t(s) {
    var v = lookup(String(s).replace(/\s+/g, ' ').trim());
    return v === null ? s : v;
  }

  function canned(key) {
    var d = dict();
    var v = d && d.canned && d.canned[key];
    return v || (window.PA_CANNED_EN && window.PA_CANNED_EN[key]) || '';
  }

  /* --- DOM pass ---------------------------------------------------------- */

  var ATTRS = ['title', 'aria-label', 'placeholder', 'alt', 'data-placeholder'];

  function skipped(el) {
    if (!el || !el.closest) return false;
    try { return !!el.closest(SKIP); } catch (e) { return false; }
  }

  function doText(node) {
    var en = node.paEn === undefined ? node.nodeValue : node.paEn;
    var key = String(en).replace(/\s+/g, ' ').trim();
    if (!key) return;
    var out = cur === 'en' ? null : lookup(key);
    if (out === null) {
      // back to English, or nothing to say: restore the source text
      if (node.paEn !== undefined && node.nodeValue !== en) node.nodeValue = en;
      return;
    }
    if (node.paEn === undefined) node.paEn = en;
    var lead = (en.match(/^\s+/) || [''])[0];
    var trail = (en.match(/\s+$/) || [''])[0];
    var next = lead + out + trail;
    if (node.nodeValue !== next) node.nodeValue = next;
  }

  function doAttr(el, name) {
    var store = el.paEnAttrs || (el.paEnAttrs = {});
    var en = store[name] === undefined ? el.getAttribute(name) : store[name];
    if (en === null || en === undefined || !en.trim()) return;
    var out = cur === 'en' ? null : lookup(String(en).replace(/\s+/g, ' ').trim());
    if (out === null) {
      if (store[name] !== undefined && el.getAttribute(name) !== en) el.setAttribute(name, en);
      return;
    }
    if (store[name] === undefined) store[name] = en;
    if (el.getAttribute(name) !== out) el.setAttribute(name, out);
  }

  /* Menu bar labels are built as "<u>F</u>ile"; translating the fragments is
     pointless, so the whole label is swapped and the mnemonic is dropped. */
  function doMenuLabel(btn) {
    if (btn.paEnLabel === undefined) btn.paEnLabel = btn.textContent.trim();
    var out = cur === 'en' ? null : lookup(btn.paEnLabel);
    var want = out === null ? btn.paEnLabel : out;
    if (btn.textContent.trim() !== want) btn.textContent = want;
  }

  function apply(root) {
    root = root || document.body;
    if (root.nodeType === 1 || root.nodeType === 11 || root.nodeType === 9) {
      if (root.nodeType === 1 && skipped(root)) return;
      // menu bar labels
      var bars = root.querySelectorAll ? root.querySelectorAll('.menubar') : [];
      for (var b = 0; b < bars.length; b++) {
        var labels = bars[b].querySelectorAll(':scope > button');
        for (var l = 0; l < labels.length; l++) doMenuLabel(labels[l]);
      }
      if (root.nodeType === 1 && root.matches && root.matches('.menubar')) {
        var own = root.querySelectorAll(':scope > button');
        for (var o = 0; o < own.length; o++) doMenuLabel(own[o]);
      }
      var els = root.querySelectorAll('*');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        // the composer is skipped as content, but its placeholder and label are
        // chrome and must still follow the language
        if (el.id === 'chatInput') {
          doAttr(el, 'data-placeholder');
          doAttr(el, 'aria-label');
          continue;
        }
        if (skipped(el)) continue;
        for (var a = 0; a < ATTRS.length; a++) doAttr(el, ATTRS[a]);
      }
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          var p = n.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          var tag = p.nodeName;
          if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('.menubar > button')) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var node;
      while ((node = w.nextNode())) doText(node);
    } else if (root.nodeType === 3) {
      doText(root);
    }
  }

  /* --- language files ----------------------------------------------------
     One file per language, fetched the first time that language is selected.
     Previously all 17 tables (359 KB) shipped with the runtime, so an English
     visitor downloaded 85 KB gzipped of translations to read none of them.
     English is the source text and has no file: the runtime returns at once. */
  var loading = {};

  function langUrl(code) { return 'i18n/' + code + '.js'; }

  function load(code) {
    if (code === 'en' || I18N[code]) return Promise.resolve(code);
    if (loading[code]) return loading[code];
    loading[code] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = langUrl(code);
      s.async = false;
      s.onload = function () { resolve(code); };
      s.onerror = function () {
        delete loading[code];
        reject(new Error('could not load ' + code));
      };
      document.head.appendChild(s);
    });
    return loading[code];
  }

  /* set() is immediate for the document's language attributes and for anything
     already loaded, and returns a promise for the translated text, so a caller
     that rebuilds a panel can wait for it. */
  function set(code) {
    var m = metaFor(code);
    cur = m.code;
    var html = document.documentElement;
    html.setAttribute('lang', cur);
    if (m.dir === 'rtl') html.setAttribute('dir', 'rtl');
    else html.removeAttribute('dir');
    apply(document.body);
    if (cur === 'en' || I18N[cur]) return Promise.resolve(cur);
    return load(cur).then(function () { apply(document.body); return cur; },
      function () { return cur; });
  }

  window.PAi18n = {
    LANGS: LANGS,
    lang: function () { return cur; },
    set: set,
    load: load,
    t: t,
    tpl: tpl,
    canned: canned,
    apply: apply,
    meta: meta,
    metaFor: metaFor,
    /* merges a language file into the table when it loads */
    data: function (d) {
      if (d) { for (var k in d) { if (Object.prototype.hasOwnProperty.call(d, k)) I18N[k] = d[k]; } }
      return I18N;
    }
  };
})();

