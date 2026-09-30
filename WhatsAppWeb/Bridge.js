// Injected at document start into web.whatsapp.com.
// Talks to Swift through window.webkit.messageHandlers.dw.
(function () {
  if (window.__dw) return;
  var post = function (msg) {
    try { window.webkit.messageHandlers.dw.postMessage(msg); } catch (e) {}
  };

  // ---- Look like desktop Safari ---------------------------------------------------
  // WhatsApp treats "Mac + maxTouchPoints > 2" as an iPad/iPhone and shows a
  // "Download WhatsApp from the App Store" overlay instead of the login screen.
  // Touch input itself keeps working; only the capability report changes.
  try {
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: function () { return 0; }, configurable: true });
  } catch (e) {}

  // ---- Notification API shim -------------------------------------------------
  // WKWebView has no window.Notification; WhatsApp Web uses it for new-message alerts.
  var live = {};
  var seq = 0;
  var loggedIn = false;
  function DWNotification(title, options) {
    options = options || {};
    this.title = String(title || '');
    this.body = options.body ? String(options.body) : '';
    this.tag = options.tag ? String(options.tag) : '';
    this.icon = options.icon || '';
    this.data = options.data;
    this.onclick = null; this.onclose = null; this.onerror = null; this.onshow = null;
    this._id = 'n' + (++seq) + '-' + Date.now();
    this._listeners = {};
    live[this._id] = this;
    post({ type: 'notify', id: this._id, title: this.title, body: this.body, tag: this.tag });
    var self = this;
    setTimeout(function () { self._fire('show'); }, 0);
  }
  DWNotification.permission = 'granted';
  DWNotification.maxActions = 0;
  // Native asks for iOS permission once the chat list has loaded (see "loggedIn").
  DWNotification.requestPermission = function (cb) {
    if (typeof cb === 'function') cb('granted');
    return Promise.resolve('granted');
  };
  DWNotification.prototype.close = function () {
    if (this.tag) post({ type: 'closeNotification', tag: this.tag });
    delete live[this._id];
    this._fire('close');
  };
  DWNotification.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  DWNotification.prototype.removeEventListener = function (type, fn) {
    var l = this._listeners[type]; if (!l) return;
    var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1);
  };
  DWNotification.prototype._fire = function (type) {
    var ev = { type: type, target: this, currentTarget: this, preventDefault: function () {} };
    try { if (typeof this['on' + type] === 'function') this['on' + type](ev); } catch (e) {}
    (this._listeners[type] || []).slice().forEach(function (fn) { try { fn.call(this, ev); } catch (e) {} }, this);
  };
  try {
    Object.defineProperty(window, 'Notification', { value: DWNotification, writable: true, configurable: true });
  } catch (e) { window.Notification = DWNotification; }

  // Some code paths query the Permissions API for notifications.
  if (navigator.permissions && navigator.permissions.query) {
    var origQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (desc) {
      if (desc && desc.name === 'notifications') {
        return Promise.resolve({ state: 'granted', status: 'granted', onchange: null,
          addEventListener: function () {}, removeEventListener: function () {} });
      }
      return origQuery(desc);
    };
  }

  // ---- Login detection -----------------------------------------------------------
  // (The unread badge is read natively from the page title, which keeps working when JS is throttled.)
  setInterval(function () {
    if (!loggedIn && document.getElementById('side')) { loggedIn = true; post({ type: 'loggedIn' }); }
  }, 2000);

  // ---- Colors behind the status bar / home indicator -------------------------------
  // Native paints the strips above and below the web view with the page's edge colors.
  function bgAt(x, y) {
    var el = document.elementFromPoint(x, y);
    for (; el && el !== document.documentElement; el = el.parentElement) {
      var c = getComputedStyle(el).backgroundColor;
      if (c && c !== 'transparent' && !/,\s*0\)$/.test(c)) return c;
    }
    return getComputedStyle(document.body || document.documentElement).backgroundColor;
  }
  var lastEdges = '';
  setInterval(function () {
    if (!document.body || document.hidden) return;
    var top = bgAt(window.innerWidth / 2, 2), bottom = bgAt(window.innerWidth / 2, window.innerHeight - 2);
    if (top + bottom !== lastEdges) { lastEdges = top + bottom; post({ type: 'edges', top: top, bottom: bottom }); }
  }, 1000);

  // ---- Focus ------------------------------------------------------------------------
  // WhatsApp never shows a notification while document.hasFocus() is true, and uses focus for
  // read receipts. In a WKWebView hasFocus() depends on UIKit first-responder state, so report the
  // app's real foreground/background state instead (native calls setAppActive on lifecycle changes).
  var appActive = true;
  Document.prototype.hasFocus = function () { return appActive; };
  function setAppActive(v) {
    v = !!v;
    if (v === appActive) return;
    appActive = v;
    try { window.dispatchEvent(new FocusEvent(v ? 'focus' : 'blur')); } catch (e) {}
  }

  // ---- Background keep-alive (opt-in) ----------------------------------------------
  // WebKit keeps a page's process at foreground priority while it is audible. A looping clip of
  // digital silence (volume > 0, not muted) therefore keeps WhatsApp connected in the background.
  var keepAliveEl = null;
  function silentWavURL() {
    var n = 8000, buf = new Uint8Array(44 + n), dv = new DataView(buf.buffer);
    var w = function (o, str) { for (var i = 0; i < str.length; i++) buf[o + i] = str.charCodeAt(i); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    w(36, 'data'); dv.setUint32(40, n, true); buf.fill(0x80, 44); // 1 s of 8-bit PCM silence
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function keepAlive(on) {
    if (!on) { if (keepAliveEl) keepAliveEl.pause(); return; }
    if (!keepAliveEl) { keepAliveEl = new Audio(silentWavURL()); keepAliveEl.loop = true; }
    keepAliveEl.play().catch(function () {});
  }

  // ---- API used from Swift --------------------------------------------------------
  window.__dw = {
    setAppActive: setAppActive,
    keepAlive: keepAlive,
    notificationClicked: function (id) {
      var n = live[id];
      window.focus();
      if (n) n._fire('click');
    }
  };
  // Every new document (including reloads while in the background) asks native for the app state.
  post({ type: 'ready' });
})();
