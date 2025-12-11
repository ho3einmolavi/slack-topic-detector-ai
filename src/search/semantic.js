/**
 * Semantic (Vector) search
 */
import { client } from '../../weaviate-setup.js';

/**
 * Perform semantic (vector) search on topics
 * @param {string} query - Search query
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Search results with ranks
 */
export async function semanticSearchTopics(query, limit = 10) {
  console.log(`[semanticSearch] Query: "${query}", Limit: ${limit}`);
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
        _additional { id distance certainty }
      `)
      .withNearText({ concepts: [query] })
      .withLimit(limit)
      .do();

    const topics = (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      vectorRank: index + 1,
      vectorScore: topic._additional?.certainty || (1 - (topic._additional?.distance || 1)),
    }));

    console.log(`[semanticSearch] Found ${topics.length} results`);
    return topics;
  } catch (error) {
    console.error('Semantic search error:', error.message);
    return [];
  }
}
