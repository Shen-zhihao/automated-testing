import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from 'react';
import type { WorkChatMessage } from '@project/shared-api';

export const MESSAGE_PAGE_SIZE = 40;
const useLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function MessageWindow({
  messages,
  viewport,
  followReply,
  children,
}: {
  messages: WorkChatMessage[];
  viewport: RefObject<HTMLDivElement>;
  followReply: MutableRefObject<boolean>;
  children: (message: WorkChatMessage) => ReactNode;
}) {
  const [start, setStart] = useState(() => Math.max(0, messages.length - MESSAGE_PAGE_SIZE));
  const anchor = useRef<{ height: number; top: number } | null>(null);
  useLayout(() => {
    if (followReply.current) setStart(Math.max(0, messages.length - MESSAGE_PAGE_SIZE));
  }, [messages.length]);
  useLayout(() => {
    const node = viewport.current;
    if (node && anchor.current) {
      node.scrollTop = anchor.current.top + node.scrollHeight - anchor.current.height;
      anchor.current = null;
    }
  }, [start, viewport]);
  return (
    <>
      {start > 0 && (
        <button
          className="workButton subtle messageHistoryButton"
          onClick={() => {
            const node = viewport.current;
            if (node) anchor.current = { height: node.scrollHeight, top: node.scrollTop };
            followReply.current = false;
            setStart((value) => Math.max(0, value - MESSAGE_PAGE_SIZE));
          }}
        >
          查看更早的消息（还有 {start} 条）
        </button>
      )}
      {messages.slice(start).map(children)}
    </>
  );
}
