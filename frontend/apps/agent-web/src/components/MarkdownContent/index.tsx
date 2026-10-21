import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBrowserWorkspace } from '@/components/BrowserWorkspace';

export default function MarkdownContent({ children }: { children: string }) {
  const browser = useBrowserWorkspace();
  return (
    <div className="markdownContent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>[图片{alt ? `：${alt}` : ''}]</span>,
          a: ({ href, children: label }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void browser.open({ url: href });
                }}
              >
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
