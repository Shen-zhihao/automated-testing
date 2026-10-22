import { useEffect, useRef, useState } from 'react';
import MarkdownContent from '@/components/MarkdownContent';
import { animationSettings, replyPrefix } from './frames.mjs';
import './index.less';

export default function TypewriterReply({
  content,
  animate,
  paused = false,
  onComplete,
  onProgress,
}: {
  content: string;
  animate: boolean;
  paused?: boolean;
  onComplete: () => void;
  onProgress: () => void;
}) {
  const [visible, setVisible] = useState(animate ? '' : content);
  const callbacks = useRef({ onComplete, onProgress });
  callbacks.current = { onComplete, onProgress };
  useEffect(() => {
    if (!animate) {
      setVisible(content);
      return;
    }
    const finish = () => {
      setVisible(content);
      callbacks.current.onComplete();
    };
    if (
      !content ||
      paused ||
      document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      finish();
      return;
    }
    const { duration, interval } = animationSettings(content.length);
    const start = performance.now();
    let timer = 0;
    setVisible('');
    const reveal = () => {
      const elapsed = performance.now() - start;
      if (elapsed >= duration) {
        finish();
        return;
      }
      setVisible(replyPrefix(content, elapsed / duration));
      timer = window.setTimeout(reveal, interval);
    };
    const visibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        finish();
      }
    };
    reveal();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [content, animate, paused]);
  useEffect(() => callbacks.current.onProgress(), [visible]);
  return (
    <div className="typewriterReply" aria-busy={animate && visible !== content}>
      <MarkdownContent>{visible || '\u200b'}</MarkdownContent>
      {animate && visible !== content && <span className="replyCursor" aria-hidden="true" />}
    </div>
  );
}
