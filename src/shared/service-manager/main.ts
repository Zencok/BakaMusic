import { ChildProcess, fork } from "child_process";
import { app, ipcMain } from "electron";
import { IWindowManager } from "@/types/main/window-manager";
import { ServiceName } from "@shared/service-manager/common";
import getResourcePath from "@/common/get-resource-path";
import logger from "@shared/logger/main";


class ServiceInstance {
    public serviceProcess: ChildProcess = null;
    private retryTimeOut = 6000;
    private started = false;
    private subprocessName: string;

    private hostChangeCallback: (host: string | null) => void;

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
        const servicePath = getResourcePath(".service/" + this.subprocessName + ".js");
        this.serviceProcess = fork(servicePath);

        interface IMessage {
            type: "port",
            port: number
        }

        this.serviceProcess.on("message", (msg: IMessage) => {
            if (msg.type !== "port") {
                return;
            }
            const host = "http://127.0.0.1:" + msg.port;
            this.hostChangeCallback(host);
        });

        this.serviceProcess.on("error", (err) => {
            if (this.started) {
                logger.logInfo(`[${this.serviceName}] Process error: ${err?.message}. Restarting in ${this.retryTimeOut}ms...`);
                this.scheduleRestart();
            }
        });

        this.serviceProcess.on("exit", (code) => {
            if (this.started) {
                logger.logInfo(`[${this.serviceName}] Exited with code ${code}. Restarting in ${this.retryTimeOut}ms...`);
                this.scheduleRestart();
            }
        });
    }

    private scheduleRestart() {
        setTimeout(() => {
            if (this.started) {
                this.spawnProcess();
            }
        }, this.retryTimeOut);
        this.retryTimeOut = Math.min(this.retryTimeOut * 2, 300000);
    }

    stop() {
        this.started = false;
        if (!this.serviceProcess.killed) {
            this.serviceProcess.removeAllListeners();
            this.serviceProcess.kill();
            this.serviceProcess = null;
            this.retryTimeOut = 6000;
            this.hostChangeCallback(null);
        }
    }
}

interface IServiceData {
    instance: ServiceInstance;
    host: string | null;
}

class ServiceManager {
    private windowManager: IWindowManager;
    private serviceMap = new Map<ServiceName, IServiceData>();


    private addService(serviceName: ServiceName) {
        const instance = new ServiceInstance(serviceName, serviceName);
        this.serviceMap.set(serviceName, { instance, host: null });
        instance.onHostChange((host) => {
            const mainWindow = this.windowManager?.mainWindow;
            if (mainWindow) {
                mainWindow.webContents.send("@shared/service-manager/host-changed", serviceName, host);
            }
            this.serviceMap.get(serviceName).host = host;
        });

        return instance;
    }

    startService(serviceName: ServiceName) {
        this.serviceMap.get(serviceName)?.instance?.start?.();
    }

    stopService(serviceName: ServiceName) {
        this.serviceMap.get(serviceName)?.instance?.stop?.();
    }

    /** Register a stream with the mflac-proxy service (callable from main process) */
    registerMflacStream(src: string, ekey: string, headers?: Record<string, string>): Promise<string | null> {
        const serviceData = this.serviceMap.get(ServiceName.MflacProxy);
        if (!serviceData?.instance) {
            logger.logInfo("[mflac-proxy] Service not found");
            return Promise.resolve(null);
        }
        const cp = serviceData.instance.serviceProcess;
        if (!cp || cp.killed) {
            logger.logInfo("[mflac-proxy] Service process not running");
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                logger.logInfo("[mflac-proxy] Registration timed out");
                cp.removeListener("message", handler);
                resolve(null);
            }, 5000);

            const handler = (msg: any) => {
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
            cp.send({ type: "register", src, ekey, headers });
        });
    }

    setup(windowManager: IWindowManager) {
        this.windowManager = windowManager;

        app.on("before-quit", () => {
            if (!windowManager.mainWindow?.isDestroyed()) {
                this.serviceMap.forEach((val) => {
                    val.instance.stop();
                });
            }
        });

        // put services here
        this.addService(ServiceName.RequestForwarder).start();
        this.addService(ServiceName.MflacProxy).start();


        ipcMain.handle("@shared/service-manager/mflac-proxy/register-stream", async (_, src, ekey, headers) => {
            return this.registerMflacStream(src, ekey, headers);
        });

        ipcMain.handle("@shared/service-manager/get-service-hosts", () => {
            const serviceHosts: Record<string, string> = {};
            this.serviceMap.forEach((val, key) => {
                if (val.host) {
                    serviceHosts[key] = val.host;
                }
            });
            return serviceHosts;
        });


    }
}


export default new ServiceManager();
