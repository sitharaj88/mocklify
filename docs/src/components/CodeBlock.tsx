import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export default function CodeBlock({ code, language = 'json', title }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg overflow-hidden theme-bg-card border theme-border my-4 code-block-wrapper">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 theme-bg border-b theme-border">
          <span className="text-sm theme-text-secondary">{title}</span>
          <button
            onClick={handleCopy}
            className="p-1.5 theme-text-secondary hover:theme-text transition-colors"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}
      <div className="relative">
        {!title && (
          <button
            onClick={handleCopy}
            className="absolute top-3 right-3 p-1.5 theme-text-secondary hover:theme-text transition-colors theme-bg rounded z-10"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        )}
        <SyntaxHighlighter
          language={language}
          style={theme === 'dark' ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
            fontSize: '0.875rem',
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
