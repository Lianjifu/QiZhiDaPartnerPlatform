import { useId } from 'react';

/** 品牌规范色（来自企智搭 VI：紫 #6D28D9 / 橙 #FF7A1B） */
export const BRAND_PURPLE = '#6D28D9';
export const BRAND_ORANGE = '#FF7A1B';
export const BRAND_MONO = '#171717';

const SIZE = 28;
const OFF = 14;
const RX = 8;
const GAP = 3.15;
const TIGHT = SIZE + OFF;

type Variant = 'mark' | 'icon';
type Tone = 'color' | 'inverse' | 'mono';

function LogoSquares({
  back,
  front,
  gap,
}: {
  back: string;
  front: string;
  gap: string | null;
}) {
  const uid = useId().replace(/:/g, '');
  const maskId = `qzd-gap-${uid}`;
  const ex = OFF - GAP;
  const ey = -GAP;
  const es = SIZE + GAP * 2;
  const erx = RX + GAP;

  if (gap) {
    return (
      <>
        <rect x={0} y={OFF} width={SIZE} height={SIZE} rx={RX} fill={back} />
        <rect x={ex} y={ey} width={es} height={es} rx={erx} fill={gap} />
        <rect x={OFF} y={0} width={SIZE} height={SIZE} rx={RX} fill={front} />
      </>
    );
  }

  return (
    <>
      <mask id={maskId}>
        <rect width={TIGHT} height={TIGHT} fill="#fff" />
        <rect x={ex} y={ey} width={es} height={es} rx={erx} fill="#000" />
      </mask>
      <rect x={0} y={OFF} width={SIZE} height={SIZE} rx={RX} fill={back} mask={`url(#${maskId})`} />
      <rect x={OFF} y={0} width={SIZE} height={SIZE} rx={RX} fill={front} />
    </>
  );
}

export function BrandLogo({
  variant = 'mark',
  tone = 'color',
  className,
  title = '企智搭',
}: {
  variant?: Variant;
  tone?: Tone;
  className?: string;
  title?: string;
}) {
  const back = tone === 'inverse' ? '#FFFFFF' : tone === 'mono' ? BRAND_MONO : BRAND_PURPLE;
  const front = tone === 'mono' ? BRAND_MONO : BRAND_ORANGE;

  if (variant === 'icon') {
    const pad = 8.4;
    const scale = (48 - pad * 2) / TIGHT;
    const iconBack = tone === 'mono' ? BRAND_MONO : BRAND_PURPLE;
    const innerFront = tone === 'mono' ? '#FFFFFF' : BRAND_ORANGE;
    return (
      <svg viewBox="0 0 48 48" className={className} role="img" aria-label={title}>
        <rect width="48" height="48" rx="13" fill={iconBack} />
        <g transform={`translate(${pad} ${pad}) scale(${scale})`}>
          <LogoSquares back="#FFFFFF" front={innerFront} gap="#FFFFFF" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${TIGHT} ${TIGHT}`} className={className} role="img" aria-label={title}>
      <LogoSquares back={back} front={front} gap={tone === 'inverse' ? '#FFFFFF' : null} />
    </svg>
  );
}
