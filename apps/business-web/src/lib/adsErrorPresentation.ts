import { presentAdsError as presentSharedAdsError } from "../../../../shared/adsErrorPresentation";
import type { AdsErrorPresentation } from "../../../../shared/adsErrorPresentation";

export * from "../../../../shared/adsErrorPresentation";

export function presentAdsError(cause: unknown, options: { operation: "read" | "mutation" | "moderation"; resource?: string }): AdsErrorPresentation {
  const presentation = presentSharedAdsError(cause, options);
  return presentation.kind === "platform_prelaunch"
    ? { ...presentation, message: "This action is currently unavailable." }
    : presentation;
}
