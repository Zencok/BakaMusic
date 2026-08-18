import * as dbus from "@particle/dbus-next";
import { RepeatMode } from "../../common/constant";
import logger from "../logger/main";
import type {
    ISystemMediaControlsBinding,
    ISystemMediaControlsUpdate,
    SystemMediaAction,
} from "./system-media-controls";

const MPRIS_BUS_NAME = "org.mpris.MediaPlayer2.BakaMusic";
const MPRIS_OBJECT_PATH = "/org/mpris/MediaPlayer2";
const MPRIS_ROOT_INTERFACE = "org.mpris.MediaPlayer2";
const MPRIS_PLAYER_INTERFACE = "org.mpris.MediaPlayer2.Player";
const MAX_POSITION_MICROSECONDS = BigInt(7 * 24 * 3600) * 1_000_000n;
const {
    ACCESS_READ,
    ACCESS_READWRITE,
    Interface,
} = dbus.interface;

function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
}

function secondsToMicroseconds(value: number) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0n;
    }
    const microseconds = BigInt(Math.round(value * 1_000_000));
    return microseconds > MAX_POSITION_MICROSECONDS
        ? MAX_POSITION_MICROSECONDS
        : microseconds;
}

function trackPath(appMediaId: string) {
    const identity = Buffer.from(appMediaId || "unknown", "utf8")
        .toString("hex")
        .slice(0, 240);
    return `/com/zencok/BakaMusic/track/track_${identity || "unknown"}`;
}

function playbackStatus(state: ISystemMediaControlsUpdate["state"]) {
    if (state === "playing" || state === "buffering") {
        return "Playing";
    }
    if (state === "paused") {
        return "Paused";
    }
    return "Stopped";
}

function loopStatus(value: ISystemMediaControlsUpdate | null) {
    if (!value || value.mediaType === "video") {
        return "None";
    }
    return value.repeatMode === RepeatMode.Loop ? "Track" : "Playlist";
}

class MprisRootInterface extends Interface {
    constructor(private readonly onAction: (event: SystemMediaAction) => void) {
        super(MPRIS_ROOT_INTERFACE);
    }

    get CanQuit() {
        return true;
    }

    get CanRaise() {
        return true;
    }

    get Fullscreen() {
        return false;
    }

    set Fullscreen(_value: boolean) {
        throw new dbus.DBusError(
            "org.mpris.MediaPlayer2.Error.NotSupported",
            "BakaMusic does not expose fullscreen media control",
        );
    }

    get CanSetFullscreen() {
        return false;
    }

    get HasTrackList() {
        return false;
    }

    get Identity() {
        return "BakaMusic";
    }

    get DesktopEntry() {
        return "bakamusic";
    }

    get SupportedUriSchemes() {
        return [];
    }

    get SupportedMimeTypes() {
        return [];
    }

    Raise() {
        this.onAction({ action: "raise" });
    }

    Quit() {
        this.onAction({ action: "quit" });
    }
}

MprisRootInterface.configureMembers({
    properties: {
        CanQuit: { signature: "b", access: ACCESS_READ },
        CanRaise: { signature: "b", access: ACCESS_READ },
        Fullscreen: { signature: "b", access: ACCESS_READWRITE },
        CanSetFullscreen: { signature: "b", access: ACCESS_READ },
        HasTrackList: { signature: "b", access: ACCESS_READ },
        Identity: { signature: "s", access: ACCESS_READ },
        DesktopEntry: { signature: "s", access: ACCESS_READ },
        SupportedUriSchemes: { signature: "as", access: ACCESS_READ },
        SupportedMimeTypes: { signature: "as", access: ACCESS_READ },
    },
    methods: {
        Raise: {},
        Quit: {},
    },
});

class MprisPlayerInterface extends Interface {
    private value: ISystemMediaControlsUpdate | null = null;
    private currentTrackPath = trackPath("");

    constructor(private readonly onAction: (event: SystemMediaAction) => void) {
        super(MPRIS_PLAYER_INTERFACE);
    }

    get PlaybackStatus() {
        return playbackStatus(this.value?.state ?? "none");
    }

    get LoopStatus() {
        return loopStatus(this.value);
    }

    set LoopStatus(value: string) {
        if (!this.value || this.value.mediaType === "video") {
            throw new dbus.DBusError(
                "org.mpris.MediaPlayer2.Player.Error.NotSupported",
                "The active media does not support repeat modes",
            );
        }
        if (value === "Track") {
            this.onAction({ action: "repeat", mode: RepeatMode.Loop });
        } else if (value === "Playlist") {
            this.onAction({ action: "repeat", mode: RepeatMode.Queue });
        } else {
            throw new dbus.DBusError(
                "org.mpris.MediaPlayer2.Player.Error.NotSupported",
                "BakaMusic does not expose a no-repeat queue mode",
            );
        }
    }

    get Rate() {
        return this.value?.playbackRate ?? 1;
    }

    set Rate(value: number) {
        if (Number.isFinite(value)) {
            this.onAction({ action: "rate", rate: clamp(value, 0.25, 4) });
        }
    }

    get Shuffle() {
        return this.value?.mediaType === "music"
            && this.value.repeatMode === RepeatMode.Shuffle;
    }

    set Shuffle(value: boolean) {
        if (!this.value || this.value.mediaType === "video") {
            throw new dbus.DBusError(
                "org.mpris.MediaPlayer2.Player.Error.NotSupported",
                "The active media does not support shuffle",
            );
        }
        this.onAction({
            action: "repeat",
            mode: value ? RepeatMode.Shuffle : RepeatMode.Queue,
        });
    }

    get Metadata() {
        const value = this.value;
        if (!value) {
            return {
                "mpris:trackid": new dbus.Variant("o", trackPath("")),
            };
        }
        const metadata: Record<string, dbus.Variant> = {
            "mpris:trackid": new dbus.Variant("o", this.currentTrackPath),
            "mpris:length": new dbus.Variant("x", secondsToMicroseconds(value.duration)),
            "xesam:title": new dbus.Variant("s", value.title),
            "xesam:artist": new dbus.Variant("as", value.artist ? [value.artist] : []),
            "xesam:album": new dbus.Variant("s", value.album),
        };
        if (value.artist) {
            metadata["xesam:albumArtist"] = new dbus.Variant("as", [value.artist]);
        }
        if (value.artwork) {
            metadata["mpris:artUrl"] = new dbus.Variant("s", value.artwork);
        }
        return metadata;
    }

    get Volume() {
        return this.value?.volume ?? 1;
    }

    set Volume(value: number) {
        if (Number.isFinite(value)) {
            this.onAction({ action: "volume", volume: clamp(value, 0, 1) });
        }
    }

    get Position() {
        return secondsToMicroseconds(this.value?.position ?? 0);
    }

    get MinimumRate() {
        return 0.25;
    }

    get MaximumRate() {
        return 4;
    }

    get CanGoNext() {
        return this.value?.nextEnabled ?? false;
    }

    get CanGoPrevious() {
        return this.value?.previousEnabled ?? false;
    }

    get CanPlay() {
        return this.value !== null;
    }

    get CanPause() {
        return this.value !== null;
    }

    get CanSeek() {
        return (this.value?.duration ?? 0) > 0;
    }

    get CanControl() {
        return this.value !== null;
    }

    Next() {
        if (this.CanGoNext) this.onAction({ action: "next" });
    }

    Previous() {
        if (this.CanGoPrevious) this.onAction({ action: "previous" });
    }

    Pause() {
        if (this.CanPause) this.onAction({ action: "pause" });
    }

    PlayPause() {
        if (!this.value) return;
        this.onAction({
            action: this.PlaybackStatus === "Playing" ? "pause" : "play",
        });
    }

    Stop() {
        if (this.value) this.onAction({ action: "stop" });
    }

    Play() {
        if (this.CanPlay) this.onAction({ action: "play" });
    }

    Seek(offset: bigint) {
        if (!this.CanSeek) return;
        const requested = this.Position + offset;
        const maximum = secondsToMicroseconds(this.value?.duration ?? 0);
        const position = requested < 0n ? 0n : requested > maximum ? maximum : requested;
        this.onAction({ action: "seek", position: Number(position) / 1_000_000 });
        this.Seeked(position);
    }

    SetPosition(trackId: string, position: bigint) {
        if (!this.CanSeek || trackId !== this.currentTrackPath) return;
        const maximum = secondsToMicroseconds(this.value?.duration ?? 0);
        const bounded = position < 0n ? 0n : position > maximum ? maximum : position;
        this.onAction({ action: "seek", position: Number(bounded) / 1_000_000 });
        this.Seeked(bounded);
    }

    OpenUri() {
        throw new dbus.DBusError(
            "org.mpris.MediaPlayer2.Player.Error.NotSupported",
            "BakaMusic does not accept arbitrary MPRIS URIs",
        );
    }

    Seeked(position: bigint) {
        return position;
    }

    update(value: ISystemMediaControlsUpdate) {
        const previous = this.value;
        this.value = value;
        this.currentTrackPath = trackPath(value.appMediaId);
        const changed: Record<string, unknown> = {};
        if (!previous || playbackStatus(previous.state) !== playbackStatus(value.state)) {
            changed.PlaybackStatus = this.PlaybackStatus;
        }
        if (!previous || loopStatus(previous) !== loopStatus(value)) {
            changed.LoopStatus = this.LoopStatus;
        }
        if (!previous || previous.repeatMode !== value.repeatMode) {
            changed.Shuffle = this.Shuffle;
        }
        if (!previous || previous.playbackRate !== value.playbackRate) {
            changed.Rate = this.Rate;
        }
        if (!previous || previous.volume !== value.volume) {
            changed.Volume = this.Volume;
        }
        if (!previous || previous.nextEnabled !== value.nextEnabled) {
            changed.CanGoNext = this.CanGoNext;
        }
        if (!previous || previous.previousEnabled !== value.previousEnabled) {
            changed.CanGoPrevious = this.CanGoPrevious;
        }
        if (!previous || previous.duration !== value.duration) {
            changed.CanSeek = this.CanSeek;
        }
        if (!previous) {
            changed.CanPlay = true;
            changed.CanPause = true;
            changed.CanControl = true;
        }
        if (
            value.updateMetadata
            || !previous
            || previous.duration !== value.duration
        ) {
            changed.Metadata = this.Metadata;
        }
        if (Object.keys(changed).length) {
            Interface.emitPropertiesChanged(this, changed, []);
        }
    }

    clear() {
        if (!this.value) return;
        this.value = null;
        this.currentTrackPath = trackPath("");
        Interface.emitPropertiesChanged(this, {
            PlaybackStatus: this.PlaybackStatus,
            Metadata: this.Metadata,
            CanGoNext: false,
            CanGoPrevious: false,
            CanPlay: false,
            CanPause: false,
            CanSeek: false,
            CanControl: false,
            LoopStatus: this.LoopStatus,
            Shuffle: this.Shuffle,
            Rate: this.Rate,
            Volume: this.Volume,
        }, []);
    }
}

MprisPlayerInterface.configureMembers({
    properties: {
        PlaybackStatus: { signature: "s", access: ACCESS_READ },
        LoopStatus: { signature: "s", access: ACCESS_READWRITE },
        Rate: { signature: "d", access: ACCESS_READWRITE },
        Shuffle: { signature: "b", access: ACCESS_READWRITE },
        Metadata: { signature: "a{sv}", access: ACCESS_READ },
        Volume: { signature: "d", access: ACCESS_READWRITE },
        Position: { signature: "x", access: ACCESS_READ },
        MinimumRate: { signature: "d", access: ACCESS_READ },
        MaximumRate: { signature: "d", access: ACCESS_READ },
        CanGoNext: { signature: "b", access: ACCESS_READ },
        CanGoPrevious: { signature: "b", access: ACCESS_READ },
        CanPlay: { signature: "b", access: ACCESS_READ },
        CanPause: { signature: "b", access: ACCESS_READ },
        CanSeek: { signature: "b", access: ACCESS_READ },
        CanControl: { signature: "b", access: ACCESS_READ },
    },
    methods: {
        Next: {},
        Previous: {},
        Pause: {},
        PlayPause: {},
        Stop: {},
        Play: {},
        Seek: { inSignature: "x" },
        SetPosition: { inSignature: "ox" },
        OpenUri: { inSignature: "s" },
    },
    signals: {
        Seeked: { signature: "x" },
    },
});

class MprisBinding implements ISystemMediaControlsBinding {
    private bus: dbus.MessageBus | null = null;
    private root: MprisRootInterface | null = null;
    private player: MprisPlayerInterface | null = null;

    isSupported() {
        return process.platform === "linux";
    }

    async initialize(
        _windowHandle: Buffer,
        callback: (event: SystemMediaAction) => void,
    ) {
        this.dispose();
        const bus = dbus.sessionBus();
        this.bus = bus;
        bus.on("error", (error) => {
            logger.logError(
                "Linux MPRIS session bus failed",
                error instanceof Error ? error : new Error(String(error)),
            );
        });
        const reply = await bus.requestName(
            MPRIS_BUS_NAME,
            dbus.NameFlag.DO_NOT_QUEUE,
        );
        if (
            reply !== dbus.RequestNameReply.PRIMARY_OWNER
            && reply !== dbus.RequestNameReply.ALREADY_OWNER
        ) {
            throw new Error(`MPRIS bus name is unavailable (${reply})`);
        }
        if (this.bus !== bus) {
            await bus.releaseName(MPRIS_BUS_NAME).catch(() => undefined);
            bus.disconnect();
            return;
        }
        this.root = new MprisRootInterface(callback);
        this.player = new MprisPlayerInterface(callback);
        bus.export(MPRIS_OBJECT_PATH, this.root);
        bus.export(MPRIS_OBJECT_PATH, this.player);
    }

    update(value: ISystemMediaControlsUpdate) {
        if (!this.player) {
            throw new Error("MPRIS is not initialized");
        }
        this.player.update(value);
    }

    clear() {
        this.player?.clear();
    }

    dispose() {
        const bus = this.bus;
        this.bus = null;
        this.root = null;
        this.player = null;
        if (!bus) return;
        // Both interfaces share one object path. Unexporting the whole object is
        // also important for dbus-next forks whose per-interface unexport path
        // removes the service object after the first interface.
        const unexportObject = bus.unexport.bind(bus) as unknown as (
            path: string,
        ) => void;
        unexportObject(MPRIS_OBJECT_PATH);
        void bus.releaseName(MPRIS_BUS_NAME).catch(() => undefined).finally(() => {
            bus.disconnect();
        });
    }
}

export default function createMprisBinding() {
    return new MprisBinding();
}
