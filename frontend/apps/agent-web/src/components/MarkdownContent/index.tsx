import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="markdownContent">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>[图片{alt ? `：${alt}` : ''}]</span>,
          a: ({ children: label }) => <span>{label}</span>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
