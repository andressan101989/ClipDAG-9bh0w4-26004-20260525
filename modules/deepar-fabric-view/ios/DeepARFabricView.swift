import AVFoundation
import DeepAR
import ExpoModulesCore
import UIKit

public final class DeepARFabricView: ExpoView {
  private var apiKey: String = ""
  private var cameraPosition: String = "front"
  private var deepAR: DeepAR?
  private var renderView: UIView?
  private var cameraController: CameraController?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  deinit {
    cameraController?.stopCamera()
    deepAR?.shutdown()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    renderView?.frame = bounds
  }

  public func setApiKey(_ apiKey: String) {
    guard self.apiKey != apiKey else {
      return
    }

    self.apiKey = apiKey
    initializeDeepARIfNeeded()
  }

  public func setCameraPosition(_ cameraPosition: String) {
    let normalizedPosition = cameraPosition == "back" ? "back" : "front"
    self.cameraPosition = normalizedPosition

    guard let cameraController else {
      return
    }

    cameraController.position = normalizedPosition == "back"
      ? AVCaptureDevice.Position.back
      : AVCaptureDevice.Position.front
  }

  public func switchEffect(path: String) {
    guard !path.isEmpty else {
      clearEffect()
      return
    }

    deepAR?.switchEffect(withSlot: "mask", path: path)
  }

  public func clearEffect() {
    deepAR?.switchEffect(withSlot: "mask", path: nil)
  }

  private func initializeDeepARIfNeeded() {
    guard deepAR == nil, !apiKey.isEmpty else {
      return
    }

    let deepAR = DeepAR()
    deepAR.setLicenseKey(apiKey)

    // createARView(withFrame:) initializes DeepAR in rendering mode internally.
    // It returns UIView*, not ARView* — treat it as UIView directly.
    guard let renderView = deepAR.createARView(withFrame: bounds) else {
      return
    }

    renderView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    renderView.frame = bounds
    insertSubview(renderView, at: 0)

    let cameraController = CameraController()
    cameraController.deepAR = deepAR
    cameraController.position = cameraPosition == "back"
      ? AVCaptureDevice.Position.back
      : AVCaptureDevice.Position.front
    cameraController.startCamera()

    self.deepAR = deepAR
    self.renderView = renderView
    self.cameraController = cameraController

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
