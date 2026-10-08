"""阶段 3 遥测基座:OpenTelemetry + prometheus_client。

本模块提供:
- ``correlation_id_var`` : ContextVar,跨 async / sync 边界传递 correlation_id
- ``init_tracing()``     : OTel SDK TracerProvider,OTLP 或 Console exporter
- ``init_metrics()``     : OTel MeterProvider(OTLP 或 Console);prometheus_client
  句柄在模块加载时就建好,供 ``from app.telemetry import skill_executions_total``
  直接拿到。
- ``get_tracer()`` / ``get_meter()`` : OTel Tracer / Meter 实例
- 模块级全局变量 ``skill_executions_total`` / ``skill_execution_duration_seconds``
  / ``skill_in_flight`` / ``egress_blocked_total`` / ``skill_syscalls_total`` /
  ``skill_subprocess_duration_seconds`` : 直接 ``from app.telemetry import ...``
  拿到,可被 monkey-patch 在 host 或容器内任意位置 ``.labels(...).inc()``。

阶段 3 第一切片只埋点不接数据面,后续切片会把这些 metric 接进
``/metrics`` (prometheus 文本格式) 和 OTLP collector。
"""
from __future__ import annotations

import os
from contextvars import ContextVar

from opentelemetry import metrics, trace
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    ConsoleMetricExporter,
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
)
from prometheus_client import Counter, Gauge, Histogram

# ---- correlation_id ----------------------------------------------------------
# ContextVar 在 async / sync 任务间隔离;子进程继承不到,但 /v1/execute 是一次
# HTTP 请求,全程在一个 task 里,够用。
correlation_id_var: ContextVar[str] = ContextVar("correlation_id", default="")


def set_correlation_id(value: str) -> None:
    """注入 correlation_id;供 main.py 在解析请求后调用一次。"""
    correlation_id_var.set(value or "")


def current_correlation_id() -> str:
    """读取当前上下文里的 correlation_id;空字符串表示未设置。"""
    return correlation_id_var.get()


# ---- tracing -----------------------------------------------------------------
_traced = False


def init_tracing() -> None:
    """初始化全局 TracerProvider。幂等:模块级 ``_traced`` 守护。

    - Resource 标记 ``service.name=qzda-sandbox`` /
      ``service.version=phase3``。
    - ``OTEL_EXPORTER_OTLP_ENDPOINT`` 环境变量设置 → ``OTLPSpanExporter``。
      否则 → ``ConsoleSpanExporter``(开发环境友好,容器内也方便调试)。
    """
    global _traced
    if _traced:
        return
    resource = Resource.create(
        {"service.name": "qzda-sandbox", "service.version": "phase3"},
    )
    provider = TracerProvider(resource=resource)
    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        # 延迟导入 OTLP exporter,避免无 OTLP collector 时启动失败。
        try:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                OTLPSpanExporter,
            )

            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter()),
            )
        except Exception as exc:  # noqa: BLE001
            # OTLP exporter 不可用(缺 gRPC / collector)时退回 console,
            # 不阻塞服务启动。
            print(f"[qzda-telemetry] OTLP exporter unavailable: {exc!r}",
                  flush=True)
            provider.add_span_processor(
                BatchSpanProcessor(ConsoleSpanExporter()),
            )
    else:
        provider.add_span_processor(
            BatchSpanProcessor(ConsoleSpanExporter()),
        )
    trace.set_tracer_provider(provider)
    _traced = True


def get_tracer() -> trace.Tracer:
    """拿到本服务的 OTel Tracer;每次返回相同名字的 tracer 实例。"""
    # 即使 init_tracing 没显式调用,SDK 会安装一个默认 NoOp provider,
    # 因此 trace.get_tracer 永远可用。
    return trace.get_tracer("qzda-sandbox")


# ---- prometheus_client 句柄 --------------------------------------------------
# 模块加载时就建好,确保 ``from app.telemetry import skill_executions_total``
# 之类直接导入可用,不依赖 init_metrics() 调用顺序。prometheus_client 句柄
# 与 OTel MeterProvider 是两套并行实现,互不依赖。
skill_executions_total: Counter = Counter(
    "skill_executions_total",
    "Total skill executions",
    ["status", "sandbox"],
)
skill_execution_duration_seconds: Histogram = Histogram(
    "skill_execution_duration_seconds",
    "Skill execution duration",
    ["sandbox"],
    buckets=[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
)
skill_in_flight: Gauge = Gauge(
    "skill_in_flight",
    "Currently running skill executions",
)
egress_blocked_total: Counter = Counter(
    "egress_blocked_total",
    "Egress attempts blocked by allowlist",
    ["host"],
)
skill_syscalls_total: Counter = Counter(
    "skill_syscalls_total",
    "Python-level syscall counts",
    ["kind", "allowed"],
)
skill_subprocess_duration_seconds: Histogram = Histogram(
    "skill_subprocess_duration_seconds",
    "Subprocess execution duration",
    ["exit_code"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
)
# 阶段 4 #8:127.0.0.1:8081 egress proxy 健康度;0 = down,1 = up
egress_proxy_up: Gauge = Gauge(
    "egress_proxy_up",
    "Egress proxy (127.0.0.1:8081) liveness",
)
# 阶段 4 #8:proxy 重启次数(累计),便于发现 flapping
egress_proxy_restart_total: Counter = Counter(
    "egress_proxy_restart_total",
    "Egress proxy supervisor-driven restarts",
)
# 阶段 4 #6:rate limiter 拒绝次数,按 scope 维度(ws_actor / ip / ws)
rate_limit_rejected_total: Counter = Counter(
    "rate_limit_rejected_total",
    "Requests rejected by rate limiter",
    ["scope"],
)


# ---- metrics (OTel MeterProvider) --------------------------------------------
_metrics_ready = False


def init_metrics() -> None:
    """初始化 OTel MeterProvider。幂等:模块级 ``_metrics_ready`` 守护。

    prometheus_client 句柄已在模块加载时建好,本函数仅负责 OTel MeterProvider。
    重复调用直接返回。
    """
    global _metrics_ready
    if _metrics_ready:
        return
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        # 无 OTLP collector 时,console 输出便于本地调试;生产靠 prometheus。
        reader = PeriodicExportingMetricReader(
            ConsoleMetricExporter(),
            export_interval_millis=60_000,
        )
        metrics.set_meter_provider(MeterProvider(
            resource=Resource.create({"service.name": "qzda-sandbox"}),
            metric_readers=[reader],
        ))
    else:
        # OTLP 路径同样由 exporter_otlp 子包提供;延迟导入避免硬依赖。
        try:
            from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
                OTLPMetricExporter,
            )

            reader = PeriodicExportingMetricReader(
                OTLPMetricExporter(),
                export_interval_millis=60_000,
            )
            metrics.set_meter_provider(MeterProvider(
                resource=Resource.create({"service.name": "qzda-sandbox"}),
                metric_readers=[reader],
            ))
        except Exception as exc:  # noqa: BLE001
            print(f"[qzda-telemetry] OTel OTLP metric exporter unavailable: {exc!r}",
                  flush=True)
    _metrics_ready = True


def get_meter() -> metrics.Meter:
    """拿到本服务的 OTel Meter;与 get_tracer 对称。"""
    return metrics.get_meter("qzda-sandbox")
