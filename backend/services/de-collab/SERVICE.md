# de-collab

| 项 | 值 |
|----|----|
| 端口 | **8101**（coarse） |
| 模块 | collab · employee |
| 逻辑层 | L02 |
| 部署 | **coarse 四进程**；monolith 下并入 **de-app:8100** |

会话 / Copilot SSE / 任务 / 数字伙伴。

**Coarse**：Copilot 模型调用经 `DE_CAP_URL`（默认 `http://127.0.0.1:8102`）转发到 de-cap。  
**Monolith**：同进程内调用 cap 路由，**勿设** `DE_CAP_URL`。

```bash
cd backend && make run-collab       # coarse 单进程
make compose-up-coarse
# monolith 默认：
make run-app
```
