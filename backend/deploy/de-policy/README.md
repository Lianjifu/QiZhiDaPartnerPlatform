# qzda-policy（已退役）

细端口 `:8094` 已并入控制面（`POST /v1/evaluate`、零信任策略）。

**Monolith（默认）**：由 **qzda-app:8100** 提供策略评估。

**Coarse**：由 **qzda-sys:8100** 吸收；可选独立二进制 `:8104`（`DE_CROSSCUTTING_SPLIT=1`）。

```bash
make compose-up-monolith   # 或 make run-app
# coarse：
make compose-up-coarse
make run-sys
```
