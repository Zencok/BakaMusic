const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const destination = path.join(__dirname, "media-runtime-manifest.json");
const repository = "Zencok/mpv-libre-runtime";
const requiredTargets = [
    "win32-x64",
    "darwin-x64",
    "darwin-arm64",
    "linux-x64",
    "linux-arm64",
];

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function fetchJson(url) {
    const authorization = process.env.GITHUB_TOKEN
        ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {};
    const response = await fetch(url, {
        headers: {
            accept: "application/vnd.github+json",
            "user-agent": "BakaMusic runtime manifest updater",
            ...authorization,
        },
    });
    if (!response.ok) {
        throw new Error(`Manifest request failed (${response.status}): ${url}`);
    }
    const text = await response.text();
    return {
        digest: crypto.createHash("sha256").update(text).digest("hex"),
        value: JSON.parse(text),
    };
}

function isRuntimeRelease(value) {
    return !value.draft
        && !value.prerelease
        && typeof value.tag_name === "string"
        && /^runtime-mpv-[A-Za-z0-9._-]+$/.test(value.tag_name);
}

function validateArtifact(target, artifact, release) {
    assert(artifact && typeof artifact === "object", `Missing ${target} artifact`);
    assert(/^[a-f0-9]{64}$/.test(artifact.sha256), `Invalid ${target} SHA-256`);
    assert(Number.isSafeInteger(artifact.size) && artifact.size > 1_000_000,
        `Invalid ${target} artifact size`);
    assert(artifact.status === "verified", `${target} runtime is not verified`);
    const url = new URL(artifact.url);
    assert(url.protocol === "https:" && url.hostname === "github.com",
        `Invalid ${target} artifact origin`);
    assert(
        url.pathname.startsWith(`/${repository}/releases/download/${release}/`),
        `Artifact URL is outside release ${release}`,
    );
}

async function resolveManifestUrl() {
    const explicit = process.argv.find((argument) => argument.startsWith("--manifest-url="));
    if (explicit) {
        return explicit.slice("--manifest-url=".length);
    }
    const releases = await fetchJson(
        `https://api.github.com/repos/${repository}/releases?per_page=100`,
    );
    const candidates = releases.value.filter(isRuntimeRelease);
    assert(candidates.length > 0, "No published mpv-libre-runtime release found");
    for (const release of candidates) {
        const manifestUrl = `https://github.com/${repository}/releases/download/`
            + `${release.tag_name}/runtime-manifest-v1.json`;
        try {
            const manifest = await fetchJson(manifestUrl);
            if (manifest.value.complete === true && manifest.value.phase === "complete") {
                return manifestUrl;
            }
        } catch {
            // A staged release may not have its manifest asset yet.
        }
    }
    throw new Error("No complete mpv-libre-runtime release is available");
}

async function main() {
    const manifestUrl = await resolveManifestUrl();
    const parsedUrl = new URL(manifestUrl);
    assert(parsedUrl.protocol === "https:" && parsedUrl.hostname === "github.com",
        "Runtime manifest must use GitHub HTTPS");
    assert(parsedUrl.pathname.startsWith(`/${repository}/releases/download/`),
        "Runtime manifest URL is outside the runtime repository");
    assert(parsedUrl.pathname.endsWith("/runtime-manifest-v1.json"),
        "Runtime manifest URL has an unexpected asset name");

    const { digest, value } = await fetchJson(manifestUrl);
    assert(value.schemaVersion === 1, "Unsupported runtime manifest schema");
    assert(value.complete === true && value.phase === "complete",
        "Runtime release is not complete");
    assert(value.engine === "libmpv", "Unexpected playback engine");
    assert(value.mediaBackend === "librempeg", "Unexpected media backend");
    assert(value.license === "AGPL-3.0-or-later", "Unexpected runtime license");
    assert(typeof value.release === "string" && value.release.length > 0,
        "Runtime release is missing");
    const releasePathPrefix = `/${repository}/releases/download/`;
    const releaseFromUrl = decodeURIComponent(parsedUrl.pathname)
        .slice(releasePathPrefix.length)
        .split("/", 1)[0];
    assert(value.release === releaseFromUrl, "Runtime release tag does not match manifest URL");
    assert(value.sources && typeof value.sources === "object", "Runtime sources are missing");
    for (const source of ["mpv", "librempeg", "libplacebo"]) {
        assert(/^[a-f0-9]{40}$/.test(value.sources[source]?.commit),
            `Invalid ${source} source commit`);
    }

    const platforms = {};
    for (const target of requiredTargets) {
        const artifact = value.artifacts?.[target];
        validateArtifact(target, artifact, value.release);
        const expectedPrefix = `mpv-libre-runtime-${target}.`;
        assert(new URL(artifact.url).pathname.endsWith(
            `/${expectedPrefix}7z`,
        ) || new URL(artifact.url).pathname.endsWith(
            `/${expectedPrefix}tar.xz`,
        ), `Unexpected ${target} artifact name`);
        platforms[target] = {
            url: artifact.url,
            sha256: artifact.sha256,
            size: artifact.size,
            status: artifact.status,
        };
    }
    const sourceCommits = Object.fromEntries(Object.entries(value.sources)
        .filter(([, source]) => /^[a-f0-9]{40}$/.test(source?.commit))
        .map(([name, source]) => [name, source.commit]));
    const next = {
        mpv: {
            version: `mpv-${value.sources.mpv.commit.slice(0, 10)}`
                + `.librempeg-${value.sources.librempeg.commit.slice(0, 10)}`
                + `.libplacebo-${value.sources.libplacebo.commit.slice(0, 10)}`,
            build: value.release,
            releaseManifest: {
                url: manifestUrl,
                sha256: digest,
            },
            engine: value.engine,
            mediaBackend: value.mediaBackend,
            decoders: ["ac4"],
            sourceCommits,
            platforms,
        },
    };
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    if (fs.existsSync(destination) && fs.readFileSync(destination, "utf8") === serialized) {
        console.log(`Runtime manifest already pins ${value.release}.`);
        return;
    }
    fs.writeFileSync(destination, serialized, "utf8");
    console.log(`Pinned ${value.release} from ${manifestUrl}.`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
