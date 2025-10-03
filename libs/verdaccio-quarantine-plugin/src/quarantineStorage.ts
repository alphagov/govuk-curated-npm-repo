import {
  CallbackAction,
  IPackageStorageManager,
  IUploadTarball,
  IReadTarball,
  Logger,
  Package,
  PackageTransformer,
  ReadPackageCallback,
  StorageUpdateCallback,
  StorageWriteCallback,
} from "@verdaccio/types";

import * as fs from "node:fs";
import * as path from "path";
import { UploadTarball, ReadTarball } from "@verdaccio/streams";
import { PluginConfig } from "./config";
import {
  //VerdaccioError,
  NotFoundError,
  ForbiddenError,
  //InternalError,
} from "./errors";

export class QuarantineStorage implements IPackageStorageManager {
  public logger: Logger;
  private config: PluginConfig;
  private packageName: string;
  private storagePath: string;
  // @ts-ignore:next-line
  private quarantinePath: string;
  private approvalsListPath: string;
  // @ts-ignore:next-line
  private uplinks: {
    [key: string]: {
      url: string;
      timeout?: string | void; // Match Verdaccio's type
    };
  };

  constructor(config: PluginConfig, logger: Logger, packageName: string) {
    this.config = config;
    this.logger = logger;
    this.packageName = packageName;
    const baseStoragePath = this.config["storagePath"] || "./storage";
    this.storagePath = path.join(baseStoragePath, packageName);
    const baseQuarantinePath = this.config["quarantinePath"] || "./quarantine";
    this.quarantinePath = path.join(baseQuarantinePath, packageName);
    this.approvalsListPath = this.config["approvalsListPath"];
    this.uplinks = this.config["uplinks"] || {
      npmjs: { url: "https://registry.npmjs.org", timeout: 3000 },
    };
  }

  public approvePackage(pkg: Package, version?: string): void {
    const approvalsDB = this.loadApprovals();
    this.saveApprovals(approvalsDB);
    console.log(pkg);
    console.log(version);
    const quarantinePackagePath = path.join(this.quarantinePath, pkg.name);
    const storagePackagePath = path.join(this.storagePath, pkg.name);
    console.log(quarantinePackagePath);
    console.log(storagePackagePath);
  }

  private saveApprovals(approvals: any) {
    const approvalsFilePath: string = this.getApprovalsFilePath();
    fs.writeFileSync(
      approvalsFilePath,
      JSON.stringify(approvals, null, 2),
      "utf8",
    );
  }

  private getApprovalsFilePath(): string {
    const approvalFile = this.approvalsListPath || "./approvals.json";
    return path.isAbsolute(approvalFile)
      ? approvalFile
      : path.join(process.cwd(), approvalFile);
  }

  /**
   * Load approvals from JSON file
   */
  private loadApprovals(): any {
    try {
      const absolutePath = this.getApprovalsFilePath();

      this.logger.debug(
        { approvalFile: absolutePath },
        "Loading approvals from file",
      );

      // Check if file exists
      if (!fs.existsSync(absolutePath)) {
        this.logger.info(
          { approvalFile: absolutePath },
          "Approvals file does not exist - creating with empty list",
        );

        const defaultApprovals = { packages: [] };

        // Create directory if it doesn't exist
        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Write default approvals file
        fs.writeFileSync(
          absolutePath,
          JSON.stringify(defaultApprovals, null, 2),
          "utf8",
        );

        return defaultApprovals;
      }

      const data = fs.readFileSync(absolutePath, "utf8");
      return JSON.parse(data);
    } catch (err) {
      this.logger.error({ err }, "Failed to load approvals file");
      return { packages: [] };
    }
  }

  /**
   * Check if a package version is approved
   */
  private isApproved(pkg: Package): boolean {
    const approvals = this.loadApprovals();
    const approvedPackages = approvals.packages || [];

    // Check if package is in approval list
    const approval = approvedPackages.find(
      (approved: any) => approved.name === this.packageName,
    );

    if (!approval) {
      this.logger.warn(
        { packageName: this.packageName },
        "Package not in approval list",
      );
      return false;
    }

    // If approval has specific versions, check them
    if (approval.versions && Array.isArray(approval.versions)) {
      // Get all versions from the package manifest
      const versions = Object.keys(pkg.versions || {});

      // Check if any version in the package is approved
      const hasApprovedVersion = versions.some((v) =>
        approval.versions.includes(v),
      );

      if (!hasApprovedVersion) {
        this.logger.warn(
          { packageName: this.packageName, versions },
          "No approved versions found in package",
        );
        return false;
      } else {
        this.logger.info(
          {
            packageName: this.packageName,
          },
          "Package version approved",
        );
        return true;
      }
    }

    // If no specific verions defined, all versions are approved
    this.logger.info(
      {
        packageName: this.packageName,
      },
      "Package approved",
    );
    return true;
  }

  /**
   * Create package - write initial package.json
   */
  public createPackage(
    pkgName: string,
    value: Package,
    cb: CallbackAction,
  ): void {
    this.logger.debug(
      { pkgName, packageName: this.packageName },
      "Creating package",
    );

    const packagePath = path.join(this.storagePath, pkgName);

    fs.mkdir(this.storagePath, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        return cb(mkdirErr);
      }

      fs.writeFile(packagePath, JSON.stringify(value, null, 2), (writeErr) => {
        if (writeErr) {
          return cb(writeErr);
        }
        cb(null);
      });
    });
  }

  /**
   * Delete package - remove a tarball file
   */
  public deletePackage(fileName: string, callback: CallbackAction): void {
    this.logger.debug(
      { fileName, packageName: this.packageName },
      "Deleting package file",
    );

    const filePath = path.join(this.storagePath, fileName);

    fs.unlink(filePath, (err: any) => {
      if (err && err.code !== "ENOENT") {
        return callback(err);
      }
      callback(null);
    });
  }

  /*
   * Download a tarball from a URL and save it to a directory
   */
  private downloadTarball(
    tarballUrl: string,
    destPath: string,
    version: string,
    callback: CallbackAction,
  ): void {
    this.logger.info(
      { tarballUrl, version, packageName: this.packageName },
      `Downloading tarball for version ${version}`,
    );

    const http = require("http");
    const urlObj = new URL(tarballUrl);

    // Extract filename from URL or use default
    const filename =
      path.basename(urlObj.pathname) || `${this.packageName}-${version}.tgz`;
    const filePath = path.join(destPath, filename);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": "Verdaccio-Quarantine-Plugin",
      },
      timeout: 60000, // 60 second timeout for large tarballs
      rejectUnauthorized: true,
    };

    const file = fs.createWriteStream(filePath);

    const req = http.request(options, (response: any) => {
      if (response.statusCode !== 200) {
        this.logger.error(
          { statusCode: response.statusCode, tarballUrl, version },
          `Failed to download tarball - upstream returned ${response.statusCode}`,
        );
        file.close();
        fs.unlink(filePath, () => {}); // Clean up partial file
        return callback(new Error(`Upstream returned ${response.statusCode}`));
      }

      response.pipe(file);

      file.on("finish", () => {
        file.close();
        this.logger.info(
          { version, packageName: this.packageName, filePath },
          `Tarball downloaded successfully for version ${version}`,
        );
        callback(null);
      });

      file.on("error", (err: any) => {
        file.close();
        fs.unlink(filePath, () => {}); // Clean up partial file
        this.logger.error(
          { err, version, packageName: this.packageName },
          `Error writing tarball file`,
        );
        callback(err);
      });
    });

    req.on("error", (err: any) => {
      file.close();
      fs.unlink(filePath, () => {}); // Clean up partial file
      this.logger.error(
        { err, tarballUrl, version },
        `Error downloading tarball`,
      );
      callback(err);
    });

    req.on("timeout", () => {
      req.destroy();
      file.close();
      fs.unlink(filePath, () => {}); // Clean up partial file
      this.logger.error({ tarballUrl, version }, `Tarball download timed out`);
      callback(new Error("Download timeout"));
    });

    req.end();
  }

  /**
   * Fetch package from upstream, save to quarantine, and return 404
   */
  private fetchFromUpstream(
    fileName: string,
    callback: ReadPackageCallback,
  ): void {
    const uplinkName: string = Object.keys(this.uplinks)[0] || "npmjs";
    const uplink = this.uplinks[uplinkName];

    if (!uplink) {
      this.logger.error("No uplinks configured");
      return callback(new NotFoundError("No uplinks configured"));
    }

    const packageUrl = `${uplink.url}/${this.packageName}`;

    this.logger.info(
      { packageName: this.packageName, url: packageUrl },
      `Fetching package from upstream ${packageUrl}`,
    );

    // Use http module
    const http = require("http");
    const urlObj = new URL(packageUrl);

    // Parse timeout from string to number
    const timeout = uplink?.timeout
      ? typeof uplink.timeout === "string"
        ? parseInt(uplink.timeout, 10)
        : uplink.timeout
      : 30000;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": "Verdaccio-Quarantine-Plugin",
        Accept: "application/json",
      },
      timeout: timeout,
    };

    const req = http.request(options, (response: any) => {
      if (response.statusCode !== 200) {
        this.logger.info(
          { statusCode: response.statusCode, packageName: this.packageName },
          "Upstream returned non-200 status",
        );

        return callback(
          new NotFoundError(
            `Upstream returned ${response.statusCode} for package '${this.packageName}'`,
          ),
        );
      }

      let data = "";
      response.on("data", (chunk: any) => {
        data += chunk;
      });

      response.on("end", () => {
        try {
          const pkg: Package = JSON.parse(data);

          this.logger.info(
            { packageName: this.packageName },
            "Package fetched from upstream - saving to quarantine",
          );

          // Save to quarantine
          this.savePackage(fileName, pkg, (saveErr) => {
            if (saveErr) {
              this.logger.info(
                { err: saveErr },
                "Failed to save package to quarantine",
              );
              return callback(saveErr);
            }

            this.logger.info(
              { packageName: this.packageName },
              "Package saved to quarantine - blocking access until approved",
            );

            // Return NotFoundError to block the install
            callback(
              new NotFoundError(
                `Package '${this.packageName}' is in quarantine pending approval`,
              ),
            );
          });
        } catch (parseErr) {
          this.logger.info(
            { err: parseErr },
            "Failed to parse upstream response",
          );
          callback(
            new NotFoundError("Failed to parse package data from upstream"),
          );
        }
      });
    });

    req.on("error", (fetchErr: any) => {
      this.logger.info(
        { err: fetchErr },
        `Failed to fetch from upstream: ${JSON.stringify(fetchErr, null, 2)}`,
      );
      callback(
        new NotFoundError(`Failed to fetch package: ${fetchErr.message}`),
      );
    });

    req.on("timeout", () => {
      req.destroy();
      this.logger.info("Request to upstream timed out");
      callback(new NotFoundError("Upstream request timed out"));
    });

    req.end();
  }

  public async init(config: PluginConfig): Promise<void> {
    this.logger.debug(
      { packageName: this.packageName },
      `init method called on QuarantineStorage with config: ${config}`,
    );
    return;
  }

  /**
   * Read package metadata - this is where we intercept and check approvals
   */
  public readPackage(fileName: string, callback: ReadPackageCallback): void {
    this.logger.info(
      { fileName, packageName: this.packageName },
      "Reading package",
    );

    const packagePath = path.join(this.storagePath, fileName);

    fs.readFile(packagePath, "utf8", (err, data) => {
      if (err) {
        if (err.code === "ENOENT") {
          this.logger.info(
            { fileName, packageName: this.packageName },
            "Package not found in quarantine - fetching from upstream",
          );

          // Fetch from OUR uplinks, not Verdaccio's
          this.fetchFromUpstream(fileName, callback);
          return;
        }
        this.logger.error(
          { err },
          `Error reading package file for ${this.packageName}`,
        );
        return callback(err);
      }

      let pkg: Package;
      try {
        pkg = JSON.parse(data);
        this.logger.info(
          { fileName, packageName: this.packageName },
          "Package found and read successfully in QuarantineStorage.readPackage",
        );
      } catch (parseErr) {
        this.logger.info(
          { fileName, packageName: this.packageName },
          `Package found and not read successfully in QuarantineStorage.readPackage. The error was ${parseErr}`,
        );
        return callback(parseErr);
      }

      // Check if package is approved
      if (!this.isApproved(pkg)) {
        const forbiddenError: ForbiddenError = new ForbiddenError(
          `Package '${this.packageName}' is not approved for use. Please contact your administrator.`,
        );
        this.logger.info(
          { fileName, packageName: this.packageName },
          "Package found in QuarantineStorage.readPackage but is not in the approval list",
        );
        return callback(forbiddenError);
      }

      // Package is approved, return it
      callback(null, pkg);
    });
  }

  /**
   * Read tarball - stream the .tgz file
   */
  public readTarball(pkgName: string): IReadTarball {
    this.logger.debug(
      { pkgName, packageName: this.packageName },
      "Reading tarball",
    );

    const tarballPath = path.join(this.storagePath, pkgName);
    const stream = new ReadTarball({});

    const readStream = fs.createReadStream(tarballPath);

    readStream.on("error", (err: any) => {
      if (err.code === "ENOENT") {
        err.status = 404;
      }
      stream.emit("error", err);
    });

    readStream.on("open", () => {
      stream.emit("open");
    });

    readStream.pipe(stream);

    return stream;
  }

  /**
   * Remove package - remove entire package directory
   */
  public removePackage(callback: CallbackAction): void {
    this.logger.debug(
      { packageName: this.packageName },
      "Removing entire package",
    );

    fs.rm(this.storagePath, { recursive: true, force: true }, (err) => {
      if (err) {
        return callback(err);
      }
      callback(null);
    });
  }

  /**
   * Save package - write package.json and download all version tarballs
   */
  public savePackage(
    fileName: string,
    json: Package,
    callback: CallbackAction,
  ): void {
    this.logger.info(
      { fileName, packageName: this.packageName },
      `Saving package in QuarantineStorage.savePackage fileName: ${fileName}`,
    );

    const packagePath = path.join(this.quarantinePath, "package.json");

    // Create directory asynchronously with recursive option
    fs.mkdir(this.quarantinePath, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        this.logger.error(
          { fileName, packageName: this.packageName },
          `Failed to create directory in QuarantineStorage.savePackage. Error: ${mkdirErr}`,
        );
        return callback(mkdirErr);
      }

      this.logger.info(
        { fileName, packageName: this.packageName },
        `Directory ${this.quarantinePath} ready`,
      );

      // Write the package.json file first
      fs.writeFile(packagePath, JSON.stringify(json, null, 2), (err) => {
        if (err) {
          this.logger.error(
            { fileName, packageName: this.packageName },
            `Failed to save package in QuarantineStorage.savePackage. Error: ${err}`,
          );
          return callback(err);
        }

        this.logger.info(
          { fileName, packageName: this.packageName },
          `Package metadata saved successfully`,
        );

        // Now create version folders and download tarballs
        const versions = Object.keys(json.versions);

        if (versions.length === 0) {
          this.logger.info(
            { packageName: this.packageName },
            "No versions to download",
          );
          return callback(null);
        }

        let completed = 0;
        let hasError = false;

        versions.forEach((version) => {
          const versionPath = path.join(this.quarantinePath, version);
          const versionData = json.versions[version];

          // Check if versionData exists
          if (!versionData) {
            this.logger.warn(
              { version, packageName: this.packageName },
              `No version data found for version ${version}`,
            );
            completed++;
            if (completed === versions.length && !hasError) {
              callback(null);
            }
            return;
          }

          // Create version directory
          fs.mkdir(versionPath, { recursive: true }, (mkdirErr) => {
            if (mkdirErr) {
              if (!hasError) {
                hasError = true;
                this.logger.error(
                  { fileName, packageName: this.packageName, version },
                  `Failed to create version directory. Error: ${mkdirErr}`,
                );
                return callback(mkdirErr);
              }
              return;
            }

            // Download tarball for this version
            if (versionData.dist && versionData.dist.tarball) {
              this.downloadTarball(
                versionData.dist.tarball,
                versionPath,
                version,
                (downloadErr) => {
                  if (downloadErr && !hasError) {
                    hasError = true;
                    this.logger.error(
                      { version, error: downloadErr },
                      `Failed to download tarball for version ${version}`,
                    );
                    return callback(downloadErr);
                  }

                  completed++;

                  if (completed === versions.length) {
                    this.logger.info(
                      {
                        packageName: this.packageName,
                        versionsCount: versions.length,
                      },
                      `All tarballs downloaded successfully`,
                    );
                    callback(null);
                  }
                },
              );
            } else {
              this.logger.warn(
                { version, packageName: this.packageName },
                `No tarball URL found for version ${version}`,
              );
              completed++;

              if (completed === versions.length && !hasError) {
                callback(null);
              }
            }
          });
        });
      });
    });
  }

  public updatePackage(
    pkgFileName: string,
    updateHandler: StorageUpdateCallback,
    onWrite: StorageWriteCallback,
    transformPackage: PackageTransformer,
    onEnd: CallbackAction,
  ): void {
    this.logger.debug(
      { pkgFileName, packageName: this.packageName },
      "Updating package",
    );

    this.readPackage(pkgFileName, (readErr, json?: Package) => {
      if (readErr) {
        return onEnd(readErr);
      }

      if (!json) {
        return onEnd("Package manifest is empty");
      }

      updateHandler(json, (updateErr: any) => {
        if (updateErr) {
          return onEnd(updateErr);
        }

        const transformed = transformPackage(json);

        onWrite(pkgFileName, transformed, (writeErr: any) => {
          if (writeErr) {
            return onEnd(writeErr);
          }
          onEnd(null);
        });
      });
    });
  }

  /**
   * Write tarball - stream to write a .tgz file
   */
  public writeTarball(pkgName: string): IUploadTarball {
    this.logger.debug(
      { pkgName, packageName: this.packageName },
      "Writing tarball",
    );

    const tarballPath = path.join(this.storagePath, pkgName);
    const stream = new UploadTarball({});

    // Ensure directory exists
    fs.mkdir(this.storagePath, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        stream.emit("error", mkdirErr);
        return;
      }

      const writeStream = fs.createWriteStream(tarballPath);

      writeStream.on("error", (err) => {
        stream.emit("error", err);
      });

      writeStream.on("finish", () => {
        stream.emit("success");
      });

      stream.pipe(writeStream);
      stream.emit("open");
    });

    return stream;
  }
}
