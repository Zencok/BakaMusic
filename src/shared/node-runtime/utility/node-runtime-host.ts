import {
    abortDownload,
    downloadFile,
    postprocessDownloadedFile,
} from "@/webworkers/downloader";
import {
    changeWatchPath,
    closeWatcher,
    onAdd,
    onRemove,
    scanDirectories,
    setupWatcher,
} from "@/webworkers/local-file-watcher";

interface RuntimeRequest {
    type: "request";
    requestId: string;
    operation: string;
    payload: any;
}

const parentPort = process.parentPort;

function respond(requestId: string, result?: unknown, error?: unknown) {
    const normalized = error instanceof Error ? error : error ? new Error(String(error)) : null;
    parentPort.postMessage({
        type: "response",
        requestId,
        result,
        error: normalized ? {
            name: normalized.name,
            message: normalized.message,
            stack: normalized.stack,
        } : undefined,
    });
}

async function handleRequest(request: RuntimeRequest) {
    const payload = request.payload ?? {};
    switch (request.operation) {
        case "download-file":
            return downloadFile(
                payload.taskId,
                payload.mediaSource,
                payload.filePath,
                (state) => parentPort.postMessage({
                    type: "download-state",
                    taskId: payload.taskId,
                    state,
                }),
            );
        case "abort-download":
            return abortDownload(payload.taskId, payload.removePartial);
        case "postprocess-download":
            return postprocessDownloadedFile(payload.filePath, payload.payload);
        case "watcher-setup":
            return setupWatcher(payload.initPaths, payload.knownPaths);
        case "watcher-close":
            return closeWatcher();
        case "watcher-change":
            return changeWatchPath(payload.addPaths, payload.removePaths);
        case "watcher-scan":
            return scanDirectories(payload.initPaths, payload.knownPaths);
        default:
            throw new Error("Node runtime operation is not supported");
    }
}

void Promise.all([
    onAdd((musicItems) => {
        parentPort.postMessage({ type: "watcher-add", musicItems });
    }),
    onRemove((filePaths) => {
        parentPort.postMessage({ type: "watcher-remove", filePaths });
    }),
]);

parentPort.on("message", (event) => {
    const request = event.data as RuntimeRequest;
    if (
        request?.type !== "request"
        || typeof request.requestId !== "string"
        || typeof request.operation !== "string"
    ) {
        return;
    }
    void Promise.resolve(handleRequest(request)).then(
        (result) => respond(request.requestId, result),
        (error) => respond(request.requestId, undefined, error),
    );
});
