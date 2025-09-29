import {
  AbbreviatedManifest,
  IPluginStorage,
  IPackageStorage,
  Logger,
  Config,
  PluginOptions,
  Manifest,
  Token,
  TokenFilter,
  MergeTags,
  Version,
} from "@verdaccio/types";

import { Readable, PassThrough } from "node:stream";

import { searchUtils } from "@verdaccio/core";

import { ISyncUplinksOptions } from "@verdaccio/proxy";

import {
  UpdateManifestOptions,
  OwnerManifestBody,
  StarManifestBody,
  UnPublishManifest,
  IGetPackageOptionsNext,
} from "./type";

import { QuarantineStorage } from "./quarantineStorage";

// Extended options type to include the base storage
interface QuarantinePluginOptions extends PluginOptions<Config> {
  baseStorage: IPluginStorage<Config>;
}

export class QuarantineStoragePlugin implements IPluginStorage<Config> {
  public logger: Logger;
  public config: Config;
  private quarantineStorage: QuarantineStorage;

  constructor(config: Config, options: QuarantinePluginOptions) {
    this.config = config;
    this.logger = options.logger;

    this.quarantineStorage = new QuarantineStorage(
      options.baseStorage,
      config,
      options.logger,
    );
  }

  public async add(name: string): Promise<void> {
    return await this.quarantineStorage.addPackage(name);
  }

  public async applyFilters(manifest: Manifest): Promise<[Manifest, any]> {
    return await this.quarantineStorage.applyFilters(manifest);
  }

  public async changePackage(
    name: string,
    metadata: Manifest,
    revision: string,
  ): Promise<void> {
    return await this.quarantineStorage.changePackage(name, metadata, revision);
  }

  public async deleteToken(user: string, tokenKey: string): Promise<any> {
    return await this.quarantineStorage.deleteToken(user, tokenKey);
  }

  public async getCachedPackages(
    query?: searchUtils.SearchQuery,
  ): Promise<searchUtils.SearchPackageItem[]> {
    return await this.quarantineStorage.getCachedPackages(query);
  }

  public get(callback: Function): void {
    this.quarantineStorage
      .getLocalDatabase()
      .then((data) => callback(null, data))
      .catch((err) => callback(err));
  }

  public async getLocalTarball(
    pkgName: string,
    filename: string,
    { signal }: { signal: AbortSignal },
  ): Promise<Readable> {
    return await this.quarantineStorage.getLocalTarball(pkgName, filename, {
      signal,
    });
  }

  public async getPackage(
    options: IGetPackageOptionsNext,
  ): Promise<[Manifest, any]> {
    return await this.quarantineStorage.getPackage(options);
  }

  public async getPackageByOptions(
    options: IGetPackageOptionsNext,
  ): Promise<Manifest | AbbreviatedManifest | Version> {
    return await this.quarantineStorage.getPackageByOptions(options);
  }

  public async getPackageByVersion(
    options: IGetPackageOptionsNext,
  ): Promise<Version> {
    return await this.quarantineStorage.getPackageByVersion(options);
  }

  public async getPackageLocalMetadata(
    name: string,
    _revision?: string,
  ): Promise<Manifest> {
    return await this.quarantineStorage.getPackageLocalMetadata(
      name,
      _revision,
    );
  }

  public async getPackageManifest(
    options: IGetPackageOptionsNext,
  ): Promise<Manifest> {
    return await this.quarantineStorage.getPackageManifest(options);
  }

  public getPackageStorage(packageName: string): IPackageStorage {
    return this.quarantineStorage.getPackageStorage(packageName);
  }

  public async getSecret(): Promise<string> {
    return await this.quarantineStorage.getSecret();
  }

  public async getTarball(
    name: string,
    filename: string,
    signal: { signal: any },
  ): Promise<PassThrough> {
    return await this.quarantineStorage.getTarball(name, filename, { signal });
  }

  public async init(config: Config): Promise<void> {
    return await this.quarantineStorage.init(config);
  }

  public async mergeTagsNext(name: string, tags: MergeTags): Promise<Manifest> {
    return await this.quarantineStorage.mergeTagsNext(name, tags);
  }

  public async readTokens(filter: TokenFilter): Promise<Token[]> {
    return await this.quarantineStorage.readTokens(filter);
  }

  public remove(name: string, callback: Function): void {
    this.quarantineStorage
      .removePackage(name, "", "")
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  public removePackage(
    name: string,
    revision: string,
    username: string,
    callback: Function,
  ): void {
    this.quarantineStorage
      .removePackage(name, revision, username)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  // Other apis to wrap

  public async removeTarball(
    name: string,
    filename: string,
    _revision: string,
    username: string,
  ): Promise<Manifest> {
    return await this.quarantineStorage.removeTarball(
      name,
      filename,
      _revision,
      username,
    );
  }

  public async saveToken(token: Token): Promise<any> {
    return await this.quarantineStorage.saveToken(token);
  }

  public async setSecret(secret: string): Promise<void> {
    return await this.quarantineStorage.setSecret(secret);
  }

  public search(
    onPackage: Function,
    onEnd: Function,
    validateName: Function,
  ): void {
    this.quarantineStorage
      .getCachedPackages()
      .then((packages) => {
        packages.forEach((pkg) => {
          if (validateName(pkg.package.name)) {
            onPackage(pkg);
          }
        });
        onEnd();
      })
      .catch((err) => {
        onEnd(err);
      });
  }

  public async syncUplinksMetadata(
    name: string,
    localManifest: Manifest | null,
    options: Partial<ISyncUplinksOptions> = {},
  ): Promise<[Manifest | null, any]> {
    return await this.quarantineStorage.syncUplinksMetadata(
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
    return await this.quarantineStorage.updateManifest(manifest, options);
  }

  public async updateVersionsNext(
    name: string,
    remoteManifest: Manifest,
  ): Promise<Manifest> {
    return await this.quarantineStorage.updateVersionsNext(
      name,
      remoteManifest,
    );
  }

  public async uploadTarball(
    name: string,
    fileName: string,
    contentReadable: Readable,
    signal: { signal: any },
  ): Promise<void> {
    return await this.quarantineStorage.uploadTarball(
      name,
      fileName,
      contentReadable,
      signal.signal,
    );
  }
}

// Factory function for Verdaccio plugin system
export default function (
  config: Config,
  options: PluginOptions<Config>,
): IPluginStorage<Config> {
  // Import and instantiate the base storage
  // This assumes you're using the default local-storage
  // Adjust the import path based on your needs
  const LocalStorage = require("@verdaccio/local-storage").default;
  const baseStorage = new LocalStorage(config, options);

  return new QuarantineStoragePlugin(config, {
    ...options,
    baseStorage,
  });
}
