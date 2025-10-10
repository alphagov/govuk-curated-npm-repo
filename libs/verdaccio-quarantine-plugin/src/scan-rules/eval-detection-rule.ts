import { IScanRule, IScanResult } from "./types";

export enum EvalFindingType {
  EVAL_CALL = "EVAL_CALL",
  FUNCTION_CONSTRUCTOR = "FUNCTION_CONSTRUCTOR",
  SETTIMEOUT_STRING = "SETTIMEOUT_STRING",
  SETINTERVAL_STRING = "SETINTERVAL_STRING",
  VM_MODULE = "VM_MODULE",
}

/**
 * Detects dangerous eval and code execution patterns
 */
export class EvalDetectionRule implements IScanRule {
  name = "eval-detection";
  description = "Detects eval() and dynamic code execution";
  filter = /\.(js|ts|mjs|cjs)$/;

  async scan(_filePath: string, fileContent: string): Promise<IScanResult[]> {
    const results: IScanResult[] = [];

    // Detect eval calls
    const evalRegex = /\beval\s*\(/g;
    let match;

    while ((match = evalRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: EvalFindingType.EVAL_CALL,
        description: "eval() call detected - dangerous code execution",
        severity: "critical",
      });
    }

    // Detect Function constructor
    const functionConstructorRegex = /new\s+Function\s*\(/g;
    while ((match = functionConstructorRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: EvalFindingType.FUNCTION_CONSTRUCTOR,
        description: "Function constructor detected - potential code injection",
        severity: "critical",
      });
    }

    // Detect setTimeout/setInterval with string argument
    const timeoutRegex = /\b(setTimeout|setInterval)\s*\(\s*['"`]/g;
    while ((match = timeoutRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type:
          match[1] === "setTimeout"
            ? EvalFindingType.SETTIMEOUT_STRING
            : EvalFindingType.SETINTERVAL_STRING,
        description: `${match[1]}() with string argument - potential code execution`,
        severity: "high",
      });
    }

    // Detect vm module usage
    const vmRegex =
      /require\s*\(\s*['"]vm['"]\s*\)|import\s+.*from\s+['"]vm['"]/g;
    while ((match = vmRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: EvalFindingType.VM_MODULE,
        description: "VM module usage detected - code execution capability",
        severity: "high",
      });
    }

    return results;
  }
}
