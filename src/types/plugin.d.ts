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


  export type Capability =
    | "search" | "entities.get" | "collections.get" | "collections.members"
    | "discovery.charts" | "discovery.chartTags" | "discovery.playlistTags"
    | "discovery.playlists" | "discovery.hotSearch" | "discovery.recommendations"
    | "discovery.daily" | "discovery.similar" | "discovery.searchSuggestions"
    | "media.prepare" | "media.resolve" | "media.video" | "media.license"
    | "lyrics.get" | "comments.list" | "links.resolve" | "links.share"
    | "recognition.identify" | "auth.login" | "auth.callback" | "auth.logout" | "auth.status";

  export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
  export type ImportKind = "auto" | "v2" | "lx";
  export interface ImportOptions { kind?: ImportKind }
  export type FailureCode = "quality_unavailable" | "track_unavailable"
    | "authentication_required" | "permission_denied" | "rate_limited"
    | "temporary_unavailable" | "signature_expired";
  export interface PageRequest { cursor: string | null; limit: number }
  export interface Page<T> {
    items: T[];
    nextCursor: string | null;
    total?: number;
    entity?: IMedia.IMediaBase;
    revision?: string;
    accountRevision?: string;
    sourceRevision?: string;
    [key: string]: unknown;
  }
  export interface ILyricSearchContext {
    title: string;
    artist: string;
    durationMs?: number;
    musicItem?: { id: string | number; [key: string]: unknown };
  }
  export interface IUserVariable {
    key: string; name?: string; hint?: string; defaultValue?: string; type?: string;
    [key: string]: unknown;
  }
  export interface Manifest {
    apiVersion: 2;
    id: string;
    kind: "provider" | "resolver";
    name: string;
    author: string;
    version: string;
    sourceId?: string;
    sources?: string[];
    capabilities: Capability[];
    description?: string;
    homepage?: string;
    license?: string;
    srcUrl?: string;
    primaryKey?: string[];
    supportedSearchType?: IMedia.SupportMediaType[];
    supportedQualities?: IMusic.IQualityKey[];
    supportedVideoQualities?: string[];
    userVariables?: IUserVariable[];
    hints?: Record<string, string[]>;
    [key: string]: unknown;
  }
  export interface IPluginDelegate extends Manifest {
    /** App-owned routing fields; never part of a provider's manifest. */
    platform: string;
    hash: string;
    path: string;
  }
  export type IPluginMeta = {
    order?: number;
    disabled?: boolean;
    userVariables?: Record<string, string>;
  };
  export interface ResolverBinding { providerId: string; resolverId: string }
  export interface RetiredPlugin {
    id: string;
    path: string;
    name: string;
    reason: "legacy_format" | "invalid_v2" | "duplicate_id";
    message?: string;
  }
  export interface RegistryState {
    retiredPlugins: RetiredPlugin[];
    resolverBindings: ResolverBinding[];
  }
  type DiscoveryRequest = PageRequest & { tag?: unknown };
  export interface Requests {
    search: PageRequest & { query: string; kind: IMedia.SupportMediaType; context?: ILyricSearchContext };
    "entities.get": { entity: IMusic.IMusicItemPartial };
    "collections.get": { entity: IMusic.IMusicItemPartial };
    "collections.members": PageRequest & { entity: IMusic.IMusicItemPartial; kind: IMedia.SupportMediaType };
    "discovery.charts": DiscoveryRequest;
    "discovery.chartTags": DiscoveryRequest;
    "discovery.playlistTags": DiscoveryRequest;
    "discovery.playlists": DiscoveryRequest;
    "discovery.hotSearch": DiscoveryRequest;
    "discovery.recommendations": DiscoveryRequest;
    "discovery.daily": DiscoveryRequest;
    "discovery.similar": PageRequest & { entity: IMusic.IMusicItemPartial };
    "discovery.searchSuggestions": PageRequest & { query: string };
    "media.prepare": { entity: IMusic.IMusicItemPartial; quality: IMusic.IQualityKey | null };
    "media.resolve": { entity: IMusic.IMusicItemPartial; quality: IMusic.IQualityKey | null };
    "media.video": { entity: IMusic.IMusicItemPartial; quality?: string | null };
    "media.license": { payload: unknown };
    "lyrics.get": { entity: IMusic.IMusicItemPartial };
    "comments.list": PageRequest & { entity: IMusic.IMusicItemPartial; sort?: string };
    "links.resolve": { url: string; kind?: IMedia.SupportMediaType };
    "links.share": { entity: IMusic.IMusicItemPartial };
    "recognition.identify": { payload: unknown };
    "auth.login": { payload: unknown };
    "auth.callback": { payload: unknown };
    "auth.logout": { payload: unknown };
    "auth.status": { payload: unknown };
  }
  export interface DailyPage extends Page<IMedia.IMediaBase> {
    state: "ready" | "login_required" | "unconfigured" | "blocked" | "updating";
    sheetItem?: IMusic.IMusicSheetItem;
    refreshAt?: number;
    date?: string;
  }
  export interface Results {
    search: Page<IMedia.IMediaBase>;
    "entities.get": IMedia.IMediaBase | null;
    "collections.get": IMusic.IMusicSheetItem | null;
    "collections.members": Page<IMedia.IMediaBase>;
    "discovery.charts": Page<IMusic.IMusicSheetItem>;
    "discovery.chartTags": Page<any>;
    "discovery.playlistTags": Page<any>;
    "discovery.playlists": Page<IMusic.IMusicSheetItem>;
    "discovery.hotSearch": Page<any>;
    "discovery.recommendations": Page<IMusic.IMusicSheetItem>;
    "discovery.daily": DailyPage;
    "discovery.similar": Page<IMusic.IMusicItem>;
    "discovery.searchSuggestions": Page<any>;
    "media.prepare": unknown;
    "media.resolve": IMediaSourceResult | null;
    "media.video": IVideoSourceResult | null;
    "media.license": unknown;
    "lyrics.get": ILyric.ILyricSource | null;
    "comments.list": Page<IComment.IComment>;
    "links.resolve": IMedia.IMediaBase | null;
    "links.share": string | null;
    "recognition.identify": IRecognizeResult | null;
    "auth.login": unknown;
    "auth.callback": unknown;
    "auth.logout": unknown;
    "auth.status": unknown;
  }
  export type IPluginInstanceMethods = {
    [K in Capability]: (request: Requests[K]) => Promise<Results[K]>;
  };
  export interface IRecognizeItem extends IMusic.IMusicItemPartial { confidence?: number }
  export interface IRecognizeResult { candidates: IRecognizeItem[]; [key: string]: unknown }
  /** App-owned complete snapshot, never a plugin capability or paged response. */
  export interface IImportMusicSheetOptions { knownVersion?: string }
  export interface IUnchangedMusicSheetResult { notModified: true; syncVersion: string }
  export type IImportMusicSheetResult = (IMusic.IMusicSheetItem & {
    syncVersion?: string; notModified?: false;
  }) | IMusic.IMusicItem[] | IUnchangedMusicSheetResult;
}
