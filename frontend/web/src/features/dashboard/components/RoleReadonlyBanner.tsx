/**
 * M01 · 审计员顶部只读 banner — 透传 `@/components/shared/RoleReadonlyBanner`，
 * 加上 M01 默认样式（间距 + 圆角 + 提示底色）。
 *
 * 该 banner 在多个非 M01 模块复用，因此实际实现留在 components/shared；
 * 本文件仅做语义化 re-export + M01 默认 className。
 */
import type { ComponentProps } from 'react';
import { RoleReadonlyBanner as SharedBanner } from '@/components/shared';

const M01_CLASS = 'mb-3 flex items-start gap-2 rounded-xl bg-[var(--info-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--info)]';

type Props = Omit<ComponentProps<typeof SharedBanner>, 'className'> & { className?: string };

export function RoleReadonlyBanner({ className, ...rest }: Props) {
  return <SharedBanner {...rest} className={className ? `${className} ${M01_CLASS}` : M01_CLASS} />;
}
