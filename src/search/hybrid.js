/**
 * Hybrid search (BM25 + Vector)
 */
import { client } from '../../weaviate-setup.js';

/**
 * Perform hybrid search on topics with BM25 and Vector search
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Search results with ranks
 */
export async function hybridSearchTopics(query, limit = 10) {
  console.log(`[hybridSearch] Query: "${query}", Limit: ${limit}`);
  try {
    const result = await client.graphql
      .get()
      .withClassName('Topic')
      .withFields(`
        name
        description
        keywords
        users
        messageCount
        _additional { id score }
      `)
      .withHybrid({
        query: query,
        alpha: 0.5, // Balance between BM25 and Vector
      })
      .withLimit(limit)
      .do();

    const topics = (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      hybridRank: index + 1,
      hybridScore: topic._additional?.score || 0,
    }));

    console.log(`[hybridSearch] Found ${topics.length} results`);
    return topics;
  } catch (error) {
    console.error('Hybrid search error:', error.message);
    return [];
  }
}
