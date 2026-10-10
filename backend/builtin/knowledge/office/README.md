# 办公开箱知识包

平台出厂办公制度与规范知识，由 `EnsureBuiltinKnowledgeReady` 在冷启动写入各工作区并标记 **published**，供办公流程与 `de-office` 检索引用。

10 个包按部门归类（旧 `kp.office.*` 已统一改名到 `kp.{hr,admin,sales,market}.*`）：

| 部门 | 包 ID | 名称 |
|-------|-------|------|
| 人事 | `kp.hr.handbook` | 员工手册与制度问答 |
| 人事 | `kp.hr.attendance` | 假勤与考勤标准 |
| 人事 | `kp.hr.compensation` | 薪酬与绩效规则 |
| 行政 | `kp.admin.meeting` | 会议与纪要规范 |
| 行政 | `kp.admin.travel` | 差旅与报销标准 |
| 行政 | `kp.admin.office_doc` | 公文与材料规范 |
| 行政 | `kp.admin.it_selfservice` | IT 自助服务 |
| 销售 | `kp.sales.pipeline` | 销售管道与客户档案 |
| 销售 | `kp.sales.quotation` | 报价单与合同模板 |
| 市场 | `kp.market.content` | 营销内容与渠道 SOP |

配套：

- 流程：`backend/builtin/workflows/wf.office.*`
- 场景三联：`backend/builtin/scenarios/office/manifest.json`
- 技能岗位包：`office`（见 `backend/services/qzda-sandbox/builtin/skills/manifest.json`）