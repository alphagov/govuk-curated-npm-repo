# Scan Rules Developer Guide

## Overview

The scanner uses a pluggable rule-based system to detect security issues and suspicious patterns in npm packages. Each scan rule is a TypeScript class that implements the `IScanRule` interface.

## Creating a Custom Scan Rule

### 1. Define Your Finding Types

Create an enum for the types of findings your rule can detect:

```typescript
// src/scan-rules/my-custom-rule.ts
export enum MyCustomFindingType {
  SUSPICIOUS_PATTERN = "SUSPICIOUS_PATTERN",
  DANGEROUS_API = "DANGEROUS_API",
}
```

### 2. Implement the IScanRule Interface

```typescript
import { IScanRule, IScanResult } from "./types";

export class MyCustomRule implements IScanRule {
  // Rule identifier
  name = "my-custom-rule";
  
  // Human-readable description
  description = "Detects my custom security patterns";
  
  // File filter - can be a glob pattern or RegExp
  // Examples:
  //   "*.js"           - only .js files
  //   "**/*.ts"        - all .ts files recursively
  //   /\.(js|ts)$/     - .js or .ts files
  filter = /\.(js|ts|mjs|cjs)$/;

  async scan(
    filePath: string,
    fileContent: string,
    ast?: any
  ): Promise<IScanResult[]> {
    const results: IScanResult[] = [];

    // Your detection logic here
    const suspiciousPattern = /dangerousFunction\s*\(/g;
    let match;

    while ((match = suspiciousPattern.exec(fileContent)) !== null) {
      results.push({
        loc: {
          startPos: match.index,
          length: match[0].length,
        },
        type: MyCustomFindingType.DANGEROUS_API,
        description: "Dangerous function call detected",
        severity: "high", // low | medium | high | critical
        metadata: {
          // Optional: add any additional context
          matchedText: match[0],
        },
      });
    }

    return results;
  }
}
```

### 3. Register Your Rule

Add your rule to the barrel file:

```typescript
// src/scan-rules/index.ts

// Export your rule
export { MyCustomRule, MyCustomFindingType } from "./my-custom-rule";

// Add to the ALL_SCAN_RULES array
import { MyCustomRule } from "./my-custom-rule";

export const ALL_SCAN_RULES: IScanRule[] = [
  new CryptoDetectionRule(),
  new NetworkActivityRule(),
  new EvalDetectionRule(),
  new MyCustomRule(), // <-- Add here
];
```

## IScanRule Interface Reference

```typescript
interface IScanRule {
  name: string;                    // Unique identifier for the rule
  description: string;             // What the rule checks for
  filter: string | RegExp;         // Which files to scan
  scan(                            // Scan function
    filePath: string,              // Absolute path to file
    fileContent: string,           // File content as string
    ast?: any                      // Optional pre-parsed AST
  ): Promise<IScanResult[]> | IScanResult[];
}
```

## IScanResult Interface Reference

```typescript
interface IScanResult {
  loc: {
    startPos: number;    // Character position in file
    length: number;      // Length of the match
    line?: number;       // Optional: line number
    column?: number;     // Optional: column number
  };
  type: string | number; // Your enum value
  description: string;   // Human-readable description
  severity?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>; // Optional additional data
}
```

## Advanced: Using Babel AST

For more sophisticated pattern detection, you can parse and traverse the AST:

```typescript
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

export class AdvancedRule implements IScanRule {
  name = "advanced-ast-rule";
  description = "Uses AST for advanced detection";
  filter = /\.(js|ts)$/;

  async scan(filePath: string, fileContent: string): Promise<IScanResult[]> {
    const results: IScanResult[] = [];

    try {
      const ast = parse(fileContent, {
        sourceType: "unambiguous",
        plugins: ["typescript", "jsx"],
      });

      traverse(ast, {
        CallExpression(path) {
          // Check for specific function calls
          if (
            path.node.callee.type === "Identifier" &&
            path.node.callee.name === "dangerousFunction"
          ) {
            results.push({
              loc: {
                startPos: path.node.start || 0,
                length: (path.node.end || 0) - (path.node.start || 0),
              },
              type: "DANGEROUS_CALL",
              description: "Dangerous function detected via AST",
              severity: "high",
            });
          }
        },
