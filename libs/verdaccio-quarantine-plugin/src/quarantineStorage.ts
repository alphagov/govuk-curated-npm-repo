import { searchUtils } from "@verdaccio/core";
import {
  AbbreviatedManifest,
  IPackageStorage,
  Logger,
  Config,
  Manifest,
  MergeTags,
  Token,
  TokenFilter,
  Version,
} from "@verdaccio/types";
import { ISyncUplinksOptions, ProxySearchParams } from "@verdaccio/proxy";
import {
  IGetPackageOptionsNext,
  UpdateManifestOptions,
  OwnerManifestBody,
  StarManifestBody,
  UnPublishManifest,
} from "./type";

import { PassThrough, Readable } from "node:stream";

// Custom storage that wraps the base storage and adds quarantine logic
export class QuarantineStorage {
  private logger: Logger;
  private config: any;
  private baseStorage: any; // Verdaccio's internal storage

  constructor(baseStorage: any, config: any, logger: Logger) {
    this.baseStorage = baseStorage;
    this.config = config;
    this.logger = logger;
    console.log(this.config);
  }

  public async addPackage(name: string): Promise<void> {
    return await this.baseStorage.addPackage(name);
  }

  public async applyFilters(manifest: Manifest): Promise<[Manifest, any]> {
    return await this.baseStorage.applyFilters(manifest);
  }

  public async changePackage(
    name: string,
    metadata: Manifest,
    revision: string,
  ): Promise<void> {
    return await this.baseStorage.changePackage(name, metadata, revision);
  }

  public async deleteToken(user: string, tokenKey: string): Promise<any> {
    return await this.baseStorage.deleteToken(user, tokenKey);
  }

  public async getCachedPackages(
    query?: searchUtils.SearchQuery,
  ): Promise<searchUtils.SearchPackageItem[]> {
    return await this.baseStorage.getCachedPackages(query);
  }

  public async getLocalDatabase(): Promise<Version[]> {
    return await this.baseStorage.getLocalDatabase();
  }

  public async getLocalTarball(
    pkgName: string,
    filename: string,
    { signal }: { signal: AbortSignal },
  ): Promise<Readable> {
    return await this.baseStorage.getLocalTarball(pkgName, filename, {
      signal,
    });
  }

  public async getPackage(
    options: IGetPackageOptionsNext,
  ): Promise<[Manifest, any]> {
    const packageName = options.name;

    this.logger.info(
      { plugin: "quarantine", package: packageName },
      `Checking quarantine status for package: ${packageName}`,
    );

    // Quarantine status checks go here

    // If Quarantine status checks pass then hand back to baseStorage
    return await this.baseStorage.getPackage(options);
  }

  public async getPackageByOptions(
    options: IGetPackageOptionsNext,
  ): Promise<Manifest | AbbreviatedManifest | Version> {
    return await this.baseStorage.getPackageByOptions(options);
  }

  public async getPackageByVersion(
    options: IGetPackageOptionsNext,
  ): Promise<Version> {
    const packageName = options.name;
    const version = options.version;

    this.logger.info(
      { plugin: "quarantine", package: packageName, version },
      `Version specific request for: ${packageName}@${version}`,
    );

    // Quarantine status checks go here

    // If Quarantine status checks pass then hand back to baseStorage
    return await this.baseStorage.getPackageByVersion(options);
  }

  public async getPackageLocalMetadata(
    name: string,
    _revision?: string,
  ): Promise<Manifest> {
    return await this.baseStorage.getPackageLocalMetadata(name, _revision);
  }

  public async getPackageManifest(
    options: IGetPackageOptionsNext,
  ): Promise<Manifest> {
    const packageName = options.name;

    this.logger.info(
      { plugin: "quarantine", package: packageName },
      `Manifest request for: ${packageName}`,
    );

    // Quarantine status checks go here

    // If Quarantine status checks pass then hand back to baseStorage
    return await this.baseStorage.getPackageManifest(options);
  }

  public getPackageStorage(packageName: string): IPackageStorage {
    // May need to wrap this if we need to intercept tarball downloads
    return this.baseStorage.getPackageStorage(packageName);
  }

  public async getSecret(): Promise<string> {
    return await this.baseStorage.getSecret();
  }

  public async getTarball(
    name: string,
    filename: string,
    signal: { signal: any },
  ): Promise<PassThrough> {
    return await this.baseStorage.getTarball(name, filename, signal.signal);
  }

  public async init(config: Config): Promise<void> {
    return await this.baseStorage.init(config);
  }

  public async mergeTagsNext(name: string, tags: MergeTags): Promise<Manifest> {
    return await this.baseStorage.mergeTagsNext(name, tags);
  }

  public async readTokens(filter: TokenFilter): Promise<Token[]> {
    return await this.readTokens(filter);
  }

  public async removeTarball(
    name: string,
    filename: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _revision: string,
    username: string,
  ): Promise<Manifest> {
    return await this.baseStorage.removeTarball(
      name,
      filename,
      _revision,
      username,
    );
  }

  public async removePackage(
    name: string,
    revision: string,
    username: string,
  ): Promise<void> {
    return await this.baseStorage.removePackage(name, revision, username);
  }

  public async saveToken(token: Token): Promise<any> {
    return await this.baseStorage.saveToken(token);
  }

  public async search(
    options: ProxySearchParams,
  ): Promise<searchUtils.SearchPackageItem[]> {
    return await this.baseStorage.search(options);
  }

  public async setSecret(secret: string): Promise<void> {
    return await this.baseStorage.setSecret(secret);
  }

  public async syncUplinksMetadata(
    name: string,
    localManifest: Manifest | null,
    options: Partial<ISyncUplinksOptions> = {},
  ): Promise<[Manifest | null, any]> {
    return await this.baseStorage.syncUplinksMetadata(
      name,
      localManifest,
      options,
    );
  }

  public async updateManifest(
    manifest:
      | Manifest
      | StarManifestBody
      | OwnerManifestBody
      | UnPublishManifest,
    options: UpdateManifestOptions,
  ): Promise<string | undefined> {
    return await this.baseStorage.updateManifest(manifest, options);
  }

  public async updateVersionsNext(
    name: string,
    remoteManifest: Manifest,
  ): Promise<Manifest> {
    return await this.baseStorage.updateVersionsNext(name, remoteManifest);
  }

  public async uploadTarball(
    name: string,
    fileName: string,
    contentReadable: Readable,
    signal: { signal: any },
  ): Promise<void> {
    return await this.baseStorage.uploadTarball(
      name,
      fileName,
      contentReadable,
      signal.signal,
    );
  }
}
