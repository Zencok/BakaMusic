import { PlayerState, RepeatMode } from "@/common/constant";
import type { IParsedLrcItem } from "@renderer/utils/lyric-parser";

/** 歌词时钟校准数据（低频 IPC 传输，桌面歌词本地插值用） */
export interface ILyricClock {
  /** 发送时播放器进度（秒） */
  anchorProgress: number;
  /** 发送时间戳（ms） */
  sentAt: number;
  /** 播放倍率 */
  speed: number;
  /** 播放状态 */
  playerState: PlayerState;
}

export interface IAppState {
  musicItem?: IMusic.IMusicItem | null;
  playerState?: PlayerState;
  repeatMode?: RepeatMode;
  lyricText?: string | null;
  parsedLrc?: IParsedLrcItem | null;
  fullLyric?: IParsedLrcItem[] | null;
  progress?: number;
  duration?: number;
  /** 歌词时钟校准 */
  lyricClock?: ILyricClock;
}

export interface ICommand {
  /** 切换播放器状态 */
  TogglePlayerState: void;
  /** 切换上一首歌 */
  SkipToPrevious: void;
  /** 切换下一首歌 */
  SkipToNext: void;
  /** 设置循环模式 */
  SetRepeatMode: RepeatMode;
  /** 播放音乐 */
  PlayMusic: IMusic.IMusicItem;
  /** 通过ID播放音乐 */
  PlayMusicById: { platform: string; id: string; quality?: IMusic.IQualityKey };
  /** 跳转路由 */
  Navigate: string;
  /** 声音调大 */
  VolumeUp: number;
  /** 声音调小 */
  VolumeDown: number;
  /** 切换喜爱状态 */
  ToggleFavorite: IMusic.IMusicItem | null;
  /** 切换桌面歌词状态 */
  ToggleDesktopLyric: void;
  /** 同步音乐状态 */
  SyncAppState: void;
  /** 打开音乐详情页面 */
  OpenMusicDetailPage: void;
  /** 切换主窗口显示 */
  ToggleMainWindowVisible: void;
}

// 内部使用的消息
// 其他窗口向主窗口发送的消息
export interface IPortMessagePayload<
  CommandKey extends keyof ICommand = keyof ICommand,
  StateKey extends keyof IAppState = keyof IAppState
> {
  mount: number;
  unmount: number;
  command: {
    command: CommandKey;
    data: ICommand[CommandKey];
  };
  subscribeAppState: StateKey[];
  ping: undefined;
}

export interface IPortMessage<
  T extends keyof IPortMessagePayload = keyof IPortMessagePayload
> {
  type: T;
  payload: IPortMessagePayload[T];
  timestamp: number;
}
