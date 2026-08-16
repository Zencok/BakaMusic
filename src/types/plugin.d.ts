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

  /**
   * MV/视频播放源。
   *
   * 音频播放继续使用 IMediaSourceResult；视频单独建模，避免把分辨率
   * （例如 1080p）误当成音频音质键。响应仍然只允许可结构化克隆的数据。
   */
  export type VideoDynamicRange = "sdr" | "hdr10" | "dolby-vision";

  export interface IVideoQualityOption {
    /** 插件下一次 getMvSource 调用使用的稳定键。 */
    key: string;
    /** 面向用户的分辨率/编码标签。 */
    label?: string;
    width?: number;
    height?: number;
    bitrate?: number;
    /** 预估或服务端返回的文件大小（字节或格式化文本）。 */
    size?: number | string;
    codec?: string;
    mimeType?: string;
    /** 色彩/动态范围；Dolby Vision Profile 5 需要专用渲染链。 */
    dynamicRange?: VideoDynamicRange;
  }

  export interface IVideoSourceResult {
    /** 视频地址；宿主会在交给播放器前再次校验。 */
    url?: string;
    headers?: Record<string, string>;
    userAgent?: string;
    /** 平台返回的分辨率/档位，例如 720p、1080p。 */
    videoQuality?: string;
    mimeType?: string;
    codec?: string;
    /** 色彩/动态范围；用于宿主选择兼容的播放后端。 */
    dynamicRange?: VideoDynamicRange;
    bitrate?: number;
    /** 当前源对应的文件大小（字节或格式化文本）。 */
    size?: number | string;
    duration?: number;
    width?: number;
    height?: number;
    /** 首次解析时由平台返回的真实可用档位；不应填入猜测的档位。 */
    availableVideoQualities?: IVideoQualityOption[];
    /** 当 CDN 主地址不可用时按顺序尝试的备用地址。 */
    backupUrls?: string[];
    /** URL 过期时间（Unix ms），供播放器决定是否重新解析。 */
    expiresAt?: number;
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

  /**
   * 导入歌单结果。新插件应返回完整歌单；歌曲数组仅用于兼容旧插件。
   */
  type IImportMusicSheetResult = IMusic.IMusicSheetItem | IMusic.IMusicItem[];

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
    /** 插件可提供的播放音质 */
    supportedQualities?: IMusic.IQualityKey[];
    /** 插件可请求的 MV/视频分辨率，例如 720p、1080p。 */
    supportedVideoQualities?: string[];
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
    /** 获取歌曲关联的 MV/视频播放源。 */
    getMvSource?: (
      musicItem: IMusic.IMusicItemPartial,
      videoQuality?: string,
    ) => Promise<IVideoSourceResult | null>;
    /** 根据主键去查询歌曲信息 */
    getMusicInfo?: (
      musicBase: IMedia.IMediaBase
    ) => Promise<Partial<IMusic.IMusicItem> | null>;
    /** 歌曲分享/详情页 URL */
    getMusicDetailPageUrl?: (
      musicItem: IMusic.IMusicItemPartial
    ) => string | Promise<string | null> | null;
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
    /** 获取作者详情（头像/简介等） */
    getArtistInfo?: (
      artistItem: IArtist.IArtistItem,
    ) => Promise<Partial<IArtist.IArtistItem> | null>;
    /** 导入歌单 */
    importMusicSheet?: (
      urlLike: string,
    ) => Promise<IImportMusicSheetResult | null>;
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
    /** 听歌识曲。audioBase64 为 8kHz/16bit/单声道 PCM 的 base64 字符串。 */
    recognize?: (
      audioBase64: string,
      sampleRate?: number,
      channels?: number,
    ) => Promise<IRecognizeResult | null>;
  }

  interface IRecognizeResult {
    isEnd?: boolean;
    data: IRecognizeItem[];
  }

  /** 识曲结果。保留平台所需的原始字段，播放器可直接交给对应插件解析。 */
  interface IRecognizeItem extends IMusic.IMusicItemPartial {
    confidence?: number;
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
