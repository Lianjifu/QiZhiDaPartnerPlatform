# 出厂默认流程模板包（Builtin Workflow Pack）

平台内置通用模板源，启动时由 `EnsureBuiltinWorkflowsReady` 装载到 `/api/workflow-templates`。

## 办公开箱 Certified（`department=office`，默认优先展示）

| ID | 名称 |
|----|------|
| `wf.office.ask_policy` | 制度问答与答复留痕 |
| `wf.office.meeting_minutes` | 会议纪要生成与分发 |
| `wf.office.weekly_report` | 周报汇总 |
| `wf.office.doc_review` | 文档审阅与定稿 |
| `wf.office.leave_request` | 请假申请 |
| `wf.office.travel_request` | 出差申请 |
| `wf.office.expense_precheck` | 报销前自查 |
| `wf.office.meeting_book` | 会议预约协作 |
| `wf.office.it_helpdesk` | IT 求助工单 |
| `wf.office.announce` | 通知拟稿与发布 |
| `wf.office.todo_followup` | 待办跟催 |

场景三联绑定见 `backend/builtin/scenarios/office/manifest.json`。  
配套知识见 `backend/builtin/knowledge/office/`。  
配套技能岗位包：`office`（summarize/docx/pdf/pptx/spreadsheets/diagram-maker）。

## 部门审批 Certified

| ID | 名称 |
|----|------|
| `wf.hr.onboarding` | 员工入职开通 |
| `wf.hr.offboarding` | 离职交接与权限回收 |
| `wf.it.access_request` | 权限申请 |
| `wf.fin.expense` | 费用报销（无付款连接器可降级） |
| `wf.fin.purchase` | 采购申请 |
| `wf.ops.ticket_escalate` | 客诉升级闭环 |
| `wf.sales.contract_approve` | 合同与折扣审批 |
| `wf.rd.release_gate` | 发版门禁 |
| `wf.compliance.export_review` | 数据导出审批 |

## 高级库

- `wf.it.incident_mitigate` — 生产事件缓解（需生产写权限槽位）

## 包结构

每个目录含 `template.json`（元数据 + graph + connectors + knowledgePackageIds + requiredSkills + fixtures）与 `README.md`。

环境变量 `QZDA_BUILTIN_WORKFLOWS_DIR` 可覆盖加载根路径。

装载：`EnsureBuiltinWorkflowsReady`（保留个人模板 `wft-user-*`）。控制台默认部门筛「办公通用」；「全部」平铺分页。详见 [环境与数据模式](../../../docs/环境与数据模式.md)。
