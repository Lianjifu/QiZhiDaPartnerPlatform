# qzda-cap

| 项 | 值 |
|----|----|
| 端口 | **8102**（coarse） |
| 模块 | model · knowledge · memory · skill · channel |
| 逻辑层 | L04–L07 · L09 |
| 部署 | **coarse 四进程**；monolith 下并入 **qzda-app:8100** |

能力控制面（非执行）。执行面见 qzda-agent-runtime / qzda-rag / qzda-skill-runtime。

对外模型调用：`POST /api/model-invoke`、`POST /api/model-invoke/stream`（凭据 Vault / `model_secrets`）。

```bash
cd backend && make run-cap          # coarse 单进程
make compose-up-coarse
# monolith 默认：
make run-app
# 内网/Ollama：DE_MODEL_ALLOW_PRIVATE=1
```
