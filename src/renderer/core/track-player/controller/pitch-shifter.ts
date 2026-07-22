export const MIN_PITCH_SEMITONES = -12;
export const MAX_PITCH_SEMITONES = 12;
export const PITCH_SHIFTER_PROCESSOR_NAME = "bakamusic-pitch-shifter";
export const PITCH_SHIFTER_PARAMETER_NAME = "semitones";

export function normalizePitchSemitones(semitones: number) {
    if (!Number.isFinite(semitones)) {
        return 0;
    }

    return Math.max(
        MIN_PITCH_SEMITONES,
        Math.min(MAX_PITCH_SEMITONES, Math.round(semitones)),
    );
}

export function semitonesToPitchRatio(semitones: number) {
    return 2 ** (normalizePitchSemitones(semitones) / 12);
}
