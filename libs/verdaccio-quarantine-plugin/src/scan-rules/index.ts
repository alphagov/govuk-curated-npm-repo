// Export all types
export * from "./types";

// Export individual rules and their enums
export {
  NetworkActivityRule,
  NetworkFindingType,
} from "./network-activity-rule";
export { EvalDetectionRule, EvalFindingType } from "./eval-detection-rule";
export {
  BackdoorDetectionRule,
  BackdoorFindingType,
} from "./backdoor-detection-rule";
export {
  PackageJsonHooksRule,
  PackageJsonHookFindingType,
} from "./package-json-hooks-rule";

// Import all rules for the default export
import { NetworkActivityRule } from "./network-activity-rule";
import { EvalDetectionRule } from "./eval-detection-rule";
import { BackdoorDetectionRule } from "./backdoor-detection-rule";
import { PackageJsonHooksRule } from "./package-json-hooks-rule";
import { IScanRule } from "./types";

/**
 * Array of all available scan rules
 * Add new rules here to have them automatically loaded by the scanner
 */
export const ALL_SCAN_RULES: IScanRule[] = [
  new NetworkActivityRule(),
  new EvalDetectionRule(),
  new BackdoorDetectionRule(),
  new PackageJsonHooksRule(),
];
