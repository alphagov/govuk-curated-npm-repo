import {
  CallbackAction,
  Config,
  IUploadTarball,
  IReadTarball,
  Logger,
  Package,
  PackageTransformer,
  ReadPackageCallback,
  StorageUpdateCallback,
  StorageWriteCallback,
} from "@verdaccio/types";

import { ILocalPackageManager } from "@verdaccio/types";

import { UploadTarball, ReadTarball } from "@verdaccio/streams";

// Custom storage that wraps the base storage and adds quarantine logic
export class QuarantineStorage implements ILocalPackageManager {
  public logger: Logger;
  private config: any;
  private name: string;
  private baseStorage: any; // Verdaccio's internal storage

  constructor(baseStorage: any, config: any, logger: Logger, name: string) {
    this.baseStorage = baseStorage;
    this.config = config;
    this.logger = logger;
    this.name = name;
    console.log(this.config);
  }

  public createPackage(name: string, value: Package, cb: CallbackAction): void {
    console.log(name);
    console.log(value);
    cb(null);
  }
  public deletePackage(fileName: string, cb: CallbackAction): void {
    console.log(fileName);
    cb(null);
  }

  public async init(config: Config): Promise<void> {
    return await this.baseStorage.init(config);
  }

  public readPackage(name: string, cb: ReadPackageCallback): void {
    console.log(name);
    cb(null);
  }

  public readTarball(name: string): IReadTarball {
    const readTarballStream: IReadTarball = new ReadTarball({});
    console.log(name);
    return readTarballStream;
  }

  public removePackage(cb: CallbackAction): void {
    try {
      this.debug({}, "Removing package @{name}");
      cb(null);
      this.debug({}, "Removed package @{name}");
    } catch (error) {
      cb(error);
      this.debug({ error }, "Failed to remove package @{name}, @{error}");
    }
  }

  public savePackage(
    fileName: string,
    json: Package,
    cb: CallbackAction,
  ): void {
    console.log(fileName);
    console.log(JSON.stringify(json, null, 2));
    cb(null);
  }

  public updatePackage(
    pkgFileName: string,
    updateHandler: StorageUpdateCallback,
    onWrite: StorageWriteCallback,
    transformPackage: PackageTransformer,
    onEnd: CallbackAction,
  ): void {
    const pkg: Package = {
      name: pkgFileName,
      versions: {},
      "dist-tags": {},
      _distfiles: {},
      _attachments: {},
      _uplinks: {},
      _rev: "",
    };
    console.log(pkgFileName);
    updateHandler(pkg, () => null);
    onWrite(pkgFileName, pkg, () => null);
    transformPackage(pkg);
    onEnd(null);
  }

  public writeTarball(name: string): IUploadTarball {
    console.log(name);
    const uploadStream: IUploadTarball = new UploadTarball({});
    return uploadStream;
  }

  private debug(conf: object, template: string): void {
    this.logger.debug({ name: this.name, ...conf }, `[Minio] ${template}`);
  }
}
