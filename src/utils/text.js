/**
 * Text processing utilities
 */
import { TEXT_PREVIEW_LENGTH, ABBREVIATIONS, STOP_WORDS } from '../config/constants.js';

/**
 * Calculate minutes between two timestamps
 * @param {string} ts1 - First timestamp
 * @param {string} ts2 - Second timestamp
 * @returns {number} Minutes difference
 */
export const getMinutesBetween = (ts1, ts2) => 
  Math.round((parseFloat(ts1) - parseFloat(ts2)) / 60);

/**
 * Truncate text to a maximum length
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export const truncate = (text, maxLength = TEXT_PREVIEW_LENGTH) => {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
};

/**
 * Normalize text for comparison
 * - Converts to lowercase
 * - Expands abbreviations
 * - Removes special characters
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
export function normalizeText(text) {
  if (!text) return '';
  let normalized = text.toLowerCase().trim();
  
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    normalized = normalized.replace(regex, full);
  }
  
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Extract keywords from text
 * @param {string} text - Text to extract keywords from
 * @returns {Array<string>} Extracted keywords
 */
export function extractKeywords(text) {
  if (!text) return [];
  
  const words = normalizeText(text)
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
  
  const freq = {};
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1;
  }
  
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}
