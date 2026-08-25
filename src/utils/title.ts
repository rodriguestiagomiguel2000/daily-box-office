/**
 * Utility to strip version and format tags (VO, VP, V.O., V.P., Dobrado, Legendado, etc.)
 * from movie titles for display and search.
 */
export function cleanMovieTitle(title: string): string {
  if (!title) return "";
  let cleaned = title
    // Remove parenthetical/bracketed version & format tags like (VO), (VP), (V.O.), (VP/3D), (Versão Portuguesa), etc.
    .replace(/\s*[\(\[]\s*(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))(?:\s*[\/\\]\s*[\w\d]+)?\s*[\)\]]/gi, "")
    // Remove trailing dash-separated version tags like - VO, - VP, - V.O., - Dobrado, - Versão Portuguesa
    .replace(/\s*[-–—]\s*(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))\b/gi, "")
    // Remove standalone trailing version tags like Movie VO, Movie VP, Movie V.O., Movie V.P., Movie Dobrado, Movie Legendado
    .replace(/\s+\b(?:VO|VP|V\.O\.|V\.P\.|Dob\.|Sub\.|Dobrado|Legendado|Vers[ãa]o\s+(?:Original|Portuguesa))\b$/gi, "");

  // Normalize multiple spaces and trim
  return cleaned.replace(/\s+/g, " ").trim();
}
