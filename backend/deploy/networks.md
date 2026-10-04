# 网络分区

| 网络 | 成员 | 说明 |
|------|------|------|
| `qzda_net` | gateway、**qzda-app**（monolith）、agent-runtime、rag、postgres、redis、… | 控制面与数据面 |
| `qzda_exec_net` | **qzda-sandbox**；qzda-app 双挂以调用沙箱 | 沙箱；无 PG/Redis DSN |
| `qzda_obs_net` | 规划中；当前 obs 组件仍在 `qzda_net` | 可选隔离抓取 |

Compose：`deploy/compose.yml` → `networks.qzda_net` / `qzda_exec_net`。
