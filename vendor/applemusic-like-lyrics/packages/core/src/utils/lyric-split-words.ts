import type { LyricWord } from "../interfaces.ts";
import { isCJK } from "./is-cjk.ts";

const hasSegmenter =
	typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined";

/**
 * 将输入的单词重新分组，之间没有空格的单词将会组合成一个单词数组
 *
 * 例如输入：`["Life", " ", "is", " a", " su", "gar so", "sweet"]`
 *
 * 应该返回：`["Life", " ", "is", " a", [" su", "gar"], "so", "sweet"]`
 * @param words 输入的单词数组
 * @returns 重新分组后的单词数组
 */
export function chunkAndSplitLyricWords(
	words: LyricWord[],
): (LyricWord | LyricWord[])[] {
	const atoms: LyricWord[] = [];

	for (const w of words) {
		const content = w.word.trim();
		const isSpace = content.length === 0;
		const romanWord = w.romanWord ?? "";
		const obscene = w.obscene ?? false;
		const hasRuby = (w.ruby?.length ?? 0) > 0;

		if (isSpace) {
			atoms.push({ ...w });
			continue;
		}
		if (hasRuby) {
			atoms.push({ ...w });
			continue;
		}

		const parts = w.word.split(/(\s+)/).filter((p) => p.length > 0);

		let currentOffset = 0;
		const totalLength = w.word.replace(/\s/g, "").length || 1;

		for (const part of parts) {
			if (!part.trim()) {
				const startTime =
					w.startTime +
					(currentOffset / totalLength) * (w.endTime - w.startTime);

				atoms.push({
					word: part,
					romanWord: "",
					startTime: startTime,
					endTime: startTime,
					obscene: obscene,
				});
				continue;
			}

			if (isCJK(part) && part.length > 1 && romanWord.trim().length === 0) {
				const chars = part.split("");
				for (const char of chars) {
					const charDuration = (1 / totalLength) * (w.endTime - w.startTime);
					const startTime =
						w.startTime +
						(currentOffset / totalLength) * (w.endTime - w.startTime);
					atoms.push({
						word: char,
						romanWord: "",
						startTime: startTime,
						endTime: startTime + charDuration,
						obscene: obscene,
					});
					currentOffset += 1;
				}
			} else {
				const partRealLen = part.length;
				const duration =
					(partRealLen / totalLength) * (w.endTime - w.startTime);
				const startTime =
					w.startTime +
					(currentOffset / totalLength) * (w.endTime - w.startTime);

				atoms.push({
					word: part,
					romanWord: romanWord,
					startTime: startTime,
					endTime: startTime + duration,
					obscene: obscene,
				});
				currentOffset += partRealLen;
			}
		}
	}

	if (!hasSegmenter) {
		return atoms;
	}

	const fullText = atoms.map((a) => a.word).join("");
	const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
	const segments = Array.from(segmenter.segment(fullText));

	const result: (LyricWord | LyricWord[])[] = [];
	let atomIndex = 0;
	let expectedLength = 0;
	let actualLength = 0;
	let currentGroup: LyricWord[] = [];

	for (const segment of segments) {
		const segmentLen = segment.segment.length;
		expectedLength += segmentLen;

		while (actualLength < expectedLength && atomIndex < atoms.length) {
			const currentAtom = atoms[atomIndex];
			currentGroup.push(currentAtom);
			actualLength += currentAtom.word.length;
			atomIndex++;
		}

		if (actualLength === expectedLength) {
			while (currentGroup.length > 1 && !currentGroup[0].word.trim()) {
				const spaceAtom = currentGroup.shift();
				if (spaceAtom) {
					result.push(spaceAtom);
				}
			}

			if (currentGroup.length === 1) {
				result.push(currentGroup[0]);
			} else if (currentGroup.length > 1) {
				result.push(currentGroup);
			}
			currentGroup = [];
		}
	}

	while (atomIndex < atoms.length) {
		result.push(atoms[atomIndex++]);
	}

	if (currentGroup.length > 0) {
		if (currentGroup.length === 1) {
			result.push(currentGroup[0]);
		} else {
			result.push(currentGroup);
		}
	}

	return result;
}
