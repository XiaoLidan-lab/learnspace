import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
// Models sometimes put trailing spaces inside bold markers or place Chinese
// punctuation against them. Normalize only display text, preserving code and source.
export function normalizeMarkdown(text: string) {
  return text
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /(?<!\\)\*\*([^*\n]+?)\*\*/g,
            (_, content: string) => ` **${content.trim()}** `,
          ),
    )
    .join("");
}
export function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          img: ({ alt, src }) => (
            <a href={src} target="_blank" rel="noopener noreferrer">
              {alt || "图片链接"}
            </a>
          ),
        }}
      >
        {normalizeMarkdown(children)}
      </ReactMarkdown>
    </div>
  );
}
