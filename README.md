<p align="center"><img src="WhatsAppWeb/Assets.xcassets/AppIcon.appiconset/AppIcon.png" width="96" alt=""></p>

# WhatsApp Web for iOS

Use a second WhatsApp or WhatsApp Business account on your iPhone, as a linked device.

iPhone Safari won't open [web.whatsapp.com](https://web.whatsapp.com); it asks you to download the app instead. This app loads the official WhatsApp Web in a native iPhone app and adapts it to the phone.

## Features

- Log in with the QR code or with an 8-character code sent to your phone number
- Phone layout: chat list and conversation as separate screens, with a back button and edge swipe
- One tap opens a chat; long-press opens WhatsApp's menu (reply, forward, delete…)
- iOS notifications, also in the background; tapping one opens the chat; unread count on the app icon
- Voice notes, camera, photos/files, downloads via the share sheet
- `wa.me` links open the chat in this account
- Stays logged in; follows light/dark mode

## How it works

| Problem | Fix |
|---|---|
| WhatsApp sends phone browsers to a "download the app" page | macOS Safari user agent and `navigator.maxTouchPoints = 0` |
| WKWebView has no Service Workers | WhatsApp domains listed in `WKAppBoundDomains` |
| The desktop layout is at least 748px wide | `Layout.js` shows two phone-width pages: chat list and chat |
| iOS needs two taps on elements with hover styles | Taps are sent as clicks and long-presses as right-clicks |
| WKWebView has no `Notification` API | `Bridge.js` passes notifications to iOS; `hasFocus()` follows the app state |
| iOS suspends apps in the background | Inaudible in-page audio keeps the connection open |

| File | Role |
|---|---|
| `WebViewController.swift` | Web view setup, navigation, keyboard, badge, lifecycle, shake menu |
| `Bridge.js` | Notification shim, focus, keep-alive audio, desktop spoofing |
| `Layout.js` | Phone layout, back navigation, touch handling, login-screen scaling |
| `NotificationManager.swift` | Local notifications and badge |
| `DownloadManager.swift` | Saves downloads and shows the share sheet |

## Install

Requires Xcode 16 or later, an iPhone on iOS 17 or later, and an Apple ID. With a free account, the app expires after 7 days; with a paid developer account, after a year.

1. Clone the repo and create `Local.xcconfig` (git-ignored):
   ```
   DEVELOPMENT_TEAM = ABCDE12345
   PRODUCT_BUNDLE_IDENTIFIER = com.yourname.whatsappweb
   APP_DISPLAY_NAME = WA Business   // optional, defaults to "WA Web"
   ```
2. Open `WhatsAppWeb.xcodeproj`, select your iPhone and press **Run** (⌘R). Turn on **Developer Mode** on the phone if asked.
3. On the phone that already has the account, go to **Settings → Linked devices → Link a device** and scan the QR code shown in the app. Or tap **Log in with phone number** in the app and enter the code on that phone.

## Use

- **Shake** the phone for Reload, the background-connection toggle, and a zoomable desktop layout.
- **Stay connected in background** is on by default; you'll find it under the app's name in the iOS Settings app. It uses more battery. Without it, notifications only arrive while the app is open.

## Limitations

- Calls aren't supported; WhatsApp Web doesn't offer them in this browser.
- The background connection can still drop, for example when another app plays audio or during a phone call.
- The layout depends on WhatsApp Web's page structure. If an update breaks it, switch to the desktop layout from the shake menu.

## Disclaimer

Not affiliated with WhatsApp or Meta. The app only displays the official web.whatsapp.com and does not use an unofficial protocol. Use it at your own risk.

## License

[MIT](LICENSE)
