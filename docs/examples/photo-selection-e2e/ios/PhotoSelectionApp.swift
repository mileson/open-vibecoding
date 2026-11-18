import SwiftUI
import UIKit

@main
struct PhotoSelectionApp: App {
    var body: some Scene {
        WindowGroup { PhotoSelectionView() }
    }
}

private struct PhotoSelectionView: View {
    @State private var ids: [String] = []
    @State private var returned: [String]?
    @State private var searching = false
    @State private var blocked = false
    private let photos = (1...10).map { String(format: "P%02d", $0) }
    private let defect = UserDefaults.standard.string(forKey: "photoVariant") == "defect"
    private let caseID = UserDefaults.standard.string(forKey: "photoCase")

    var body: some View {
        VStack(spacing: 12) {
            if let returned {
                Text("已选照片").font(.title)
                Text(returned.joined(separator: " "))
                    .accessibilityIdentifier("returned-ids")
            } else {
                Text("选择照片").font(.title)
                HStack {
                    Button("相册") { searching = false }.accessibilityIdentifier("album")
                    Button("搜索入口") { searching = true }.accessibilityIdentifier("search")
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3)) {
                    ForEach(searching ? Array(photos.suffix(1)) : Array(photos.prefix(9)), id: \.self) { id in
                        Button { toggle(id) } label: {
                            VStack {
                                thumbnail(id)
                                Text(id)
                            }
                            .padding(4)
                            .background(ids.contains(id) ? Color.blue.opacity(0.2) : .clear)
                        }
                        .accessibilityIdentifier("photo-" + id)
                        .accessibilityAddTraits(ids.contains(id) ? .isSelected : [])
                    }
                }
                Text("已选 \(ids.count) 张")
                Text(ids.joined(separator: " ")).accessibilityIdentifier("selected-ids")
                if blocked { Text("最多选择 9 张照片").accessibilityIdentifier("limit-notice") }
                Button("完成") { complete(ids) }.accessibilityIdentifier("done")
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear(perform: reportInitialState)
    }

    private func photoImage(_ id: String) -> UIImage? {
        let url = Bundle.main.url(forResource: id, withExtension: "png")
        return url.flatMap { UIImage(contentsOfFile: $0.path) }
    }

    private func thumbnail(_ id: String) -> some View {
        let image = photoImage(id) ?? UIImage()
        return Image(uiImage: image).resizable().scaledToFit().frame(height: 44).accessibilityHidden(true)
    }

    private func toggle(_ id: String) {
        blocked = false
        if let position = ids.firstIndex(of: id) {
            ids.remove(at: position)
        } else if ids.count < 9 {
            ids.append(id)
        } else if defect && searching {
            ids[0] = id
        } else {
            blocked = true
        }
        guard searching, id == "P10" else { return }
        switch caseID {
        case "count": record(ids.count)
        case "blocked": record(["notice": blocked, "tenthSelected": ids.contains(id)])
        case "selection": record(ids)
        default: break
        }
    }

    private func complete(_ selected: [String]) {
        returned = selected
        if caseID == "returned" { record(selected) }
    }

    private func record(_ value: Any) {
        guard let caseID, ["count", "blocked", "selection", "returned"].contains(caseID) else { return }
        saveObservation(["actual": value], file: caseID + ".json")
    }

    private func reportInitialState() {
        guard let probe = UserDefaults.standard.string(forKey: "photoDataProbe"), UUID(uuidString: probe) != nil else { return }
        let available = photos.filter { photoImage($0) != nil }
        saveObservation(["photoIds": available, "selectedIds": ids], file: "ovc-data-" + probe + ".json")
    }

    private func saveObservation(_ observation: [String: Any], file: String) {
        do {
            let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true)
            let data = try JSONSerialization.data(withJSONObject: observation)
            try data.write(to: documents.appending(path: file), options: .atomic)
        } catch {
            NSLog("Cannot save photo selection observation: %@", error.localizedDescription)
        }
    }
}
