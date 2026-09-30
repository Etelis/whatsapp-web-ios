import UIKit
import WebKit

/// Hosts web.whatsapp.com in a WKWebView and bridges it to iOS: notifications, badge,
/// keyboard, downloads, back navigation and background keep-alive.
final class WebViewController: UIViewController {
    static let home = URL(string: "https://web.whatsapp.com/")!

    /// Desktop Safari on macOS. WhatsApp Web redirects mobile user agents to a "download the app" page.
    static let desktopUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"

    /// Keep WhatsApp connected in the background (silent in-page audio) so notifications arrive.
    /// On by default; toggled from the shake menu or the Settings app.
    static var keepAliveEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "keepAlive") }
        set { UserDefaults.standard.set(newValue, forKey: "keepAlive") }
    }

    private var webView: WKWebView!
    private var webViewBottom: NSLayoutConstraint!
    private let bottomFill = UIView()
    private let downloads = DownloadManager()
    private let backSwipeLeft = UIScreenEdgePanGestureRecognizer()
    private let backSwipeRight = UIScreenEdgePanGestureRecognizer()
    private var titleObservation: NSKeyValueObservation?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var lastBadge = -1

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // persistent: the linked session survives relaunches
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.preferredContentMode = .desktop
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        // With WhatsApp's domains in WKAppBoundDomains (Info.plist) WKWebView enables Service Workers,
        // which WhatsApp Web uses for media and downloads.
        config.limitsNavigationsToAppBoundDomains = true

        let content = WKUserContentController()
        for name in ["Bridge", "Layout"] {
            guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
                  let source = try? String(contentsOf: url, encoding: .utf8) else { continue }
            content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        content.add(WeakScriptHandler(self), name: "dw")
        config.userContentController = content

        webView = WKWebView(frame: .zero, configuration: config)
        webView.customUserAgent = Self.desktopUserAgent
        #if DEBUG
        webView.isInspectable = true // Safari > Develop on the Mac
        #endif
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        downloads.presenter = self

        // Status bar / home indicator strips are painted with the page's edge colors ("edges" message).
        let root = UIView()
        root.backgroundColor = .systemBackground
        bottomFill.backgroundColor = .systemBackground
        root.addSubview(bottomFill)
        root.addSubview(webView)
        bottomFill.translatesAutoresizingMaskIntoConstraints = false
        webView.translatesAutoresizingMaskIntoConstraints = false
        webViewBottom = webView.bottomAnchor.constraint(equalTo: root.safeAreaLayoutGuide.bottomAnchor)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.safeAreaLayoutGuide.topAnchor),
            webViewBottom,
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            bottomFill.topAnchor.constraint(equalTo: root.centerYAnchor),
            bottomFill.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            bottomFill.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            bottomFill.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NotificationManager.shared.onTap = { [weak self] jsId in
            self?.webView.callAsyncJavaScript("window.__dw?.notificationClicked(id)", arguments: ["id": jsId], in: nil, in: .page)
        }
        titleObservation = webView.observe(\.title) { [weak self] webView, _ in
            DispatchQueue.main.async { self?.updateBadge(fromTitle: webView.title) }
        }
        for (gesture, edge) in [(backSwipeLeft, UIRectEdge.left), (backSwipeRight, UIRectEdge.right)] {
            gesture.edges = edge
            gesture.isEnabled = false
            gesture.addTarget(self, action: #selector(handleBackSwipe(_:)))
            webView.addGestureRecognizer(gesture)
        }
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        nc.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        nc.addObserver(self, selector: #selector(appWillResignActive), name: UIApplication.willResignActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(appDidEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        reload()
    }

    func reload() {
        webView.load(URLRequest(url: Self.home))
    }

    // MARK: - Keyboard

    /// Shrinks the web view above the keyboard so the message box stays visible.
    @objc private func keyboardWillChange(_ note: Notification) {
        guard let info = note.userInfo,
              let endFrame = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
        var overlap: CGFloat = 0
        if note.name != UIResponder.keyboardWillHideNotification, let window = view.window {
            let keyboard = view.convert(endFrame, from: window.screen.coordinateSpace)
            overlap = max(0, view.bounds.maxY - keyboard.minY - view.safeAreaInsets.bottom)
        }
        guard webViewBottom.constant != -overlap else { return }
        webViewBottom.constant = -overlap
        let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
        UIView.animate(withDuration: duration, delay: 0, options: UIView.AnimationOptions(rawValue: curve << 16)) {
            self.view.layoutIfNeeded()
        }
    }

    // MARK: - App lifecycle

    @objc private func appWillResignActive() {
        // Start the keep-alive while the page is still visible; WebKit may refuse to start playback later.
        if Self.keepAliveEnabled { webView.evaluateJavaScript("window.__dw && window.__dw.keepAlive(true)") }
    }

    @objc private func appDidEnterBackground() {
        // WhatsApp only notifies while the page reports no focus.
        webView.evaluateJavaScript("window.__dw && window.__dw.setAppActive(false)")
        beginBackgroundTask()
    }

    @objc private func appDidBecomeActive() {
        endBackgroundTask()
        webView.evaluateJavaScript("window.__dw && (window.__dw.setAppActive(true), window.__dw.keepAlive(false))")
        refreshBadge() // notification permission may have changed in Settings
    }

    /// A new document (e.g. a reload while in the background) starts out focused and silent; re-apply background state.
    private func pageReady() {
        guard UIApplication.shared.applicationState == .background else { return }
        webView.evaluateJavaScript("window.__dw.setAppActive(false)" + (Self.keepAliveEnabled ? "; window.__dw.keepAlive(true)" : ""))
    }

    /// Grace period for messages arriving right after leaving the app (the only one without keep-alive).
    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "WhatsAppGrace") { [weak self] in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: - Unread badge

    /// "(3) WhatsApp Business – …" -> 3, "WhatsApp" -> 0, anything else (title flashing) -> nil.
    static func unreadCount(fromTitle title: String?) -> Int? {
        guard let t = title?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        if t.hasPrefix("("), let close = t.firstIndex(of: ")") {
            // wholeNumberValue accepts non-Latin digits; separators such as "1,234" are skipped.
            let digits = t[t.index(after: t.startIndex)..<close].compactMap(\.wholeNumberValue)
            return digits.isEmpty ? nil : digits.reduce(0) { $0 * 10 + $1 }
        }
        return t.hasPrefix("WhatsApp") ? 0 : nil
    }

    private func updateBadge(fromTitle title: String?) {
        guard let count = Self.unreadCount(fromTitle: title), count != lastBadge else { return }
        lastBadge = count
        NotificationManager.shared.setBadge(count)
    }

    private func refreshBadge() {
        lastBadge = -1
        updateBadge(fromTitle: webView.title)
    }

    // MARK: - Back swipe (Layout.js reports which page is shown)

    private func layoutChanged(_ body: [String: Any]) {
        let inChat = body["inChat"] as? Bool ?? false
        let rtl = body["rtl"] as? Bool ?? false
        backSwipeLeft.isEnabled = inChat && !rtl
        backSwipeRight.isEnabled = inChat && rtl
    }

    @objc private func handleBackSwipe(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended, abs(gesture.translation(in: webView).x) > 60 else { return }
        webView.evaluateJavaScript("window.__wam && window.__wam.back()")
    }

    // MARK: - Shake menu

    // Shake events travel up the responder chain from the web view, so the page keeps focus.
    override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        guard motion == .motionShake, presentedViewController == nil else { return }
        webView.evaluateJavaScript("window.__wam ? window.__wam.mode() : 'mobile'") { [weak self] result, _ in
            self?.showMenu(desktopLayout: (result as? String) == "desktop")
        }
    }

    private func showMenu(desktopLayout: Bool) {
        let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        sheet.addAction(UIAlertAction(title: "Reload", style: .default) { [weak self] _ in self?.reload() })
        let keep = Self.keepAliveEnabled
        sheet.addAction(UIAlertAction(title: keep ? "Background connection: On ✓" : "Background connection: Off",
                                      style: .default) { [weak self] _ in self?.setKeepAlive(!keep) })
        sheet.addAction(UIAlertAction(title: desktopLayout ? "Use phone layout" : "Use desktop layout (zoomable)",
                                      style: .default) { [weak self] _ in
            self?.webView.evaluateJavaScript("window.__wam && window.__wam.setMode('\(desktopLayout ? "mobile" : "desktop")')")
        })
        sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        if let pop = sheet.popoverPresentationController {
            pop.sourceView = view
            pop.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        }
        present(sheet, animated: true)
    }

    private func setKeepAlive(_ on: Bool) {
        guard on else { Self.keepAliveEnabled = false; return }
        let alert = UIAlertController(
            title: "Stay connected in background?",
            message: "Keeps WhatsApp connected after you leave the app so new messages still notify you. It plays inaudible audio to stay awake, which uses more battery.",
            preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Turn On", style: .default) { _ in Self.keepAliveEnabled = true })
        present(alert, animated: true)
    }

    // MARK: - Helpers

    /// Parses "rgb(r, g, b)" / "rgba(r, g, b, a)" from getComputedStyle.
    static func color(fromCSS css: String?) -> UIColor? {
        guard let css, let open = css.firstIndex(of: "("), let close = css.lastIndex(of: ")") else { return nil }
        let parts = css[css.index(after: open)..<close].split(separator: ",").compactMap {
            Double($0.trimmingCharacters(in: .whitespaces))
        }
        guard parts.count >= 3 else { return nil }
        return UIColor(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: 1)
    }

    /// Only WhatsApp Web itself loads in the web view; any other page would replace the session.
    private static func isWebApp(_ url: URL) -> Bool {
        url.host?.lowercased() == home.host
    }

    /// Opens a link outside the web view. Click-to-chat links (wa.me/<number>, api.whatsapp.com/send)
    /// open the chat in this account instead of the phone's WhatsApp app.
    private func openExternally(_ url: URL) {
        let host = url.host?.lowercased()
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let phone = host == "wa.me" ? url.pathComponents.dropFirst().first
            : host == "api.whatsapp.com" && url.path == "/send" ? query.first { $0.name == "phone" }?.value : nil
        if let phone, !phone.isEmpty, phone.allSatisfy(\.isNumber) {
            var chat = URLComponents(string: "https://web.whatsapp.com/send")!
            chat.queryItems = [URLQueryItem(name: "phone", value: phone)] + query.filter { $0.name == "text" }
            webView.load(URLRequest(url: chat.url!))
        } else {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Messages from Bridge.js / Layout.js

extension WebViewController: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "notify":
            NotificationManager.shared.post(id: body["id"] as? String ?? UUID().uuidString,
                                            title: body["title"] as? String ?? "WhatsApp",
                                            body: body["body"] as? String ?? "",
                                            tag: body["tag"] as? String)
        case "closeNotification":
            if let tag = body["tag"] as? String { NotificationManager.shared.close(tag: tag) }
        case "ready":
            pageReady()
        case "loggedIn":
            // Asked only once logged in, not on the QR screen.
            NotificationManager.shared.requestAuthorization { [weak self] granted in
                if granted { self?.refreshBadge() }
            }
        case "edges":
            if let top = Self.color(fromCSS: body["top"] as? String) { view.backgroundColor = top }
            if let bottom = Self.color(fromCSS: body["bottom"] as? String) { bottomFill.backgroundColor = bottom }
        case "layout":
            layoutChanged(body)
        default:
            break
        }
    }
}

// MARK: - Navigation & downloads

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
        guard let url = navigationAction.request.url else { return decisionHandler(.allow) }
        let isSubframe = navigationAction.targetFrame?.isMainFrame == false
        if isSubframe || Self.isWebApp(url) || ["blob", "data", "about"].contains(url.scheme?.lowercased() ?? "") {
            decisionHandler(.allow)
        } else {
            openExternally(url) // other sites to Safari; tel:, mailto:, maps: to their apps
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
        let isAttachment = disposition?.lowercased().hasPrefix("attachment") ?? false
        decisionHandler(!navigationResponse.canShowMIMEType || isAttachment ? .download : .allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = downloads
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = downloads
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // iOS killed the web process (memory pressure); reconnect. In the background, pageReady()
        // restores the background state once the new page starts.
        if UIApplication.shared.applicationState == .background { beginBackgroundTask() }
        reload()
    }
}

// MARK: - New windows, camera/mic, JS dialogs

extension WebViewController: WKUIDelegate {
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target=_blank / window.open: WhatsApp Web URLs load here, everything else opens outside.
        if let url = navigationAction.request.url {
            if Self.isWebApp(url) { webView.load(navigationAction.request) } else { openExternally(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host.lowercased() == "web.whatsapp.com" ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}

/// WKUserContentController retains its handlers; this breaks the cycle with the view controller.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
