import { IAppConfig } from "@/types/app-config";
import defaultAppConfig from "@shared/app-config/default-app-config";
import {
    createChangedConfigPatch,
    IAppConfigUpdate,
} from "@shared/app-config/config-utils";
import logger from "@shared/logger/renderer";
import { toError } from "@/common/error-util";


interface IMod {
    syncConfig(): Promise<IAppConfig>;

    setConfig(config: IAppConfig): void;

    onConfigUpdate(callback: (update: IAppConfigUpdate) => void): void;

    reset(): void;
}

const mod = window["@shared/app-config" as any] as unknown as IMod;

class AppConfig {
    private config: IAppConfig = {};

    public initialized = false;
    private setupPromise: Promise<void> | null = null;
    private updateListenerBound = false;
    private pendingUpdates: IAppConfigUpdate[] = [];

    private updateCallbacks: Set<(patch: IAppConfig, config: IAppConfig) => void> = new Set();

    private notifyCallbacks(patch: IAppConfig) {
        for (const callback of this.updateCallbacks) {
            try {
                callback(patch, this.config);
            } catch (error) {
                logger.logError("配置更新回调执行失败", toError(error));
            }
        }
    }

    private applyUpdate(update: IAppConfigUpdate, notify = true): void {
        if (update.replace) {
            this.config = {
                ...defaultAppConfig,
                ...update.config,
            };
        } else {
            this.config = {
                ...defaultAppConfig,
                ...this.config,
                ...update.patch,
            };
        }
        if (notify) {
            this.notifyCallbacks(update.patch);
        }
    }

    private bindUpdateListener(): void {
        if (this.updateListenerBound) {
            return;
        }
        this.updateListenerBound = true;
        mod.onConfigUpdate((update) => {
            if (!this.initialized) {
                this.pendingUpdates.push(update);
                return;
            }
            this.applyUpdate(update);
        });
    }

    private async initialize(): Promise<void> {
        this.bindUpdateListener();
        this.config = {
            ...defaultAppConfig,
            ...await mod.syncConfig(),
        };
        for (const update of this.pendingUpdates) {
            this.applyUpdate(update, false);
        }
        this.pendingUpdates = [];
        this.initialized = true;
        this.notifyCallbacks(this.config);
    }

    async setup() {
        if (this.initialized) {
            return;
        }
        if (!this.setupPromise) {
            this.setupPromise = this.initialize().catch((error) => {
                this.setupPromise = null;
                throw error;
            });
        }
        await this.setupPromise;
    }

    public onConfigUpdate(callback: (patch: IAppConfig, config: IAppConfig) => void) {
        this.updateCallbacks.add(callback);
    }

    public offConfigUpdate(callback: (patch: IAppConfig, config: IAppConfig) => void) {
        this.updateCallbacks.delete(callback);
    }

    public getAllConfig() {
        return this.config;
    }

    public getConfig<T extends keyof IAppConfig>(key: T): IAppConfig[T] {
        return this.config[key];
    }

    public setConfig(data: IAppConfig) {
        const changedPatch = createChangedConfigPatch(this.config, data);
        if (Object.keys(changedPatch).length > 0) {
            mod.setConfig(changedPatch);
        }
    }

    public reset() {
        mod.reset();
    }

}

export default new AppConfig();
