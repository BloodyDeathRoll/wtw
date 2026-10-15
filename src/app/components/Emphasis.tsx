import { Fragment, type ReactNode } from "react";

// The engine's reason text marks titles with markdown emphasis
// ("*The Shawshank Redemption*"). Render those spans as <em> instead of
// showing raw asterisks. Like markdown, the span must hug its text
// ("*x*", not "5* and 4*"), so loose asterisks are left as typed.
// No lookbehind: it is a parse-time SyntaxError before iOS Safari 16.4.
const EMPHASIS = /\*{1,2}(?=\S)([^*\n]*[^*\s])\*{1,2}/g;

export function Emphasis({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(EMPHASIS)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(<em key={at}>{m[1]}</em>);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment>{parts}</Fragment>;
}
