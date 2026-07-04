import { Box, Text, UnstyledButton } from '@mantine/core';
import type { CSSProperties, ReactNode } from 'react';

/* PipelineFunnel — horizontal gradient chevron funnel (CRM/cockpit wireframe #3/#12). Pure
   presentation: each stage is a chevron segment, color intensity ramps from a pale blue tint
   at the first stage to full brand at the last. `onClick` per stage is a passthrough only — no
   internal state/data-fetching, so it's a drop-in for both the cockpit KPI funnel and any list
   view's pipeline visualization. */

export interface PipelineFunnelStage {
  label: string;
  count: number;
  /** Secondary line under the count, e.g. "61% Chuyển đổi". */
  value?: ReactNode;
  onClick?: () => void;
}

export interface PipelineFunnelProps {
  stages: PipelineFunnelStage[];
}

/** Chevron clip-path per stage index: first stage has a flat left edge, last stage has a flat
 *  right edge, middle stages notch both sides — same shape as the wireframe's `.pipeline-step`. */
function chevronClipPath(index: number, count: number): string {
  const isFirst = index === 0;
  const isLast = index === count - 1;
  if (isFirst) return 'polygon(0% 0%, 90% 0%, 100% 50%, 90% 100%, 0% 100%)';
  if (isLast) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 10% 50%)';
  return 'polygon(0% 0%, 90% 0%, 100% 50%, 90% 100%, 0% 100%, 10% 50%)';
}

/** Linear-interpolates the chip background from a pale brand tint (stage 0) to full brand
 *  (last stage), mixing against the brand token via CSS `color-mix` — same source-of-truth
 *  color as the rest of the app, no hardcoded hex ramp to keep in sync with theme.ts. */
function chevronBackground(index: number, count: number): string {
  if (count <= 1) return 'var(--cmc-brand)';
  const ratio = index / (count - 1); // 0 (first, palest) .. 1 (last, full brand)
  const pct = Math.round(15 + ratio * 85); // 15% brand .. 100% brand mixed into white
  return `color-mix(in srgb, var(--cmc-brand) ${pct}%, white)`;
}

/** Last stage renders count/labels in white (solid brand bg); earlier stages use dark text. */
function chevronTextColor(index: number, count: number): string {
  return index === count - 1 ? '#FFFFFF' : 'var(--cmc-text)';
}

export function PipelineFunnel({ stages }: PipelineFunnelProps) {
  return (
    <Box style={{ display: 'flex', alignItems: 'stretch', width: '100%', height: 128, gap: 4 }}>
      {stages.map((stage, i) => {
        const textColor = chevronTextColor(i, stages.length);
        const content = (
          <>
            <Text
              size="xs"
              fw={700}
              tt="uppercase"
              style={{ letterSpacing: '0.04em', color: textColor, opacity: 0.85 }}
            >
              {stage.label}
            </Text>
            <Text
              fw={700}
              style={{
                fontSize: 'var(--cmc-text-2xl)',
                lineHeight: 1.1,
                color: textColor,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {stage.count}
            </Text>
            {stage.value != null && (
              <Text size="xs" style={{ color: textColor, opacity: 0.75, marginTop: 2 }}>
                {stage.value}
              </Text>
            )}
          </>
        );

        const segmentStyle: CSSProperties = {
          flex: 1,
          minWidth: 120,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          clipPath: chevronClipPath(i, stages.length),
          backgroundColor: chevronBackground(i, stages.length),
          transition: 'filter 150ms ease',
        };

        return stage.onClick ? (
          <UnstyledButton
            key={stage.label}
            onClick={stage.onClick}
            style={{ ...segmentStyle, cursor: 'pointer' }}
          >
            {content}
          </UnstyledButton>
        ) : (
          <Box key={stage.label} style={segmentStyle}>
            {content}
          </Box>
        );
      })}
    </Box>
  );
}
