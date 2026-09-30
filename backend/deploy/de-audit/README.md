# qzda-audit（已退役）

细端口 `:8095` 已并入控制面（audit-center + 本地 audit sink）。

**Monolith（默认）**：由 **qzda-app:8100** 提供审计路由。

**Coarse**：由 **qzda-sys:8100** 吸收；可选独立二进制 `:8105`（`DE_CROSSCUTTING_SPLIT=1`）。

```bash
make compose-up-monolith   # 或 make run-app
# coarse：
make compose-up-coarse
make run-sys
```
