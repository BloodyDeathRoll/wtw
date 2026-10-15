import { Fragment, type ReactNode } from "react";

// The engine's reason text marks titles with markdown emphasis
// ("*The Shawshank Redemption*"). Render those spans as <em> instead of
// showing raw asterisks; unpaired asterisks are left as typed.
const EMPHASIS = /\*{1,2}([^*\n]+?)\*{1,2}/g;

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
