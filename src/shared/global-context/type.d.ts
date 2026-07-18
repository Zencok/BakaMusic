export interface IGlobalContext {
  /** 版本号 */
  appVersion: string;
  appPath: {
    userData: string;
    temp: string;
    downloads: string;
    res: string;
  };
  platform: NodeJS.Platform;
}
