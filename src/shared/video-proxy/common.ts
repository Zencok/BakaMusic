export interface IVideoProxySource {
    url: string;
    headers?: Record<string, string>;
    userAgent?: string;
    mimeType?: string;
    backupUrls?: string[];
}

export interface IVideoProxySession {
    id: string;
    url: string;
    downloadUrl: string;
}
