#!/bin/bash

# Collect BakaMusic/libmpv diagnostics on macOS without changing the app.
# Usage:
#   bash collect-macos-libmpv-diagnostics.command [BakaMusic.app]

set -u

umask 077

if [ "$(uname -s 2>/dev/null)" != "Darwin" ]; then
    echo "This diagnostic collector is intended for macOS."
    exit 2
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
desktop_dir="$HOME/Desktop"
report_dir="$desktop_dir/BakaMusic-mac-diagnostics-$timestamp"
archive_path="$report_dir.zip"
mkdir -p "$report_dir"

note() {
    printf '%s\n' "$*"
}

section() {
    printf '\n===== %s =====\n' "$1"
}

find_app() {
    if [ "$#" -gt 0 ] && [ -d "$1" ]; then
        printf '%s\n' "$1"
        return
    fi

    for candidate in \
        "/Applications/BakaMusic.app" \
        "$HOME/Applications/BakaMusic.app" \
        "/Volumes/BakaMusic/BakaMusic.app"
    do
        if [ -d "$candidate" ]; then
            printf '%s\n' "$candidate"
            return
        fi
    done

    if command -v mdfind >/dev/null 2>&1; then
        candidate="$(mdfind 'kMDItemCFBundleIdentifier == "com.zencok.bakamusic"' 2>/dev/null | head -n 1)"
        if [ -n "$candidate" ] && [ -d "$candidate" ]; then
            printf '%s\n' "$candidate"
            return
        fi
    fi

    printf '%s\n' ""
}

app_path="$(find_app "${1:-}")"

note "BakaMusic macOS diagnostic collector"
note "Output: $archive_path"
note "Collection may take about one minute."

{
    section "Collection"
    echo "created_at=$(date '+%Y-%m-%d %H:%M:%S %z')"
    echo "collector_version=1"
    echo "app_path=${app_path:-NOT_FOUND}"

    section "System"
    sw_vers 2>&1
    uname -a 2>&1
    echo "machine_arch=$(uname -m 2>/dev/null)"
    sysctl -n hw.model 2>/dev/null | sed 's/^/hardware_model=/'
    sysctl -n machdep.cpu.brand_string 2>/dev/null | sed 's/^/cpu=/'
    sysctl -n hw.optional.arm64 2>/dev/null | sed 's/^/arm64_supported=/'

    section "Disk"
    df -h "$HOME" 2>&1

    section "BakaMusic processes"
    pgrep -alf 'BakaMusic|libmpv' 2>&1 || true
} > "$report_dir/system.txt"

log_dir="$HOME/Library/Logs/BakaMusic"
mkdir -p "$report_dir/app-logs"
if [ -d "$log_dir" ]; then
    ditto "$log_dir" "$report_dir/app-logs" 2> "$report_dir/app-log-copy-errors.txt" || true
else
    echo "Log directory not found: $log_dir" > "$report_dir/app-log-copy-errors.txt"
fi

{
    echo "BakaMusic unified log excerpt"
    echo "Range: last 30 minutes"
    echo
    log show \
        --last 30m \
        --style compact \
        --info \
        --debug \
        --predicate '(process CONTAINS[c] "BakaMusic") OR (eventMessage CONTAINS[c] "BakaMusic") OR (eventMessage CONTAINS[c] "libmpv") OR (eventMessage CONTAINS[c] "koffi") OR (eventMessage CONTAINS[c] "dyld") OR (eventMessage CONTAINS[c] "code signature") OR (senderImagePath CONTAINS[c] "amfid")' \
        2>&1
} > "$report_dir/unified-log.txt"

diagnostic_dir="$HOME/Library/Logs/DiagnosticReports"
mkdir -p "$report_dir/crash-reports"
if [ -d "$diagnostic_dir" ]; then
    find "$diagnostic_dir" -type f -mtime -2 \
        \( -iname 'BakaMusic*' -o -iname '*Electron*' \) -print \
        > "$report_dir/crash-report-files.txt" 2>&1
    while IFS= read -r crash_file; do
        if [ -f "$crash_file" ]; then
            cp -p "$crash_file" "$report_dir/crash-reports/" 2>/dev/null || true
        fi
    done < "$report_dir/crash-report-files.txt"
fi

if [ -n "$app_path" ]; then
    contents="$app_path/Contents"
    resources="$contents/Resources"
    frameworks="$contents/Frameworks"
    info_plist="$contents/Info.plist"
    app_binary="$contents/MacOS/BakaMusic"

    {
        section "App path"
        echo "$app_path"
        ls -ldO@ "$app_path" 2>&1
        du -sh "$app_path" 2>&1

        section "Info.plist"
        plutil -p "$info_plist" 2>&1

        section "Main executable"
        file "$app_binary" 2>&1

        section "Gatekeeper assessment"
        spctl --assess --type execute --verbose=4 "$app_path" 2>&1
        echo "spctl_exit=$?"

        section "Deep strict signature verification"
        codesign --verify --deep --strict --verbose=4 "$app_path" 2>&1
        echo "codesign_verify_exit=$?"

        section "App signature"
        codesign --display --verbose=4 "$app_path" 2>&1

        section "App entitlements"
        codesign --display --entitlements :- "$app_path" 2>&1

        section "App extended attributes"
        xattr -l "$app_path" 2>&1
    } > "$report_dir/app-verification.txt"

    {
        for helper in "$frameworks"/*.app; do
            if [ ! -d "$helper" ]; then
                continue
            fi
            section "Helper: $helper"
            codesign --verify --strict --verbose=4 "$helper" 2>&1
            echo "verify_exit=$?"
            codesign --display --verbose=4 "$helper" 2>&1
            echo "--- entitlements ---"
            codesign --display --entitlements :- "$helper" 2>&1
            echo "--- attributes ---"
            xattr -l "$helper" 2>&1
        done
    } > "$report_dir/helper-signatures.txt"

    runtime_root="$resources/res/.runtime/mpv"
    runtime_dir=""
    if [ -d "$runtime_root/darwin-$(uname -m)" ]; then
        runtime_dir="$runtime_root/darwin-$(uname -m)"
    elif [ "$(uname -m)" = "arm64" ] && [ -d "$runtime_root/darwin-arm64" ]; then
        runtime_dir="$runtime_root/darwin-arm64"
    elif [ -d "$runtime_root/darwin-x64" ]; then
        runtime_dir="$runtime_root/darwin-x64"
    fi

    {
        section "Runtime root"
        echo "runtime_root=$runtime_root"
        echo "runtime_dir=${runtime_dir:-NOT_FOUND}"
        find "$runtime_root" -type f -print 2>&1 || true

        if [ -n "$runtime_dir" ]; then
            section "runtime.json"
            cat "$runtime_dir/runtime.json" 2>&1

            find "$runtime_dir" -type f \
                \( -name '*.dylib' -o -name 'ffmpeg' -o -name 'ffprobe' \) -print \
                2>/dev/null | while IFS= read -r native_file; do
                    section "Runtime binary: $native_file"
                    file "$native_file" 2>&1
                    echo "--- dependencies ---"
                    otool -L "$native_file" 2>&1
                    echo "--- deployment target ---"
                    if [ -x /usr/bin/vtool ]; then
                        /usr/bin/vtool -show-build "$native_file" 2>&1
                    else
                        otool -l "$native_file" 2>&1 | awk '
                            /cmd LC_BUILD_VERSION/ { capture=1; lines=0 }
                            capture { print; lines++ }
                            capture && lines >= 8 { capture=0 }
                        '
                    fi
                    echo "--- signature verification ---"
                    codesign --verify --strict --verbose=4 "$native_file" 2>&1
                    echo "verify_exit=$?"
                    codesign --display --verbose=4 "$native_file" 2>&1
                    echo "--- attributes ---"
                    xattr -l "$native_file" 2>&1
                done
        fi
    } > "$report_dir/mpv-runtime.txt"

    {
        section "Native addons"
        find "$resources/app.asar.unpacked" -type f -name '*.node' -print 2>&1 || true

        find "$resources/app.asar.unpacked" -type f -name 'koffi.node' -print \
            2>/dev/null | while IFS= read -r koffi_file; do
                section "Koffi addon: $koffi_file"
                file "$koffi_file" 2>&1
                otool -L "$koffi_file" 2>&1
                codesign --verify --strict --verbose=4 "$koffi_file" 2>&1
                echo "verify_exit=$?"
                codesign --display --verbose=4 "$koffi_file" 2>&1
                xattr -l "$koffi_file" 2>&1
            done
    } > "$report_dir/native-addons.txt"
else
    cat > "$report_dir/app-verification.txt" <<'EOF'
BakaMusic.app was not found automatically.
Run the collector with the app path, for example:
  bash collect-macos-libmpv-diagnostics.command /Applications/BakaMusic.app
EOF
fi

cat > "$report_dir/README.txt" <<EOF
BakaMusic macOS/libmpv diagnostic package

Created: $(date '+%Y-%m-%d %H:%M:%S %z')
App: ${app_path:-NOT_FOUND}

Important files:
- app-logs/: BakaMusic electron-log files
- unified-log.txt: recent macOS process/dyld/signature events
- app-verification.txt: app signature and Gatekeeper results
- helper-signatures.txt: Helper/Plugin Helper signatures and entitlements
- mpv-runtime.txt: libmpv dependencies, deployment targets and signatures
- native-addons.txt: Koffi/native addon details
- crash-reports/: recent matching macOS diagnostic reports

Review the package before sharing. Application logs can contain local paths,
media URLs or plugin-generated content.
EOF

if ditto -c -k --sequesterRsrc --keepParent "$report_dir" "$archive_path" 2> "$report_dir/archive-errors.txt"; then
    note "Done: $archive_path"
    open -R "$archive_path" >/dev/null 2>&1 || true
else
    note "Archive creation reported an error. The unpacked report is available at:"
    note "$report_dir"
    open "$report_dir" >/dev/null 2>&1 || true
    exit 1
fi

