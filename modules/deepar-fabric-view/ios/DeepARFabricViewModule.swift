import ExpoModulesCore

public final class DeepARFabricViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeepARFabricView")

    View(DeepARFabricView.self) {
      Events("onScreenshotTaken", "onVideoRecordingFinished")

      Prop("apiKey") { (view: DeepARFabricView, apiKey: String) in
        view.setApiKey(apiKey)
      }

      Prop("cameraPosition") { (view: DeepARFabricView, cameraPosition: String) in
        view.setCameraPosition(cameraPosition)
      }

      AsyncFunction("switchEffect") { (view: DeepARFabricView, path: String) in
        view.switchEffect(path: path)
      }

      AsyncFunction("clearEffect") { (view: DeepARFabricView) in
        view.clearEffect()
      }

      AsyncFunction("takeScreenshot") { (view: DeepARFabricView) in
        view.takeScreenshot()
      }

      AsyncFunction("startVideoRecording") { (view: DeepARFabricView) in
        view.startVideoRecording()
      }

      AsyncFunction("finishVideoRecording") { (view: DeepARFabricView) in
        view.finishVideoRecording()
      }
    }
  }
}
