import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { useTick } from './hooks.js';
import { color } from './theme.js';

export function Bar({ ratio, width = 26, tone = color.accent }: { ratio: number; width?: number; tone?: string }) {
  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const filled = Math.round(r * width);
  return (
    <Text>
      <Text color={tone}>{'█'.repeat(filled)}</Text>
      <Text color={color.dim}>{'░'.repeat(width - filled)}</Text>
    </Text>
  );
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner() {
  const tick = useTick(80);
  return <Text color={color.accent}>{FRAMES[tick % FRAMES.length]}</Text>;
}

export function Row({ label, truncate, children }: { label: string; truncate?: boolean; children: React.ReactNode }) {
  return (
    <Box>
      <Box width={16} flexShrink={0}>
        <Text color={color.dim}>{label}</Text>
      </Box>
      <Text wrap={truncate ? 'truncate-end' : 'wrap'}>{children}</Text>
    </Box>
  );
}

export interface MenuItem {
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** Arrow keys or digits move, Enter confirms. */
export function Menu({ items, onSelect }: { items: MenuItem[]; onSelect: (index: number) => void }) {
  const [cursor, setCursor] = useState(Math.max(0, items.findIndex((i) => !i.disabled)));
  const move = (dir: 1 | -1) =>
    setCursor((c) => {
      let n = c;
      for (let i = 0; i < items.length; i++) {
        n = (n + dir + items.length) % items.length;
        if (!items[n]?.disabled) return n;
      }
      return c;
    });
  useInput((input, key) => {
    if (key.upArrow || input === 'k') move(-1);
    else if (key.downArrow || input === 'j') move(1);
    else if (key.return) {
      if (!items[cursor]?.disabled) onSelect(cursor);
    } else if (/^[1-9]$/.test(input)) {
      const n = Number(input) - 1;
      if (n < items.length && !items[n]?.disabled) setCursor(n);
    }
  });
  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const active = i === cursor;
        return (
          <Text key={item.label} wrap="truncate-end">
            <Text color={color.accent}>{active ? '❯ ' : '  '}</Text>
            <Text color={item.disabled ? color.dim : active ? color.accent : undefined} bold={active} dimColor={item.disabled}>
              {i + 1}. {item.label}
            </Text>
            {item.hint ? <Text color={color.dim}>  {item.hint}</Text> : null}
          </Text>
        );
      })}
      <Text color={color.dim}>
        ↑↓ or 1-{items.length} to choose · Enter to confirm
      </Text>
    </Box>
  );
}
