import { IScanRule, IScanResult } from "./types";

export enum NetworkFindingType {
  HTTP_REQUEST = "HTTP_REQUEST",
  FETCH_CALL = "FETCH_CALL",
  WEBSOCKET = "WEBSOCKET",
  DNS_LOOKUP = "DNS_LOOKUP",
  TCP_CONNECTION = "TCP_CONNECTION",
}

/**
 * Detects network activity and external connections
 */
export class NetworkActivityRule implements IScanRule {
  name = "network-activity";
  description = "Detects network requests and external connections";
  filter = /\.(js|ts|mjs|cjs)$/;

  async scan(_filePath: string, fileContent: string): Promise<IScanResult[]> {
    const results: IScanResult[] = [];

    // Detect http/https module usage
    const httpImportRegex =
      /require\s*\(\s*['"]https?['"]\s*\)|import\s+.*from\s+['"]https?['"]/g;
    let match;

    while ((match = httpImportRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: NetworkFindingType.HTTP_REQUEST,
        description: "HTTP/HTTPS module import detected",
        severity: "medium",
      });
    }

    // Detect fetch calls
    const fetchRegex = /\bfetch\s*\(/g;
    while ((match = fetchRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: NetworkFindingType.FETCH_CALL,
        description: "Fetch API call detected",
        severity: "medium",
      });
    }

    // Detect WebSocket usage
    const websocketRegex =
      /new\s+WebSocket\s*\(|require\s*\(\s*['"]ws['"]\s*\)/g;
    while ((match = websocketRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: NetworkFindingType.WEBSOCKET,
        description: "WebSocket connection detected",
        severity: "high",
      });
    }

    // Detect net module (TCP)
    const netRegex =
      /require\s*\(\s*['"]net['"]\s*\)|import\s+.*from\s+['"]net['"]/g;
    while ((match = netRegex.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: NetworkFindingType.TCP_CONNECTION,
        description: "TCP/Net module usage detected",
        severity: "high",
      });
    }

    return results;
  }
}
