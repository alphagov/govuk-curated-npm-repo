// src/scan-engine.ts
import * as fs from "node:fs";
import * as path from "path";
import { minimatch } from "minimatch";
import {
  IScanRule,
  IFileScanResults,
  IVersionScanResults,
} from "./scan-rules/types";
import { ALL_SCAN_RULES } from "./scan-rules";

export class ScanEngine {
  private rules: IScanRule[];

  constructor(rules?: IScanRule[]) {
    this.rules = rules || ALL_SCAN_RULES;
  }

  /**
   * Check if a file matches a rule's filter
   */
  private matchesFilter(filePath: string, filter: string | RegExp): boolean {
    const fileName = path.basename(filePath);

    if (filter instanceof RegExp) {
      return filter.test(filePath) || filter.test(fileName);
    }

    // Use minimatch for glob patterns
    return minimatch(fileName, filter) || minimatch(filePath, filter);
  }

  /**
   * Get applicable rules for a file
   */
  private getApplicableRules(filePath: string): IScanRule[] {
    return this.rules.filter((rule) =>
      this.matchesFilter(filePath, rule.filter),
    );
  }

  /**
   * Scan a single file with all applicable rules
   */
  async scanFile(
    filePath: string,
    extractedDir: string,
  ): Promise<IFileScanResults> {
    const relativePath = path.relative(extractedDir, filePath);
    const applicableRules = this.getApplicableRules(filePath);

    const fileScanResults: IFileScanResults = {
      filePath,
      relativePath,
      scannedAt: new Date().toISOString(),
      results: [],
    };

    if (applicableRules.length === 0) {
      return fileScanResults;
    }

    // Read file content once
    let fileContent: string;
    try {
      fileContent = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(`   ❌ Error reading file ${relativePath}:`, err);
      return fileScanResults;
    }

    // Run each applicable rule
    for (const rule of applicableRules) {
      try {
        const findings = await rule.scan(filePath, fileContent);
        fileScanResults.results.push({
          ruleName: rule.name,
          findings,
        });
      } catch (err) {
        console.error(
          `   ❌ Error running rule ${rule.name} on ${relativePath}:`,
          err,
        );
      }
    }

    return fileScanResults;
  }

  /**
   * Scan all files in the call tree
   */
  async scanCallTree(
    files: Set<string>,
    extractedDir: string,
    packageName: string,
    version: string,
  ): Promise<IVersionScanResults> {
    const versionResults: IVersionScanResults = {
      packageName,
      version,
      scannedAt: new Date().toISOString(),
      totalFiles: files.size,
      totalFindings: 0,
      files: [],
      summary: {},
    };

    // Initialize summary for all rules
    for (const rule of this.rules) {
      versionResults.summary[rule.name] = {
        count: 0,
        severity: {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        },
      };
    }

    // Scan each file
    for (const filePath of files) {
      const fileResults = await this.scanFile(filePath, extractedDir);

      // Only include files with findings
      const hasFindings = fileResults.results.some(
        (r) => r.findings.length > 0,
      );
      if (hasFindings) {
        versionResults.files.push(fileResults);

        // Update summary
        for (const ruleResult of fileResults.results) {
          const ruleSummary = versionResults.summary[ruleResult.ruleName];
          if (ruleSummary) {
            ruleSummary.count += ruleResult.findings.length;
            versionResults.totalFindings += ruleResult.findings.length;

            // Count by severity
            for (const finding of ruleResult.findings) {
              const severity = finding.severity || "low";
              ruleSummary.severity[severity]++;
            }
          }
        }
      }
    }

    return versionResults;
  }

  /**
   * Save scan results to JSON file
   */
  saveScanResults(results: IVersionScanResults, versionDir: string): void {
    const outputPath = path.join(versionDir, "scan_results.json");

    try {
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
      console.log(`\n     💾 Scan results saved to: ${outputPath}`);
      console.log(
        `     📊 Total findings: ${results.totalFindings} across ${results.files.length} files`,
      );

      // Print summary
      console.log(`\n     📈 Summary by rule:`);
      for (const [ruleName, summary] of Object.entries(results.summary)) {
        if (summary.count > 0) {
          console.log(`        ${ruleName}: ${summary.count} findings`);
          const severities = [];
          if (summary.severity.critical > 0)
            severities.push(`${summary.severity.critical} critical`);
          if (summary.severity.high > 0)
            severities.push(`${summary.severity.high} high`);
          if (summary.severity.medium > 0)
            severities.push(`${summary.severity.medium} medium`);
          if (summary.severity.low > 0)
            severities.push(`${summary.severity.low} low`);
          if (severities.length > 0) {
            console.log(`          (${severities.join(", ")})`);
          }
        }
      }
    } catch (err) {
      console.error(`     ❌ Error saving scan results:`, err);
    }
  }

  /**
   * Add a custom rule
   */
  addRule(rule: IScanRule): void {
    this.rules.push(rule);
  }

  /**
   * Remove a rule by name
   */
  removeRule(ruleName: string): void {
    this.rules = this.rules.filter((r) => r.name !== ruleName);
  }

  /**
   * Get all registered rules
   */
  getRules(): IScanRule[] {
    return [...this.rules];
  }
}
