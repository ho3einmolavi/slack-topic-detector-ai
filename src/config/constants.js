/**
 * Application constants and configuration
 */

export const CONVERSATION_TIMEOUT_MINUTES = 10;
export const TEXT_PREVIEW_LENGTH = 150;
export const MAX_TOPICS_LIMIT = 50;
export const RRF_K = 60; // Reciprocal Rank Fusion constant

export const MODEL = 'gpt-4o';

export const TOPIC_FIELDS = `
  name
  description
  keywords
  users
  combinedSearchText
  messageCount
  _additional { id }
`;

export const MESSAGE_WITH_TOPIC_FIELDS = `
  text
  user
  userName
  timestamp
  topic {
    ... on Topic {
      name
      users
      _additional { id }
    }
  }
`;

/**
 * Common abbreviations for text normalization
 */
export const ABBREVIATIONS = {
  'db': 'database',
  'k8s': 'kubernetes',
  'auth': 'authentication',
  'api': 'application programming interface',
  'ui': 'user interface',
  'ux': 'user experience',
  'fe': 'frontend',
  'be': 'backend',
  'devops': 'development operations',
  'ci': 'continuous integration',
  'cd': 'continuous deployment',
  'pr': 'pull request',
  'mr': 'merge request',
  'env': 'environment',
  'config': 'configuration',
  'infra': 'infrastructure',
  'perf': 'performance',
  'prod': 'production',
  'dev': 'development',
  'qa': 'quality assurance',
};

/**
 * Stop words for keyword extraction
 */
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
  'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
  'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and',
  'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at',
  'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up',
  'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'here', 'there', 'ok', 'okay', 'yes', 'no', 'حله', 'اوکی',
]);
