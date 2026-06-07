import AVFoundation
import ExpoModulesCore
import UIKit

public final class DeepARFabricView: ExpoView {
  private var apiKey: String = ""
  private var cameraPosition: String = "front"
  private var renderView: UIView?
  private var bridge: DeepARBridge?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  deinit {
    bridge?.shutdown()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    renderView?.frame = bounds
  }

  public func setApiKey(_ apiKey: String) {
    print("[DeepAR] apiKey prefix \(apiKey.prefix(8))")

    guard self.apiKey != apiKey else {
      return
    }

    self.apiKey = apiKey
    initializeDeepARIfNeeded()
  }

  public func setCameraPosition(_ cameraPosition: String) {
    let normalizedPosition = cameraPosition == "back" ? "back" : "front"
    self.cameraPosition = normalizedPosition
    bridge?.setCameraPosition(normalizedPosition)
  }

  public func switchEffect(path: String) {
    guard !path.isEmpty else {
      clearEffect()
      return
    }

    bridge?.switchEffect(path)
  }

  public func clearEffect() {
    bridge?.clearEffect()
  }

  private func initializeDeepARIfNeeded() {
    guard bridge == nil, !apiKey.isEmpty else {
      return
    }

    let bridge = DeepARBridge()
    guard let renderView = bridge.createRenderView(
      withApiKey: apiKey,
      frame: bounds,
      cameraPosition: cameraPosition
    ) else {
      return
    }

    renderView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    renderView.frame = bounds
    insertSubview(renderView, at: 0)

    self.renderView = renderView
    self.bridge = bridge

    configureAudioSession()
  }

  private func configureAudioSession() {
    do {
      try AVAudioSession.sharedInstance().setCategory(.playAndRecord, options: [.mixWithOthers])
    } catch {
      NSLog("[DeepARFabricView] Failed to configure audio session: \(error.localizedDescription)")
    }
  }
}
