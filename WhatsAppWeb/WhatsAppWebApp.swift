import SwiftUI

@main
struct WhatsAppWebApp: App {
    init() {
        // Staying connected in the background is what makes notifications arrive outside the app.
        UserDefaults.standard.register(defaults: ["keepAlive": true])
        NotificationManager.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            WebContainer().ignoresSafeArea() // WebViewController handles safe areas and the keyboard
        }
    }
}

private struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController { WebViewController() }
    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}
