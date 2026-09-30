import UIKit
import WebKit

/// Saves files the page downloads (media, documents) to a temporary folder,
/// then offers the share sheet so they can be saved to Photos/Files or shared.
final class DownloadManager: NSObject, WKDownloadDelegate {
    weak var presenter: UIViewController?

    private var destinations: [ObjectIdentifier: URL] = [:]

    func download(_ download: WKDownload,
                  decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        // A fresh folder per download keeps the suggested name and avoids collisions.
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(suggestedFilename.isEmpty ? "download" : suggestedFilename)
        destinations[ObjectIdentifier(download)] = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = destinations.removeValue(forKey: ObjectIdentifier(download)), let presenter else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = presenter.view
        (presenter.presentedViewController ?? presenter).present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        destinations.removeValue(forKey: ObjectIdentifier(download))
        let alert = UIAlertController(title: "Download failed", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter?.present(alert, animated: true)
    }
}
