import { lazy, memo, Suspense } from 'react';
import { useOpenBrowser } from '@/components/BrowserWorkspace';

const Renderer = lazy(() => import('./components/Renderer'));

export default memo(function MarkdownContent({ children }: { children: string }) {
  const openBrowser = useOpenBrowser();
  return (
    <Suspense
      fallback={
        <div className="markdownContent" role="status">
          正在打开文档…
        </div>
      }
    >
      <Renderer content={children} openBrowser={openBrowser} />
    </Suspense>
  );
});
