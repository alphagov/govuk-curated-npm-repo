/**
 * Location information for a scan result
 */
export interface IScanResultLocation {
  startPos: number;
  length: number;
  line?: number;
  column?: number;
}

/**
 * Individual scan result
 */
export interface IScanResult {
  loc: IScanResultLocation;
  type: string | number; // Allow both string enums and numeric enums
  description: string;
  severity?: "low" | "medium" | "high" | "critical";
  metadata?: Record<string, any>;
}

/**
 * Scan rule interface that all rules must implement
 */
export interface IScanRule {
  /**
   * Name of the scan rule
   */
  name: string;

  /**
   * Description of what this rule checks for
   */
  description: string;

  /**
   * File filter - glob pattern or regex to match files
   * Examples: "*.js", "**\/*.ts", /\.m?js$/
   */
  filter: string | RegExp;

  /**
   * Scan a file and return results
   * @param filePath - Absolute path to the file being scanned
   * @param fileContent - Content of the file
   * @param ast - Optional: Pre-parsed AST if available
   * @returns Array of scan results
   */
  scan(
    filePath: string,
    fileContent: string,
    ast?: any,
  ): Promise<IScanResult[]> | IScanResult[];
}

/**
 * Aggregated scan results for a single file
 */
export interface IFileScanResults {
  filePath: string;
  relativePath: string;
  scannedAt: string;
  results: {
    ruleName: string;
    findings: IScanResult[];
  }[];
}

/**
 * Complete scan results for a package version
 */
export interface IVersionScanResults {
  packageName: string;
  version: string;
  scannedAt: string;
  totalFiles: number;
  totalFindings: number;
  files: IFileScanResults[];
  summary: {
    [ruleName: string]: {
      count: number;
      severity: {
        low: number;
        medium: number;
        high: number;
        critical: number;
      };
    };
  };
}
