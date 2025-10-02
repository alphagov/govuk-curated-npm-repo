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

  constructor(config: PluginConfig, logger: Logger, packageName: string) {
    this.config = config;
    this.logger = logger;
    this.packageName = packageName;
    const baseStoragePath = this.config["storage"] || "./storage";
    this.storagePath = path.join(baseStoragePath, packageName);
  }

  /**
   * Load approvals from JSON file
   */
  private loadApprovals(): any {
    try {
      const approvalFile =
        this.config["approvalListPath"] || "./approvals.json";
      const absolutePath = path.isAbsolute(approvalFile)
        ? approvalFile
        : path.join(process.cwd(), approvalFile);

      this.logger.debug(
        { approvalFile: absolutePath },
        "Loading approvals from file",
      );

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
            "Package not found in QuarantineStorage.readPackage",
          );
          return callback(
            new NotFoundError(`Package '${this.packageName} not found`),
          );
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
   * Save package - write package.json
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

    const packagePath = path.join(this.storagePath, fileName);

    // Create directory asynchronously with recursive option
    fs.mkdir(this.storagePath, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        this.logger.error(
          { fileName, packageName: this.packageName },
          `Failed to create directory in QuarantineStorage.savePackage. Error: ${mkdirErr}`,
        );
        return callback(mkdirErr);
      }

      this.logger.info(
        { fileName, packageName: this.packageName },
        `Directory ${this.storagePath} ready`,
      );

      // Write the file
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
          `Package saved successfully`,
        );
        callback(null);
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
