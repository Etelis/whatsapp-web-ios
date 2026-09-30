import UIKit
import UserNotifications

/// Bridges the web page's `Notification` API to iOS local notifications
/// and mirrors the unread count onto the app icon badge.
final class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    /// Called when the user taps a notification; receives the JS-side notification id.
    var onTap: ((String) -> Void)?

    private let center = UNUserNotificationCenter.current()

    func configure() {
        center.delegate = self
    }

    func requestAuthorization(completion: ((Bool) -> Void)? = nil) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async { completion?(granted) }
        }
    }

    func post(id: String, title: String, body: String, tag: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["jsId": id]
        if let tag, !tag.isEmpty { content.threadIdentifier = tag }
        // Reusing the tag as the request id makes a newer message from the same chat replace the older banner.
        let identifier = content.threadIdentifier.isEmpty ? id : content.threadIdentifier
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    func close(tag: String) {
        center.removeDeliveredNotifications(withIdentifiers: [tag])
    }

    func setBadge(_ count: Int) {
        center.setBadgeCount(count)
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // While the app is on screen the chat is already visible; only play a sound + keep it in the list.
        completionHandler([.list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        if let jsId = response.notification.request.content.userInfo["jsId"] as? String {
            DispatchQueue.main.async { self.onTap?(jsId) }
        }
        completionHandler()
    }
}
