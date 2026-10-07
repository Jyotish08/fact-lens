import type { Passage } from "./types";

function countWords(str: string): number {
  if (!str) return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

interface TextSpan {
  start: number;
  end: number;
  words: number;
}

/**
 * Split text into sentence-level spans with exact start and end offsets.
 */
function splitIntoSentenceSpans(text: string, baseOffset: number): TextSpan[] {
  const spans: TextSpan[] = [];
  // Match sentences ending in ., !, or ? followed by whitespace or end of string
  const sentenceRegex = /[^.!?\r\n]+(?:[.!?]+(?:$|(?=\s)))?/g;
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;

    // Trim leading whitespace
    const leadingWhitespace = rawMatch.match(/^\s*/)?.[0].length || 0;
    // Trim trailing whitespace
    const trailingWhitespace = rawMatch.match(/\s*$/)?.[0].length || 0;

    const start = baseOffset + matchIndex + leadingWhitespace;
    const end = baseOffset + matchIndex + rawMatch.length - trailingWhitespace;

    if (end > start) {
      const sentenceText = text.slice(matchIndex + leadingWhitespace, matchIndex + rawMatch.length - trailingWhitespace);
      const words = countWords(sentenceText);
      if (words > 0) {
        // If a single sentence exceeds 220 words, split on comma or word chunks
        if (words > 220) {
          const subSpans = splitLongSentence(sentenceText, start);
          spans.push(...subSpans);
        } else {
          spans.push({ start, end, words });
        }
      }
    }
  }

  return spans;
}

function splitLongSentence(sentenceText: string, baseOffset: number): TextSpan[] {
  const words = sentenceText.split(/\s+/).filter(Boolean);
  const spans: TextSpan[] = [];
  let currentWordIdx = 0;
  let charIdx = 0;

  while (currentWordIdx < words.length) {
    const chunkWords = words.slice(currentWordIdx, currentWordIdx + 150);
    const chunkWordCount = chunkWords.length;
    const firstWord = chunkWords[0];
    const lastWord = chunkWords[chunkWords.length - 1];
    if (!firstWord || !lastWord) break;

    const startInSub = sentenceText.indexOf(firstWord, charIdx);
    const endInSub = sentenceText.indexOf(lastWord, startInSub) + lastWord.length;

    spans.push({
      start: baseOffset + startInSub,
      end: baseOffset + endInSub,
      words: chunkWordCount,
    });

    currentWordIdx += chunkWordCount;
    charIdx = endInSub;
  }

  return spans;
}

/**
 * Splits cleanedText into atomic spans (paragraphs or sentences) with exact offsets into cleanedText.
 */
function getAtomicSpans(cleanedText: string): TextSpan[] {
  const spans: TextSpan[] = [];
  // Split on double newlines for paragraphs
  const paraRegex = /[^\r\n]+(?:\r?\n[^\r\n]+)*/g;
  let match: RegExpExecArray | null;

  while ((match = paraRegex.exec(cleanedText)) !== null) {
    const rawPara = match[0];
    const matchIndex = match.index;

    const leadingWs = rawPara.match(/^\s*/)?.[0].length || 0;
    const trailingWs = rawPara.match(/\s*$/)?.[0].length || 0;

    const start = matchIndex + leadingWs;
    const end = matchIndex + rawPara.length - trailingWs;

    if (end > start) {
      const paraText = cleanedText.slice(start, end);
      const words = countWords(paraText);

      if (words > 220) {
        // Break long paragraph into sentences
        const sentenceSpans = splitIntoSentenceSpans(paraText, start);
        spans.push(...sentenceSpans);
      } else if (words > 0) {
        spans.push({ start, end, words });
      }
    }
  }

  return spans;
}

function buildContextText(
  allPassages: Array<{ text: string; words: number }>,
  index: number,
  maxWords: number = 450,
): string {
  const curr = allPassages[index];
  if (!curr) return "";

  if (curr.words >= maxWords) {
    return curr.text.split(/\s+/).slice(0, maxWords).join(" ");
  }

  let remaining = maxWords - curr.words;
  let prevText = "";
  let nextText = "";

  const prev = allPassages[index - 1];
  const next = allPassages[index + 1];

  if (prev && next) {
    const half = Math.floor(remaining / 2);
    const prevWords = prev.text.split(/\s+/);
    prevText = prevWords.slice(Math.max(0, prevWords.length - half)).join(" ");
    remaining -= countWords(prevText);

    const nextWords = next.text.split(/\s+/);
    nextText = nextWords.slice(0, remaining).join(" ");
  } else if (prev) {
    const prevWords = prev.text.split(/\s+/);
    prevText = prevWords.slice(Math.max(0, prevWords.length - remaining)).join(" ");
  } else if (next) {
    const nextWords = next.text.split(/\s+/);
    nextText = nextWords.slice(0, remaining).join(" ");
  }

  const parts = [prevText, curr.text, nextText].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Segment cleaned markdown/text into 80-220 word passages with neighbor context.
 * Guaranteed invariant: cleanedText.slice(start, end) === text
 */
export function segmentPassages(docId: string, cleanedText: string): Passage[] {
  if (!cleanedText || !cleanedText.trim()) {
    return [];
  }

  const atomicSpans = getAtomicSpans(cleanedText);
  if (atomicSpans.length === 0) {
    return [];
  }

  const passageSpans: TextSpan[] = [];
  let currentGroup: TextSpan[] = [];
  let currentWords = 0;

  for (const span of atomicSpans) {
    if (currentGroup.length === 0) {
      currentGroup.push(span);
      currentWords = span.words;
      continue;
    }

    if (currentWords + span.words <= 220) {
      currentGroup.push(span);
      currentWords += span.words;
    } else {
      const first = currentGroup[0];
      const last = currentGroup[currentGroup.length - 1];
      const start = first ? first.start : span.start;
      const end = last ? last.end : span.end;

      if (currentWords >= 80) {
        passageSpans.push({
          start,
          end,
          words: currentWords,
        });
        currentGroup = [span];
        currentWords = span.words;
      } else {
        if (currentWords + span.words <= 250) {
          currentGroup.push(span);
          currentWords += span.words;
          const gFirst = currentGroup[0];
          const gLast = currentGroup[currentGroup.length - 1];
          passageSpans.push({
            start: gFirst ? gFirst.start : span.start,
            end: gLast ? gLast.end : span.end,
            words: currentWords,
          });
          currentGroup = [];
          currentWords = 0;
        } else {
          passageSpans.push({
            start,
            end,
            words: currentWords,
          });
          currentGroup = [span];
          currentWords = span.words;
        }
      }
    }
  }

  if (currentGroup.length > 0) {
    const gFirst = currentGroup[0];
    const gLast = currentGroup[currentGroup.length - 1];
    const start = gFirst ? gFirst.start : 0;
    const end = gLast ? gLast.end : 0;

    // If the trailing passage is tiny (<30 words) and there is a previous passage, merge if <= 250 words
    if (passageSpans.length > 0 && currentWords < 30) {
      const prev = passageSpans[passageSpans.length - 1];
      if (prev && prev.words + currentWords <= 250) {
        prev.end = end;
        prev.words += currentWords;
      } else {
        passageSpans.push({
          start,
          end,
          words: currentWords,
        });
      }
    } else {
      passageSpans.push({
        start,
        end,
        words: currentWords,
      });
    }
  }

  // Pre-calculate passage texts
  const passagesDraft = passageSpans.map((span) => ({
    start: span.start,
    end: span.end,
    text: cleanedText.slice(span.start, span.end),
    words: span.words,
  }));

  return passagesDraft.map((draft, idx) => ({
    passageId: `${docId}#p${idx + 1}`,
    docId,
    start: draft.start,
    end: draft.end,
    text: draft.text,
    contextText: buildContextText(passagesDraft, idx, 450),
    relevance: 0,
  }));
}

export function segmentMarkdownPassages(doc: { docId: string; cleanedText: string }): Passage[] {
  return segmentPassages(doc.docId, doc.cleanedText);
}
