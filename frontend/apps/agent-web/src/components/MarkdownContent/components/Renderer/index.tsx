import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];

export default function Renderer({
  content,
  openBrowser,
}: {
  content: string;
  openBrowser: (options: { url: string }) => Promise<void>;
}) {
  return (
    <div className="markdownContent">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={{
          img: ({ alt }) => <span>[图片{alt ? `：${alt}` : ''}]</span>,
          a: ({ href, children: label }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  void openBrowser({ url: href });
                }}
              >
                {label}
              </a>
            ) : (
              <span>{label}</span>
            ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
