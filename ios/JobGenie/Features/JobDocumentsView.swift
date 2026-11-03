import SwiftUI
import QuickLook
import UniformTypeIdentifiers

struct JobDocumentsView: View {
    @EnvironmentObject private var model: AppModel
    let jobID: String
    @State private var documents: [JobDocument] = []
    @State private var kind = JobDocumentKind.resume
    @State private var fileID = ""
    @State private var note = ""
    @State private var busy = false
    @State private var error: UserMessage?
    @State private var importing = false
    @State private var preview: URL?
    @State private var export: AttachmentDocument?
    @State private var exporting = false
    @State private var exportName = ""
    var body: some View {
        List {
            Section {
                Text("每次关联保存独立版本，附件库文件删除后仍可查看历史材料。")
                if model.isDemo { Text("请登录真实账号以关联申请材料。") }
                Picker("材料类型", selection: $kind) { ForEach(JobDocumentKind.allCases) { Text(LocalizedStringKey($0.title)).tag($0) } }
                Picker("选择附件", selection: $fileID) {
                    Text("请选择附件").tag("")
                    ForEach(model.attachments) { file in Text(verbatim: "\(file.name) · \(file.uploadDate.formatted(date: .numeric, time: .shortened))").tag(file.id) }
                }.accessibilityIdentifier("documents.file")
                TextField("版本备注（可选）", text: $note).accessibilityIdentifier("documents.note")
                Button("上传新材料") { importing = true }
                Text("上传后请选择附件，再保存材料版本。") .font(.caption)
                Button("保存材料版本") { Task { await link() } }
                    .disabled(fileID.isEmpty || note.count > 200).accessibilityIdentifier("documents.save")
            }.disabled(busy || model.isDemo)
            if busy { ProgressView() }
            if let error { ErrorBanner(message: error) }
            ForEach(JobDocumentKind.allCases) { kind in
                Section(LocalizedStringKey(kind.title)) {
                    ForEach(documents.filter { $0.kind == kind }.sorted { $0.version > $1.version }) { document in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(verbatim: "v\(document.version) · \(document.name)").font(.headline)
                            if !document.label.isEmpty { Text(verbatim: document.label) }
                            Text(document.uploadDate, format: .dateTime.year().month().day().hour().minute()).font(.caption)
                            HStack {
                                Button("查看") { Task { await open(document, viewing: true) } }
                                Spacer()
                                Button("下载到文件") { Task { await open(document, viewing: false) } }
                            }.buttonStyle(.borderless).disabled(busy)
                        }
                    }
                }
            }
            if documents.isEmpty && !busy { Text("暂无关联材料") }
        }.localizedNavigationTitle("申请材料与版本")
        .task { await load() }.refreshable { await load() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, UTType(filenameExtension: "docx")!, .png, .jpeg]) { result in
            switch result { case .success(let url): Task { await upload(url) }; case .failure(let failure): error = model.message(failure) }
        }
        .quickLookPreview($preview)
        .fileExporter(isPresented: $exporting, document: export, contentType: UTType(filenameExtension: (exportName as NSString).pathExtension) ?? .data, defaultFilename: exportName) { result in
            if case .failure(let failure) = result { error = model.message(failure) }
            export = nil
        }
        .onChange(of: preview) { _, value in if value == nil { model.attachmentCache.clear() } }
        .onDisappear { preview = nil; export = nil; model.attachmentCache.clear() }
    }
    private func perform(_ operation: () async throws -> Void) async {
        guard !busy, !model.isDemo, model.user != nil else { return }
        let generation = model.sessionGeneration
        busy = true; error = nil; defer { busy = false }
        do { try await operation() }
        catch is CancellationError { }
        catch {
            guard generation == model.sessionGeneration else { return }
            if error as? APIError == .unauthorized { await model.signOut() }
            else { self.error = model.message(error) }
        }
    }
    private func fetch() async throws {
        let generation = model.sessionGeneration
        let result = try await model.api.jobDocuments(jobID)
        guard generation == model.sessionGeneration else { throw CancellationError() }
        documents = result
    }
    private func load() async { await perform { try await model.loadAttachments(); try await fetch() } }
    private func link() async {
        await perform {
            let generation = model.sessionGeneration
            try await model.api.linkDocument(jobID: jobID, fileID: fileID, kind: kind, label: note)
            guard generation == model.sessionGeneration else { throw CancellationError() }
            try await fetch(); note = ""
        }
    }
    private func upload(_ url: URL) async {
        await perform {
            let generation = model.sessionGeneration
            let data = try await Task.detached { try AttachmentPolicy.read(url) }.value
            guard generation == model.sessionGeneration else { throw CancellationError() }
            try await model.uploadAttachment(name: url.lastPathComponent, data: data)
        }
    }
    private func open(_ document: JobDocument, viewing: Bool) async {
        await perform {
            let generation = model.sessionGeneration
            let data = try await model.api.jobDocumentData(jobID: jobID, documentID: document.id)
            guard generation == model.sessionGeneration else { throw CancellationError() }
            if viewing { preview = try model.attachmentCache.store(data, name: document.name) }
            else { exportName = document.name; export = AttachmentDocument(data: data); exporting = true }
        }
    }
}
