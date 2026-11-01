import UIKit
import SwiftUI
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let host = UIHostingController(rootView: ShareForm(context: extensionContext))
        addChild(host); view.addSubview(host.view); host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor), host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor), host.view.topAnchor.constraint(equalTo: view.topAnchor), host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        host.didMove(toParent: self)
    }
}
private struct ShareForm: View {
    let context: NSExtensionContext?
    @State private var url = ""
    @State private var company = ""
    @State private var position = ""
    @State private var title = ""
    @State private var loading = true
    @State private var saved = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                if saved {
                    Section {
                        Label("草稿已保存", systemImage: "checkmark.circle")
                        Text("打开 JobGenie，在“分享的岗位”中确认创建申请。")
                    }
                } else {
                    Section {
                        TextField("岗位链接 · https://", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("share.url")
                        TextField("公司", text: $company).accessibilityIdentifier("share.company")
                        TextField("职位", text: $position).accessibilityIdentifier("share.position")
                        Text("公司和职位可稍后补充。草稿保存在本机，创建申请前需在 App 内确认账号。")
                            .font(.footnote).foregroundStyle(.secondary)
                        if !title.isEmpty { Text(verbatim: title).font(.caption).foregroundStyle(.secondary) }
                    }
                    if loading { ProgressView() }
                    if let error { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
                }
            }
            .navigationTitle("分享岗位")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(saved ? "完成" : "取消") { context?.completeRequest(returningItems: nil) } }
                if !saved { ToolbarItem(placement: .confirmationAction) {
                    Button("保存草稿") { save() }.disabled(loading || SharedJobDraft.webURL(url) == nil || company.count > 200 || position.count > 200).accessibilityIdentifier("share.save")
                } }
            }
            .task { await load() }
        }
    }
    private func save() {
        do {
            _ = try SharedJobDraftStore.shared().save(SharedJobDraft(url: url, company: company, position: position, title: title)); saved = true
        } catch ShareDraftError.full { error = "最多保留 50 个分享草稿，请先在 App 中处理。" }
        catch { self.error = "无法保存草稿，请检查共享容器配置后重试。" }
    }
    private func load() async {
        defer { loading = false }
        let items = context?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        title = String((items.first?.attributedTitle?.string ?? "").prefix(500))
        let providers = items.flatMap { $0.attachments ?? [] }
        var urls = Set<String>()
        // Prefer URL representations; Safari can also provide text for the same item.
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier),
               let link = (value as? URL)?.absoluteString ?? (value as? String), let safe = SharedJobDraft.webURL(link) { urls.insert(safe.absoluteString) }
        }
        if urls.isEmpty {
            for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                if let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier),
                   let text = value as? String, let safe = SharedJobDraft.extractURL(from: text) { urls.insert(safe.absoluteString) }
            }
        }
        if urls.count == 1 { url = urls.first! }
        else { error = "请选择一个 http 或 https 岗位链接，也可以手动粘贴。" }
    }
}
