import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/** Display only: never modifies stored questions or answer values. */
export function MathText({ children }: { children: string }) {
  return (
    <span className="math-text">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            { trust: false, strict: "ignore", throwOnError: false },
          ],
        ]}
        skipHtml
        components={{ p: ({ children }) => <span>{children}</span> }}
      >
        {children}
      </ReactMarkdown>
    </span>
  );
}
