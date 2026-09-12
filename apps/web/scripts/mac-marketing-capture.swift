import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

private func failure(_ message: String) -> NSError {
    NSError(domain: "AAPMacCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}

private func positiveInteger(_ text: String, maximum: Int = Int(Int32.max)) throws -> Int {
    guard let value = Int(text), value > 0, value <= maximum else {
        throw failure("Invalid positive integer: \(text)")
    }
    return value
}

private func windowIsFullSize(_ id: CGWindowID, pid: pid_t, width: Double, height: Double) -> Bool {
    guard let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]],
          let window = windows.first,
          window[kCGWindowOwnerPID as String] as? Int == Int(pid),
          let bounds = window[kCGWindowBounds as String] as? [String: Double],
          let actualWidth = bounds["Width"], let actualHeight = bounds["Height"] else { return false }
    // Quartz can include a one-point window border that CDP excludes.
    return abs(actualWidth - width) <= 2 && abs(actualHeight - height) <= 2
}

private final class StopRequest {
    private let lock = NSLock()
    private let semaphore = DispatchSemaphore(value: 0)
    private var stopped = false
    private var storedError: Error?
    private var stopTime: CMTime?

    func stop(_ error: Error? = nil) {
        lock.lock()
        if storedError == nil { storedError = error }
        let notify = !stopped
        if notify { stopTime = CMClockGetTime(CMClockGetHostTimeClock()) }
        stopped = true
        lock.unlock()
        if notify { semaphore.signal() }
    }

    var error: Error? {
        lock.lock()
        defer { lock.unlock() }
        return storedError
    }

    var stoppedAt: CMTime? {
        lock.lock()
        defer { lock.unlock() }
        return stopTime
    }

    func wait() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                if self.semaphore.wait(timeout: .now() + 600) == .timedOut {
                    self.stop(failure("Native capture exceeded ten minutes"))
                }
                continuation.resume()
            }
        }
    }
}

@available(macOS 14.0, *)
private func streamConfiguration(width: Int, height: Int) -> SCStreamConfiguration {
    let configuration = SCStreamConfiguration()
    configuration.width = width
    configuration.height = height
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 60)
    configuration.queueDepth = 8
    configuration.captureResolution = .best
    configuration.ignoreShadowsSingleWindow = true
    configuration.showsCursor = false // The browser installs the shared deterministic cursor.
    configuration.capturesAudio = false
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    configuration.colorSpaceName = CGColorSpace.sRGB
    return configuration
}

@available(macOS 14.0, *)
private final class CaptureSink: NSObject, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "aap.capture.writer")
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let adaptor: AVAssetWriterInputPixelBufferAdaptor
    private let stopRequest: StopRequest
    private let windowID: CGWindowID
    private let pid: pid_t
    private let pointWidth: Double
    private let pointHeight: Double
    private let width: Int
    private let height: Int
    private let epochOffset: Double
    private var firstPTS: CMTime?
    private var lastPTS = CMTime.zero
    private var lastPixels: CVPixelBuffer?
    private var frames = 0
    private var dropped = 0

    init(url: URL, windowID: CGWindowID, pid: pid_t, width: Int, height: Int,
         pointWidth: Double, pointHeight: Double, stopRequest: StopRequest) throws {
        self.windowID = windowID
        self.pid = pid
        self.width = width
        self.height = height
        self.pointWidth = pointWidth
        self.pointHeight = pointHeight
        self.stopRequest = stopRequest
        // ScreenCaptureKit sample PTS uses the CoreMedia host clock. Callback time
        // includes queue latency and must not become the recording time origin.
        epochOffset = Date().timeIntervalSince1970 - CMClockGetTime(CMClockGetHostTimeClock()).seconds
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width, AVVideoHeightKey: height,
            AVVideoColorPropertiesKey: [
                AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
                AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
                AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2
            ],
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 60_000_000,
                AVVideoExpectedSourceFrameRateKey: 60,
                AVVideoMaxKeyFrameIntervalKey: 120,
                AVVideoAllowFrameReorderingKey: false
            ]
        ])
        input.expectsMediaDataInRealTime = true
        adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
        super.init()
        guard writer.canAdd(input) else { throw failure("H.264 writer input is unavailable") }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? failure("H.264 writer did not start") }
        writer.startSession(atSourceTime: .zero)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { stopRequest.stop(error) }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue: status) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
        guard CVPixelBufferGetWidth(pixels) == width, CVPixelBufferGetHeight(pixels) == height else {
            stopRequest.stop(failure("Native frame dimensions changed")); return
        }
        // A fixed-size SCK buffer can contain a scaled Stage Manager window.
        // Check its native bounds throughout capture, including after readiness.
        guard windowIsFullSize(windowID, pid: pid, width: pointWidth, height: pointHeight) else {
            if frames > 0 { stopRequest.stop(failure("Capture window changed size during recording")) }
            return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sample)
        guard pts.isNumeric else { stopRequest.stop(failure("Invalid native frame timestamp")); return }
        guard input.isReadyForMoreMediaData else { dropped += 1; return }
        if firstPTS == nil {
            let epoch = pts.seconds + epochOffset
            guard abs(epoch - Date().timeIntervalSince1970) < 2 else {
                stopRequest.stop(failure("Native frame clock does not match the host clock")); return
            }
            firstPTS = pts
        }
        let relativePTS = CMTimeSubtract(pts, firstPTS!)
        guard relativePTS >= lastPTS else { stopRequest.stop(failure("Native frame timestamps moved backwards")); return }
        guard adaptor.append(pixels, withPresentationTime: relativePTS) else {
            stopRequest.stop(writer.error ?? failure("Native frame append failed")); return
        }
        lastPTS = relativePTS
        lastPixels = pixels
        frames += 1
        if frames == 1 {
            emit(["event": "ready", "first_frame_epoch_ms": (firstPTS!.seconds + epochOffset) * 1000,
                  "window_id": windowID, "pid": pid, "width": width, "height": height])
        }
    }

    func finish() async throws {
        // A static window can stop delivering complete frames. Hold its last real
        // image until the actual stop request, rather than truncating that interval
        // or extending it to an inferred encoder duration. This is not a cadence sample.
        let deadline = Date().addingTimeInterval(2)
        while !input.isReadyForMoreMediaData && writer.status == .writing && Date() < deadline {
            try await Task.sleep(nanoseconds: 5_000_000)
        }
        queue.sync {
            let frameInterval = CMTime(value: 1, timescale: 60)
            var end = CMTimeAdd(lastPTS, frameInterval)
            if let first = firstPTS, let stoppedAt = stopRequest.stoppedAt, let pixels = lastPixels {
                end = CMTimeMaximum(end, CMTimeSubtract(stoppedAt, first))
                let terminalPTS = CMTimeSubtract(end, frameInterval)
                if terminalPTS > lastPTS {
                    if !input.isReadyForMoreMediaData || !adaptor.append(pixels, withPresentationTime: terminalPTS) {
                        stopRequest.stop(writer.error ?? failure("Could not preserve the final static interval"))
                    }
                }
            }
            writer.endSession(atSourceTime: end)
            input.markAsFinished()
        }
        await writer.finishWriting()
        if let error = stopRequest.error { throw error }
        guard frames > 0, writer.status == .completed else {
            throw writer.error ?? failure("Native capture contains no complete frames")
        }
        emit(["event": "finished", "frames": frames, "dropped_frames": dropped])
    }
}

@available(macOS 14.0, *)
@MainActor
private func run(_ args: [String]) async throws {
    guard CGPreflightScreenCaptureAccess() else {
        throw failure("Screen Recording permission is required for this terminal/agent in System Settings > Privacy & Security")
    }
    if args == ["check"] { emit(["available": true, "driver": "screencapturekit"]); return }
    guard args.count == 6 || args.count == 8 else { throw failure("Expected snapshot or record arguments") }
    let mode = args[0]
    let pid = pid_t(try positiveInteger(args[1]))
    guard let application = NSRunningApplication(processIdentifier: pid) else { throw failure("Capture browser exited") }
    // Activation alone does not restore a hidden Chromium window from Stage Manager.
    application.unhide()
    application.activate(options: [.activateAllWindows])
    // Let activation settle before resolving native bounds; no global desktop capture is used.
    try await Task.sleep(nanoseconds: 300_000_000)
    var windows = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false).windows
    if mode == "snapshot" {
        guard args.count == 6, args[2].hasPrefix("marketing-capture-") else { throw failure("Invalid capture window title") }
        let pointWidth = Double(try positiveInteger(args[3], maximum: 8192))
        let pointHeight = Double(try positiveInteger(args[4], maximum: 8192))
        let matches = windows.filter { $0.owningApplication?.processID == pid && $0.title?.contains(args[2]) == true }
        guard matches.count == 1 else { throw failure("Expected exactly one browser-owned capture window") }
        let id = matches[0].windowID
        for _ in 0..<30 {
            if windowIsFullSize(id, pid: pid, width: pointWidth, height: pointHeight) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard windowIsFullSize(id, pid: pid, width: pointWidth, height: pointHeight) else {
            let state = CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]]
            throw failure("Capture window must be visible at its full desktop size; expected \(pointWidth)x\(pointHeight), bounds=\(state?.first?[kCGWindowBounds as String] ?? "missing"), onscreen=\(state?.first?[kCGWindowIsOnscreen as String] ?? false)")
        }
        windows = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false).windows
        guard let window = windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == pid }) else {
            throw failure("Capture window disappeared")
        }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let width = Int((window.frame.width * Double(filter.pointPixelScale)).rounded())
        let height = Int((window.frame.height * Double(filter.pointPixelScale)).rounded())
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: streamConfiguration(width: width, height: height))
        let url = URL(fileURLWithPath: args[5])
        guard url.pathExtension == "png", !FileManager.default.fileExists(atPath: url.path),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw failure("Snapshot output must be a new PNG file")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw failure("Could not write native calibration snapshot") }
        emit(["window_id": id, "pid": pid, "width": image.width, "height": image.height,
              "point_width": window.frame.width, "point_height": window.frame.height])
        return
    }
    guard mode == "record", args.count == 8 else { throw failure("Unknown native capture command") }
    let id = CGWindowID(try positiveInteger(args[2]))
    let width = try positiveInteger(args[3], maximum: 8192)
    let height = try positiveInteger(args[4], maximum: 8192)
    let pointWidth = Double(try positiveInteger(args[5], maximum: 8192))
    let pointHeight = Double(try positiveInteger(args[6], maximum: 8192))
    guard width % 2 == 0, height % 2 == 0,
          let window = windows.first(where: { $0.windowID == id && $0.owningApplication?.processID == pid }) else {
        throw failure("Invalid native video dimensions or window owner")
    }
    let url = URL(fileURLWithPath: args[7])
    guard url.pathExtension == "mp4", !FileManager.default.fileExists(atPath: url.path) else { throw failure("Recording output must be a new MP4 file") }
    let stop = StopRequest()
    let sink = try CaptureSink(url: url, windowID: id, pid: pid, width: width, height: height,
                               pointWidth: pointWidth, pointHeight: pointHeight, stopRequest: stop)
    let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window),
                          configuration: streamConfiguration(width: width, height: height), delegate: sink)
    try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: sink.queue)
    let signals = [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
        source.setEventHandler { stop.stop() }
        source.resume()
        return source
    }
    defer { signals.forEach { $0.cancel() } }
    DispatchQueue.global().async {
        // q or pipe EOF both stop gracefully, including parent-process exit.
        while let line = readLine() { if line == "q" { break } }
        stop.stop()
    }
    try await stream.startCapture()
    application.activate(options: [.activateAllWindows])
    await stop.wait()
    try await stream.stopCapture()
    try await sink.finish()
}

@main private struct Main {
    static func main() async {
        do {
            NSApplication.shared.setActivationPolicy(.prohibited)
            guard #available(macOS 14.0, *) else { throw failure("Native marketing capture requires macOS 14 or later") }
            try await run(Array(CommandLine.arguments.dropFirst()))
        } catch {
            FileHandle.standardError.write(Data(("ScreenCaptureKit: \(error.localizedDescription)\n").utf8))
            exit(1)
        }
    }
}
