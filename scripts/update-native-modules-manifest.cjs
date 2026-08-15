/**
 * Pin scripts/native-modules-manifest.json to a published baka-native release.
 *
 *   node scripts/update-native-modules-manifest.cjs
 *   node scripts/update-native-modules-manifest.cjs --manifest-url=https://github.com/.../native-manifest-v1.json
 *   node scripts/update-native-modules-manifest.cjs --release=native-electron-43.4.0-<sha>
 *
 * TagLib is whatever version that release built (native CI defaults to GitHub latest).
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const destination = path.join(__dirname, "native-modules-manifest.json");
const repository = "Zencok/baka-native";
const requiredTargets = [
    "win32-x64",
    "darwin-x64",
    "darwin-arm64",
    "linux-x64",
    "linux-arm64",
];
const requiredModules = ["qmc2", "ence", "taglib", "transcode"];

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function authHeaders() {
    const token = process.env.NATIVE_REPO_TOKEN
        || process.env.GH_TOKEN
        || process.env.GITHUB_TOKEN;
    return token
        ? {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "user-agent": "BakaMusic native manifest updater",
        }
        : {
            accept: "application/vnd.github+json",
            "user-agent": "BakaMusic native manifest updater",
        };
}

async function fetchJson(url) {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
        throw new Error(`Request failed (${response.status}): ${url}`);
    }
    const text = await response.text();
    return {
        digest: crypto.createHash("sha256").update(text).digest("hex"),
        value: JSON.parse(text),
    };
}

function releaseAssetTarget(url) {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/
        .exec(url);
    if (!match) {
        return null;
    }
    const [, owner, repo, tag, fileName] = match;
    return { owner, repo, tag, fileName: decodeURIComponent(fileName) };
}

/**
 * baka-native is private, and private release assets are unreachable through the
 * github.com/<owner>/<repo>/releases/download/... web path: that route ignores
 * bearer tokens and always answers 404. Assets must be pulled from the REST API
 * asset endpoint with an octet-stream accept header instead. Public repositories
 * still work either way, so the canonical download URL stays the recorded one.
 */
async function fetchReleaseAssetJson(url) {
    const target = releaseAssetTarget(url);
    if (!target) {
        return fetchJson(url);
    }
    const release = await fetchJson(
        `https://api.github.com/repos/${target.owner}/${target.repo}`
        + `/releases/tags/${encodeURIComponent(target.tag)}`,
    );
    const asset = (release.value.assets || []).find((item) => item.name === target.fileName);
    assert(asset?.url, `Release asset not found: ${target.fileName} in ${target.tag}`);
    const assetUrl = new URL(asset.url);
    assert(assetUrl.protocol === "https:" && assetUrl.hostname === "api.github.com",
        `Release asset URL is outside the GitHub API: ${asset.url}`);

    const response = await fetch(asset.url, {
        headers: { ...authHeaders(), accept: "application/octet-stream" },
    });
    if (!response.ok) {
        throw new Error(`Request failed (${response.status}): ${url}`);
    }
    const text = await response.text();
    return {
        digest: crypto.createHash("sha256").update(text).digest("hex"),
        value: JSON.parse(text),
    };
}

function isNativeRelease(value) {
    return !value.draft
        && !value.prerelease
        && typeof value.tag_name === "string"
        && /^native-/.test(value.tag_name);
}

function appElectronVersion() {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
        );
        return String(pkg.devDependencies?.electron || "").replace(/^[^\d]*/, "");
    } catch {
        return "";
    }
}

/**
 * Fields that describe the developer prebuilt tree rather than the pinned
 * release, so the upstream manifest never carries them. Carried over instead of
 * being dropped on every automated update.
 */
function localAnnotations() {
    try {
        const current = JSON.parse(fs.readFileSync(destination, "utf8"));
        return {
            devPrebuilt: current.devPrebuilt,
            notes: current.notes,
        };
    } catch {
        return {};
    }
}

async function resolveManifestUrl() {
    const explicit = process.argv.find((arg) => arg.startsWith("--manifest-url="));
    if (explicit) {
        return explicit.slice("--manifest-url=".length);
    }
    const releaseArg = process.argv.find((arg) => arg.startsWith("--release="));
    if (releaseArg) {
        const tag = releaseArg.slice("--release=".length);
        return `https://github.com/${repository}/releases/download/${tag}/native-manifest-v1.json`;
    }

    const releases = await fetchJson(
        `https://api.github.com/repos/${repository}/releases?per_page=50`,
    );
    const candidates = releases.value.filter(isNativeRelease);
    assert(candidates.length > 0, "No published baka-native release found");
    for (const release of candidates) {
        const manifestUrl = `https://github.com/${repository}/releases/download/`
            + `${release.tag_name}/native-manifest-v1.json`;
        try {
            const manifest = await fetchReleaseAssetJson(manifestUrl);
            if (manifest.value.complete === true && manifest.value.phase === "complete") {
                return manifestUrl;
            }
            console.warn(
                `[native-manifest] skipping ${release.tag_name}: `
                + `complete=${manifest.value.complete} phase=${manifest.value.phase}`,
            );
        } catch (error) {
            // Staged release, missing manifest asset, or a transient API failure.
            console.warn(
                `[native-manifest] skipping ${release.tag_name}: ${error.message}`,
            );
        }
    }
    throw new Error("No complete baka-native release is available");
}

async function main() {
    const manifestUrl = await resolveManifestUrl();
    const parsedUrl = new URL(manifestUrl);
    assert(parsedUrl.protocol === "https:" && parsedUrl.hostname === "github.com",
        "Manifest must use GitHub HTTPS");
    assert(parsedUrl.pathname.startsWith(`/${repository}/releases/download/`),
        "Manifest URL is outside baka-native releases");
    assert(parsedUrl.pathname.endsWith("/native-manifest-v1.json"),
        "Unexpected manifest asset name");

    const { digest, value } = await fetchReleaseAssetJson(manifestUrl);
    assert(value.schemaVersion === 1, "Unsupported schemaVersion");
    assert(value.complete === true && value.phase === "complete", "Release is not complete");
    assert(value.repository === repository, "Unexpected repository field");
    assert(
        typeof value.taglib === "string" && /^\d+\.\d+(\.\d+)?$/.test(value.taglib),
        "Unexpected TagLib version in release manifest",
    );
    assert(Array.isArray(value.modules), "modules missing");
    for (const mod of requiredModules) {
        assert(value.modules.includes(mod), `module ${mod} missing from manifest`);
    }

    const appElectron = appElectronVersion();
    if (appElectron && value.electron && value.electron !== appElectron) {
        console.warn(
            `[native-manifest] warning: release electron=${value.electron} `
            + `but package.json electron=${appElectron}`,
        );
    }

    for (const target of requiredTargets) {
        const artifact = value.platforms?.[target];
        assert(artifact, `Missing platform ${target}`);
        assert(/^[a-f0-9]{64}$/.test(artifact.sha256), `Invalid sha256 for ${target}`);
        assert(Number.isSafeInteger(artifact.size) && artifact.size > 1000,
            `Invalid size for ${target}`);
        assert(artifact.status === "verified", `${target} is not verified`);
        const url = new URL(artifact.url);
        assert(url.protocol === "https:" && url.hostname === "github.com");
        assert(
            url.pathname.startsWith(`/${repository}/releases/download/${value.release}/`),
            `Artifact URL outside release ${value.release}`,
        );
        for (const mod of requiredModules) {
            assert(artifact.modules?.[mod]?.sha256, `${target} missing module digest ${mod}`);
        }
    }

    const annotations = localAnnotations();
    const pinned = {
        schemaVersion: 1,
        complete: true,
        phase: "complete",
        release: value.release,
        repository: value.repository,
        electron: value.electron,
        taglib: value.taglib,
        taglibPolicy: value.taglibPolicy || "latest-at-build",
        modules: requiredModules,
        sourceCommit: value.sourceCommit || null,
        license: value.license,
        platforms: Object.fromEntries(
            requiredTargets.map((target) => [target, value.platforms[target]]),
        ),
        generatedAt: value.generatedAt,
        devPrebuilt: annotations.devPrebuilt,
        notes: annotations.notes,
        releaseManifest: {
            url: manifestUrl,
            sha256: digest,
        },
        updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(destination, `${JSON.stringify(pinned, null, 2)}\n`, "utf8");
    console.log(`[native-manifest] pinned release ${pinned.release}`);
    console.log(`[native-manifest] taglib=${pinned.taglib} electron=${pinned.electron}`);
    console.log(`[native-manifest] wrote ${destination}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
