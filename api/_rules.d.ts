// Types for the plain-JS allow-list, which stays JS because it runs in a
// serverless function. src/__tests__/shared-memory.test.ts imports it to
// assert it matches the rules the lenses actually emit.
export declare const KNOWN_RULE_IDS: string[]
export declare const KNOWN_RULE_SET: Set<string>
