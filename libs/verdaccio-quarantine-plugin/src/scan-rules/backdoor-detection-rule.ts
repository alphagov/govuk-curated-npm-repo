import { IScanRule, IScanResult } from "./types";

export enum BackdoorFindingType {
  HTTP_SERVER_CREATION = "HTTP_SERVER_CREATION",
  EXPRESS_SERVER = "EXPRESS_SERVER",
  SERVER_LISTEN = "SERVER_LISTEN",
  PORT_BINDING = "PORT_BINDING",
  LOCALHOST_BINDING = "LOCALHOST_BINDING",
  WILDCARD_BINDING = "WILDCARD_BINDING",
  NET_SERVER = "NET_SERVER",
  DGRAM_SOCKET = "DGRAM_SOCKET",
  REVERSE_SHELL = "REVERSE_SHELL",
  SHELL_EXEC = "SHELL_EXEC",
}

/**
 * Detects potential backdoor patterns including server creation,
 * port listening, and shell execution
 */
export class BackdoorDetectionRule implements IScanRule {
  name = "backdoor-detection";
  description =
    "Detects potential backdoor patterns like server creation and shell execution";
  filter = /\.(js|ts|mjs|cjs)$/;

  async scan(_filePath: string, fileContent: string): Promise<IScanResult[]> {
    const results: IScanResult[] = [];

    // Detect HTTP server creation
    const httpServerRegex = /http\.createServer|https\.createServer/g;
    let match;

    while ((match = httpServerRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.HTTP_SERVER_CREATION,
        description:
          "HTTP/HTTPS server creation detected - potential backdoor listener",
        severity: "high",
        metadata: {
          pattern: match[0],
        },
      });
    }

    // Detect Express server initialization
    const expressServerRegex =
      /(?:express|app)\s*\(\s*\)|new\s+express\s*\(\s*\)/g;
    while ((match = expressServerRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.EXPRESS_SERVER,
        description: "Express server initialization detected",
        severity: "medium",
        metadata: {
          pattern: match[0],
        },
      });
    }

    // Detect .listen() calls (server listening on ports)
    const listenRegex = /\.listen\s*\(\s*(\d+|[a-zA-Z_$][\w$]*)/g;
    while ((match = listenRegex.exec(fileContent)) !== null) {
      // Extract port if it's a number
      const portMatch = match[1];
      if (!portMatch) continue;

      const isNumericPort = /^\d+$/.test(portMatch);

      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.SERVER_LISTEN,
        description: isNumericPort
          ? `Server listening on port ${portMatch} - potential backdoor`
          : "Server listen call detected - potential backdoor",
        severity: "critical",
        metadata: {
          port: isNumericPort ? parseInt(portMatch) : portMatch,
          pattern: match[0],
        },
      });
    }

    // Detect port binding patterns
    const portBindingRegex = /(?:PORT|port|Port)\s*=\s*(\d+)/g;
    while ((match = portBindingRegex.exec(fileContent)) !== null) {
      const portStr = match[1];
      if (!portStr) continue;

      const port = parseInt(portStr);
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.PORT_BINDING,
        description: `Port ${port} assignment detected`,
        severity: port < 1024 ? "high" : "medium",
        metadata: {
          port: port,
          privileged: port < 1024,
        },
      });
    }

    // Detect localhost binding (might be trying to hide)
    const localhostRegex = /['"](?:localhost|127\.0\.0\.1|0\.0\.0\.0)['"]/g;
    while ((match = localhostRegex.exec(fileContent)) !== null) {
      const host = match[0].replace(/['"]/g, "");
      const isWildcard = host === "0.0.0.0";

      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: isWildcard
          ? BackdoorFindingType.WILDCARD_BINDING
          : BackdoorFindingType.LOCALHOST_BINDING,
        description: isWildcard
          ? "Wildcard binding (0.0.0.0) - accessible from any network interface"
          : `Localhost binding detected: ${host}`,
        severity: isWildcard ? "critical" : "medium",
        metadata: {
          host: host,
          wildcardBinding: isWildcard,
        },
      });
    }

    // Detect TCP/Net server creation
    const netServerRegex = /net\.createServer|net\.Server/g;
    while ((match = netServerRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.NET_SERVER,
        description:
          "TCP server creation detected - potential raw socket backdoor",
        severity: "critical",
        metadata: {
          pattern: match[0],
        },
      });
    }

    // Detect UDP socket creation
    const dgramRegex = /dgram\.createSocket/g;
    while ((match = dgramRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.DGRAM_SOCKET,
        description: "UDP socket creation detected - potential covert channel",
        severity: "high",
        metadata: {
          pattern: match[0],
        },
      });
    }

    // Detect reverse shell patterns
    const reverseShellRegex = /\.connect\s*\(\s*\{?\s*(?:port|host)/g;
    while ((match = reverseShellRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.REVERSE_SHELL,
        description: "Outbound connection pattern - potential reverse shell",
        severity: "critical",
        metadata: {
          pattern: match[0],
        },
      });
    }

    // Detect shell execution combined with network operations
    const shellExecRegex =
      /(?:exec|spawn|execSync|spawnSync)\s*\(\s*['"](?:sh|bash|cmd|powershell)/g;
    while ((match = shellExecRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: BackdoorFindingType.SHELL_EXEC,
        description:
          "Shell execution detected - potential command execution backdoor",
        severity: "critical",
        metadata: {
          pattern: match[0],
        },
      });
    }

    // Check for combination of server + shell (highly suspicious)
    const hasServer = results.some(
      (r) =>
        r.type === BackdoorFindingType.HTTP_SERVER_CREATION ||
        r.type === BackdoorFindingType.NET_SERVER ||
        r.type === BackdoorFindingType.SERVER_LISTEN,
    );
    const hasShell = results.some(
      (r) => r.type === BackdoorFindingType.SHELL_EXEC,
    );

    if (hasServer && hasShell) {
      results.push({
        loc: {
          startPos: 0,
          length: 0,
        },
        type: BackdoorFindingType.SHELL_EXEC,
        description:
          "⚠️ CRITICAL: File contains BOTH server creation AND shell execution - strong backdoor indicator",
        severity: "critical",
        metadata: {
          combinedThreat: true,
          hasServer: true,
          hasShell: true,
        },
      });
    }

    return results;
  }
}
