# 办公场景包

将 **知识 · 技能 · 流程** 绑定为可验收的办公开箱三联，供模板卡片展示配套标签，并作为装配参考。

- Manifest：`manifest.json`（流程 ID → 知识包 / 技能 ID）
- 流程源：`backend/builtin/workflows/wf.office.*`
- 知识源：`backend/builtin/knowledge/office/`
- 技能岗位包：`office`（`backend/services/qzda-sandbox/builtin/skills/manifest.json`）

装载顺序（`apprun`）：技能目录与岗位包 → 知识包 published → 流程模板（个人 `wft-user-*` 保留）。
