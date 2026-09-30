/* Layout.js — WhatsApp Web -> phone-width "two-page carousel" layout.
 * Injected by WebViewController at document start (main frame only).
 * Page 1 = nav rail + chat list, page 2 = open conversation (or the screen opened from the rail).
 * Logged-out screens (QR code / phone-number login) are instead scaled down to fit the screen.
 *
 * Anchors used (all verified in the web.whatsapp.com bundle served 2026-09-30):
 *   #side, #pane-side, #main (data-testid="conversation-panel-wrapper"),
 *   [data-testid="drawer-left" | "drawer-middle" | "drawer-right" | "drawer-fullscreen"],
 *   [data-testid="intro-panel"], [data-testid="drawer-title-body"], header elements,
 *   root classes "two" / "three" (emitted via classnamesConvertMeToStylexPlease),
 *   CSS var --navbar-width (64px), document-level keydown "Escape" => CLOSE_CHAT.
 * No obfuscated (x…/_a…) class names are used. If anchors are missing, the script
 * does nothing and WhatsApp's own 748px horizontally-scrollable layout remains.
 */
(function () {
  'use strict';
  if (window.__wam) return;

  var html = document.documentElement;
  var MODE_KEY = 'wam-mode';
  var VIEWPORT = {
    mobile: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
    desktop: 'width=1000, user-scalable=yes, maximum-scale=4' // fallback: scaled desktop
  };
  var LOGIN_WIDTH = 620; // logged-out screens are fixed ~600px desktop layouts
  var mode = 'mobile';
  try { mode = localStorage.getItem(MODE_KEY) === 'desktop' ? 'desktop' : 'mobile'; } catch (e) {}

  function wantViewport() {
    if (mode === 'desktop') return VIEWPORT.desktop;
    if (document.getElementById('side') || document.getElementById('main')) return VIEWPORT.mobile;
    return 'width=' + Math.max(LOGIN_WIDTH, window.screen.width);
  }

  /* ------------------------------------------------------------------ CSS */
  var W = 'var(--wam-w, 100vw)';
  var NAV = 'var(--navbar-width, 64px)';
  var CSS = [
    'html{-webkit-text-size-adjust:100%}',
    'html.wam-on *{-webkit-tap-highlight-color:transparent}',
    // Long press = WhatsApp's menu (see touch handling), so no iOS callout / text selection there.
    'html.wam-on #app,html.wam-on #app *{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}',
    'html.wam-on #app input,html.wam-on #app textarea,html.wam-on #app [contenteditable="true"],' +
      'html.wam-on #app [contenteditable="true"] *{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}',
    // 1. Undo WhatsApp\'s floors: min-width:748px (<=748px wide) and min-height:512px (<=512px tall)
    //    on the app root, and overflow:auto on the wrapper. Root becomes exactly two screens wide.
    'html.wam-on [data-wam-anc]{overflow:hidden!important;min-width:0!important;min-height:0!important}',
    'html.wam-on [data-wam="root"]{min-width:0!important;min-height:0!important;max-width:none!important;' +
      'flex:none!important;width:calc(2 * ' + W + ')!important;overflow:hidden!important}',
    // 2. Page 1 = nav rail + chat list (and the left drawers that overlay it)
    'html.wam-on [data-wam="list"],html.wam-on [data-wam="drawer-left"]{' +
      'flex:0 0 calc(' + W + ' - ' + NAV + ')!important;width:calc(' + W + ' - ' + NAV + ')!important;' +
      'max-width:none!important;min-width:0!important}',
    //    Page 2 = conversation; drawer-middle (flex-grow:1) fills page 2 automatically.
    'html.wam-on [data-wam="conv"]{flex:0 0 ' + W + '!important;width:' + W + '!important;' +
      'max-width:none!important;min-width:0!important}',
    //    Right drawer (contact info, search, starred…) is absolute at <=1300px: make it one full page.
    'html.wam-on [data-wam="root"].three>[data-wam="drawer-right"]{width:' + W + '!important;' +
      'max-width:none!important;min-width:0!important;flex-basis:auto!important}',
    //    Fullscreen drawer (business tools, broadcasts, profile…) is 100% - navbar of the root: clamp to page 1.
    'html.wam-on [data-wam="drawer-full"]{width:calc(' + W + ' - ' + NAV + ')!important;max-width:none!important}',
    // 3. Back button + room for it in the chat header
    'html.wam-on.wam-page2:not(.wam-rdrawer) #main>header{padding-inline-start:48px!important}',
    '#wam-back{position:fixed;z-index:2147483000;top:10px;inset-inline-start:4px;width:40px;height:40px;' +
      'border:0;border-radius:20px;background:transparent;color:var(--WDS-content-default,#111b21);' +
      'display:none;align-items:center;justify-content:center;padding:0;margin:0}',
    'html.wam-on.wam-page2:not(.wam-rdrawer) #wam-back{display:flex}',
    '#wam-back:active{background:rgba(127,127,127,.2)}',
    '#wam-back svg{width:24px;height:24px;fill:currentColor}',
    '#wam-back:dir(rtl) svg{transform:scaleX(-1)}',
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('wam-style')) return;
    var s = document.createElement('style');
    s.id = 'wam-style';
    s.textContent = CSS;
    (document.head || html).appendChild(s);
  }

  /* ------------------------------------------------------------- viewport */
  // WebKit re-runs processViewport() whenever a connected <meta name=viewport> is inserted
  // or its content attribute changes, so rewriting WhatsApp's own meta is enough.
  var vpHoldUntil = 0;
  function fixViewport() {
    if (Date.now() < vpHoldUntil) return;
    var want = wantViewport();
    var metas = document.querySelectorAll('meta[name="viewport"]');
    if (!metas.length) {
      if (!document.head) return;
      var m = document.createElement('meta');
      m.name = 'viewport';
      m.content = want;
      document.head.appendChild(m);
      return;
    }
    for (var i = 0; i < metas.length; i++) {
      if (metas[i].getAttribute('content') !== want) metas[i].setAttribute('content', want);
    }
  }

  /* -------------------------------------------------------- DOM discovery */
  var st = { root: null, scroller: null, page: 1, shown: 0, animUntil: 0, forcePage2: false, tap: null, sent: '' };

  function findRoot() {
    var side = document.getElementById('side');
    if (!side) return null;
    var r = side.closest('.two, .three');
    if (r) return r;
    // Otherwise: the nearest common ancestor of the chat list and the conversation pane
    // (#main when a chat is open, the intro panel when none is).
    var other = document.getElementById('main') || document.querySelector('[data-testid="intro-panel"]');
    for (var el = side.parentElement; el && el.id !== 'app' && el !== document.body; el = el.parentElement) {
      if (el.querySelector(':scope > [data-testid="drawer-right"]')) return el;
      if (other && el.contains(other)) return el;
    }
    return null;
  }

  function childOf(root, node) {
    while (node && node.parentElement !== root) node = node.parentElement;
    return node || null;
  }

  function tag(el, role) {
    if (el && el.getAttribute('data-wam') !== role) el.setAttribute('data-wam', role);
    return el;
  }

  function findScroller(root) {
    for (var a = root.parentElement; a && a !== html; a = a.parentElement) {
      if (a.scrollWidth > a.clientWidth + 1) return a;
    }
    return null;
  }

  var rootClassObs = new MutationObserver(schedule);

  function discover() {
    var root = findRoot();
    if (!root) return null;
    if (root !== st.root) {
      st.root = root;
      var old = document.querySelectorAll('[data-wam-anc]');
      for (var i = 0; i < old.length; i++) old[i].removeAttribute('data-wam-anc');
      for (var a = root.parentElement; a && a.id !== 'app' && a !== document.body; a = a.parentElement) {
        a.setAttribute('data-wam-anc', '');
      }
      rootClassObs.disconnect();
      rootClassObs.observe(root, { attributes: true, attributeFilter: ['class'] });
    }
    tag(root, 'root');
    var list = tag(childOf(root, document.getElementById('side')), 'list');
    var main = document.getElementById('main');
    var conv = main ? childOf(root, main) : root.querySelector(':scope > [data-wam="conv"]');
    if (!conv) {
      var intro = root.querySelector('[data-testid="intro-panel"]');
      if (intro) conv = childOf(root, intro);
    }
    if (!conv && list) {
      conv = list.nextElementSibling;
      while (conv && (conv.tagName !== 'DIV' || /^drawer-/.test(conv.getAttribute('data-testid') || ''))) {
        conv = conv.nextElementSibling;
      }
    }
    if (!list || !conv || conv === list) return null;
    tag(conv, 'conv');
    tag(root.querySelector(':scope > [data-testid="drawer-right"]'), 'drawer-right');
    tag(root.querySelector(':scope > [data-testid="drawer-fullscreen"]'), 'drawer-full');
    tag(root.querySelector('[data-testid="drawer-left"]'), 'drawer-left');
    tag(root.querySelector('[data-testid="drawer-middle"]'), 'drawer-mid');
    return { root: root, list: list, conv: conv, main: main };
  }

  /* ---------------------------------------------------------- page logic */
  function scrollToPage(d, page, instant) {
    var now = Date.now();
    var changed = page !== st.shown;
    if (!changed && !instant && now < st.animUntil) return;   // let a running animation finish
    var sc = st.scroller;
    if (!sc || !sc.isConnected || !sc.contains(d.root)) sc = st.scroller = findScroller(d.root);
    if (!sc) return;
    var sr = sc.getBoundingClientRect(), rr = d.root.getBoundingClientRect(), cr = d.conv.getBoundingClientRect();
    var convOnRight = (cr.left + cr.width / 2) > (rr.left + rr.width / 2); // false in RTL UIs
    var delta = page === 2 ? cr.left - sr.left : (convOnRight ? rr.left - sr.left : rr.right - sr.right);
    st.shown = page;
    if (Math.abs(delta) < 1) return;
    var smooth = changed && !instant;
    if (smooth) {
      st.animUntil = now + 450;
      setTimeout(function () { instantNext = true; schedule(); }, 500); // guarantee we land exactly on the page
    }
    sc.scrollTo({ left: sc.scrollLeft + delta, behavior: smooth ? 'smooth' : 'auto' });
  }

  function placeBackButton(d) {
    var btn = document.getElementById('wam-back');
    if (!btn && document.body) {
      btn = document.createElement('button');
      btn.id = 'wam-back';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Back');
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>';
      btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); back(); });
      document.body.appendChild(btn);
    }
    var hdr = d && d.main && d.main.querySelector(':scope > header');
    if (btn && hdr) {
      var r = hdr.getBoundingClientRect();
      if (r.height) btn.style.top = Math.round(r.top + (r.height - 40) / 2) + 'px';
    }
  }

  // Tells native whether a chat is shown (enables the edge-swipe back gesture) and the text direction.
  function notifyNative() {
    var msg = { type: 'layout', inChat: html.classList.contains('wam-on') && st.page === 2,
      rtl: getComputedStyle(document.body || html).direction === 'rtl' };
    var key = JSON.stringify(msg);
    if (key === st.sent) return;
    st.sent = key;
    try { window.webkit.messageHandlers.dw.postMessage(msg); } catch (e) {}
  }

  var instantNext = true;
  function update() {
    fixViewport();
    injectCSS();
    if (mode !== 'mobile') { html.classList.remove('wam-on'); notifyNative(); return; }
    var d = discover();
    if (!d) { html.classList.remove('wam-on', 'wam-page2', 'wam-rdrawer'); st.root = null; notifyNative(); return; }
    html.style.setProperty('--wam-w', html.clientWidth + 'px');
    html.classList.add('wam-on');
    var rdrawer = d.root.classList.contains('three');
    if (st.forcePage2) {
      var mid = d.root.querySelector('[data-testid="drawer-middle"]');
      if (d.main || !mid || !mid.firstElementChild) st.forcePage2 = false;
    }
    if (!d.main && !rdrawer && !st.forcePage2) st.page = 1;
    else st.page = 2;
    html.classList.toggle('wam-page2', st.page === 2);
    html.classList.toggle('wam-rdrawer', rdrawer);
    scrollToPage(d, st.page, instantNext);
    instantNext = false;
    placeBackButton(d);
    notifyNative();
  }

  var raf = 0, tmo = 0;
  function run() { if (raf) cancelAnimationFrame(raf); clearTimeout(tmo); raf = tmo = 0; update(); }
  function schedule() {
    if (raf || tmo) return;
    raf = requestAnimationFrame(run);   // normal path: batch with the next frame
    tmo = setTimeout(run, 250);         // fallback when rAF is throttled
  }

  /* --------------------------------------------------------------- back */
  function pressEscape() {
    // WhatsApp registers document.addEventListener("keydown") and maps key "Escape" (no modifiers)
    // to Action.CLOSE_CHAT; it reads only e.key/altKey/ctrlKey/metaKey/shiftKey (no isTrusted check).
    var init = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent('keydown', init));
    document.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  function back() {
    var root = st.root;
    if (!root || !root.isConnected) return false;
    if (root.classList.contains('three')) {
      var dr = root.querySelector(':scope > [data-testid="drawer-right"]');
      var t = dr && dr.querySelector('[data-testid="drawer-title-body"]');
      var hdr = (t && t.closest('header')) || (dr && dr.querySelector('header'));
      var btn = hdr && hdr.querySelector('button, [role="button"]');
      if (btn) { btn.click(); return true; }
    }
    if (document.getElementById('main')) { pressEscape(); return true; }
    if (st.forcePage2) { st.forcePage2 = false; schedule(); return true; }
    return false;
  }

  /* ------------------------------------------------------------ wiring */
  // Heuristic for drawer-middle screens (Settings detail, Status, Calls, Business tools):
  // a tap on page 1 content followed quickly by DOM changes inside drawer-middle => go to page 2.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t || !st.root) return;
    if (t.closest('[data-wam="list"], [data-wam="drawer-left"]')) st.tap = { zone: 'p1', at: Date.now() };
    else if (t.closest('[data-wam="root"] > header')) { st.tap = null; st.forcePage2 = false; }
  }, true);

  var vpDone = false;
  var mo = new MutationObserver(function (records) {
    if (!vpDone) fixViewport();          // rewrite WhatsApp's meta viewport as soon as it is parsed
    if (st.tap && Date.now() - st.tap.at < 800 && !st.forcePage2) {
      var mid = st.root && st.root.querySelector('[data-wam="drawer-mid"]');
      for (var i = 0; mid && i < records.length; i++) {
        if (records[i].addedNodes.length && mid.contains(records[i].target)) { st.forcePage2 = true; st.tap = null; break; }
      }
    }
    schedule();
  });
  mo.observe(html, { childList: true, subtree: true });

  /* ------------------------------------------------------ touch -> click */
  // WhatsApp reveals things on :hover (chat-row chevrons, tooltips). iOS then treats the first tap
  // as a "hover" and only the second tap clicks. For quick taps we cancel iOS's emulated mouse
  // events and send mousedown/mouseup/click ourselves. A long press becomes a right-click, which
  // opens WhatsApp's own menu for chats and messages (reply, forward, delete, archive...).
  // Text fields, pickers and media keep native iOS behaviour.
  var NATIVE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], video, audio, iframe';
  var touch = null;
  var lastScrollAt = 0; // a tap that stops a momentum scroll must not click (iOS handles it natively)
  function fireMouse(type, target, x, y, button) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, view: window, detail: 1,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: button || 0, buttons: type === 'mousedown' || type === 'contextmenu' ? (button === 2 ? 2 : 1) : 0
    }));
  }
  function isEditable(el) { return !!(el && el.matches && el.matches(NATIVE)); }

  document.addEventListener('touchstart', function (e) {
    if (touch) clearTimeout(touch.timer);
    touch = null;
    if (!html.classList.contains('wam-on') || e.touches.length !== 1) return;
    var t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    if (!t || t.closest(NATIVE) || Date.now() - lastScrollAt < 150) return;
    var p = e.touches[0];
    var cur = touch = { x: p.clientX, y: p.clientY, t: t, at: Date.now(), long: false, timer: 0 };
    cur.timer = setTimeout(function () {
      if (touch !== cur) return;
      cur.long = true;
      fireMouse('contextmenu', cur.t, cur.x, cur.y, 2);
    }, 500);
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!touch) return;
    var p = e.touches[0];
    if (Math.abs(p.clientX - touch.x) > 10 || Math.abs(p.clientY - touch.y) > 10) {
      clearTimeout(touch.timer);
      touch = null; // it's a scroll
    }
  }, { capture: true, passive: true });

  document.addEventListener('touchcancel', function () {
    if (touch) clearTimeout(touch.timer);
    touch = null;
  }, true);

  document.addEventListener('touchend', function (e) {
    var cur = touch;
    touch = null;
    if (!cur) return;
    clearTimeout(cur.timer);
    if (lastScrollAt > cur.at) return; // content scrolled under the finger
    e.preventDefault(); // no emulated hover, no second-tap requirement, no native long-press callout
    if (cur.long) return; // the long press already opened the menu
    // Tapping outside the message box closes the keyboard, like a native app.
    var active = document.activeElement;
    if (isEditable(active) && !cur.t.closest('footer')) active.blur();
    fireMouse('mousedown', cur.t, cur.x, cur.y);
    fireMouse('mouseup', cur.t, cur.x, cur.y);
    fireMouse('click', cur.t, cur.x, cur.y);
  }, { capture: true, passive: false });

  // Logged-out screens are scaled down, so iOS zooms in when a field (phone number) is focused.
  // That helps while typing; once the field loses focus, zoom back out to fit the screen.
  document.addEventListener('focusout', function (e) {
    if (mode === 'desktop' || document.getElementById('side')) return;
    if (!e.target || !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) return;
    var base = wantViewport();
    var fit = window.screen.width / Math.max(LOGIN_WIDTH, window.screen.width);
    vpHoldUntil = Date.now() + 500;
    m.setAttribute('content', base + ', maximum-scale=' + fit.toFixed(3));
    setTimeout(function () { vpHoldUntil = 0; m.setAttribute('content', base); }, 450);
  }, true);

  window.addEventListener('resize', function () { instantNext = true; st.scroller = null; schedule(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { instantNext = true; schedule(); } });
  document.addEventListener('DOMContentLoaded', function () { fixViewport(); vpDone = true; schedule(); });

  // Keep the carousel aligned if something (focus, scrollIntoView) scrolls the container.
  var driftTimer = 0;
  document.addEventListener('scroll', function (e) {
    if (e.target !== st.scroller) lastScrollAt = Date.now();
    if (!st.scroller || e.target !== st.scroller) return;
    clearTimeout(driftTimer);
    driftTimer = setTimeout(function () { if (Date.now() >= st.animUntil) { instantNext = true; schedule(); } }, 200);
  }, true);

  window.__wam = {
    back: back,
    mode: function () { return mode; },
    setMode: function (m) { try { localStorage.setItem(MODE_KEY, m === 'desktop' ? 'desktop' : 'mobile'); } catch (e) {} location.reload(); }
  };

  fixViewport();
  injectCSS();
  schedule();
})();
