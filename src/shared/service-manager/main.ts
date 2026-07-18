import { app, ipcMain, utilityProcess, UtilityProcess } from "electron";
import path from "path";
import { IWindowManager } from "@/types/window-manager";
import { ServiceName } from "@shared/service-manager/common";
import getResourcePath from "@/common/get-resource-path";
import logger from "@shared/logger/main";
import {
    assertIpcPayload,
    assertIpcSender,
    assertPlainObject,
    assertString,
    assertUrl,
} from "@shared/ipc-security/main";


class ServiceInstance {
    public serviceProcess: UtilityProcess | null = null;
    private retryTimeoutMs = 6000;
    private restartTimer: NodeJS.Timeout | null = null;
    private started = false;
    private subprocessName: string;
    private resourceTimer: NodeJS.Timeout | null = null;

    private hostChangeCallback: (host: string | null) => void = () => undefined;

    public serviceName: string;

    constructor(serviceName: string, subprocessPath: string) {
        this.serviceName = serviceName;
        this.subprocessName = subprocessPath;
    }


    onHostChange(callback: (host: string | null) => void) {
        this.hostChangeCallback = callback;
    }


    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        this.spawnProcess();
    }

    private spawnProcess() {
        if (!this.started || this.serviceProcess) {
            return;
        }
        const servicePath = getResourcePath(".service/" + this.subprocessName + ".cjs");
        const serviceEnv = this.createServiceEnvironment();

        let childProcess: UtilityProcess;
        try {
            childProcess = utilityProcess.fork(servicePath, [], {
                serviceName: `BakaMusic ${this.serviceName}`,
                cwd: path.dirname(servicePath),
                env: serviceEnv,
                execArgv: ["--max-old-space-size=128"],
                stdio: "pipe",
                allowLoadingUnsignedLibraries: false,
                disclaim: process.platform === "darwin",
            });
        } catch (error) {
            logger.logInfo(
                `[${this.serviceName}] Failed to start: ${String(error)}`,
            );
            this.scheduleRestart();
            return;
        }
        this.serviceProcess = childProcess;
        this.startResourceMonitor(childProcess);

        interface IMessage {
            type: "port",
            port: number
        }

        const logServiceError = (chunk: Buffer) => {
            const output = chunk.toString().trim();
            if (output) {
                logger.logInfo(`[${this.serviceName}] stderr: ${output}`);
            }
        };

        childProcess.stderr?.on("data", (chunk: Buffer) => {
            logServiceError(chunk);
        });

        childProcess.on("message", (msg: IMessage) => {
            if (msg.type !== "port") {
                return;
            }
            const host = "http://127.0.0.1:" + msg.port;
            this.retryTimeoutMs = 6000;
            logger.logInfo(`[${this.serviceName}] Listening on ${host}`);
            this.hostChangeCallback(host);
        });

        childProcess.once("error", (_type, location) => {
            this.handleProcessStopped(
                childProcess,
                `Process error: ${location}`,
            );
        });

        childProcess.once("exit", (code) => {
            this.handleProcessStopped(
                childProcess,
                `Exited with code ${code}`,
            );
        });
    }

    private createServiceEnvironment() {
        const environment: NodeJS.ProcessEnv = {};
        for (const key of [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "no_proxy",
            "LANG",
            "LC_ALL",
            "NODE_EXTRA_CA_CERTS",
            "SSL_CERT_DIR",
            "SSL_CERT_FILE",
            "TEMP",
            "TMP",
            "TMPDIR",
            "TZ",
            // Windows networking and native runtime initialization require
            // these system locations even when the service environment is
            // otherwise intentionally restricted.
            "SystemRoot",
            "WINDIR",
        ]) {
            const value = process.env[key];
            if (value !== undefined && value.length <= 32_768) {
                environment[key] = value;
            }
        }
        return environment;
    }

    private startResourceMonitor(childProcess: UtilityProcess) {
        this.stopResourceMonitor();
        this.resourceTimer = setInterval(() => {
            if (!childProcess.pid || this.serviceProcess !== childProcess) {
                return;
            }
            const metric = app.getAppMetrics().find((item) => item.pid === childProcess.pid);
            if (metric && metric.memory.workingSetSize > 256 * 1024) {
                logger.logInfo(`[${this.serviceName}] Working-set limit exceeded`);
                childProcess.kill();
            }
        }, 5000);
        this.resourceTimer.unref();
    }

    private stopResourceMonitor() {
        if (this.resourceTimer) {
            clearInterval(this.resourceTimer);
            this.resourceTimer = null;
        }
    }

    private handleProcessStopped(
        childProcess: UtilityProcess,
        reason: string,
    ): void {
        if (this.serviceProcess !== childProcess) {
            return;
        }
        this.serviceProcess = null;
        this.stopResourceMonitor();
        this.hostChangeCallback(null);
        if (!this.started) {
            return;
        }
        logger.logInfo(
            `[${this.serviceName}] ${reason}. Restarting in ${this.retryTimeoutMs}ms...`,
        );
        this.scheduleRestart();
    }

    private scheduleRestart() {
        if (!this.started || this.restartTimer) {
            return;
        }
        const delayMs = this.retryTimeoutMs;
        this.retryTimeoutMs = Math.min(this.retryTimeoutMs * 2, 300000);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (this.started) {
                this.spawnProcess();
            }
        }, delayMs);
    }

    stop() {
        this.started = false;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        const childProcess = this.serviceProcess;
        this.serviceProcess = null;
        this.stopResourceMonitor();
        if (childProcess) {
            childProcess.removeAllListeners();
            childProcess.kill();
        }
        this.retryTimeoutMs = 6000;
        this.hostChangeCallback(null);
    }
}

interface IServiceData {
    instance: ServiceInstance;
    host: string | null;
}

class ServiceManager {
    private windowManager!: IWindowManager;
    private serviceMap = new Map<ServiceName, IServiceData>();
    private serviceRequestId = 0;


    private addService(serviceName: ServiceName) {
        const instance = new ServiceInstance(serviceName, serviceName);
        this.serviceMap.set(serviceName, { instance, host: null });
        instance.onHostChange((host) => {
            const mainWindow = this.windowManager?.mainWindow;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("@shared/service-manager/host-changed", serviceName, host);
            }
            const serviceData = this.serviceMap.get(serviceName);
            if (serviceData) {
                serviceData.host = host;
            }
        });

        return instance;
    }

    startService(serviceName: ServiceName) {
        this.serviceMap.get(serviceName)?.instance?.start?.();
    }

    stopService(serviceName: ServiceName) {
        this.serviceMap.get(serviceName)?.instance?.stop?.();
    }

    private stopAllServices(): void {
        this.serviceMap.forEach((serviceData) => {
            serviceData.instance.stop();
        });
    }

    /** Register a stream with the mflac-proxy service (callable from main process) */
    registerMflacStream(src: string, ekey: string, headers?: Record<string, string>): Promise<string | null> {
        const serviceData = this.serviceMap.get(ServiceName.MflacProxy);
        if (!serviceData?.instance) {
            logger.logInfo("[mflac-proxy] Service not found");
            return Promise.resolve(null);
        }
        const cp = serviceData.instance.serviceProcess;
        if (!cp?.pid) {
            logger.logInfo("[mflac-proxy] Service process not running");
            return Promise.resolve(null);
        }
        const requestId = `mflac-${++this.serviceRequestId}`;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger.logInfo("[mflac-proxy] Registration timed out");
                cp.removeListener("message", handler);
                resolve(null);
            }, 5000);

            const handler = (msg: any) => {
                if (msg?.requestId !== requestId) {
                    return;
                }
                if (msg?.type === "registered") {
                    clearTimeout(timeout);
                    cp.removeListener("message", handler);
                    logger.logInfo("[mflac-proxy] Registered stream", msg.localUrl);
                    resolve(msg.localUrl);
                } else if (msg?.type === "error") {
                    clearTimeout(timeout);
                    cp.removeListener("message", handler);
                    logger.logInfo("[mflac-proxy] Registration error", msg.error);
                    resolve(null);
                }
            };
            cp.on("message", handler);
            cp.postMessage({ type: "register", requestId, src, ekey, headers });
        });
    }

    /** Register a stream with the luna-proxy service (CENC streaming decrypt) */
    registerLunaStream(src: string, cek: string, headers?: Record<string, string>): Promise<string | null> {
        const serviceData = this.serviceMap.get(ServiceName.LunaProxy);
        if (!serviceData?.instance) {
            logger.logInfo("[luna-proxy] Service not found");
            return Promise.resolve(null);
        }
        const cp = serviceData.instance.serviceProcess;
        if (!cp?.pid) {
            logger.logInfo("[luna-proxy] Service process not running");
            return Promise.resolve(null);
        }
        const requestId = `luna-${++this.serviceRequestId}`;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger.logInfo("[luna-proxy] Registration timed out");
                cp.removeListener("message", handler);
                resolve(null);
            }, 20000);

            const handler = (msg: any) => {
                if (msg?.requestId !== requestId) {
                    return;
                }
                if (msg?.type === "registered") {
                    clearTimeout(timeout);
                    cp.removeListener("message", handler);
                    logger.logInfo("[luna-proxy] Registered stream", msg.localUrl);
                    resolve(msg.localUrl);
                } else if (msg?.type === "error") {
                    clearTimeout(timeout);
                    cp.removeListener("message", handler);
                    logger.logInfo("[luna-proxy] Registration error", msg.error);
                    resolve(null);
                }
            };
            cp.on("message", handler);
            cp.postMessage({ type: "register", requestId, src, cek, headers });
        });
    }

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;

        app.on("before-quit", () => this.stopAllServices());

        // put services here
        this.addService(ServiceName.RequestForwarder).start();
        this.addService(ServiceName.MflacProxy).start();
        this.addService(ServiceName.LunaProxy).start();


        ipcMain.handle("@shared/service-manager/mflac-proxy/register-stream", async (event, src, ekey, headers) => {
            assertIpcSender(event, ["main"]);
            this.validateStreamRegistration(src, ekey, headers);
            return this.registerMflacStream(src, ekey, headers);
        });

        ipcMain.handle("@shared/service-manager/luna-proxy/register-stream", async (event, src, cek, headers) => {
            assertIpcSender(event, ["main"]);
            this.validateStreamRegistration(src, cek, headers);
            return this.registerLunaStream(src, cek, headers);
        });

        ipcMain.handle("@shared/service-manager/get-service-hosts", (event) => {
            assertIpcSender(event, ["main"]);
            const serviceHosts: Record<string, string> = {};
            this.serviceMap.forEach((val, key) => {
                if (val.host) {
                    serviceHosts[key] = val.host;
                }
            });
            return serviceHosts;
        });
    }

    private validateStreamRegistration(src: unknown, key: unknown, headers: unknown) {
        assertUrl(src, ["https:", "http:"], 8192);
        assertString(key, "stream key", 16384);
        if (headers == null) {
            return;
        }
        assertIpcPayload(headers, 64 * 1024);
        assertPlainObject(headers, "stream headers");
        for (const [name, value] of Object.entries(headers)) {
            if (
                !/^[A-Za-z0-9-]{1,64}$/.test(name)
                || typeof value !== "string"
                || value.length > 8192
            ) {
                throw new Error("Stream header is not accepted");
            }
        }
    }
}


export default new ServiceManager();
