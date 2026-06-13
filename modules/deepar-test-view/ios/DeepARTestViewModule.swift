import ExpoModulesCore

public final class DeepARTestViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeepARTestView")

    View(DeepARTestView.self)
  }
}
