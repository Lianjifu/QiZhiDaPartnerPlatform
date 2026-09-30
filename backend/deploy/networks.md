# 网络分区

| 网络 | 成员 | 说明 |
|------|------|------|
| `qzda_net` | gateway、**qzda-app**（monolith）或 qzda-sys/collab/cap/workflow（coarse）、agent-runtime、rag、postgres、redis、… | 控制面与数据面 |
| `qzda_exec_net` | **qzda-skill-runtime**；monolith 下 qzda-app 双挂；coarse 下 qzda-collab/qzda-cap 双挂 | 沙箱；无 PG/Redis DSN |
| `qzda_obs_net` | 规划中；当前 obs 组件仍在 `qzda_net` | 可选隔离抓取 |

Compose：`deploy/compose.yml` → `networks.qzda_net` / `qzda_exec_net`。
