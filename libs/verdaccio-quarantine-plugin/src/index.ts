import {
  Callback,
  IPluginStorage,
  IPackageStorage,
  Logger,
  PluginOptions,
  Token,
  TokenFilter,
} from "@verdaccio/types";

import { PluginConfig } from "./config";
import { version } from "../package.json";
import { QuarantineStorage } from "./quarantineStorage";

export default class QuarantineStoragePlugin
  implements IPluginStorage<PluginConfig>
{
  public config: PluginConfig;
  public options: PluginOptions<PluginConfig>;
  public logger: Logger;
  private tokens: Token[] = [];
  public version = version;

  constructor(config: PluginConfig, options: PluginOptions<PluginConfig>) {
    this.config = config;
    this.logger = options.logger;
    this.options = options;

    try {
    } catch (error) {
      this.logger.error(
        { plugin: "quarantine" },
        JSON.stringify(error, null, 2),
      );
      throw error;
    }
  }

  public add(name: string, callback: Function): void {
    console.log(name);
    callback(null);
  }

  public deleteToken(user: string, key: string): Promise<void> {
    console.log(user);
    console.log(key);
    return (async () => undefined)();
  }

  public get(callback: Function): void {
    callback(null, []);
  }

  public getPackageStorage(name: string): IPackageStorage {
    const LocalStorage = require("@verdaccio/store").Storage;
    const baseStorage = new LocalStorage(this.config, this.options);
    return new QuarantineStorage(baseStorage, this.config, this.logger, name);
  }

  public getSecret(): Promise<string> {
    return (async () => "")();
  }

  public readTokens(filter: TokenFilter): Promise<Token[]> {
    console.log(filter);
    return (async () => [])();
  }

  public remove(name: string, callback: Function): void {
    console.log(name);
    callback(null);
  }

  public saveToken(token: Token): Promise<void> {
    return (async () => {
      this.tokens.push(token);
      return undefined;
    })();
  }

  public search(
    onPackage: Callback,
    onEnd: Callback,
    validate: (name: string) => boolean,
  ): void {
    onPackage(null);
    onEnd(null);
    validate("");
  }

  public setSecret(secret: string): Promise<void> {
    console.log(secret);
    return (async () => undefined)();
  }
}
