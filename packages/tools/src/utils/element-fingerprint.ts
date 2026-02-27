// ─── Adaptive Element Tracking ─────────────────────────────────────
// Captures "fingerprints" of HTML elements and uses similarity algorithms
// to re-locate them when the page structure changes. Inspired by Scrapling's
// adaptive scraping engine, adapted for TypeScript/Node.js.

import { createHash } from 'node:crypto';

// ─── Types ─────────────────────────────────────

export interface ElementFingerprint {
  id: string;
  url: string;
  selector: string;
  tag: string;
  attributes: Record<string, string>;
  textContent: string;
  parentChain: string[];
  siblingIndex: number;
  depth: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
  matchCount: number;
}

export interface CandidateElement {
  tag: string;
  attributes: Record<string, string>;
  textContent: string;
  parentChain: string[];
  siblingIndex: number;
  depth: number;
  childCount: number;
  generatedSelector: string;
}

export interface MatchResult {
  score: number;
  candidate: CandidateElement;
  confidence: 'high' | 'medium' | 'low' | 'none';
  breakdown: {
    tag: number;
    attributes: number;
    text: number;
    parentChain: number;
    position: number;
  };
}

// ─── Similarity Weights ─────────────────────────────────────

const WEIGHTS = {
  tag: 0.10,
  attributes: 0.30,
  text: 0.25,
  parentChain: 0.20,
  position: 0.15,
};

const CONFIDENCE_THRESHOLDS = {
  high: 0.75,
  medium: 0.55,
  low: 0.35,
};

// ─── Fingerprint Generation ─────────────────────────────────────

export function generateFingerprintId(url: string, selector: string): string {
  return createHash('sha256')
    .update(`${url}::${selector}`)
    .digest('hex')
    .substring(0, 16);
}

export function createFingerprint(
  url: string,
  selector: string,
  element: CandidateElement,
): ElementFingerprint {
  const now = new Date().toISOString();
  return {
    id: generateFingerprintId(url, selector),
    url,
    selector,
    tag: element.tag,
    attributes: element.attributes,
    textContent: element.textContent.substring(0, 200),
    parentChain: element.parentChain,
    siblingIndex: element.siblingIndex,
    depth: element.depth,
    childCount: element.childCount,
    createdAt: now,
    updatedAt: now,
    matchCount: 1,
  };
}

// ─── Similarity Functions ─────────────────────────────────────

/**
 * Jaccard similarity between two sets of strings.
 * Returns 0..1 where 1 means identical sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/**
 * Attribute similarity: compares both keys and key=value pairs.
 * Ignores volatile attributes (style, data-reactid, etc.)
 */
const VOLATILE_ATTRS = new Set([
  'style', 'data-reactid', 'data-reactroot', 'data-react-checksum',
  'data-v-', 'data-testid', 'jsaction', 'jscontroller', 'jsmodel',
  'data-id', 'data-index', 'data-key', 'tabindex',
]);

function isVolatileAttr(key: string): boolean {
  if (VOLATILE_ATTRS.has(key)) return true;
  if (key.startsWith('data-v-')) return true;
  if (key.startsWith('aria-')) return false; // aria attrs are useful
  return false;
}

function attributeSimilarity(
  a: Record<string, string>,
  b: Record<string, string>,
): number {
  const filterAttrs = (attrs: Record<string, string>) => {
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (!isVolatileAttr(k)) filtered[k] = v;
    }
    return filtered;
  };

  const fa = filterAttrs(a);
  const fb = filterAttrs(b);

  // Compare keys
  const keysA = new Set(Object.keys(fa));
  const keysB = new Set(Object.keys(fb));
  const keySim = jaccardSimilarity(keysA, keysB);

  // Compare key=value pairs
  const pairsA = new Set(Object.entries(fa).map(([k, v]) => `${k}=${v}`));
  const pairsB = new Set(Object.entries(fb).map(([k, v]) => `${k}=${v}`));
  const pairSim = jaccardSimilarity(pairsA, pairsB);

  // Class similarity (special handling since classes change often)
  const classesA = new Set((fa['class'] || '').split(/\s+/).filter(Boolean));
  const classesB = new Set((fb['class'] || '').split(/\s+/).filter(Boolean));
  const classSim = classesA.size > 0 || classesB.size > 0
    ? jaccardSimilarity(classesA, classesB)
    : 1;

  // Weighted combination: value pairs matter most, then classes, then just keys
  return pairSim * 0.4 + classSim * 0.35 + keySim * 0.25;
}

/**
 * Text similarity using token overlap (fast approximation).
 * Normalizes text, tokenizes, and computes Jaccard on tokens.
 */
function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, '').trim();

  const tokenize = (s: string) =>
    new Set(normalize(s).split(/\s+/).filter(t => t.length > 1));

  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.size === 0 && tokensB.size === 0) return 1;

  return jaccardSimilarity(tokensA, tokensB);
}

/**
 * Parent chain similarity: how many ancestor signatures match in order.
 */
function parentChainSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const maxLen = Math.max(a.length, b.length);
  let matches = 0;

  // Compare from closest parent upward
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) {
      matches++;
    } else {
      // Partial match: same tag but different classes
      const tagA = a[i].split('.')[0].split('#')[0];
      const tagB = b[i].split('.')[0].split('#')[0];
      if (tagA === tagB) matches += 0.5;
    }
  }

  return matches / maxLen;
}

/**
 * Position similarity based on sibling index and depth.
 */
function positionSimilarity(
  fingerprint: { siblingIndex: number; depth: number; childCount: number },
  candidate: { siblingIndex: number; depth: number; childCount: number },
): number {
  // Sibling index similarity (closer = better)
  const maxSibling = Math.max(fingerprint.siblingIndex, candidate.siblingIndex, 1);
  const siblingDiff = Math.abs(fingerprint.siblingIndex - candidate.siblingIndex);
  const siblingSim = 1 - (siblingDiff / (maxSibling + 1));

  // Depth similarity
  const depthDiff = Math.abs(fingerprint.depth - candidate.depth);
  const depthSim = 1 / (1 + depthDiff);

  // Child count similarity
  const maxChild = Math.max(fingerprint.childCount, candidate.childCount, 1);
  const childDiff = Math.abs(fingerprint.childCount - candidate.childCount);
  const childSim = 1 - (childDiff / (maxChild + 1));

  return siblingSim * 0.4 + depthSim * 0.35 + childSim * 0.25;
}

// ─── Match Engine ─────────────────────────────────────

/**
 * Compute similarity score between a stored fingerprint and a candidate element.
 */
export function computeSimilarity(
  fingerprint: ElementFingerprint,
  candidate: CandidateElement,
): MatchResult {
  const tagScore = fingerprint.tag === candidate.tag ? 1.0 : 0.0;
  const attrScore = attributeSimilarity(fingerprint.attributes, candidate.attributes);
  const textScore = textSimilarity(fingerprint.textContent, candidate.textContent);
  const parentScore = parentChainSimilarity(fingerprint.parentChain, candidate.parentChain);
  const posScore = positionSimilarity(fingerprint, candidate);

  const score =
    tagScore * WEIGHTS.tag +
    attrScore * WEIGHTS.attributes +
    textScore * WEIGHTS.text +
    parentScore * WEIGHTS.parentChain +
    posScore * WEIGHTS.position;

  let confidence: MatchResult['confidence'] = 'none';
  if (score >= CONFIDENCE_THRESHOLDS.high) confidence = 'high';
  else if (score >= CONFIDENCE_THRESHOLDS.medium) confidence = 'medium';
  else if (score >= CONFIDENCE_THRESHOLDS.low) confidence = 'low';

  return {
    score,
    candidate,
    confidence,
    breakdown: {
      tag: tagScore,
      attributes: attrScore,
      text: textScore,
      parentChain: parentScore,
      position: posScore,
    },
  };
}

/**
 * Find the best match for a fingerprint among a list of candidates.
 * Returns null if no match meets the minimum confidence threshold.
 */
export function findBestMatch(
  fingerprint: ElementFingerprint,
  candidates: CandidateElement[],
  minConfidence: MatchResult['confidence'] = 'medium',
): MatchResult | null {
  if (candidates.length === 0) return null;

  // Pre-filter: only consider same-tag candidates (huge performance win)
  const sameTag = candidates.filter(c => c.tag === fingerprint.tag);
  const pool = sameTag.length > 0 ? sameTag : candidates;

  // Limit to 500 candidates to avoid performance issues on huge pages
  const limited = pool.length > 500 ? pool.slice(0, 500) : pool;

  let bestMatch: MatchResult | null = null;

  for (const candidate of limited) {
    const result = computeSimilarity(fingerprint, candidate);

    if (!bestMatch || result.score > bestMatch.score) {
      bestMatch = result;
    }
  }

  if (!bestMatch) return null;

  // Check confidence threshold
  const thresholdMap: Record<string, number> = {
    high: CONFIDENCE_THRESHOLDS.high,
    medium: CONFIDENCE_THRESHOLDS.medium,
    low: CONFIDENCE_THRESHOLDS.low,
    none: 0,
  };

  const threshold = thresholdMap[minConfidence] ?? CONFIDENCE_THRESHOLDS.medium;
  if (bestMatch.score < threshold) return null;

  return bestMatch;
}

// ─── Browser-side extraction script ─────────────────────────────────────
// This script runs inside the browser via page.evaluate() to extract
// candidate elements from the DOM.

export const EXTRACT_CANDIDATES_SCRIPT = `
(selector) => {
  function getParentChain(el, maxDepth = 5) {
    const chain = [];
    let current = el.parentElement;
    let d = 0;
    while (current && d < maxDepth && current !== document.documentElement) {
      let sig = current.tagName.toLowerCase();
      if (current.id) sig += '#' + current.id;
      else if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/).slice(0, 3).join('.');
        if (classes) sig += '.' + classes;
      }
      chain.push(sig);
      current = current.parentElement;
      d++;
    }
    return chain;
  }

  function getSiblingIndex(el) {
    let idx = 0;
    let sibling = el.previousElementSibling;
    while (sibling) { idx++; sibling = sibling.previousElementSibling; }
    return idx;
  }

  function getDepth(el) {
    let depth = 0;
    let current = el.parentElement;
    while (current) { depth++; current = current.parentElement; }
    return depth;
  }

  function getAttributes(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      if (attr.name !== 'style') {
        attrs[attr.name] = (attr.value || '').substring(0, 200);
      }
    }
    return attrs;
  }

  function generateSelector(el) {
    if (el.id) return '#' + el.id;
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;

    // Try unique class combo
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\\s+/).filter(Boolean);
      if (classes.length > 0) {
        const sel = tag + '.' + classes.join('.');
        try {
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch {}
      }
    }

    // Try nth-child
    const siblings = parent.children;
    let idx = 0;
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i] === el) { idx = i + 1; break; }
    }
    const parentSel = generateSelector(parent);
    return parentSel + ' > ' + tag + ':nth-child(' + idx + ')';
  }

  // If selector is provided, extract fingerprint for that specific element
  if (selector) {
    const el = document.querySelector(selector);
    if (!el) return { found: false, element: null };
    return {
      found: true,
      element: {
        tag: el.tagName.toLowerCase(),
        attributes: getAttributes(el),
        textContent: (el.textContent || '').trim().substring(0, 200),
        parentChain: getParentChain(el),
        siblingIndex: getSiblingIndex(el),
        depth: getDepth(el),
        childCount: el.children.length,
        generatedSelector: generateSelector(el),
      }
    };
  }

  // No selector: extract all candidate elements (for matching)
  const allElements = document.querySelectorAll('body *');
  const candidates = [];
  const MAX = 500;
  for (let i = 0; i < allElements.length && candidates.length < MAX; i++) {
    const el = allElements[i];
    const tag = el.tagName.toLowerCase();
    // Skip non-visible and script/style elements
    if (['script', 'style', 'noscript', 'link', 'meta', 'br', 'hr'].includes(tag)) continue;
    candidates.push({
      tag,
      attributes: getAttributes(el),
      textContent: (el.textContent || '').trim().substring(0, 200),
      parentChain: getParentChain(el),
      siblingIndex: getSiblingIndex(el),
      depth: getDepth(el),
      childCount: el.children.length,
      generatedSelector: generateSelector(el),
    });
  }
  return { found: false, candidates };
}
`;

// ─── Cheerio-side extraction (for web_browse tool) ─────────────────

export function extractCandidateFromCheerio(
  $: any,
  element: any,
  rootSelector?: string,
): CandidateElement {
  const el = $(element);
  const tag = (element.tagName || element.name || 'div').toLowerCase();

  // Attributes
  const attributes: Record<string, string> = {};
  const rawAttrs = element.attribs || {};
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (k !== 'style') {
      attributes[k] = String(v || '').substring(0, 200);
    }
  }

  // Text content
  const textContent = el.text().trim().substring(0, 200);

  // Parent chain
  const parentChain: string[] = [];
  let parent = el.parent();
  let d = 0;
  while (parent.length && d < 5 && parent[0] !== undefined && parent[0].tagName !== 'html') {
    const pTag = (parent[0].tagName || parent[0].name || '').toLowerCase();
    if (!pTag || pTag === '[document]') break;
    const pId = parent.attr('id');
    const pClass = (parent.attr('class') || '').trim().split(/\s+/).slice(0, 3).join('.');
    let sig = pTag;
    if (pId) sig += `#${pId}`;
    else if (pClass) sig += `.${pClass}`;
    parentChain.push(sig);
    parent = parent.parent();
    d++;
  }

  // Sibling index
  let siblingIndex = 0;
  const prev = el.prevAll();
  siblingIndex = prev.length;

  // Depth
  const depth = parentChain.length + 1;

  // Child count
  const childCount = el.children().length;

  // Generate selector
  let generatedSelector = rootSelector || tag;
  const id = attributes['id'];
  if (id) {
    generatedSelector = `#${id}`;
  } else {
    const classes = (attributes['class'] || '').trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      generatedSelector = `${tag}.${classes.join('.')}`;
    }
  }

  return {
    tag,
    attributes,
    textContent,
    parentChain,
    siblingIndex,
    depth,
    childCount,
    generatedSelector,
  };
}

export function extractAllCandidatesFromCheerio($: any, filterTag?: string): CandidateElement[] {
  const candidates: CandidateElement[] = [];
  const selector = filterTag ? `body ${filterTag}` : 'body *';
  const elements = $(selector);
  const MAX = 500;

  elements.each((_: number, el: any) => {
    if (candidates.length >= MAX) return false;
    const tag = (el.tagName || el.name || '').toLowerCase();
    if (['script', 'style', 'noscript', 'link', 'meta', 'br', 'hr'].includes(tag)) return undefined;
    candidates.push(extractCandidateFromCheerio($, el));
    return undefined;
  });

  return candidates;
}
