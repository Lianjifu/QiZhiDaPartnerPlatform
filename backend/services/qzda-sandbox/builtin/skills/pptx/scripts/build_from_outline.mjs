#!/usr/bin/env node
/**
 * Build a production-grade PPTX from a Markdown outline using PilotDeck layout-library.
 *
 * Usage (via pptx.sh so PPTX_SKILL_ROOT / PPTX_RUNTIME_ROOT are set):
 *   bash scripts/pptx.sh node scripts/build_from_outline.mjs --title T --outline-file O --out F.pptx
 *
 * Or with env already exported.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildToolkit } from './lib/toolkit.mjs';

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return '';
  return process.argv[idx + 1];
}

function parseOutline(title, markdown) {
  const text = String(markdown || '').trim();
  const slides = [];
  let cur = null;

  const ensure = (slideTitle) => {
    cur = { title: slideTitle || title || '内容', bullets: [], body: [] };
    slides.push(cur);
    return cur;
  };

  if (!text) {
    return [
      { title: title || '演示文稿', bullets: [], body: ['业务汇报材料', '请补充：汇报人 / 周期 / 日期'] },
      { title: '目录', bullets: ['背景与目标', '核心内容', '总结与下一步'], body: [] },
      { title: '核心内容', bullets: ['要点一', '要点二', '要点三'], body: [] },
      { title: '总结与下一步', bullets: ['结论', '行动项与负责人'], body: [] },
    ];
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === '---') {
      if (line === '---') cur = null;
      continue;
    }
    if (/^#\s+/.test(line)) {
      ensure(line.replace(/^#\s+/, '').trim() || title);
      continue;
    }
    if (/^##\s+/.test(line)) {
      ensure(line.replace(/^##\s+/, '').trim() || '内容');
      continue;
    }
    if (!cur) ensure(title || '内容');
    if (/^[-*•]\s+/.test(line)) {
      cur.bullets.push(line.replace(/^[-*•]\s+/, '').trim());
    } else if (/^\d+[\.、．]\s+/.test(line)) {
      cur.bullets.push(line.replace(/^\d+[\.、．]\s+/, '').trim());
    } else {
      cur.body.push(line);
    }
  }

  if (!slides.length) ensure(title || '演示文稿');
  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i];
    if ((s.bullets?.length || 0) + (s.body?.length || 0) > 0) continue;
    s.body = i === 0
      ? ['业务汇报材料', '请补充：汇报人 / 周期 / 日期']
      : ['（本页要点待补充）'];
  }
  return slides.slice(0, 20);
}

function isAgendaTitle(t) {
  return /^(目录|议程|agenda|contents|toc)$/i.test(String(t || '').trim())
    || /目录|议程/.test(String(t || ''));
}

function isClosingTitle(t) {
  return /总结|下一步|行动|closing|next|结论|谢谢/.test(String(t || ''));
}

function looksLikeMetrics(bullets) {
  if (!bullets || bullets.length < 2 || bullets.length > 4) return false;
  const scored = bullets.filter((b) => /\d/.test(b) || /%|％|完成|达成|指标/.test(b));
  return scored.length >= Math.ceil(bullets.length * 0.6);
}

function toMetrics(bullets) {
  return bullets.slice(0, 4).map((b) => {
    const m = b.match(/^(.+?)[：:]\s*(.+)$/);
    if (m) return { value: m[2].slice(0, 18), label: m[1].slice(0, 24), detail: '' };
    const num = b.match(/(\d+(?:\.\d+)?%?)/);
    return {
      value: num ? num[1] : b.slice(0, 12),
      label: b.replace(num?.[1] ?? '', '').replace(/[：:\-—]/g, ' ').trim().slice(0, 24) || '指标',
      detail: '',
    };
  });
}

async function main() {
  const title = argValue('--title') || '演示文稿';
  const out = argValue('--out');
  const outlineFile = argValue('--outline-file');
  const outlineInline = argValue('--outline');
  if (!out) {
    process.stderr.write('missing --out\n');
    process.exit(2);
  }
  let markdown = outlineInline || '';
  if (outlineFile) {
    markdown = await fs.readFile(path.resolve(outlineFile), 'utf8');
  }

  const { createDeck, resolveDesignTokens, layouts } = await buildToolkit();
  const tokens = await resolveDesignTokens({ lang: 'zh-CN', profile: 'cross-platform-zh' });
  const slides = parseOutline(title, markdown);
  const footer = title.slice(0, 28);
  const pptx = await createDeck({
    title,
    subject: `${title} · Digital Employee`,
    lang: 'zh-CN',
    tokens,
  });

  let page = 1;
  slides.forEach((slide, index) => {
    const bullets = [...(slide.bullets || [])];
    const body = [...(slide.body || [])];
    const lines = [...body, ...bullets];

    if (index === 0) {
      const subtitle = body[0] || bullets[0] || '业务汇报材料';
      const metaBits = body.slice(1).concat(bullets.slice(body[0] ? 0 : 1)).slice(0, 2);
      layouts.titleSlide(pptx, tokens, {
        eyebrow: 'Digital Employee',
        title: slide.title || title,
        subtitle,
        meta: metaBits.join(' · ') || 'PilotDeck · 生产级版式',
      });
      page += 1;
      return;
    }

    if (isAgendaTitle(slide.title)) {
      const items = (bullets.length ? bullets : body).slice(0, 8);
      if (items.length >= 3 && items.length <= 5) {
        layouts.timelineSlide(pptx, tokens, {
          kicker: '目录',
          title: slide.title || '目录',
          steps: items.map((label) => ({ label: label.slice(0, 24), detail: '' })),
          footer,
          page,
        });
      } else {
        layouts.agendaSlide(pptx, tokens, {
          title: slide.title || '目录',
          items,
          footer,
          page,
        });
      }
      page += 1;
      return;
    }

    if (index === slides.length - 1 && isClosingTitle(slide.title)) {
      layouts.closingSlide(pptx, tokens, {
        title: slide.title,
        action: (bullets[0] || body[0] || '按行动项推进并跟踪闭环').slice(0, 80),
        contact: bullets.slice(1).concat(body.slice(1)).join(' · ').slice(0, 60) || footer,
      });
      page += 1;
      return;
    }

    // Sparse chapter divider
    if (lines.length <= 1 && !looksLikeMetrics(bullets)) {
      layouts.sectionSlide(pptx, tokens, {
        number: index,
        title: slide.title,
        subtitle: lines[0] || '',
        footer,
        page,
      });
      page += 1;
      return;
    }

    if (looksLikeMetrics(bullets)) {
      layouts.metricSlide(pptx, tokens, {
        kicker: '关键指标',
        title: slide.title,
        metrics: toMetrics(bullets),
        source: footer,
        page,
      });
      page += 1;
      return;
    }

    // Two-column when many bullets
    if (bullets.length >= 6) {
      const mid = Math.ceil(bullets.length / 2);
      layouts.twoColumnSlide(pptx, tokens, {
        kicker: '要点',
        title: slide.title,
        left: { heading: '要点 A', items: bullets.slice(0, mid) },
        right: { heading: '要点 B', items: bullets.slice(mid) },
        footer,
        page,
      });
      page += 1;
      return;
    }

    const merged = [];
    for (const b of body) {
      if (b && !bullets.includes(b)) merged.push(b);
    }
    merged.push(...bullets);
    layouts.bulletSlide(pptx, tokens, {
      kicker: index === 1 ? 'CONTENT' : undefined,
      title: slide.title,
      bullets: merged.slice(0, 8),
      footer,
      page,
    });
    page += 1;
  });

  // Ensure closing if last wasn't closing
  const last = slides[slides.length - 1];
  if (slides.length >= 2 && last && !isClosingTitle(last.title)) {
    layouts.closingSlide(pptx, tokens, {
      title: '下一步',
      action: '确认数据、对齐行动项，并安排复核节奏。',
      contact: footer,
    });
  }

  const output = path.resolve(out);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await pptx.writeFile({ fileName: output });
  process.stdout.write(`${JSON.stringify({ status: 'ok', output, slides: slides.length })}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  process.exit(1);
});
