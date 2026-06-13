import ExpoModulesCore
import UIKit

public class DeepARTestView: ExpoView {
  private let label = UILabel()

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = UIColor.systemBlue.withAlphaComponent(0.25)
    label.text = "DeepARTestView ✓"
    label.textColor = .white
    label.textAlignment = .center
    label.font = .systemFont(ofSize: 14, weight: .semibold)
    addSubview(label)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    label.frame = bounds
  }
}
