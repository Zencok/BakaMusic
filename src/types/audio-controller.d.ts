import { PlayerState } from "@/common/constant";
import { CurrentTime, ErrorReason } from "@renderer/core/track-player/enum";

export interface IAudioController {
    // 是否有音源
    hasSource: boolean;

    playerState: PlayerState;

    musicItem: IMusic.IMusicItem | null;

    // 准备音乐信息
    prepareTrack?(musicItem: IMusic.IMusicItem): void;

    // 设置音源
    setTrackSource(trackSource: IMusic.IMusicSource, musicItem: IMusic.IMusicItem): void;

    /**
     * 重新打开当前音源（如输出设备移除后回落到默认设备）。
     * 没有可恢复的音源时返回 false。
     */
    reloadTrack?(options?: { seekTo?: number; autoPlay?: boolean }): boolean;

    /** 释放 libmpv 音频实例持有的输出端点，同时保留当前音源以便稍后恢复。 */
    suspendForVideo?(): Promise<void>;

    // 暂停
    pause(): void;

    // 播放
    play(): void;

    // 设置音量
    setVolume(volume: number): void;

    // 跳转
    seekTo(seconds: number): void;

    // 设置循环
    setLoop(isLoop: boolean): void;

    // 设置播放速度
    setSpeed(speed: number): void;

    // 设置升降调（半音）
    setPitch(semitones: number): void;

    // 设置输出设备id
    setSinkId(deviceId: string): Promise<void>;

    /**
     * Windows WASAPI exclusive mode (no-op / shared on other platforms).
     * When enabled, the device is locked for this process via libmpv.
     */
    setAudioExclusive?(enabled: boolean): Promise<void>;

    // 清空当前播放的歌曲
    reset(): void;

    // 销毁audio实例
    destroy(): void;

    onPlayerStateChanged?: (playerState: PlayerState) => void;
    // 进度更新
    onProgressUpdate?: (progress: CurrentTime) => void;
    // 出错
    onError?: (type: ErrorReason, error?: any) => void;
    // 播放结束
    onEnded?: () => void;
    // 音量改变
    onVolumeChange?: (volume: number) => void;
    // 速度改变
    onSpeedChange?: (speed: number) => void;
    // 升降调改变（半音）
    onPitchChange?: (semitones: number) => void;
    // 音频输出设备增减
    onAudioDevicesChanged?: (change: { removed: boolean; added: boolean }) => void;

}

