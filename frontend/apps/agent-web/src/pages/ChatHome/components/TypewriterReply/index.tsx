import { useEffect, useRef, useState } from 'react';
import MarkdownContent from '@/components/MarkdownContent';
import './index.less';

export default function TypewriterReply({
  content,
  animate,
  onComplete,
  onProgress,
}: {
  content: string;
  animate: boolean;
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
    if (!content || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(content);
      callbacks.current.onComplete();
      return;
    }
    const characters = Array.from(content);
    const duration = Math.min(16000, Math.max(600, characters.length * 14));
    const start = performance.now();
    let frame = 0;
    let previous = 0;
    setVisible('');
    const reveal = (time: number) => {
      const elapsed = time - start;
      if (elapsed >= duration) {
        setVisible(content);
        callbacks.current.onComplete();
        return;
      }
      if (time - previous >= 45) {
        previous = time;
        setVisible(
          characters
            .slice(0, Math.max(1, Math.floor((characters.length * elapsed) / duration)))
            .join(''),
        );
      }
      frame = requestAnimationFrame(reveal);
    };
    frame = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(frame);
  }, [content, animate]);
  useEffect(() => callbacks.current.onProgress(), [visible]);
  return (
    <div className="typewriterReply" aria-busy={animate && visible !== content}>
      <MarkdownContent>{visible || '\u200b'}</MarkdownContent>
      {animate && visible !== content && <span className="replyCursor" aria-hidden="true" />}
    </div>
  );
}
