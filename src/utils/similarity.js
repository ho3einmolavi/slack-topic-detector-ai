/**
 * Similarity and distance calculation utilities
 */
import { normalizeText } from './text.js';

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Calculate fuzzy similarity between two strings (0-1)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1)
 */
export function fuzzySimilarity(str1, str2) {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0;
  
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  
  const distance = levenshteinDistance(s1, s2);
  return 1 - (distance / maxLen);
}

/**
 * Calculate keyword overlap between two keyword arrays
 * @param {Array<string>} keywords1 - First keywords array
 * @param {Array<string>} keywords2 - Second keywords array
 * @returns {number} Overlap score (0-1)
 */
export function keywordOverlap(keywords1, keywords2) {
  if (!keywords1?.length || !keywords2?.length) return 0;
  
  const set1 = new Set(keywords1.map(k => normalizeText(k)));
  const set2 = new Set(keywords2.map(k => normalizeText(k)));
  
  let matches = 0;
  for (const k1 of set1) {
    for (const k2 of set2) {
      if (k1 === k2 || fuzzySimilarity(k1, k2) > 0.8) {
        matches++;
        break;
      }
    }
  }
  
  const unionSize = new Set([...set1, ...set2]).size;
  return matches / unionSize;
}
