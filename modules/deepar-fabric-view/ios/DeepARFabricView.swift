import AVFoundation
import ExpoModulesCore
import UIKit

public final class DeepARFabricView: ExpoView {
  private var apiKey: String = ""
  private var cameraPosition: String = "front"
  private var renderView: UIView?
  private var bridge: DeepARBridge?

  let onInitialized = EventDispatcher()
  let onCameraReady = EventDispatcher()
  let onScreenshotTaken = EventDispatcher()
  let onVideoRecordingFinished = EventDispatcher()
  let onError = EventDispatcher()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    print("[DeepARNative] init")
    clipsToBounds = true
  }

  deinit {
    print("[DeepARNative] deinit")
    bridge?.shutdown()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    print("[DeepARNative] layoutSubviews bounds=\(bounds)")
    renderView?.frame = bounds
    if bounds.width > 0 && bounds.height > 0 {
      initializeDeepARIfNeeded()
    }
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    print("[DeepARNative] didMoveToWindow window=\(window != nil ? "set" : "nil")")
  }

  public override func didMoveToSuperview() {
    super.didMoveToSuperview()
    print("[DeepARNative] didMoveToSuperview superview=\(superview != nil ? "set" : "nil")")
  }

  public func setApiKey(_ apiKey: String) {
    print("[DeepARNative] setApiKey prefix=\(apiKey.prefix(8))")

    guard self.apiKey != apiKey else {
      print("[DeepARNative] setApiKey skipped — same key already set")
      return
    }

    self.apiKey = apiKey
    if bounds.width > 0 && bounds.height > 0 {
      initializeDeepARIfNeeded()
    }
  }

  public func setCameraPosition(_ cameraPosition: String) {
    let normalizedPosition = cameraPosition == "back" ? "back" : "front"
    print("[DeepARNative] setCameraPosition \(normalizedPosition)")
    self.cameraPosition = normalizedPosition
    bridge?.setCameraPosition(normalizedPosition)
  }

  public func switchEffect(path: String) {
    guard !path.isEmpty else {
      print("[DeepARNative] switchEffect path empty — clearing effect")
      clearEffect()
      return
    }
    print("[DeepARNative] effect loaded path=\(path)")
    bridge?.switchEffect(path)
  }

  public func clearEffect() {
    print("[DeepARNative] clearEffect")
    bridge?.clearEffect()
  }

  public func takeScreenshot() {
    print("[DeepARNativeCapture] view takeScreenshot")
    guard let bridge else {
      print("[DeepARNativeCapture] view takeScreenshot SKIP - bridge nil")
      onError(["message": "DeepAR not initialized", "isFatal": false])
      return
    }
    bridge.takeScreenshot()
  }

  public func startVideoRecording() {
    print("[DeepARNativeCapture] view startVideoRecording")
    guard let bridge else {
      print("[DeepARNativeCapture] view startVideoRecording SKIP - bridge nil")
      onError(["message": "DeepAR not initialized", "isFatal": false])
      return
    }
    bridge.startVideoRecording()
  }

  public func finishVideoRecording() {
    print("[DeepARNativeCapture] view finishVideoRecording")
    guard let bridge else {
      print("[DeepARNativeCapture] view finishVideoRecording SKIP - bridge nil")
      onError(["message": "DeepAR not initialized", "isFatal": false])
      return
    }
    bridge.finishVideoRecording()
  }

  private func initializeDeepARIfNeeded() {
    guard bridge == nil else {
      print("[DeepARNative] initializeDeepARIfNeeded skipped — bridge already exists")
      return
    }
    guard !apiKey.isEmpty else {
      print("[DeepARNative] initializeDeepARIfNeeded skipped — apiKey empty")
      return
    }
    guard bounds.width > 0 && bounds.height > 0 else {
      print("[DeepARNative] initialize skipped — zero bounds")
      return
    }

    let cameraStatus = AVCaptureDevice.authorizationStatus(for: .video)
    switch cameraStatus {
    case .authorized:
      print("[DeepARNative] camera authorized")
    case .notDetermined:
      print("[DeepARNative] requesting camera (status: notDetermined)")
    case .denied:
      print("[DeepARNative] camera denied")
    case .restricted:
      print("[DeepARNative] camera denied (restricted)")
    @unknown default:
      print("[DeepARNative] camera status unknown rawValue=\(cameraStatus.rawValue)")
    }

    print("[DeepARNative] create DeepAR")
    let bridge = DeepARBridge()
    wireBridgeCallbacks(bridge)

    print("[DeepARNative] set license key prefix=\(apiKey.prefix(8))")
    print("[DeepARNative] initialize renderer")
    print("[DeepARNative] create Metal/OpenGL surface")
    print("[DeepARNative] surface size bounds=\(bounds)")

    guard let renderView = bridge.createRenderView(
      withApiKey: apiKey,
      frame: bounds,
      cameraPosition: cameraPosition
    ) else {
      print("[DeepARNative] error — createRenderView returned nil (bounds=\(bounds), cameraPosition=\(cameraPosition))")
      return
    }

    print("[DeepARNative] AVCaptureSession started")
    print("[DeepARNative] start rendering")

    renderView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    renderView.frame = bounds
    insertSubview(renderView, at: 0)

    self.renderView = renderView
    self.bridge = bridge

    configureAudioSession()
  }

  private func wireBridgeCallbacks(_ bridge: DeepARBridge) {
    bridge.onInitialized = { [weak self] in
      guard let self else { return }
      print("[DeepARNativeCapture] emit onInitialized")
      self.onInitialized([:])
      self.onCameraReady([:])
    }

    bridge.onScreenshotTaken = { [weak self] uri in
      guard let self else { return }
      print("[DeepARNativeCapture] emit onScreenshotTaken uri=\(uri)")
      self.onScreenshotTaken(["uri": uri])
    }

    bridge.onVideoRecordingFinished = { [weak self] uri in
      guard let self else { return }
      print("[DeepARNativeCapture] emit onVideoRecordingFinished uri=\(uri)")
      self.onVideoRecordingFinished(["uri": uri])
    }

    bridge.onCaptureError = { [weak self] message in
      guard let self else { return }
      print("[DeepARNativeCapture] emit onError message=\(message)")
      self.onError(["message": message, "isFatal": false])
    }
  }

  private func configureAudioSession() {
    do {
      try AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.mixWithOthers])
    } catch {
      print("[DeepARNative] error — audio session failed: \(error)")
      NSLog("[DeepARFabricView] Failed to configure audio session: \(error.localizedDescription)")
    }
  }
}
