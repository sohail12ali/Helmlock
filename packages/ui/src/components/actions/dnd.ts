// Our own drag-and-drop surface over Pragmatic drag and drop (F149): pages never import @atlaskit directly.
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { type RefObject, useEffect, useRef, useState } from "react";

const KIND = "hl-ticket-card";
interface CardData {
  kind: typeof KIND;
  id: string;
  stage: string;
}
const isCard = (d: Record<string | symbol, unknown>): d is Record<string | symbol, unknown> & CardData => d.kind === KIND;

/** Makes a board card draggable. Returns whether it is being dragged (for a dimmed look). */
export function useDraggableCard(ref: RefObject<HTMLElement | null>, id: string, stage: string, enabled = true): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    return draggable({
      element: el,
      getInitialData: () => ({ kind: KIND, id, stage }) satisfies CardData,
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [ref, id, stage, enabled]);
  return dragging;
}

/** Makes a lane a drop target for cards from other lanes. Returns whether a card hovers over it. */
export function useDropLane(ref: RefObject<HTMLElement | null>, stage: string, onDropCard: (id: string, from: string) => void): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onDropCard);
  cb.current = onDropCard;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => isCard(source.data) && source.data.stage !== stage,
      getData: () => ({ stage }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        if (isCard(source.data)) cb.current(source.data.id, source.data.stage);
      },
    });
  }, [ref, stage]);
  return over;
}

/** Makes any element (a crew role card) a drop target for ticket cards. Returns whether a card hovers over it. */
export function useDropTicket(ref: RefObject<HTMLElement | null>, onDropTicket: (id: string) => void, enabled = true): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onDropTicket);
  cb.current = onDropTicket;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => isCard(source.data),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop: ({ source }) => {
        setOver(false);
        if (isCard(source.data)) cb.current(source.data.id);
      },
    });
  }, [ref, enabled]);
  return over;
}
