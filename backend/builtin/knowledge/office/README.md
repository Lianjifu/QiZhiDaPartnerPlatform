# 办公开箱知识包

平台出厂办公制度与规范知识，由 `EnsureBuiltinKnowledgeReady` 在冷启动写入各工作区并标记 **published**，供办公流程与 `de-office` 检索引用。

| 包 ID | 用途 |
|-------|------|
| `kp.office.handbook` | 制度手册问答 |
| `kp.office.meeting` | 会议规范与纪要口径 |
| `kp.office.writing` | 公文 / 周报写作规范 |
| `kp.office.leave_travel` | 假勤与出差常识 |
| `kp.office.expense_lite` | 报销前自查常识 |
| `kp.office.it_selfservice` | IT 自助与求助指引 |

配套：

- 流程：`backend/builtin/workflows/wf.office.*`
- 场景三联：`backend/builtin/scenarios/office/manifest.json`
- 技能岗位包：`office`（见 `backend/services/qzda-sandbox/builtin/skills/manifest.json`）
