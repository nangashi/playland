import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** 上端・下端からこの距離に入ったら自動でスクロールする */
const EDGE = 72;
const MAX_SCROLL_SPEED = 16;

export interface DragState {
  id: string;
  from: number;
  over: number;
  /** つまんだ行の移動量 */
  dy: number;
  /** ほかの行をずらす量（つまんだ行の高さ＋間隔） */
  shift: number;
}

interface Session {
  id: string;
  from: number;
  pointerId: number;
  startPageY: number;
  lastClientY: number;
  /** 各行の中心（ページ座標、つまんだ時点） */
  centers: number[];
  shift: number;
  frame: number;
}

/**
 * つまみ（ハンドル）をつかんだときだけ行を上下にドラッグする。
 * つまみ以外ではスクロールをさまたげないよう、つまみ側に touch-action: none を付けて使う。
 */
export function useDragReorder({
  ids,
  disabled,
  onDrop,
}: {
  ids: readonly string[];
  disabled: boolean;
  onDrop: (id: string, target: number) => void;
}) {
  const rows = useRef(new Map<string, HTMLElement>());
  const session = useRef<Session | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);
  const latest = useRef({ onDrop });
  latest.current = { onDrop };

  const update = useCallback(() => {
    const s = session.current;
    if (!s) return;
    const dy = s.lastClientY + window.scrollY - s.startPageY;
    const center = s.centers[s.from]! + dy;
    let over = s.from;
    s.centers.forEach((c, i) => {
      if (i < s.from && center < c) over--;
      if (i > s.from && center > c) over++;
    });
    setDrag({ id: s.id, from: s.from, over, dy, shift: s.shift });
  }, [setDrag]);

  const finish = useCallback((commit: boolean) => {
    const s = session.current;
    if (!s) return;
    cancelAnimationFrame(s.frame);
    session.current = null;
    const current = dragRef.current;
    setDrag(null);
    if (commit && current && current.over !== current.from) latest.current.onDrop(current.id, current.over);
  }, [setDrag]);

  useEffect(() => () => finish(false), [finish]);

  /** 行の要素を登録する（ref に渡す） */
  const rowRef = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) rows.current.set(id, el);
      else rows.current.delete(id);
    },
    [],
  );

  function handleProps(id: string) {
    return {
      onPointerDown(e: ReactPointerEvent<HTMLElement>) {
        if (disabled || session.current || (e.pointerType === "mouse" && e.button !== 0)) return;
        const from = ids.indexOf(id);
        const rects = ids.map((rowId) => rows.current.get(rowId)?.getBoundingClientRect());
        if (from < 0 || rects.some((r) => !r)) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const gap = rects.length > 1 ? Math.max(0, rects[1]!.top - rects[0]!.bottom) : 0;
        session.current = {
          id,
          from,
          pointerId: e.pointerId,
          startPageY: e.clientY + window.scrollY,
          lastClientY: e.clientY,
          centers: rects.map((r) => r!.top + window.scrollY + r!.height / 2),
          shift: rects[from]!.height + gap,
          frame: 0,
        };
        const tick = () => {
          const s = session.current;
          if (!s) return;
          const y = s.lastClientY;
          const speed =
            y < EDGE ? -Math.ceil(((EDGE - y) / EDGE) * MAX_SCROLL_SPEED)
            : y > window.innerHeight - EDGE ? Math.ceil(((y - (window.innerHeight - EDGE)) / EDGE) * MAX_SCROLL_SPEED)
            : 0;
          if (speed !== 0) {
            window.scrollBy(0, speed);
            update();
          }
          s.frame = requestAnimationFrame(tick);
        };
        session.current.frame = requestAnimationFrame(tick);
        update();
      },
      onPointerMove(e: ReactPointerEvent<HTMLElement>) {
        const s = session.current;
        if (!s || s.pointerId !== e.pointerId) return;
        s.lastClientY = e.clientY;
        update();
      },
      onPointerUp(e: ReactPointerEvent<HTMLElement>) {
        if (session.current?.pointerId === e.pointerId) finish(true);
      },
      onPointerCancel(e: ReactPointerEvent<HTMLElement>) {
        if (session.current?.pointerId === e.pointerId) finish(false);
      },
    };
  }

  /** 行をずらす量（ドラッグ中だけ） */
  function offsetOf(id: string): number {
    if (!drag) return 0;
    if (id === drag.id) return drag.dy;
    const i = ids.indexOf(id);
    if (i < 0) return 0;
    if (drag.from < i && i <= drag.over) return -drag.shift;
    if (drag.over <= i && i < drag.from) return drag.shift;
    return 0;
  }

  return { drag, rowRef, handleProps, offsetOf };
}
