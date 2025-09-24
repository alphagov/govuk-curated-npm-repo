import * as fs from "fs/promises";
import * as path from "path";
import * as tar from "tar";
import { Logger } from "@verdaccio/types";

export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskType =
  | "suspicious-script"
  | "network-access"
  | "filesystem-access"
  | "package-json-error"
  | "scan-error"
  | "suspicious-dependency"
  | "binary-executable"
  | "large-files";

export interface SecurityRisk {
  type: RiskType;
  severity: RiskSeverity;
  description: string;
  details?: Record<string, any>;
}

export interface ScanResults {
  packageName: string;
  scannedAt: string;
  risks: SecurityRisk[];
  riskScore: number;
  scanDurationMs: number;
}

export class PackageScanner {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async scanPackage(
    packagePath: string,
    packageName: string,
  ): Promise<ScanResults> {
    const startTime = Date.now();
    this.logger.info(
      { plugin: "quarantine", package: packageName },
      "Starting security scan",
    );

    const results: ScanResults = {
      packageName,
      scannedAt: new Date().toISOString(),
      risks: [],
      riskScore: 0,
      scanDurationMs: 0,
    };

    try {
      // Extract tarball for analysis
      const extractPath = path.join(
        path.dirname(packagePath),
        `${packageName.replace(/[^a-zA-Z0-9]/g, "_")}-extract`,
      );
      await this.extractPackage(packagePath, extractPath);

      // Run security checks
      await this.scanPackageJson(extractPath, results);
      await this.scanSourceCode(extractPath, results);
      await this.scanForSuspiciousPatterns(extractPath, results);

      // Calculate overall risk score
      results.riskScore = this.calculateRiskScore(results.risks);

      // Cleanup

      await fs.rm(extractPath, { recursive: true, force: true });

      results.scanDurationMs = Date.now() - startTime;
      this.logger.info(
        {
          plugin: "quarantine",
          package: packageName,
          riskScore: results.riskScore,
          risksFound: results.risks.length,
          duration: results.scanDurationMs,
        },
        "Scan completed",
      );
    } catch (error) {
      this.logger.error(
        { plugin: "quarantine", package: packageName, error },
        "Scan failed",
      );
      results.risks.push({
        type: "scan-error",
        severity: "medium",
        description: "Failed to complete security scan",
        details: { error: error },
      });
      results.riskScore = 100;
      results.scanDurationMs = Date.now() - startTime;
    }

    return results;
  }

  private async extractPackage(
    tarballPath: string,
    extractPath: string,
  ): Promise<void> {
    await fs.mkdir(extractPath, { recursive: true });
    await tar.extract({
      file: tarballPath,
      cwd: extractPath,
      strip: 1, // Remove the package/ prefix that tarballs usually have
    });
  }

  private async scanPackageJson(
    extractPath: string,
    results: ScanResults,
  ): Promise<void> {
    const packageJsonPath = path.join(extractPath, "package.json");

    try {
      const packageJsonContent = await fs.readFile(packageJsonPath, "utf8");
      const packageJson = JSON.parse(packageJsonContent);

      // Check for suspicious scripts
      if (packageJson.scripts) {
        const suspiciousScripts = [
          "preinstall",
          "postinstall",
          "preunintstall",
          "postunintall",
        ];
        for (const script of suspiciousScripts) {
          if (packageJson.scripts[script]) {
            results.risks.push({
              type: "suspicious-script",
              severity: "high",
              description: `Package has ${script}' script: ${packageJson.scripts[script]}`,
              details: { script, command: packageJson.scripts[script] },
            });
          }
        }
      }

      // Check for suspicious dependencies
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
        ...packageJson.optionalDependencies,
      };

      // Look for known problematic packages or patterns
      const suspiciousDeps = Object.keys(allDeps).filter(
        (dep) =>
          dep.includes("eval") ||
          dep.includes("exec") ||
          dep.toLowerCase().includes("backdoor"),
      );

      for (const dep of suspiciousDeps) {
        results.risks.push({
          type: "suspicious-dependency",
          severity: "medium",
          description: `Potentially suspicious depencency: ${dep}`,
          details: { dependency: dep, version: allDeps[dep] },
        });
      }
    } catch (error) {
      results.risks.push({
        type: "package-json-error",
        severity: "high",
        description: "Could not read or parse package.json",
      });
    }
  }

  private async scanSourceCode(
    extractPath: string,
    results: ScanResults,
  ): Promise<void> {
    await this.scanDirectory(extractPath, results);
  }

  private async scanDirectory(
    dirPath: string,
    results: ScanResults,
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".") &&
        entry.name != "node_modules"
      ) {
        await this.scanDirectory(fullPath, results);
      } else if (entry.isFile() && this.shouldScanFile(entry.name)) {
        await this.scanFile(fullPath, results);
      }
    }
  }

  private shouldScanFile(filename: string): boolean {
    const extensions = [
      ".js",
      ".ts",
      ".json",
      ".sh",
      ".py",
      ".jsx",
      ".tsx",
      ".mjs",
    ];
    return extensions.some((ext) => filename.endsWith(ext));
  }

  private async scanFile(
    filePath: string,
    results: ScanResults,
  ): Promise<void> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const relativePath = path.relative(process.cwd(), filePath);

      // Look for network calls
      const networkPatterns = [
        { pattern: /fetch\s*\(/gi, description: "fetch() call" },
        { pattern: /XMLHttpRequest/gi, description: "XMLHttpRequest usage" },
        { pattern: /\.post\s*\(/gi, description: "HTTP POST call" },
        { pattern: /\.get\s*\(/gi, description: "HTTP GET call" },
        { pattern: /axios\./gi, description: "Axios usage" },
        { pattern: /require\s*\(\s*]'"]]/gi, description: "HTTP(S) require" },
      ];

      for (const { pattern, description } of networkPatterns) {
        if (pattern.test(content)) {
          results.risks.push({
            type: "network-access",
            severity: "medium",
            description: `File ${path.basename(filePath)} contains ${description}`,
            details: { file: relativePath },
          });
          break; // Only flag once per file
        }
      }

      const fsPatterns = [
        { pattern: /fs\.writeFile/gi, description: "file write operation" },
        {
          pattern: /fs\.createWriteStream/gi,
          description: "write stream creation",
        },
        { pattern: /process\.cwd/gi, description: "current directory access" },
        { pattern: /\.\.\/\.\.\//g, description: "directory traversal" },
      ];

      for (const { pattern, description } of fsPatterns) {
        if (pattern.test(content)) {
          results.risks.push({
            type: "filesystem-access",
            severity: "low",
            description: `File $path.basename(filePath)} contains ${description}`,
            details: { file: relativePath },
          });
          break;
        }
      }
    } catch (error) {
      // Skip files that can't be read as text
    }
  }

  private async scanForSuspiciousPatterns(
    extractPath: string,
    results: ScanResults,
  ): Promise<void> {
    await this.scanForBinariesAndLargeFiles(extractPath, results);
  }

  private async scanForBinariesAndLargeFiles(
    dirPath: string,
    results: ScanResults,
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        await this.scanForBinariesAndLargeFiles(fullPath, results);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);

        // Check for large files (>10MB)
        if (stats.size > 10 * 1024 * 1024) {
          results.risks.push({
            type: "large-files",
            severity: "low",
            description: `Large file detected: ${entry.name} (${Math.round(stats.size / 1024 / 1024)}MB)`,
            details: { file: entry.name, size: stats.size },
          });
        }

        // Check for potentially executable files
        if (this.isExecutable(entry.name) || (stats.mode & 0o111) != 0) {
          results.risks.push({
            type: "binary-executable",
            severity: "medium",
            description: `Executable file detected: ${entry.name}`,
            details: { file: entry.name },
          });
        }
      }
    }
  }

  private isExecutable(filename: string): boolean {
    const executableExtensions = [
      ".exe",
      ".bin",
      ".app",
      ".dmg",
      ".deb",
      ".rpm",
    ];
    return executableExtensions.some((ext) => filename.endsWith(ext));
  }

  private calculateRiskScore(risks: SecurityRisk[]): number {
    const severityRiskScores: Record<RiskSeverity, number> = {
      low: 10,
      medium: 30,
      high: 60,
      critical: 100,
    };

    let score = 0;
    for (const risk of risks) {
      score += severityRiskScores[risk.severity];
    }

    // Cap at 100
    return Math.min(score, 100);
  }
}
