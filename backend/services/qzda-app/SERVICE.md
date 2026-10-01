# qzda-app

Monolith control plane — **sys + collab + cap** in one Go process（方案 A）。

| 项 | 值 |
|----|-----|
| 模式 | `DE_SERVICE=app` / `ModeApp` |
| 端口 | `8100`（`DE_APP_ADDR`） |
| 写域 | `DomainAll`（全 PG 集合） |
| 侧车 | `qzda-sandbox :8093`（必须）；`qzda-workflow`（可选） |

## 启动

```bash
cd backend
make run-app          # 本机裸跑
make compose-up-monolith
make smoke-monolith
```

## 环境变量

| Variable | Default | Description |
|----------|---------|-------------|
| `DE_APP_ADDR` | `:8100` | Listen address |
| `DE_RUNTIME_MODE` | `local` | 进程内 ReAct Harness（不启 qzda-agent） |
| `DE_SANDBOX_RUNTIME_URL` | `http://127.0.0.1:8093` | 技能沙箱 |
| `DE_CAP_URL` | — | **不设置**（同进程，无 peer 委托） |

## 与 coarse 的关系

- `qzda-sys` / `qzda-collab` / `qzda-cap` 二进制保留，用于规模化拆分部署。
- 本地 dev-stack 默认 `DE_STACK=monolith`；`DE_STACK=coarse` 回退四进程。
