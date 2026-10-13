#pragma once

#include <reactnativekeyboardcontroller.h>

namespace facebook::react {

inline std::shared_ptr<TurboModule> rnkc_ModuleProvider(
    const std::string &moduleName,
    const JavaTurboModule::InitParams &params) {
  return reactnativekeyboardcontroller_ModuleProvider(moduleName, params);
}

} // namespace facebook::react
