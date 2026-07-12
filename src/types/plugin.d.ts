declare namespace IPlugin {
  export interface IMediaSourceResult {
    headers?: Record<string, string>;
    /** 兜底播放 */
    url?: string;
    /** UA */
    userAgent?: string;
    /** 音质 */
    quality?: IMusic.IQualityKey;
    /** QMC2 encryption key for mflac/mgg/mmp4 */
    ekey?: string;
    /** CENC content key (32-hex) - triggers local streaming decryption via luna-proxy */
    cek?: string;
  }

  export interface ISearchResult<T extends IMedia.SupportMediaType> {
    isEnd?: boolean;
    data: IMedia.SupportMediaItem[T][];
  }

  export type ISearchResultType = IMedia.SupportMediaType;

  type ISearchFunc = <T extends IMedia.SupportMediaType>(
    query: string,
    page: number,
    type: T
  ) => Promise<ISearchResult<T>>;

  type IGetArtistWorksFunc = <T extends IArtist.ArtistMediaType>(
    artistItem: IArtist.IArtistItem,
    page: number,
    type: T
  ) => Promise<ISearchResult<T>>;

  interface IUserVariable {
    /** 变量键名 */
    key: string;
    /** 变量名 */
    name?: string;
    /** 提示文案 */
    hint?: string;
  }

  interface IAlbumInfoResult {
    isEnd?: boolean;
    albumItem?: IAlbum.IAlbumItem;
    musicList?: IMusic.IMusicItem[];
  }

  interface ISheetInfoResult {
    isEnd?: boolean;
    sheetItem?: IMusic.IMusicSheetItem;
    musicList?: IMusic.IMusicItem[];
  }

  interface ITopListInfoResult {
    isEnd?: boolean;
    topListItem?: IMusic.IMusicSheetItem;
    musicList?: IMusic.IMusicItem[];
  }

  interface IGetRecommendSheetTagsResult {
    // 固定的tag
    pinned?: IMusic.IMusicSheetItem[];
    data?: IMusic.IMusicSheetGroupItem[];
  }

  interface IGetCommentResult {
    isEnd?: boolean;
    data?: IComment.IComment[];
  }

  interface IPluginDefine {
    /** 来源名 */
    platform: string;
    /** 匹配的版本号 */
    appVersion?: string;
    /** 插件版本 */
    version?: string;
    /** 远程更新的url */
    srcUrl?: string;
    /** 主键，会被存储到mediameta中 */
    primaryKey?: string[];
    /** 默认搜索类型 */
    defaultSearchType?: IMedia.SupportMediaType;
    /** 有效搜索类型 */
    supportedSearchType?: ICommon.SupportMediaType[];
    /** 插件缓存控制 */
    cacheControl?: "cache" | "no-cache" | "no-store";
    /** 插件作者 */
    author?: string;
    /** 用户自定义输入 */
    userVariables?: IUserVariable[];
    /** 提示文本 */
    hints?: Record<string, string[]>;
    /** 搜索 */
    search?: ISearchFunc;
    /** 获取根据音乐信息获取url */
    getMediaSource?: (
      musicItem: IMusic.IMusicItemPartial,
      quality: IMusic.IQualityKey
    ) => Promise<IMediaSourceResult | null>;
    /** 根据主键去查询歌曲信息 */
    getMusicInfo?: (
      musicBase: IMedia.IMediaBase
    ) => Promise<Partial<IMusic.IMusicItem> | null>;
    /** 获取歌词 */
    getLyric?: (
      musicItem: IMusic.IMusicItemPartial
    ) => Promise<ILyric.ILyricSource | null>;
    /** 获取专辑信息，里面的歌曲分页 */
    getAlbumInfo?: (
      albumItem: IAlbum.IAlbumItem,
      page: number
    ) => Promise<IAlbumInfoResult | null>;
    /** 获取歌单信息，有分页 */
    getMusicSheetInfo?: (
      sheetItem: IMusic.IMusicSheetItem,
      page: number
    ) => Promise<ISheetInfoResult | null>;
    /** 获取作品，有分页 */
    getArtistWorks?: IGetArtistWorksFunc;
    /** 导入歌单 */
    // todo: 数据结构应该是IMusicSheetItem
    importMusicSheet?: (urlLike: string) => Promise<IMusic.IMusicItem[] | null>;
    /** 导入单曲 */
    importMusicItem?: (urlLike: string) => Promise<IMusic.IMusicItem | null>;
    /** 获取榜单 */
    getTopLists?: () => Promise<IMusic.IMusicSheetGroupItem[]>;
    /** 获取榜单详情 */
    getTopListDetail?: (
      topListItem: IMusic.IMusicSheetItem,
      page: number
    ) => Promise<ITopListInfoResult>;
    /** 获取热门歌单tag */
    getRecommendSheetTags?: () => Promise<IGetRecommendSheetTagsResult>;
    /** 歌单列表 */
    getRecommendSheetsByTag?: (
      tag: ICommon.IUnique,
      page?: number
    ) => Promise<ICommon.PaginationResponse<IMusic.IMusicSheetItem>>;
    /** 歌曲评论 */
    getMusicComments?: (musicItem: IMusic.IMusicItem, page?: number) => Promise<IGetCommentResult>
  }

  export interface IPluginInstance extends IPluginDefine {
    /** 内部属性 */
    /** 插件路径 */
    _path: string;
  }

  type R = Required<IPluginInstance>;
  export type IPluginInstanceMethods = {
    [K in keyof R as R[K] extends (...args: any) => any ? K : never]: R[K];
  };

  /** 插件其他属性 */
  export type IPluginMeta = {
    order?: number;
    disabled?: boolean;
    userVariables?: Record<string, string>;
  };

  export type IPluginDelegate = {
    // 除去函数
    [K in keyof R as R[K] extends (...args: any) => any ? never : K]: R[K];
  } & {
    supportedMethod: string[];
    hash: string;
    path: string;
  };
}
