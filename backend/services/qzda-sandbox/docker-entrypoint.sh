#!/usr/bin/env bash
# qzda-sandbox docker entrypoint.
#
# 职责：
# 1. 探测容器是否真的跑在 gVisor (runsc) 运行时下
# 2. 若运行时是 runsc、且本机装了 /usr/local/bin/runsc、设置 QZDA_SANDBOX_RUNTIME_DETECTED
# 3. 解析 QZDA_SANDBOX_SANDBOX：声明的能力 (runsc | gvisor-local) 与实际能力求交集
# 4. 透传到 uvicorn
#
# 检测方法（容器内只能感知 OCI 命名空间，无法看到 host 上的 runsc 进程）：
# - /proc/version 含 "gvisor"           → runsc-ptrace（默认后端）
# - /proc/version 含 "gvisor" + /dev/kvm → runsc-kvm（host 暴露 KVM）
# - /proc/1/cmdline 含 "runc"           → runc
# - 兜底 → process
set -euo pipefail

log() { echo "[entrypoint] $*" >&2; }

detect_runtime() {
  local version=""
  if [[ -r /proc/version ]]; then
    version="$(cat /proc/version 2>/dev/null || true)"
  fi

  if [[ "${version,,}" == *"gvisor"* ]]; then
    if [[ -e /dev/kvm ]]; then
      echo "runsc-kvm"
    else
      echo "runsc-ptrace"
    fi
    return
  fi

  local cmdline=""
  if [[ -r /proc/1/cmdline ]]; then
    cmdline="$(tr '\0' ' ' < /proc/1/cmdline 2>/dev/null || true)"
  fi

  if [[ "$cmdline" == *"runc"* ]]; then
    echo "runc"
    return
  fi

  echo "process"
}

requested="${QZDA_SANDBOX_SANDBOX:-gvisor-local}"
actual="$(detect_runtime)"
export QZDA_SANDBOX_RUNTIME_DETECTED="$actual"

case "$requested:$actual" in
  runsc:runsc-kvm)
    export QZDA_SANDBOX_SANDBOX="runsc"          # 强隔离，KVM 加速
    ;;
  runsc:runsc-ptrace)
    export QZDA_SANDBOX_SANDBOX="runsc"          # 强隔离，ptrace 后端
    ;;
  runsc:runc)
    export QZDA_SANDBOX_SANDBOX="runsc-emulated" # 声明 runsc 但 host 是 runc
    ;;
  runsc:process)
    export QZDA_SANDBOX_SANDBOX="runsc-emulated"
    ;;
  gvisor-local:*)
    export QZDA_SANDBOX_SANDBOX="gvisor-local"   # 进程级 + Docker 网络兜底
    ;;
  *)
    export QZDA_SANDBOX_SANDBOX="$requested"
    ;;
esac

log "QZDA_SANDBOX_SANDBOX=${QZDA_SANDBOX_SANDBOX} requested=${requested} runtime=${actual}"

# exec 通过 tini 做 PID 1 信号转发
exec tini -- "$@"