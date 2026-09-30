# obs/prometheus

| 项 | 值 |
|----|----|
| Profile | `obs` |
| 端口 | 9090 |
| 配置 | `deploy/obs/prometheus.yml` |

抓取：`qzda-monolith` job → `:8100`（qzda-app）；`qzda-coarse` job → `:8100–8103`（host.docker.internal）。与 `make compose-up-monolith` 或 `make compose-up-coarse` 联用时请同时 `--profile obs`。
