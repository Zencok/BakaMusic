import path from "path";
import exposeInMainWorld from "./expose-in-main-world";
import "electron-log/preload";
import "@shared/i18n/preload";
import "@shared/global-context/preload";
import "@shared/themepack/preload";
import "@shared/app-config/preload";
import "@shared/utils/preload";
import "@shared/window-drag/preload";

// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

exposeInMainWorld("path", path);
