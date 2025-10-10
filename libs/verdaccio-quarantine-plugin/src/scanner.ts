#!/usr/bin/env node

import Workflow from "./workflow";
import { Logger } from "@verdaccio/types";
import * as fs from "node:fs";
import * as path from "node:path";
import * as tar from "tar";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import { ScanEngine } from "./scan-engine";

const logger: Logger = {
  error: (conf: any, message?: string) => console.error(message || conf),
  info: (conf: any, message?: string) => console.info(message || conf),
  debug: (conf: any, message?: string) => console.debug(message || conf),
  child: (_conf: any) => logger,
  warn: (conf: any, message?: string) => console.warn(message || conf),
  http: (conf: any, message?: string) => console.log(message || conf),
  trace: (conf: any, message?: string) => console.trace(message || conf),
};

const workflow = new Workflow("./workflow.json", logger, {
  debounceMs: 0,
});

const QUARANTINE_DIR = "./quarantine";

const scanEngine = new ScanEngine();

interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  module?: string;
  browser?: string | Record<string, string>;
  bin?: string | Record<string, string>;
  exports?: any;
  versions?: Record<string, any>;
}

/**
 * Extract imports/requires from a JavaScript/TypeScript file using Babel
 */
function extractImports(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const imports: string[] = [];

    // Determine file type for parser plugins
    const ext = path.extname(filePath);
    const plugins: any[] = [];

    if ([".ts", ".tsx"].includes(ext)) {
      plugins.push("typescript");
    }
    if ([".jsx", ".tsx"].includes(ext)) {
      plugins.push("jsx");
    }

    // Parse the file
    const ast = parse(content, {
      sourceType: "unambiguous", // Auto-detect module vs script
      plugins: [
        ...plugins,
        "decorators-legacy",
        "classProperties",
        "dynamicImport",
        "exportDefaultFrom",
        "exportNamespaceFrom",
      ],
      errorRecovery: true, // Continue parsing even with errors
    });

    // Traverse the AST to find imports
    traverse(ast, {
      // ES6 import statements: import x from 'module'
      ImportDeclaration(path) {
        const source = path.node.source?.value;
        if (source) {
          imports.push(source);
        }
      },

      // CommonJS require: require('module')
      CallExpression(path) {
        const callee = path.node.callee;
        const firstArg = path.node.arguments[0];

        if (
          callee.type === "Identifier" &&
          callee.name === "require" &&
          firstArg &&
          firstArg.type === "StringLiteral"
        ) {
          imports.push(firstArg.value);
        }
      },

      // Dynamic imports: import('module')
      Import(path) {
        const parent = path.parent;
        if (!parent) return;

        const firstArg =
          parent.type === "CallExpression" ? parent.arguments[0] : null;

        if (
          parent.type === "CallExpression" &&
          firstArg &&
          firstArg.type === "StringLiteral"
        ) {
          imports.push(firstArg.value);
        }
      },

      // Export from: export { x } from 'module'
      ExportNamedDeclaration(path) {
        const source = path.node.source?.value;
        if (source) {
          imports.push(source);
        }
      },

      // Export all from: export * from 'module'
      ExportAllDeclaration(path) {
        const source = path.node.source?.value;
        if (source) {
          imports.push(source);
        }
      },
    });

    return [...new Set(imports)]; // Remove duplicates
  } catch (err) {
    console.error(`   ❌ Error parsing file ${filePath}:`, err);
    return [];
  }
}

/**
 * Resolve import path to actual file path
 */
function resolveImportPath(
  importPath: string,
  currentDir: string,
  extractedDir: string,
): string | null {
  // Skip node_modules and external packages
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return null;
  }

  const possibleExtensions = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ""];
  const basePath = path.resolve(currentDir, importPath);

  // Security check: ensure resolved path is within extractedDir
  if (!basePath.startsWith(extractedDir)) {
    return null;
  }

  // Try with different extensions
  for (const ext of possibleExtensions) {
    const fullPath = basePath + ext;
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }

  // Try index files
  for (const ext of possibleExtensions.slice(0, -1)) {
    const indexPath = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
      return indexPath;
    }
  }

  return null;
}

/**
 * Build call tree from an entry point
 */
function buildCallTree(
  entryPoint: string,
  extractedDir: string,
  visited: Set<string> = new Set(),
  depth: number = 0,
): Set<string> {
  const indent = "  ".repeat(depth);
  const relativePath = path.relative(extractedDir, entryPoint);

  if (visited.has(entryPoint)) {
    console.log(`${indent}↺ ${relativePath} (already visited)`);
    return visited;
  }

  visited.add(entryPoint);
  console.log(`${indent}📄 ${relativePath}`);

  const imports = extractImports(entryPoint);
  const currentDir = path.dirname(entryPoint);

  for (const imp of imports) {
    const resolvedPath = resolveImportPath(imp, currentDir, extractedDir);
    if (resolvedPath) {
      buildCallTree(resolvedPath, extractedDir, visited, depth + 1);
    }
  }

  return visited;
}

/**
 * Get entry points from package.json
 */
function getEntryPoints(
  packageJson: PackageJson,
  extractedDir: string,
): string[] {
  const entryPoints: string[] = [];

  // Main entry point
  if (packageJson.main) {
    const mainPath = path.join(extractedDir, packageJson.main);
    if (fs.existsSync(mainPath)) {
      entryPoints.push(mainPath);
    }
  }

  // Module entry point (ES modules)
  if (packageJson.module) {
    const modulePath = path.join(extractedDir, packageJson.module);
    if (fs.existsSync(modulePath)) {
      entryPoints.push(modulePath);
    }
  }

  // Browser entry point
  if (packageJson.browser) {
    if (typeof packageJson.browser === "string") {
      const browserPath = path.join(extractedDir, packageJson.browser);
      if (fs.existsSync(browserPath)) {
        entryPoints.push(browserPath);
      }
    }
  }

  // Binary entry points
  if (packageJson.bin) {
    if (typeof packageJson.bin === "string") {
      const binPath = path.join(extractedDir, packageJson.bin);
      if (fs.existsSync(binPath)) {
        entryPoints.push(binPath);
      }
    } else if (typeof packageJson.bin === "object") {
      for (const binFile of Object.values(packageJson.bin)) {
        const binPath = path.join(extractedDir, binFile);
        if (fs.existsSync(binPath)) {
          entryPoints.push(binPath);
        }
      }
    }
  }

  // If no entry points found, try index.js
  if (entryPoints.length === 0) {
    const indexPath = path.join(extractedDir, "index.js");
    if (fs.existsSync(indexPath)) {
      entryPoints.push(indexPath);
    }
  }

  return entryPoints;
}

/**
 * Extract tarball to _extracted folder
 */
async function extractTarball(
  tarballPath: string,
  extractDir: string,
): Promise<void> {
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }

  await tar.extract({
    file: tarballPath,
    cwd: extractDir,
    strip: 1, // Remove the top-level 'package' directory
  });
}

/**
 * Scan a specific version of a package
 */
async function scanVersion(version: string, versionDir: string): Promise<void> {
  console.log(`\n  📦 Version: ${version}`);

  // Find tarball in version directory
  const files = fs.readdirSync(versionDir);
  const tarball = files.find(
    (f) => f.endsWith(".tgz") || f.endsWith(".tar.gz"),
  );

  if (!tarball) {
    console.log(`     ⚠️  No tarball found in ${versionDir}`);
    return;
  }

  const tarballPath = path.join(versionDir, tarball);
  const extractedDir = path.join(versionDir, "_extracted");

  console.log(`     📦 Tarball: ${tarball}`);

  // Extract if not already extracted
  if (!fs.existsSync(extractedDir)) {
    console.log(`     🔧 Extracting...`);
    try {
      await extractTarball(tarballPath, extractedDir);
    } catch (err) {
      console.error(`     ❌ Error extracting tarball:`, err);
      return;
    }
  } else {
    console.log(`     ✓ Already extracted`);
  }

  // Read package.json from extracted directory
  const packageJsonPath = path.join(extractedDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`     ⚠️  No package.json found in extracted directory`);
    return;
  }

  try {
    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    );

    // Get entry points
    const entryPoints = getEntryPoints(packageJson, extractedDir);

    if (entryPoints.length === 0) {
      console.log(`     ⚠️  No entry points found`);
      return;
    }

    console.log(`\n     🎯 Entry points found: ${entryPoints.length}`);

    // Collect all files in call trees
    const allFiles = new Set<string>();

    // Build call tree for each entry point
    for (const entryPoint of entryPoints) {
      const relativePath = path.relative(extractedDir, entryPoint);
      console.log(`\n     🌳 Call tree from: ${relativePath}`);
      const files = buildCallTree(entryPoint, extractedDir, new Set(), 2);

      // Add all files from this call tree to the set
      files.forEach((file) => allFiles.add(file));
    }

    // Run security scans on all files
    console.log(
      `\n     🔍 Running security scans on ${allFiles.size} files...`,
    );
    const scanResults = await scanEngine.scanCallTree(
      allFiles,
      extractedDir,
      packageJson.name || "unknown",
      version,
    );

    // Save scan results
    scanEngine.saveScanResults(scanResults, versionDir);
  } catch (err) {
    console.error(`     ❌ Error processing package:`, err);
  }
}

/**
 * Scan a package in quarantine
 */
async function scanPackage(packageName: string): Promise<void> {
  const packageDir = path.join(QUARANTINE_DIR, packageName);

  // Check if package directory exists
  if (!fs.existsSync(packageDir)) {
    console.log(`⚠️  Package directory not found: ${packageDir}`);
    return;
  }

  // Read server-side package.json (with versions key)
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`⚠️  package.json not found in: ${packageDir}`);
    return;
  }

  try {
    const packageJson: PackageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, "utf8"),
    );
    console.log(`\n📦 Scanning package: ${packageName}`);

    if (
      !packageJson.versions ||
      Object.keys(packageJson.versions).length === 0
    ) {
      console.log(`   ⚠️  No versions found in package.json`);
      return;
    }

    const versions = Object.keys(packageJson.versions);
    console.log(
      `   Found ${versions.length} version(s): ${versions.join(", ")}`,
    );

    // Process each version
    for (const version of versions) {
      const versionDir = path.join(packageDir, version);
      if (fs.existsSync(versionDir)) {
        await scanVersion(version, versionDir);
      } else {
        console.log(`\n  ⚠️  Version directory not found: ${versionDir}`);
      }
    }
  } catch (err) {
    console.error(`❌ Error scanning package ${packageName}:`, err);
  }
}

// Main execution
async function main() {
  console.log("🔍 Starting quarantine scan...\n");

  const items = workflow.getAllWorkflowItems();
  console.log(`Found ${items.length} workflow item(s)\n`);

  for (const item of items) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Processing: ${item.packageName} (Status: ${item.status})`);
    await scanPackage(item.packageName);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Scan complete");
}

/**
 * Recursively find all files in a directory
 */
// function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
//   const files = fs.readdirSync(dirPath);

//   files.forEach((file) => {
//     const filePath = path.join(dirPath, file);
//     if (fs.statSync(filePath).isDirectory()) {
//       arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
//     } else {
//       arrayOfFiles.push(filePath);
//     }
//   });

//   return arrayOfFiles;
// }

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
