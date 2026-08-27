/**
 * Utility to strip version and format tags (VO, VP, XLVISION, XVISION, ATMOS, IMAX, Dobrado, Legendado, etc.)
 * from movie titles for display and search.
 */

const FORMAT_TAGS = [
  "XL[- ]?VISION", "X[- ]?VISION", "XL[- ]?VIS[ÃA]O", "X[- ]?VIS[ÃA]O",
  "VO", "VP", "V\\.O\\.", "V\\.P\\.",
  "DOB\\.?", "SUB\\.?", "LEG\\.?", "DOBRADO", "DOBRADA", "LEGENDADO", "LEGENDADA",
  "VERS[ÃA]O\\s+(?:ORIGINAL|PORTUGUESA|DOBRADA|LEGENDADA)",
  "ORIGINAL\\s+VERSION", "PORTUGUESE\\s+VERSION", "DUBBED", "SUBTITLED",
  "AUDIODESCRI[ÇC][ÃA]O", "AUDIO[- ]?DESCRI[ÇC][ÃA]O", "AD",
  "LSE", "LEGENDAGEM\\s+ESPECIAL", "LEGENDA\\s+ESPECIAL", "LEG\\.?\\s+ESPECIAL",
  "SESS[ÃA]O\\s+(?:SENSORIAL|RELAXADA|ESPECIAL|EXCLUSIVA)", "SENSORIAL", "SENSORY(?:[- ]?FRIENDLY)?",
  "RELAXADA", "RELAXED(?:\\s+SCREENING)?",
  "ATMOS", "DOLBY\\s+ATMOS", "DOLBY",
  "IMAX(?:\\s+(?:3D|2D|70MM|LASER))?", "4DX", "4D", "SCREEN[- ]?X",
  "3D(?:\\s+HFR)?", "2D", "HFR", "D[- ]?BOX", "VIP", "ISENSE", "ONYX"
];

const TAG_REGEX_STR = `(?:${FORMAT_TAGS.join("|")})`;
const MULTI_TAG_REGEX_STR = `(?:${TAG_REGEX_STR})(?:\\s*[/\\\\+&,-]\\s*${TAG_REGEX_STR}|\\s+${TAG_REGEX_STR})*`;

export function cleanMovieTitle(title: string): string {
  if (!title) return "";
  let cleaned = title
    // 1. Remove parenthetical/bracketed version & format tags like (VO), (VP), (XL VISION VP), (VP XLVISION), (3D ATMOS), (XLVISION), [IMAX], etc.
    .replace(new RegExp(`\\s*[\\(\\[]\\s*${MULTI_TAG_REGEX_STR}\\s*[\\)\\]]`, "gi"), "")
    // 2. Remove trailing dash-separated version/format tags like - XLVISION VP, - VO, - VP, - Dobrado, - Versão Portuguesa, - XL VISION
    .replace(new RegExp(`\\s*[-–—]\\s*${MULTI_TAG_REGEX_STR}\\s*$`, "gi"), "")
    // 3. Remove standalone trailing version/format tags like Movie VO, Movie VP, Movie XLVISION VP
    .replace(new RegExp(`\\s+\\b${MULTI_TAG_REGEX_STR}\\s*$`, "gi"), "");

  // Normalize multiple spaces and trim
  return cleaned.replace(/\s+/g, " ").trim();
}

