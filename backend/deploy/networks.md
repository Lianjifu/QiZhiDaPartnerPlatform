# 网络分区

| 网络 | 成员 | 说明 |
|------|------|------|
| `qzda_net` | gateway、**qzda-app**（monolith）、**qzda-sandbox**、agent-runtime、rag、postgres、redis、… | 控制面与数据面（当前唯一网络） |

Compose：`deploy/compose.yml` → `networks.qzda_net`。

> 原计划的 `qzda_exec_net`（沙箱独占、qzda-app 双挂）在 M10 折叠时随 compose 精简一并下线：沙箱仍**独立成进程/容器**，只是与控制面同处 `qzda_net`，隔离靠沙箱自身的 RunToken HMAC + gVisor/seccomp + 只读根文件系统，不靠网络分段。
