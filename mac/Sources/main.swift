// SQUIZZZzZ Pult – dünne Mac-App um die Host-Seite.
// Zeigt https://squizzzzz-live.github.io/host/ in einem eigenen Fenster und gibt der Seite
// zwei Fähigkeiten, die ein Browser nicht hat:
//   1. Dateien aus ~/Desktop/SQUIZZZzZ lesen (nur lesen, nur innerhalb dieses Ordners)
//   2. QLab per OSC steuern (Passcode liegt im Mac-Schlüsselbund, nie in der Seite)
// Die Brücke antwortet nur der Hauptseite von squizzzzz-live.github.io über https.

import Cocoa
import WebKit
import Network
import Security

let ALLOWED_HOST = "squizzzzz-live.github.io"
let DEFAULT_START = URL(string: "https://squizzzzz-live.github.io/host/")!
let TEST_PAGE = URL(string: "https://squizzzzz-live.github.io/host/mac-test.html")!
let ROOT = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Desktop/SQUIZZZzZ", isDirectory: true)
let APP_VERSION = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "dev"
let MAX_READ = 80_000_000

// MARK: - Schlüsselbund (QLab-Passcode)

enum Keychain {
    static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "de.squizzzzz.pult.qlab",
        kSecAttrAccount as String: "passcode",
    ]
    static func get() -> String? {
        var q = base
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        let s = String(decoding: d, as: UTF8.self)
        return s.isEmpty ? nil : s
    }
    static func set(_ value: String) {
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        SecItemAdd(add as CFDictionary, nil)
    }
}

// MARK: - OSC (nur was QLab braucht: Strings, Int32, Float32)

enum OSC {
    static func padded(_ s: String) -> Data {
        var d = Data(s.utf8)
        d.append(0)
        while d.count % 4 != 0 { d.append(0) }
        return d
    }
    static func message(_ address: String, _ args: [Any]) -> Data {
        var tags = ","
        var body = Data()
        for a in args {
            if let s = a as? String {
                tags += "s"; body.append(padded(s))
            } else if let i = a as? Int {
                tags += "i"; var v = Int32(truncatingIfNeeded: i).bigEndian
                body.append(Data(bytes: &v, count: 4))
            } else if let f = a as? Double {
                tags += "f"; var v = Float(f).bitPattern.bigEndian
                body.append(Data(bytes: &v, count: 4))
            }
        }
        var d = padded(address)
        d.append(padded(tags))
        d.append(body)
        return d
    }
    static func readString(_ b: [UInt8], _ i: inout Int) -> String? {
        guard i < b.count, let end = b[i...].firstIndex(of: 0) else { return nil }
        let s = String(decoding: b[i..<end], as: UTF8.self)
        i += ((end - i) / 4 + 1) * 4
        return s
    }
    /// Liefert (Adresse, erstes String-Argument) – QLab antwortet mit JSON im ersten String.
    static func parseReply(_ d: Data) -> (String, String)? {
        let b = [UInt8](d)
        var i = 0
        guard let addr = readString(b, &i), let tags = readString(b, &i), tags.hasPrefix(",") else { return nil }
        if tags.dropFirst().first == "s", let s = readString(b, &i) { return (addr, s) }
        return (addr, "")
    }
}

// MARK: - QLab-Verbindung (TCP 53000, SLIP-gerahmt nach OSC 1.1)
// TCP statt UDP: QLab trennt UDP-Clients nach 61 s Stille, große Cue-Listen passen nicht in ein
// UDP-Paket, und Antworten kommen bei TCP zuverlässig über dieselbe Verbindung zurück.

enum SLIP {
    static let END: UInt8 = 0xC0, ESC: UInt8 = 0xDB, ESC_END: UInt8 = 0xDC, ESC_ESC: UInt8 = 0xDD
    static func encode(_ d: Data) -> Data {
        var out = Data([END])
        for b in d {
            switch b {
            case END: out.append(contentsOf: [ESC, ESC_END])
            case ESC: out.append(contentsOf: [ESC, ESC_ESC])
            default: out.append(b)
            }
        }
        out.append(END)
        return out
    }
    static func decode(_ frame: [UInt8]) -> Data {
        var out = Data(); var esc = false
        for b in frame {
            if esc { out.append(b == ESC_END ? END : b == ESC_ESC ? ESC : b); esc = false }
            else if b == ESC { esc = true }
            else { out.append(b) }
        }
        return out
    }
}

final class QLab {
    private let q = DispatchQueue(label: "de.squizzzzz.pult.qlab")
    private var conn: NWConnection?
    private var buffer: [UInt8] = []
    private var pending: [String: [(String?) -> Void]] = [:]
    private var workspace: String?
    private var passcode: String?          // einmal aus dem Schlüsselbund gelesen, dann im Speicher
    private(set) var workspaceName: String?
    private var log: [String] = []

    func reset() {
        q.async {
            self.passcode = nil
            self.drop("zurückgesetzt")
        }
    }

    func recentLog(_ done: @escaping ([String]) -> Void) { q.async { let l = self.log; DispatchQueue.main.async { done(l) } } }

    private func note(_ s: String) {
        let f = DateFormatter(); f.dateFormat = "HH:mm:ss"
        log.append("\(f.string(from: Date()))  \(s)")
        if log.count > 40 { log.removeFirst(log.count - 40) }
    }

    private func drop(_ why: String) {
        note("Verbindung weg: \(why)")
        conn?.cancel(); conn = nil
        workspace = nil; workspaceName = nil; buffer = []
        let waiting = pending; pending = [:]
        waiting.values.flatMap { $0 }.forEach { $0(nil) }
    }

    private func ensureConnection() {
        guard conn == nil else { return }
        let c = NWConnection(host: "127.0.0.1", port: 53000, using: .tcp)
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self = self, let c = c, c === self.conn else { return }
            switch state {
            case .ready: self.note("TCP verbunden")
            case .failed(let e): self.drop("Fehler \(e)")
            case .cancelled: break
            case .waiting(let e): self.drop("wartet (\(e)) – läuft QLab?")
            default: break
            }
        }
        conn = c
        c.start(queue: q)
        receive(on: c)
    }

    private func receive(on c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, complete, error in
            guard let self = self, c === self.conn else { return }
            if let d = data { self.ingest([UInt8](d)) }
            if complete || error != nil { self.drop(error.map { "\($0)" } ?? "von QLab beendet"); return }
            self.receive(on: c)
        }
    }

    private func ingest(_ bytes: [UInt8]) {
        for b in bytes {
            if b == SLIP.END {
                if !buffer.isEmpty { handle(SLIP.decode(buffer)); buffer = [] }
            } else {
                buffer.append(b)
            }
        }
    }

    private func handle(_ d: Data) {
        guard let (addr, json) = OSC.parseReply(d) else { return }
        note("← \(addr.replacingOccurrences(of: workspace ?? "§", with: "…"))")
        if let callbacks = pending.removeValue(forKey: addr) { callbacks.forEach { $0(json) } }
    }

    /// Läuft auf q. done höchstens einmal: Antwort oder nil (Zeitüberschreitung / Verbindung weg).
    private func send(_ address: String, _ args: [Any], timeout: Double = 2.5, _ done: @escaping (String?) -> Void) {
        ensureConnection()
        let key = "/reply" + address
        var fired = false
        let once: (String?) -> Void = { r in
            if fired { return }
            fired = true
            done(r)
        }
        pending[key, default: []].append(once)
        let shown = address.replacingOccurrences(of: workspace ?? "§", with: "…")
        note("→ \(shown.hasSuffix("/connect") ? shown + " ••••" : shown)")
        conn?.send(content: SLIP.encode(OSC.message(address, args)), completion: .contentProcessed { _ in })
        q.asyncAfter(deadline: .now() + timeout) { [weak self] in
            if !fired {
                self?.note("⏱ keine Antwort auf \(shown)")
                self?.pending[key] = nil
                once(nil)
            }
        }
    }

    private func fire(_ address: String, _ args: [Any]) {
        ensureConnection()
        conn?.send(content: SLIP.encode(OSC.message(address, args)), completion: .contentProcessed { _ in })
    }

    static func object(_ json: String) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
    }

    private func ensureWorkspace(_ done: @escaping (String?) -> Void, retry: Bool = true) {
        if workspace != nil { done(nil); return }
        send("/workspaces", []) { r in
            if r == nil, retry { self.ensureWorkspace(done, retry: false); return }
            guard let r = r, let o = QLab.object(r), let list = o["data"] as? [[String: Any]], !list.isEmpty else {
                done("QLab antwortet nicht. Läuft QLab mit geöffnetem Workspace „SQUIZZZzZ Live“?")
                return
            }
            let pick = list.first { (($0["displayName"] as? String) ?? "").contains("SQUIZZZzZ Live") } ?? list[0]
            guard let id = pick["uniqueID"] as? String else { done("QLab meldet keinen Workspace."); return }
            if self.passcode == nil { self.passcode = Keychain.get() }
            let pass = self.passcode ?? ""
            self.send("/workspace/\(id)/connect", pass.isEmpty ? [] : [pass]) { r in
                guard let r = r, let o = QLab.object(r) else { done("QLab antwortet nicht auf die Anmeldung."); return }
                let data = (o["data"] as? String) ?? ""
                if (o["status"] as? String) == "ok", data.hasPrefix("ok") {
                    self.workspace = id
                    self.workspaceName = pick["displayName"] as? String
                    // Ohne alwaysReply antwortet QLab nur auf Abfragen, nicht auf start/pause/resume/stop.
                    self.fire("/workspace/\(id)/alwaysReply", [1])
                    self.fire("/alwaysReply", [1])
                    self.q.asyncAfter(deadline: .now() + 0.15) { done(nil) }
                } else if pass.isEmpty {
                    done("QLab-Passcode fehlt. Menü „SQUIZZZzZ Pult“ → „QLab-Passcode festlegen…“.")
                } else {
                    self.passcode = nil
                    done("QLab lehnt den Passcode ab (\(data.isEmpty ? (o["status"] as? String ?? "?") : data)).")
                }
            }
        }
    }

    /// address ist relativ zum Workspace, z. B. "/cueLists" oder "/cue/1.1/start".
    func call(_ address: String, _ args: [Any], _ done: @escaping (String?, String?) -> Void) {
        q.async {
            self.ensureWorkspace { err in
                if let e = err { DispatchQueue.main.async { done(nil, e) }; return }
                guard let ws = self.workspace else { DispatchQueue.main.async { done(nil, "Keine Verbindung zu QLab.") }; return }
                self.send("/workspace/\(ws)" + address, args) { r in
                    DispatchQueue.main.async {
                        if let r = r { done(r, nil) } else { done(nil, "QLab antwortet nicht auf \(address).") }
                    }
                }
            }
        }
    }
}

// MARK: - Brücke Seite ⇄ Mac

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    let qlab = QLab()

    func resolve(_ relative: String) -> URL? {
        let root = ROOT.standardizedFileURL.resolvingSymlinksInPath().path
        let u = ROOT.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        return (u.path == root || u.path.hasPrefix(root + "/")) ? u : nil
    }

    static func convert(_ a: Any) -> Any {
        if let s = a as? String { return s }
        if let n = a as? NSNumber { return CFNumberIsFloatType(n) ? n.doubleValue : n.intValue }
        return "\(a)"
    }

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "https", origin.host == ALLOWED_HOST else {
            replyHandler(nil, "Diese Seite darf die Mac-Brücke nicht benutzen.")
            return
        }
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else {
            replyHandler(nil, "Ungültige Anfrage.")
            return
        }
        let args = (body["args"] as? [String: Any]) ?? [:]

        switch cmd {
        case "info":
            var isDir: ObjCBool = false
            let found = FileManager.default.fileExists(atPath: ROOT.path, isDirectory: &isDir) && isDir.boolValue
            replyHandler(["version": APP_VERSION, "root": ROOT.path, "rootFound": found,
                          "passcodeSet": UserDefaults.standard.bool(forKey: "qlabPasscodeSet")], nil)

        case "list":
            guard let u = resolve((args["path"] as? String) ?? "") else { replyHandler(nil, "Pfad liegt außerhalb von SQUIZZZzZ."); return }
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey]
                    let items = try FileManager.default.contentsOfDirectory(at: u, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
                    let out: [[String: Any]] = items.map { f in
                        let v = try? f.resourceValues(forKeys: Set(keys))
                        return ["name": f.lastPathComponent, "dir": v?.isDirectory ?? false, "size": v?.fileSize ?? 0]
                    }.sorted { ($0["name"] as! String).localizedStandardCompare($1["name"] as! String) == .orderedAscending }
                    DispatchQueue.main.async { replyHandler(out, nil) }
                } catch {
                    DispatchQueue.main.async { replyHandler(nil, "Ordner nicht lesbar: \(error.localizedDescription)") }
                }
            }

        case "read":
            guard let u = resolve((args["path"] as? String) ?? "") else { replyHandler(nil, "Pfad liegt außerhalb von SQUIZZZzZ."); return }
            let asBase64 = (args["base64"] as? Bool) ?? false
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let size = (try u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                    if size > MAX_READ { throw NSError(domain: "pult", code: 1, userInfo: [NSLocalizedDescriptionKey: "Datei ist zu groß (\(size / 1_000_000) MB)."]) }
                    let d = try Data(contentsOf: u)
                    let out = asBase64 ? d.base64EncodedString() : String(decoding: d, as: UTF8.self)
                    DispatchQueue.main.async { replyHandler(out, nil) }
                } catch {
                    DispatchQueue.main.async { replyHandler(nil, "Datei nicht lesbar: \(error.localizedDescription)") }
                }
            }

        case "qlab":
            guard let address = args["address"] as? String, address.hasPrefix("/") else { replyHandler(nil, "OSC-Adresse fehlt."); return }
            let a = ((args["args"] as? [Any]) ?? []).map(Bridge.convert)
            qlab.call(address, a) { result, error in replyHandler(result, error) }

        case "qlabLog":
            qlab.recentLog { replyHandler($0, nil) }

        case "qlabReset":
            qlab.reset()
            replyHandler(true, nil)

        default:
            replyHandler(nil, "Unbekannter Befehl: \(cmd)")
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    let bridge = Bridge()
    var popups: [NSWindow] = []
    var activity: NSObjectProtocol?

    var startURL: URL {
        if let s = UserDefaults.standard.string(forKey: "startURL"), let u = URL(string: s) { return u }
        return DEFAULT_START
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                       // Anmeldung bleibt erhalten
        cfg.mediaTypesRequiringUserActionForPlayback = []      // Buzzernamen ohne „Ton an“-Klick
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "sqz")
        let marker = "window.__sqzMac = { version: \"\(APP_VERSION)\" };"
        cfg.userContentController.addUserScript(WKUserScript(source: marker, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "SQUIZZZzZ Pult"
        window.contentView = web
        window.collectionBehavior = [.fullScreenPrimary]
        window.center()
        window.setFrameAutosaveName("PultFenster")
        window.makeKeyAndOrderFront(nil)

        // Während der Show soll der Bildschirm nicht schlafen gehen
        activity = ProcessInfo.processInfo.beginActivity(options: [.idleDisplaySleepDisabled, .userInitiated], reason: "SQUIZZZzZ Live-Show")

        web.load(URLRequest(url: startURL))
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: Menü

    func item(_ title: String, _ action: Selector, _ key: String, _ mods: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.keyEquivalentModifierMask = mods
        i.target = target
        return i
    }

    func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu(title: "SQUIZZZzZ Pult")
        appMenu.addItem(item("Über SQUIZZZzZ Pult", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""))
        appMenu.addItem(.separator())
        appMenu.addItem(item("QLab-Passcode festlegen…", #selector(setPasscode), "", target: self))
        appMenu.addItem(.separator())
        appMenu.addItem(item("SQUIZZZzZ Pult ausblenden", #selector(NSApplication.hide(_:)), "h"))
        appMenu.addItem(item("SQUIZZZzZ Pult beenden", #selector(NSApplication.terminate(_:)), "q"))
        let appItem = NSMenuItem(); appItem.submenu = appMenu; main.addItem(appItem)

        let edit = NSMenu(title: "Bearbeiten")
        edit.addItem(item("Widerrufen", Selector(("undo:")), "z"))
        edit.addItem(item("Wiederholen", Selector(("redo:")), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Ausschneiden", #selector(NSText.cut(_:)), "x"))
        edit.addItem(item("Kopieren", #selector(NSText.copy(_:)), "c"))
        edit.addItem(item("Einsetzen", #selector(NSText.paste(_:)), "v"))
        edit.addItem(item("Alles auswählen", #selector(NSText.selectAll(_:)), "a"))
        let editItem = NSMenuItem(); editItem.submenu = edit; main.addItem(editItem)

        let view = NSMenu(title: "Darstellung")
        view.addItem(item("Neu laden", #selector(reload), "r", target: self))
        view.addItem(item("Vollbild", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]))
        view.addItem(.separator())
        view.addItem(item("Pult", #selector(openPult), "1", target: self))
        view.addItem(item("Mac-Test", #selector(openTest), "2", target: self))
        let viewItem = NSMenuItem(); viewItem.submenu = view; main.addItem(viewItem)

        let win = NSMenu(title: "Fenster")
        win.addItem(item("Im Dock ablegen", #selector(NSWindow.performMiniaturize(_:)), "m"))
        let winItem = NSMenuItem(); winItem.submenu = win; main.addItem(winItem)
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }

    @objc func reload() { web.reloadFromOrigin() }
    @objc func openPult() { web.load(URLRequest(url: startURL)) }
    @objc func openTest() { web.load(URLRequest(url: TEST_PAGE)) }

    @objc func setPasscode() {
        let alert = NSAlert()
        alert.messageText = "QLab-Passcode"
        alert.informativeText = "Der Passcode aus QLab (Workspace-Einstellungen → Network). Er wird nur im Mac-Schlüsselbund gespeichert. Leer lassen löscht ihn."
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 240, height: 24))
        alert.accessoryView = field
        alert.addButton(withTitle: "Speichern")
        alert.addButton(withTitle: "Abbrechen")
        alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn {
            Keychain.set(field.stringValue)
            UserDefaults.standard.set(!field.stringValue.isEmpty, forKey: "qlabPasscodeSet")
            bridge.qlab.reset()
        }
    }

    // MARK: Navigation – fremde Seiten öffnen im normalen Browser

    func allowedHost(_ host: String) -> Bool {
        host == ALLOWED_HOST || host.hasSuffix(".firebaseapp.com") || host.hasSuffix(".web.app")
            || host.hasSuffix("google.com") || host.hasSuffix(".googleapis.com") || host.hasSuffix(".gstatic.com")
            || host.hasSuffix(".firebaseio.com") || host.hasSuffix(".firebasedatabase.app")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { decisionHandler(.download); return }
        guard let url = action.request.url, let host = url.host else { decisionHandler(.allow); return }
        if allowedHost(host) || action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var target = dir.appendingPathComponent(suggestedFilename)
        var n = 2
        while FileManager.default.fileExists(atPath: target.path) {
            target = dir.appendingPathComponent("\(n) \(suggestedFilename)")
            n += 1
        }
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        NSWorkspace.shared.activateFileViewerSelecting([FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]])
    }

    // MARK: Fenster, Dialoge, Dateiauswahl

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let pv = WKWebView(frame: NSRect(x: 0, y: 0, width: 520, height: 700), configuration: configuration)
        pv.navigationDelegate = self
        pv.uiDelegate = self
        let w = NSWindow(contentRect: pv.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        w.isReleasedWhenClosed = false
        w.title = "Anmelden"
        w.contentView = pv
        w.center()
        w.makeKeyAndOrderFront(nil)
        popups.append(w)
        return pv
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let w = webView.window, w !== window {
            w.close()
            popups.removeAll { $0 === w }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "OK"); a.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Abbrechen")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = prompt
        let f = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); f.stringValue = defaultText ?? ""
        a.accessoryView = f
        a.addButton(withTitle: "OK"); a.addButton(withTitle: "Abbrechen")
        a.window.initialFirstResponder = f
        completionHandler(a.runModal() == .alertFirstButtonReturn ? f.stringValue : nil)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = parameters.allowsMultipleSelection
        p.canChooseDirectories = false
        p.canChooseFiles = true
        p.begin { r in completionHandler(r == .OK ? p.urls : nil) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
