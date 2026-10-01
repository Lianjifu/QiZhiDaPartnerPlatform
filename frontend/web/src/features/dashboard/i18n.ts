/**
 * M01 运营总览 i18n 键 — 与主 i18n 字典的 `home.*` 命名空间一一对应。
 *
 * 主 `i18n/index.tsx` 会 import 并 spread 这个对象的 zh/en 子对象到 DICTS；
 * 消费方继续用 `useT()` 读 `home.title`、`home.subtitle`、`home.kpi.tasks`、
 * `home.kpi.health`、`error.home`、`notfound.home`，**路径不变**。
 *
 * ⚠️ 不要在这里改 key 路径 —— nav/role-nav/onboarding 都通过 i18n key 反查。
 */
export const homeI18n = {
  zh: {
    'home.title': '运营总览',
    'home.subtitle': '专家团队在岗状态、待处理事项与成本产出',
    'home.kpi.tasks': '今日任务',
    'home.kpi.health': '系统健康度',
    'error.home': '返回运营总览',
    'notfound.home': '返回运营总览',
  },
  en: {
    'home.title': 'Overview',
    'home.subtitle': 'Expert team status, inbox, and cost with outcomes',
    'home.kpi.tasks': 'Tasks Today',
    'home.kpi.health': 'System Health',
    'error.home': 'Back to Overview',
    'notfound.home': 'Back to Overview',
  },
} as const;
