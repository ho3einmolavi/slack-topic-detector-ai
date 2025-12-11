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

    return (result.data?.Get?.Topic || []).map((topic, index) => ({
      ...topic,
      vectorRank: index + 1,
      vectorScore: topic._additional?.certainty || (1 - (topic._additional?.distance || 1)),
    }));
  } catch (error) {
    console.error('Semantic search error:', error.message);
    return [];
  }
}
