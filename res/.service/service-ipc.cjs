"use strict";

const parentPort = process.parentPort;

function send(message) {
    if (parentPort) {
        parentPort.postMessage(message);
        return;
    }
    process.send?.(message);
}

function onMessage(listener) {
    if (parentPort) {
        parentPort.on("message", (event) => listener(event.data));
        return;
    }
    process.on("message", listener);
}

module.exports = {
    onMessage,
    send,
};
