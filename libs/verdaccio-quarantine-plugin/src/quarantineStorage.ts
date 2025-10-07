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
  ForbiddenError,
  InternalError,
  NotFoundError,
  PackageReadError,
} from "./errors";
import Workflow from "./workflow";

import Approvals from "./approvals";

export class QuarantineStorage implements IPackageStorageManager {
  public logger: Logger;
  private config: PluginConfig;
  private packageName: string;
  private storagePath: string;
  // @ts-ignore:next-line
  private quarantinePath: string;
  private approvalsListPath: string;
  private workflowDBPath: string;
  private approvals: Approvals;
  private workflow: Workflow;
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
    this.workflowDBPath = this.config["workflowDBPath"] || "./workflow.json";
    this.uplinks = this.config["uplinks"] || {
      npmjs: { url: "https://registry.npmjs.org", timeout: 3000 },
    };
    this.approvals = new Approvals(this.approvalsListPath, logger);
    this.workflow = new Workflow(this.workflowDBPath, logger);
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
  private fetchFromUpstream(fileName: string): void {
    const uplinkName: string = Object.keys(this.uplinks)[0] || "npmjs";
    const uplink = this.uplinks[uplinkName];

    if (!uplink) {
      this.logger.error("No uplinks configured");
      throw new NotFoundError("No uplinks configured");
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

        throw new NotFoundError(
          `Upstream returned ${response.statusCode} for package "${this.packageName}"`,
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
          this.savePackage(fileName, pkg);
        } catch (parseErr) {
          this.logger.info(
            { err: parseErr },
            "Failed to parse upstream response",
          );
          throw new NotFoundError("Failed to parse package data from upstream");
        }
      });
    });

    req.on("error", (fetchErr: any) => {
      this.logger.info(
        { err: fetchErr },
        `Failed to fetch from upstream: ${JSON.stringify(fetchErr, null, 2)}`,
      );
      throw new NotFoundError(`Failed to fetch package: ${fetchErr.message}`);
    });

    req.on("timeout", () => {
      req.destroy();
      this.logger.info("Request to upstream timed out");
      throw new NotFoundError("Upstream request timed out");
    });

    req.end();
  }

  private getPackageFilePath(quarantine: boolean = false): string {
    return path.join(
      quarantine ? this.quarantinePath : this.storagePath,
      "package.json",
    );
  }

  public async init(config: PluginConfig): Promise<void> {
    this.logger.debug(
      { packageName: this.packageName },
      `init method called on QuarantineStorage with config: ${config}`,
    );
    return;
  }

  private isQuarantined(): boolean {
    const quarantinePackagePath = this.getPackageFilePath(false);
    try {
      fs.accessSync(quarantinePackagePath);
      return true;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        this.logger.info(
          { packageName: this.packageName },
          `${quarantinePackagePath} - Package not found in quarantine`,
        );
      }
      return false;
    }
  }

  private isStored(): boolean {
    const storagePackagePath = path.join(this.storagePath, "package.json");
    try {
      fs.accessSync(storagePackagePath);
      return true;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        this.logger.info(
          { packageName: this.packageName },
          `${storagePackagePath} - Package not found in storage`,
        );
      }
      return false;
    }
  }

  private getPackageFile(fromQuarantine: boolean = false): Package {
    const pkgPath = `${this.getPackageFilePath(fromQuarantine)}`;
    try {
      const data = fs.readFileSync(pkgPath, "utf8");
      const pkg: Package = JSON.parse(data);
      return pkg;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        this.logger.info(
          { packageName: this.packageName },
          `${pkgPath} - Package not found in ${fromQuarantine ? "Quarantine" : "Storage"}`,
        );
        throw new NotFoundError(
          `${pkgPath} - Package not found in ${fromQuarantine ? "Quarantine" : "Storage"}`,
        );
      }
      this.logger.info(
        { packageName: this.packageName },
        `${pkgPath} - Error reading package in ${fromQuarantine ? "Quarantine" : "Storage"}`,
      );
      throw new PackageReadError(
        `${pkgPath} - Error reading package in ${fromQuarantine ? "Quarantine" : "Storage"}`,
      );
    }
  }

  /**
   * Read package metadata - this is where we intercept and check approvals
   */
  public readPackage(fileName: string, callback: ReadPackageCallback): void {
    this.logger.info(
      { fileName: fileName, packageName: this.packageName },
      "Reading package",
    );

    if (this.isStored()) {
      // Check if package is approved
      if (this.approvals.isApproved(this.packageName)) {
        try {
          let pkg: Package = this.getPackageFile();
          callback(null, pkg);
        } catch (err) {
          callback(err);
        }
      }
      const forbiddenError: ForbiddenError = new ForbiddenError(
        `Package '${this.packageName}' is not approved for use. Please contact your administrator.`,
      );
      return callback(forbiddenError);
    }

    if (!this.isQuarantined()) {
      // Fetch from OUR uplinks, not Verdaccio's
      try {
        this.fetchFromUpstream(fileName);
        // Add new workflow item for the scanner to pick up
        this.workflow.addWorkflowItem(fileName);
        // Tell npm cli that the package cannot be found
        callback(
          new NotFoundError(
            `Package '${this.packageName}' is neither quarantined nor approved. Your adminisrator has been notified`,
          ),
        );
      } catch (err) {
        callback(err);
      }
    }
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
  public savePackage(fileName: string, json: Package): void {
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
        throw new InternalError(
          `Failed to create directory in QuarantineStorage.savePackage. Error: ${mkdirErr}`,
        );
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
          throw new InternalError(
            `Failed to save package in QuarantineStorage.savePackage. Error: ${err}`,
          );
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
                throw new InternalError(
                  `Failed to create version directory. Error: ${mkdirErr}`,
                );
              }
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
                    throw new InternalError(
                      `Failed to download tarball for version ${version}`,
                    );
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
                  }
                },
              );
            } else {
              this.logger.warn(
                { version, packageName: this.packageName },
                `No tarball URL found for version ${version}`,
              );
              completed++;
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
