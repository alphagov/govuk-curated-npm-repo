import { IScanRule, IScanResult } from "./types";

export enum PackageJsonHookFindingType {
  PREINSTALL_SCRIPT = "PREINSTALL_SCRIPT",
  POSTINSTALL_SCRIPT = "POSTINSTALL_SCRIPT",
  PREUNINSTALL_SCRIPT = "PREUNINSTALL_SCRIPT",
  POSTUNINSTALL_SCRIPT = "POSTUNINSTALL_SCRIPT",
  INSTALL_SCRIPT = "INSTALL_SCRIPT",
  SHELL_COMMAND = "SHELL_COMMAND",
  CURL_DOWNLOAD = "CURL_DOWNLOAD",
  WGET_DOWNLOAD = "WGET_DOWNLOAD",
  EVAL_IN_HOOK = "EVAL_IN_HOOK",
  ENCODED_COMMAND = "ENCODED_COMMAND",
  OBFUSCATED_SCRIPT = "OBFUSCATED_SCRIPT",
  REMOTE_SCRIPT_EXECUTION = "REMOTE_SCRIPT_EXECUTION",
  ENVIRONMENT_EXFILTRATION = "ENVIRONMENT_EXFILTRATION",
  HIDDEN_PROCESS = "HIDDEN_PROCESS",
  PRIVILEGE_ESCALATION = "PRIVILEGE_ESCALATION",
}

/**
 * Detects malicious patterns in package.json lifecycle hooks
 * (preinstall, postinstall, etc.)
 */
export class PackageJsonHooksRule implements IScanRule {
  name = "package-json-hooks";
  description = "Detects malicious patterns in package.json lifecycle scripts";
  filter = /package\.json$/;

  async scan(_filePath: string, fileContent: string): Promise<IScanResult[]> {
    const results: IScanResult[] = [];

    let packageJson: any;
    try {
      packageJson = JSON.parse(fileContent);
    } catch (err) {
      // Invalid JSON, skip
      return results;
    }

    // Check if scripts section exists
    if (!packageJson.scripts || typeof packageJson.scripts !== "object") {
      return results;
    }

    const scripts = packageJson.scripts;
    const suspiciousHooks = [
      "preinstall",
      "install",
      "postinstall",
      "preuninstall",
      "postuninstall",
    ];

    // Check each lifecycle hook
    for (const hook of suspiciousHooks) {
      if (!scripts[hook]) continue;

      const script = scripts[hook];
      const scriptStartPos = fileContent.indexOf(`"${hook}"`) || 0;

      // Flag the existence of the hook
      let hookType: PackageJsonHookFindingType;
      let severity: "low" | "medium" | "high" | "critical" = "medium";

      switch (hook) {
        case "preinstall":
          hookType = PackageJsonHookFindingType.PREINSTALL_SCRIPT;
          severity = "high"; // Runs before installation
          break;
        case "install":
          hookType = PackageJsonHookFindingType.INSTALL_SCRIPT;
          severity = "medium";
          break;
        case "postinstall":
          hookType = PackageJsonHookFindingType.POSTINSTALL_SCRIPT;
          severity = "high"; // Common attack vector
          break;
        case "preuninstall":
          hookType = PackageJsonHookFindingType.PREUNINSTALL_SCRIPT;
          severity = "medium";
          break;
        case "postuninstall":
          hookType = PackageJsonHookFindingType.POSTUNINSTALL_SCRIPT;
          severity = "medium";
          break;
        default:
          continue;
      }

      results.push({
        loc: {
          startPos: scriptStartPos,
          length: hook.length + script.length,
        },
        type: hookType,
        description: `${hook} script detected: "${script}"`,
        severity: severity,
        metadata: {
          hook: hook,
          script: script,
        },
      });

      // Now scan the script content for suspicious patterns
      this.scanScriptContent(script, scriptStartPos, results);
    }

    return results;
  }

  /**
   * Scan the actual script content for malicious patterns
   */
  private scanScriptContent(
    script: string,
    startPos: number,
    results: IScanResult[],
  ): void {
    const patterns = [
      {
        regex: /\b(curl|wget)\s+.*https?:\/\//i,
        type: PackageJsonHookFindingType.CURL_DOWNLOAD,
        description: "Downloads file from remote URL during install",
        severity: "critical" as const,
      },
      {
        regex: /\|\s*(?:sh|bash|zsh|fish)\b/,
        type: PackageJsonHookFindingType.SHELL_COMMAND,
        description: "Pipes content to shell - potential code execution",
        severity: "critical" as const,
      },
      {
        regex: /\beval\s*\(/,
        type: PackageJsonHookFindingType.EVAL_IN_HOOK,
        description: "eval() in install script - dangerous code execution",
        severity: "critical" as const,
      },
      {
        regex: /base64|atob|btoa|Buffer\.from.*base64/i,
        type: PackageJsonHookFindingType.ENCODED_COMMAND,
        description: "Base64 encoding/decoding - potential obfuscation",
        severity: "high" as const,
      },
      {
        regex: /\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|\\[0-7]{3}/i,
        type: PackageJsonHookFindingType.OBFUSCATED_SCRIPT,
        description: "Obfuscated characters detected in script",
        severity: "high" as const,
      },
      {
        regex: /node\s+-e\s+['"]|node\s+--eval\s+['"]/,
        type: PackageJsonHookFindingType.REMOTE_SCRIPT_EXECUTION,
        description: "Inline Node.js code execution",
        severity: "high" as const,
      },
      {
        regex: /process\.env|printenv|env\s*\||\$\{?\w+\}?/,
        type: PackageJsonHookFindingType.ENVIRONMENT_EXFILTRATION,
        description:
          "Accesses environment variables - potential credential theft",
        severity: "high" as const,
      },
      {
        regex: /nohup|disown|&\s*$/,
        type: PackageJsonHookFindingType.HIDDEN_PROCESS,
        description: "Background process execution - may persist after install",
        severity: "critical" as const,
      },
      {
        regex: /sudo|su\s|chmod\s+[+]?[xs]|setuid/i,
        type: PackageJsonHookFindingType.PRIVILEGE_ESCALATION,
        description: "Privilege escalation attempt detected",
        severity: "critical" as const,
      },
      {
        regex: /rm\s+-rf\s+\/|dd\s+if=.*of=|mkfs|fdisk/,
        type: PackageJsonHookFindingType.SHELL_COMMAND,
        description: "Destructive file system command detected",
        severity: "critical" as const,
      },
      {
        regex: />>\s*~\/\.|>>\s*\/etc\/|>>\s*\/usr\//,
        type: PackageJsonHookFindingType.SHELL_COMMAND,
        description: "Writes to system or hidden files",
        severity: "high" as const,
      },
      {
        regex: /nc\s|netcat|telnet\s/i,
        type: PackageJsonHookFindingType.REMOTE_SCRIPT_EXECUTION,
        description:
          "Network utility (nc/netcat/telnet) - potential reverse shell",
        severity: "critical" as const,
      },
      {
        regex: /python\s+-c|perl\s+-e|ruby\s+-e/,
        type: PackageJsonHookFindingType.REMOTE_SCRIPT_EXECUTION,
        description: "Inline script execution in another language",
        severity: "high" as const,
      },
      {
        regex: /crontab|at\s+\d|systemctl|service\s/,
        type: PackageJsonHookFindingType.HIDDEN_PROCESS,
        description: "Attempts to install persistent service/scheduled task",
        severity: "critical" as const,
      },
      {
        regex: /\/dev\/tcp\/|\/dev\/udp\//,
        type: PackageJsonHookFindingType.REMOTE_SCRIPT_EXECUTION,
        description: "Direct TCP/UDP connection via bash - potential backdoor",
        severity: "critical" as const,
      },
    ];

    for (const pattern of patterns) {
      const match = pattern.regex.exec(script);
      if (match) {
        results.push({
          loc: {
            startPos: startPos + match.index,
            length: match[0].length,
          },
          type: pattern.type,
          description: pattern.description,
          severity: pattern.severity,
          metadata: {
            matchedPattern: match[0],
            fullScript: script,
          },
        });
      }
    }

    // Check for suspiciously long scripts (often obfuscated)
    if (script.length > 500) {
      results.push({
        loc: {
          startPos: startPos,
          length: script.length,
        },
        type: PackageJsonHookFindingType.OBFUSCATED_SCRIPT,
        description: `Unusually long install script (${script.length} chars) - possible obfuscation`,
        severity: "medium",
        metadata: {
          scriptLength: script.length,
        },
      });
    }

    // Check for multiple commands chained together (suspicious)
    const commandCount = (script.match(/[;&|]\s*(?!$)/g) || []).length;
    if (commandCount > 3) {
      results.push({
        loc: {
          startPos: startPos,
          length: script.length,
        },
        type: PackageJsonHookFindingType.OBFUSCATED_SCRIPT,
        description: `Complex chained commands (${commandCount + 1} commands) in install script`,
        severity: "high",
        metadata: {
          commandCount: commandCount + 1,
        },
      });
    }
  }
}
