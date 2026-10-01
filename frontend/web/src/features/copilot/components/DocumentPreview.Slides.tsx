/**
 * DocumentPreview — PPTX preview components (useAuthedImageSrc + SlideVisual + SlideDeckReader).
 * Extracted from DocumentPreview.tsx to satisfy file-size gates.
 */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { authHeader } from '@/auth';
import type { PptxPreviewSlide } from './DocumentPreview';

/**
 * 将受 Bearer 鉴权保护的图片 URL 转为同源 blob URL，喂给 <img src>。
 * 浏览器原生 <img> 不能附加 Authorization，所以必须先以 fetch 拿到字节
 * 再用 URL.createObjectURL 暴露给标签。未指定 URL 时返回 null。
 */
export function useAuthedImageSrc(url: string | undefined): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }
    let aborted = false;
    const ctrl = new AbortController();
    fetch(url, { credentials: 'same-origin', signal: ctrl.signal, headers: authHeader() })
      .then(async (res) => {
        if (!res.ok || aborted) return;
        const blob = await res.blob();
        if (aborted) return;
        const next = URL.createObjectURL(blob);
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return next;
        });
      })
      .catch(() => {
        /* aborted or network error — leave placeholder src */
      });
    return () => {
      aborted = true;
      ctrl.abort();
    };
  }, [url]);
  return blobUrl;
}

function SlideVisual({ slide, total }: { slide: PptxPreviewSlide; total: number }) {
  const src = useAuthedImageSrc(slide.imageUrl);
  if (slide.imageUrl) {
    return (
      <article className="copilot-pptx-slide copilot-pptx-slide--raster" aria-label={`第 ${slide.index} 页：${slide.title}`}>
        <img
          src={src ?? slide.imageUrl}
          alt={`第 ${slide.index} 页 ${slide.title}`}
          className="copilot-pptx-slide__image"
          draggable={false}
        />
        <footer className="copilot-pptx-slide__footer copilot-pptx-slide__footer--overlay">
          {slide.index} / {total}
        </footer>
      </article>
    );
  }

  const variant = slide.variant
    || (slide.index === 1 || (slide.background ? /^#(0|1|2)/i.test(slide.background) : false) ? 'cover' : 'content');
  const isCover = variant === 'cover';
  const bg = slide.background || (isCover ? '#102A43' : '#FFFFFF');
  const accent = slide.accent || '#F26B38';
  const ink = slide.textColor || (isCover ? '#FFFFFF' : '#102A43');
  const muted = isCover ? '#D7E2EA' : '#5B6B7C';
  const bodyLines = (slide.lines && slide.lines.length > 0) ? slide.lines : (slide.bullets || []);
  const bulletSet = new Set(slide.bullets || []);
  const isAgenda = variant === 'agenda';

  return (
    <article
      className={`copilot-pptx-slide copilot-pptx-slide--${variant}`}
      style={{
        background: bg,
        color: ink,
        ['--pptx-accent' as string]: accent,
        ['--pptx-muted' as string]: muted,
      }}
      aria-label={`第 ${slide.index} 页：${slide.title}`}
    >
      {isCover ? (
        <>
          {slide.eyebrow ? <div className="copilot-pptx-slide__eyebrow">{slide.eyebrow}</div> : null}
          <div className="copilot-pptx-slide__accent-rule" aria-hidden />
          <header className="copilot-pptx-slide__title copilot-pptx-slide__title--cover">{slide.title}</header>
          {(slide.subtitle || bodyLines[0]) ? (
            <p className="copilot-pptx-slide__subtitle">{slide.subtitle || bodyLines[0]}</p>
          ) : null}
          <div className="copilot-pptx-slide__spacer" />
          <footer className="copilot-pptx-slide__meta">
            {slide.footer || '请补充：汇报人 / 周期 / 日期'}
          </footer>
        </>
      ) : (
        <>
          <header className="copilot-pptx-slide__title">{slide.title}</header>
          <div className="copilot-pptx-slide__body">
            {bodyLines.length === 0 ? (
              <p className="copilot-pptx-slide__empty">本页要点待补充</p>
            ) : isAgenda ? (
              <ol className="copilot-pptx-slide__agenda">
                {bodyLines.map((line, i) => (
                  <li key={`${slide.index}-a-${i}`}>
                    <span className="copilot-pptx-slide__agenda-num">{String(i + 1).padStart(2, '0')}</span>
                    <span>{line.replace(/^\d+\s*/, '')}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="copilot-pptx-slide__list">
                {bodyLines.map((line, i) => {
                  const isBullet = bulletSet.has(line) || bodyLines.length > 1;
                  return (
                    <li key={`${slide.index}-${i}`} className={isBullet ? 'is-bullet' : 'is-plain'}>
                      {line}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <footer className="copilot-pptx-slide__footer">
            {slide.footer ? <span className="copilot-pptx-slide__footer-label">{slide.footer}</span> : null}
            <span>{slide.index} / {total}</span>
          </footer>
        </>
      )}
    </article>
  );
}

export function SlideDeckReader({
  slides,
  deckTitle,
  initialIndex,
}: {
  slides: PptxPreviewSlide[];
  deckTitle: string;
  /** 1-based slide number to jump to when the deck first mounts. */
  initialIndex?: number;
}) {
  const [index, setIndex] = useState(() => {
    if (typeof initialIndex !== 'number' || initialIndex < 1) return 0;
    return Math.min(initialIndex - 1, Math.max(0, slides.length - 1));
  });
  const total = slides.length;
  const slide = slides[Math.min(index, Math.max(0, total - 1))];

  useEffect(() => {
    setIndex(0);
  }, [slides]);

  if (!slide || total === 0) {
    return <div className="copilot-doc-preview__state">暂无幻灯片内容</div>;
  }

  const hasRaster = slides.some((s) => Boolean(s.imageUrl));

  return (
    <div className="copilot-pptx-reader" aria-label={`${deckTitle} 幻灯片预览`}>
      <div className={`copilot-pptx-reader__stage${hasRaster ? ' is-raster' : ''}`}>
        <SlideVisual slide={slide} total={total} />
      </div>
      <div className="copilot-pptx-reader__nav">
        <button
          type="button"
          className="copilot-pptx-reader__btn"
          disabled={index <= 0}
          onClick={() => setIndex((v) => Math.max(0, v - 1))}
          aria-label="上一页"
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </button>
        <div className="copilot-pptx-reader__dots" role="tablist" aria-label="幻灯片页码">
          {slides.map((s, i) => (
            <button
              key={`dot-${s.index}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={`copilot-pptx-reader__dot${i === index ? ' is-active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`第 ${s.index} 页`}
            />
          ))}
        </div>
        <button
          type="button"
          className="copilot-pptx-reader__btn"
          disabled={index >= total - 1}
          onClick={() => setIndex((v) => Math.min(total - 1, v + 1))}
          aria-label="下一页"
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}