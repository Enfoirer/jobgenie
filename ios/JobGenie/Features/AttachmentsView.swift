import SwiftUI
import UniformTypeIdentifiers
import QuickLook

struct AttachmentDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}
struct AttachmentsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase
    @State private var importing = false
    @State private var exporting = false
    @State private var preview: URL?
    @State private var document: AttachmentDocument?
    @State private var exportName = ""
    @State private var exportType = UTType.data
    @State private var loading = false
    @State private var working = false
    @State private var error: UserMessage?
    var body: some View {
        List {
            DemoNotice()
            Section {
                Text("账号附件库与网页版共用，附件不绑定到单个申请。") .font(.footnote).foregroundStyle(.secondary)
                Text("支持 PDF、DOCX、PNG、JPG/JPEG，每次一个文件，最大 4 MB。") .font(.footnote)
                Button { importing = true } label: { Label("上传附件", systemImage: "arrow.up.doc") }
                    .disabled(working || model.attachmentBusy).accessibilityIdentifier("attachments.upload")
            }
            if loading || working || model.attachmentBusy { ProgressView("正在处理附件…") }
            if let error { ErrorBanner(message: error) { Task { await load() } } }
            if let notice = model.attachmentNotice { Text(notice.localized(locale: locale)) }
            Section("附件") {
                if !loading && model.attachments.isEmpty && error == nil { Text("暂无附件").accessibilityIdentifier("attachments.empty") }
                ForEach(model.attachments) { file in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(verbatim: file.name).font(.headline)
                        HStack { Text(verbatim: file.size); Text(file.uploadDate, format: .dateTime.year().month().day()) }.font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("查看") { Task { await open(file, viewing: true) } }.disabled(!file.canPreview)
                                .accessibilityIdentifier("attachment.view.\(file.id)")
                            Spacer()
                            Button("下载到文件") { Task { await open(file, viewing: false) } }
                                .accessibilityIdentifier("attachment.download.\(file.id)")
                        }.buttonStyle(.borderless).disabled(working || model.attachmentBusy)
                    }.padding(.vertical, 4)
                }
            }
            Section { Text("预览临时文件在离开页面或退出账号时清除。存储到“文件”的副本由你管理。") .font(.footnote).foregroundStyle(.secondary) }
        }.localizedNavigationTitle("附件")
            .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, UTType(filenameExtension: "docx")!, .png, .jpeg]) { result in
                switch result {
                case .success(let url): Task { await upload(url) }
                case .failure(let failure): error = model.message(failure)
                }
            }
            .quickLookPreview($preview)
            .fileExporter(isPresented: $exporting, document: document, contentType: exportType, defaultFilename: exportName) { result in
                if case .failure(let failure) = result { error = model.message(failure) }
                document = nil
            }
            .task { await load() }
            .refreshable { await load() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await load() } } }
            .onChange(of: exporting) { _, value in if !value { document = nil } }
            .onChange(of: preview) { _, value in if value == nil { model.attachmentCache.clear() } }
            .onDisappear { preview = nil; document = nil; model.attachmentCache.clear() }
    }
    private func load() async {
        guard !loading, !working, !model.attachmentBusy else { return }
        loading = true; error = nil; defer { loading = false }
        do { try await model.loadAttachments() }
        catch is CancellationError { }
        catch { self.error = model.message(error) }
    }
    private func upload(_ url: URL) async {
        let current = model.sessionGeneration
        working = true; error = nil; defer { working = false }
        do {
            let data = try await Task.detached { try AttachmentPolicy.read(url) }.value
            guard current == model.sessionGeneration else { return }
            try await model.uploadAttachment(name: url.lastPathComponent, data: data)
        } catch is CancellationError { }
        catch { if current == model.sessionGeneration { self.error = model.message(error) } }
    }
    private func open(_ file: Attachment, viewing: Bool) async {
        working = true; error = nil; defer { working = false }
        do {
            let data = try await model.attachmentData(file)
            if viewing {
                guard file.canPreview else { throw APIError.unsupportedFile }
                preview = try model.attachmentCache.store(data, name: file.name)
            } else {
                // Legacy unsupported filenames export as inert .bin, never as executable/HTML content.
                exportName = file.canPreview ? file.name : "attachment.bin"
                exportType = file.canPreview ? (UTType(filenameExtension: (file.name as NSString).pathExtension) ?? .data) : .data
                document = AttachmentDocument(data: data); exporting = true
            }
        } catch is CancellationError { }
        catch { self.error = model.message(error) }
    }
}
