interface IMod {
    fs: {
        writeFile(filePath: string, data: string, encoding?: "utf8" | "utf-8"): Promise<void>;
        readFile(filePath: string, encoding?: "utf8" | "utf-8"): Promise<string>;
        isFile: (path: string) => Promise<boolean>;
        isFolder: (path: string) => Promise<boolean>;
        rimraf: (path: string) => Promise<boolean>;
        trashFile: (path: string) => Promise<boolean>;
        addFileScheme: (filePath: string) => string;
        getPathForFile: (file: File) => string;
    },
    app: {
        exitApp: () => void;
        getPath: (pathName: "home" | "appData" | "userData" | "sessionData" | "temp" | "exe" | "module" | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos" | "recent" | "logs" | "crashDumps") => Promise<string>;
        checkUpdate: () => Promise<ICommon.IUpdateInfo>;
        downloadUpdate: () => Promise<void>;
        onUpdateDownloadProgress: (callback: (progress: { downloaded: number; total: number }) => void) => () => void;
        installUpdate: () => Promise<void>;
        cancelUpdateDownload: () => void;
        clearCache: () => void;
        getCacheSize: () => Promise<number>;
    }
    appWindow: {
        minMainWindow: (skipTaskBar?: boolean) => void;
        showMainWindow: () => void;
        setLyricWindow: (enabled: boolean) => void;
        setMinimodeWindow: (enabled: boolean) => void;
        getCurrentWindowBounds: () => Promise<Electron.Rectangle>;
        getAllWorkAreas: () => Promise<Electron.Rectangle[]>;
        ignoreMouseEvent: (ignore: boolean) => void;
        setCurrentWindowBounds: (bounds: Electron.Rectangle) => void;
        toggleMainWindowVisible: () => void;
        toggleMainWindowMaximize: () => void;
        setMainWindowFullScreen: (enabled: boolean) => void;
        toggleMainWindowFullScreen: () => Promise<boolean>;
        isMainWindowFullScreen: () => Promise<boolean>;
        onMainWindowFullScreenChanged: (
            callback: (isFullScreen: boolean) => void,
        ) => () => void;
        onMainWindowF11: (callback: () => void) => () => void;
    },
    shell: {
        openExternal: (url: string) => void;
        openPath: (path: string) => void;
        showItemInFolder: (path: string) => Promise<boolean>;
    },
    dialog: {
        showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue>;
        showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue>;
    }

}

const utils = window["@shared/utils" as any] as unknown as IMod;


export const { fs: fsUtil, app: appUtil, appWindow: appWindowUtil, shell: shellUtil, dialog: dialogUtil } = utils;
