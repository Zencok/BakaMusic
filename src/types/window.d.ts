/** 某些没有类型的新特性 */
interface Window {
    "@shared/dlna": import("@shared/dlna/common").DlnaBridge;
    /** 获取本地字体 */
    queryLocalFonts: () => Promise<FontData[]>;
    "@shared/native-playback": import("@shared/native-playback/type").IMod;
}


declare interface FontData {
    family: readonly string;
    fullName: readonly string;
    postscriptName: readonly string;
    style: readonly string;
}
