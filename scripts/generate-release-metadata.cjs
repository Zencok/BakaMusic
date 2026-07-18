const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const inputDir = path.resolve(args.find((arg) => !arg.startsWith("--")) || "release-assets");
const outputIndex = args.indexOf("--output");
const outputPath = path.resolve(
    outputIndex >= 0 && args[outputIndex + 1]
        ? args[outputIndex + 1]
        : path.join(inputDir, "SHA256SUMS.txt"),
);

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

if (!fs.existsSync(inputDir)) {
    throw new Error(`release asset directory is missing: ${inputDir}`);
}

const files = walk(inputDir)
    .filter((filePath) => path.resolve(filePath) !== outputPath)
    .sort((left, right) => left.localeCompare(right, "en"));

if (files.length === 0) {
    throw new Error(`no release assets found in ${inputDir}`);
}

const lines = files.map((filePath) => {
    const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    const relativePath = path.relative(inputDir, filePath).replaceAll("\\", "/");
    return `${digest}  ${relativePath}`;
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`release-metadata: wrote ${lines.length} checksums to ${outputPath}`);
