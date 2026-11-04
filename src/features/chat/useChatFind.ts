import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { findMatches, stepMatch } from "../../lib/textSearch";

// Highlight names used in index.css (::highlight(...)).
const ALL = "chat-find";
const CURRENT = "chat-find-current";
// Text from different blocks never joins into a single match (the "end" of one box + the "start" of the next).
const BLOCK = "p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,th,tr,ul,ol,table";

type Piece = { node: Text; start: number };

/** Visible text of the container, with each text node's position to convert back into a Range. */
function collectText(root: HTMLElement): { text: string; pieces: Piece[] } {
  const pieces: Piece[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (parent.closest("[data-find-skip]")) return NodeFilter.FILTER_REJECT;
      // Collapsed parts (closed timeline, etc.) aren't visible and don't count as results.
      if (parent.checkVisibility && !parent.checkVisibility()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const block = node.parentElement!.closest(BLOCK);
    if (lastBlock && block !== lastBlock) text += "\n";
    lastBlock = block;
    pieces.push({ node, start: text.length });
    text += node.nodeValue;
  }
  return { text, pieces };
}

/** Node and offset of position `pos` in the joined text. `end` prefers the end of the previous node. */
function locate(pieces: Piece[], pos: number, end: boolean): [Text, number] {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const p = pieces[mid];
    if (end ? p.start < pos : p.start <= pos) lo = mid;
    else hi = mid - 1;
  }
  const piece = pieces[lo];
  return [piece.node, Math.min(pos - piece.start, piece.node.length)];
}

function buildRanges(root: HTMLElement, query: string): Range[] {
  const { text, pieces } = collectText(root);
  if (!pieces.length) return [];
  return findMatches(text, query).map(({ start, end }) => {
    const range = document.createRange();
    range.setStart(...locate(pieces, start, false));
    range.setEnd(...locate(pieces, end, true));
    return range;
  });
}

const highlights = () => (typeof CSS !== "undefined" ? CSS.highlights : undefined);

function clearHighlights() {
  highlights()?.delete(ALL);
  highlights()?.delete(CURRENT);
}

/** Centers the match in the chat scroller without moving the rest of the window. */
function scrollIntoView(scroller: HTMLElement, range: Range) {
  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (rect.top >= box.top + 40 && rect.bottom <= box.bottom - 40) return;
  scroller.scrollTop += rect.top - box.top - box.height / 2;
}

/**
 * Search in the open conversation (Ctrl+F): highlights every match on screen, including text still
 * streaming in, and navigates between them.
 */
export function useChatFind(
  scrollerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(-1);
  const rangesRef = useRef<Range[]>([]);
  const currentRef = useRef(-1);

  const paint = useCallback((index: number, scroll: boolean) => {
    const ranges = rangesRef.current;
    const registry = highlights();
    currentRef.current = index;
    setCurrent(index);
    if (!registry) return;
    registry.set(ALL, new Highlight(...ranges));
    if (index >= 0 && ranges[index]) {
      registry.set(CURRENT, new Highlight(ranges[index]));
      if (scroll && scrollerRef.current) scrollIntoView(scrollerRef.current, ranges[index]);
    } else registry.delete(CURRENT);
  }, [scrollerRef]);

  // Recomputes when the query changes (goes to the first match from what is visible)
  // and when the conversation changes on screen (keeps the position without pulling the scroll).
  useEffect(() => {
    const content = contentRef.current;
    if (!open || !content || !query.trim()) {
      rangesRef.current = [];
      setTotal(0);
      currentRef.current = -1;
      setCurrent(-1);
      clearHighlights();
      return;
    }
    const run = (fresh: boolean) => {
      const ranges = buildRanges(content, query);
      rangesRef.current = ranges;
      setTotal(ranges.length);
      if (!ranges.length) return paint(-1, false);
      if (fresh) {
        const top = scrollerRef.current?.getBoundingClientRect().top ?? 0;
        const first = ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
        paint(first < 0 ? 0 : first, true);
      } else paint(Math.min(Math.max(currentRef.current, 0), ranges.length - 1), false);
    };
    run(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => run(false), 150);
    });
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [open, query, contentRef, scrollerRef, paint]);

  useEffect(() => clearHighlights, []);

  const step = useCallback(
    (delta: number) => {
      const next = stepMatch(currentRef.current, rangesRef.current.length, delta);
      if (next >= 0) paint(next, true);
    },
    [paint],
  );

  const close = useCallback(() => setOpen(false), []);

  return { open, setOpen, query, setQuery, total, current, next: () => step(1), prev: () => step(-1), close };
}
