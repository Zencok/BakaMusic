import RadioGroupSettingItem from "../../components/RadioGroupSettingItem";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import { useOutputAudioDevices } from "@/hooks/useMediaDevices";
import ListBoxSettingItem from "../../components/ListBoxSettingItem";
import SettingGroup from "../../components/SettingGroup";
import trackPlayer from "@renderer/core/track-player";
import { useTranslation } from "react-i18next";
import AppConfig from "@shared/app-config/renderer";
import { MusicSheetSortType } from "@/common/constant";
import { getGlobalContext } from "@shared/global-context/renderer";

/** Playback quality, devices, and queue behavior (formerly PlayMusic). */
export default function Playback() {
    const audioDevices = useOutputAudioDevices();
    const { t } = useTranslation();
    const isWindows = getGlobalContext().platform === "win32";

    return (
        <div className="setting-view--playback-container">
            <SettingGroup
                title={t("settings.group.quality")}
                description={t("settings.group.quality_desc")}
            >
                <RadioGroupSettingItem
                    label={t("settings.play_music.default_play_quality")}
                    keyPath="playMusic.defaultQuality"
                    options={[
                        "mgg",
                        "128k",
                        "192k",
                        "320k",
                        "flac",
                        "flac24bit",
                        "hires",
                        "vinyl",
                        "dolby",
                        "atmos",
                        "atmos_plus",
                        "master",
                    ]}
                    renderItem={(it) => t("media.music_quality_" + it)}
                ></RadioGroupSettingItem>
                <RadioGroupSettingItem
                    label={t("settings.play_music.when_quality_missing")}
                    keyPath="playMusic.whenQualityMissing"
                    options={["lower", "higher", "skip"]}
                    renderItem={(it) => t("settings.play_music.play_" + it + "_quality_version")}
                ></RadioGroupSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.playback_behavior")}
                description={t("settings.group.playback_behavior_desc")}
            >
                <RadioGroupSettingItem
                    label={t("settings.play_music.when_play_error")}
                    keyPath="playMusic.playError"
                    options={["pause", "skip"]}
                    renderItem={(it) => {
                        if (it === "pause") {
                            return t("settings.play_music.pause");
                        }
                        return t("settings.play_music.skip_to_next");
                    }}
                ></RadioGroupSettingItem>
                <RadioGroupSettingItem
                    label={t("settings.play_music.double_click_music_list")}
                    keyPath="playMusic.clickMusicList"
                    options={["normal", "replace"]}
                    renderItem={(it) => {
                        if (it === "normal") {
                            return t("settings.play_music.add_music_to_playlist");
                        }
                        return t("settings.play_music.replace_playlist_with_musiclist");
                    }}
                ></RadioGroupSettingItem>
                <CheckBoxSettingItem
                    keyPath="playMusic.caseSensitiveInSearch"
                    label={t("settings.play_music.case_sensitive_in_search")}
                ></CheckBoxSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.audio_device")}
                description={t("settings.group.audio_device_desc")}
            >
                <ListBoxSettingItem
                    label={t("settings.play_music.audio_output_device")}
                    keyPath="playMusic.audioOutputDevice"
                    renderItem={(item) => item?.label ?? t("common.default")}
                    width={"320px"}
                    onChange={async (evt, item) => {
                        evt.preventDefault();
                        if (!item) {
                            return;
                        }
                        await trackPlayer.setAudioOutputDevice(item.deviceId);
                        AppConfig.setConfig({
                            "playMusic.audioOutputDevice": item.toJSON(),
                        });
                    }}
                    options={audioDevices}
                ></ListBoxSettingItem>
                <RadioGroupSettingItem
                    label={t("settings.play_music.when_device_removed")}
                    keyPath="playMusic.whenDeviceRemoved"
                    renderItem={(it) => {
                        if (it === "pause") {
                            return t("settings.play_music.pause");
                        }
                        return t("settings.play_music.continue_playing");
                    }}
                    options={["pause", "play"]}
                ></RadioGroupSettingItem>
                {isWindows ? (
                    <CheckBoxSettingItem
                        keyPath="playMusic.wasapiExclusive"
                        label={t("settings.play_music.wasapi_exclusive")}
                        onChange={(_event, checked) => {
                            void trackPlayer.setWasapiExclusive(checked);
                        }}
                    ></CheckBoxSettingItem>
                ) : null}
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.sheet_defaults")}
                description={t("settings.group.sheet_defaults_desc")}
            >
                <RadioGroupSettingItem
                    label={t("settings.play_music.new_sheet_default_sort")}
                    keyPath="playMusic.newSheetDefaultSort"
                    options={[
                        MusicSheetSortType.Title,
                        MusicSheetSortType.Artist,
                        MusicSheetSortType.Album,
                        MusicSheetSortType.Newest,
                        MusicSheetSortType.Oldest,
                    ]}
                    direction="vertical"
                    renderItem={(item) => {
                        switch (item) {
                            case MusicSheetSortType.Title:
                                return t("settings.play_music.sort_by_title");
                            case MusicSheetSortType.Artist:
                                return t("settings.play_music.sort_by_artist");
                            case MusicSheetSortType.Album:
                                return t("settings.play_music.sort_by_album");
                            case MusicSheetSortType.Newest:
                                return t("settings.play_music.sort_by_collected_newest");
                            case MusicSheetSortType.Oldest:
                            default:
                                return t("settings.play_music.sort_by_collected_oldest");
                        }
                    }}
                ></RadioGroupSettingItem>
            </SettingGroup>
        </div>
    );
}
