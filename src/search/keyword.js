/**
 * Keyword (BM25) search
 */
import { client } from '../../weaviate-setup.js';

/**
 * Perform keyword (BM25) search on topics
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Search results with ranks
 */
export async function keywordSearchTopics(query, limit = 10) {
  console.log(`[keywordSearch] Query: "${query}", Limit: ${limit}`);
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
      .withBm25({
        query: query,
        properties: ['combinedSearchText'],
      })
      .withLimit(limit)
      .do();

    const topics = (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      bm25Rank: index + 1,
      bm25Score: topic._additional?.score || 0,
    }));

    console.log(`[keywordSearch] Found ${topics.length} results`);
    return topics;
  } catch (error) {
    console.error('Keyword search error:', error.message);
    return [];
  }
}
