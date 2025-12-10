/**
 * Reciprocal Rank Fusion (RRF) for merging search results
 */
import { RRF_K } from '../config/constants.js';
import { keywordOverlap, fuzzySimilarity, normalizeText } from '../utils/index.js';

/**
 * Reciprocal Rank Fusion to merge multiple search results
 * RRF_score = Σ 1/(k + rank_i)
 * @param {Array<Array>} searchResults - Array of search result arrays
 * @param {number} k - RRF constant (default: 60)
 * @returns {Array} Fused and sorted results
 */
export function reciprocalRankFusion(searchResults, k = RRF_K) {
  const topicScores = new Map();
  const topicData = new Map();
  
  // Process each search result set
  for (const results of searchResults) {
    for (const topic of results) {
      const id = topic._additional?.id;
      if (!id) continue;
      
      // Calculate RRF contribution
      const rank = topic.hybridRank || topic.vectorRank || topic.bm25Rank || 999;
      const rrfScore = 1 / (k + rank);
      
      // Accumulate scores
      const currentScore = topicScores.get(id) || 0;
      topicScores.set(id, currentScore + rrfScore);
      
      // Store topic data (first occurrence wins)
      if (!topicData.has(id)) {
        topicData.set(id, {
          id,
          name: topic.name,
          description: topic.description,
          keywords: topic.keywords || [],
          users: topic.users || [],
          sampleMessages: topic.sampleMessages || [],
          messageCount: topic.messageCount || 0,
          ranks: {},
        });
      }
      
      // Track individual ranks for debugging
      const data = topicData.get(id);
      if (topic.hybridRank) data.ranks.hybrid = topic.hybridRank;
      if (topic.vectorRank) data.ranks.vector = topic.vectorRank;
      if (topic.bm25Rank) data.ranks.bm25 = topic.bm25Rank;
    }
  }
  
  // Sort by RRF score
  const sortedTopics = Array.from(topicScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id, rrfScore]) => ({
      ...topicData.get(id),
      rrfScore,
    }));
  
  return sortedTopics;
}

/**
 * Calculate final confidence score using weighted factors
 * @param {Object} topic - Topic object with rrfScore
 * @param {string} query - Original search query
 * @param {Array<string>} messageKeywords - Extracted message keywords
 * @returns {Object} Confidence score and factors
 */
export function calculateConfidence(topic, query, messageKeywords) {
  const topicKeywords = topic.keywords || [];
  
  // Factor 1: RRF score (normalized to 0-1)
  const rrfNormalized = Math.min(topic.rrfScore * 20, 1);
  
  // Factor 2: Keyword overlap
  const kwOverlap = keywordOverlap(messageKeywords, topicKeywords);
  
  // Factor 3: Name similarity
  const nameSimilarity = fuzzySimilarity(query, topic.name);
  
  // Factor 4: Recency boost (more messages = more active)
  const recencyBoost = Math.min((topic.messageCount || 0) / 50, 1);
  
  // Weighted average
  const confidence = 
    (rrfNormalized * 0.4) +
    (kwOverlap * 0.3) +
    (nameSimilarity * 0.2) +
    (recencyBoost * 0.1);
  
  return {
    confidence,
    factors: {
      rrfScore: rrfNormalized,
      keywordOverlap: kwOverlap,
      nameSimilarity,
      recencyBoost,
    },
  };
}

/**
 * Build human-readable match reasons
 * @param {Object} factors - Confidence factors
 * @param {Object} topic - Topic object
 * @param {Array<string>} messageKeywords - Message keywords
 * @returns {Array<string>} Match reasons
 */
export function buildMatchReasons(factors, topic, messageKeywords) {
  const reasons = [];
  
  if (factors.rrfScore > 0.5) reasons.push('semantic_match');
  if (factors.keywordOverlap > 0.3) {
    const overlapping = (topic.keywords || [])
      .filter(k => messageKeywords.some(mk => 
        normalizeText(k) === normalizeText(mk) || fuzzySimilarity(k, mk) > 0.8
      ));
    if (overlapping.length > 0) {
      reasons.push(`keyword_overlap:${overlapping.slice(0, 3).join(',')}`);
    }
  }
  if (factors.nameSimilarity > 0.4) reasons.push('name_similarity');
  if (factors.recencyBoost > 0.5) reasons.push('high_activity');
  
  return reasons.length > 0 ? reasons : ['partial_match'];
}

/**
 * Generate action recommendation based on matches
 * @param {Array} matches - Scored matches
 * @returns {Object} Recommendation
 */
export function generateRecommendation(matches) {
  if (matches.length === 0) {
    return {
      action: 'create',
      confidence: 0,
      reason: 'No existing topics found - create a new specific topic',
    };
  }

  const bestMatch = matches[0];
  
  if (bestMatch.confidence >= 0.80) {
    return {
      action: 'assign',
      confidence: bestMatch.confidence,
      suggested_topic_id: bestMatch.id,
      suggested_topic_name: bestMatch.name,
      reason: `High confidence match with "${bestMatch.name}"`,
    };
  } else if (bestMatch.confidence >= 0.50) {
    return {
      action: 'review',
      confidence: bestMatch.confidence,
      suggested_topic_id: bestMatch.id,
      suggested_topic_name: bestMatch.name,
      reason: `Possible match with "${bestMatch.name}" - review context to decide`,
    };
  } else {
    return {
      action: 'create',
      confidence: bestMatch.confidence,
      reason: `Low confidence matches - consider creating a new specific topic`,
    };
  }
}
