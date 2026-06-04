// src/qa/triageConstants.js
// Leaf constant shared by triage.js and aiPrivacy.js. Kept import-free on purpose:
// aiPrivacy can use it without importing triage.js, which would otherwise form an
// aiPrivacy → triage → llm → aiPrivacy import cycle.
export const TRIAGE_CATEGORIES = ['object-authz', 'schema-drift', 'sensitive-exposure', 'rate-limit', 'auth-matrix', 'false-positive', 'other'];
